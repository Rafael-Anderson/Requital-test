import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { isDuplicateKeyError } from '../database/mysql-errors';
import type { CollectionRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { slugify } from '../common/slugify';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { ReorderCollectionsDto } from './dto/reorder-collections.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { deleteMetafieldValues } from '../metafields/metafield-cleanup';
import { CollectionRulesService } from './collection-rules.service';
import type { MatchMode, ParsedRule } from './collection-rules';
import type { PreviewCollectionRulesDto } from './dto/collection-rule.dto';

@Injectable()
export class CollectionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
    private readonly rulesService: CollectionRulesService,
  ) {}

  findAll(ctx: TenantContext) {
    return this.db.query<(CollectionRow & RowDataPacket)[]>(
      `SELECT * FROM collection WHERE shopId = ? ORDER BY displayOrder ASC, name ASC`,
      [ctx.shopId],
    );
  }

  async findOne(ctx: TenantContext, id: number) {
    const rows = await this.db.query<(CollectionRow & RowDataPacket)[]>(
      `SELECT * FROM collection WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Collection ${id} not found`);
    }
    return { ...rows[0], rules: await this.rulesService.load(ctx.shopId, id) };
  }

  async previewRules(ctx: TenantContext, dto: PreviewCollectionRulesDto) {
    const rules = await this.rulesService.validate(ctx.shopId, dto.rules);
    return this.rulesService.preview(
      ctx.shopId,
      dto.matchMode as MatchMode,
      rules,
      dto.page ?? 1,
      dto.pageSize ?? 20,
    );
  }

  async create(ctx: TenantContext, dto: CreateCollectionDto) {
    if (dto.parentCollectionId !== undefined) {
      await this.assertParentBelongsToShop(ctx, dto.parentCollectionId);
    }

    const automated = dto.collectionType === 'automated';
    const rules: ParsedRule[] = automated
      ? await this.rulesService.validate(ctx.shopId, dto.rules ?? [])
      : [];

    try {
      const insertId = await this.db.transaction(async (conn) => {
        const [result] = await conn.query<ResultSetHeader>(
          `INSERT INTO collection (shopId, name, slug, parentCollectionId, displayOrder, image, icon, isFeatured, description, collectionType, matchMode, defaultSort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ctx.shopId,
            dto.name,
            dto.slug ?? slugify(dto.name),
            dto.parentCollectionId ?? null,
            dto.displayOrder ?? 0,
            dto.image ?? null,
            dto.icon ?? null,
            dto.isFeatured ?? false,
            dto.description ?? null,
            automated ? 'automated' : 'manual',
            dto.matchMode ?? 'all',
            dto.defaultSort ?? null,
          ],
        );
        await this.rulesService.replace(conn, ctx.shopId, result.insertId, rules);
        return result.insertId;
      });
      return this.findById(insertId);
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async update(ctx: TenantContext, id: number, dto: UpdateCollectionDto) {
    await this.findOne(ctx, id);

    // Rules are only (re)written for an automated collection; switching back to
    // manual keeps the stored conditions inert rather than deleting them.
    const rules: ParsedRule[] | undefined =
      dto.rules !== undefined
        ? await this.rulesService.validate(ctx.shopId, dto.rules)
        : undefined;

    if (dto.parentCollectionId !== undefined && dto.parentCollectionId !== null) {
      if (dto.parentCollectionId === id) {
        throw new BadRequestException('A collection cannot be its own parent');
      }
      await this.assertParentBelongsToShop(ctx, dto.parentCollectionId);
      await this.assertNoCycle(ctx, id, dto.parentCollectionId);
    }

    try {
      const set = buildSetClause({
        name: dto.name,
        slug: dto.slug,
        displayOrder: dto.displayOrder,
        isFeatured: dto.isFeatured,
        parentCollectionId: dto.parentCollectionId,
        image: dto.image,
        icon: dto.icon,
        description: dto.description,
        collectionType: dto.collectionType,
        matchMode: dto.matchMode,
        defaultSort: dto.defaultSort,
      });
      await this.db.transaction(async (conn) => {
        if (set) {
          await conn.query(
            `UPDATE collection SET ${set.setClause} WHERE id = ? AND shopId = ?`,
            [...set.params, id, ctx.shopId],
          );
        }
        if (rules !== undefined) {
          await this.rulesService.replace(conn, ctx.shopId, id, rules);
        }
      });
      return this.findById(id);
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async remove(ctx: TenantContext, id: number) {
    const collection = await this.findOne(ctx, id);

    const [childRows, productRows] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM collection WHERE parentCollectionId = ?`,
        [id],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM productcollection WHERE collectionId = ?`,
        [id],
      ),
    ]);
    const childCount = Number(childRows[0].c);
    // An automated collection owns no hand-picked products (any left over from
    // before it was switched are dropped with it).
    const productCount =
      collection.collectionType === 'automated' ? 0 : Number(productRows[0].c);
    if (childCount > 0 || productCount > 0) {
      throw new ConflictException(
        `Cannot delete: this collection has ${childCount} sub-collection${childCount === 1 ? '' : 's'} and ${productCount} product${productCount === 1 ? '' : 's'} assigned. Reassign or remove them first.`,
      );
    }

    if (collection.collectionType === 'automated') {
      await this.db.execute(`DELETE FROM productcollection WHERE collectionId = ?`, [id]);
    }
    await this.db.execute(`DELETE FROM collection WHERE id = ?`, [id]);
    await deleteMetafieldValues(this.db, 'collection', [id]);
    await this.auditLogService.logCtx(ctx, {
      action: 'collection.deleted',
      entityType: 'collection',
      entityId: id,
      before: { name: collection.name },
    });
    return { id, deleted: true };
  }

  // Every id must belong to this shop (validated up front, before any
  // writes) — a stray/foreign id in the array rejects the whole request
  // rather than partially reordering. Same pattern as BioLinksService.reorder.
  async reorder(ctx: TenantContext, dto: ReorderCollectionsDto) {
    const existing = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM collection WHERE shopId = ?`,
      [ctx.shopId],
    );
    const existingIds = new Set(existing.map((c) => c.id as number));
    const requestedIds = new Set(dto.ids);
    if (
      dto.ids.length !== existingIds.size ||
      [...existingIds].some((id) => !requestedIds.has(id))
    ) {
      throw new BadRequestException(
        "ids must be exactly the full set of this shop's collection ids",
      );
    }

    await this.db.transaction(async (conn) => {
      for (let index = 0; index < dto.ids.length; index++) {
        await conn.query(`UPDATE collection SET displayOrder = ? WHERE id = ?`, [
          index,
          dto.ids[index],
        ]);
      }
    });
    return this.findAll(ctx);
  }

  private async findById(id: number) {
    const rows = await this.db.query<(CollectionRow & RowDataPacket)[]>(
      `SELECT * FROM collection WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  private async assertParentBelongsToShop(
    ctx: TenantContext,
    parentCollectionId: number,
  ) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM collection WHERE id = ? AND shopId = ?`,
      [parentCollectionId, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new BadRequestException(
        'parentCollectionId is invalid for this shop',
      );
    }
  }

  // Walks the proposed new parent's ancestor chain — if the collection being
  // moved (id) appears anywhere in it, reassigning would create a cycle.
  private async assertNoCycle(
    ctx: TenantContext,
    id: number,
    proposedParentId: number,
  ) {
    let cursor: number | null = proposedParentId;
    const seen = new Set<number>();
    while (cursor !== null) {
      if (cursor === id) {
        throw new BadRequestException(
          'This move would make the collection an ancestor of itself',
        );
      }
      if (seen.has(cursor)) break; // defensive: pre-existing cycle, stop walking
      seen.add(cursor);
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT parentCollectionId FROM collection WHERE id = ? AND shopId = ?`,
        [cursor, ctx.shopId],
      );
      cursor = (rows[0]?.parentCollectionId as number | null | undefined) ?? null;
    }
  }

  private handleDbError(error: unknown): never {
    if (isDuplicateKeyError(error)) {
      throw new ConflictException('A collection with this slug already exists');
    }
    throw error;
  }
}
