import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { isDuplicateKeyError } from '../database/mysql-errors';
import type { CollectionRow, CollectionruleRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { slugify } from '../common/slugify';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import type { PreviewRulesDto } from './dto/collection-rule.dto';
import {
  buildMembershipWhere,
  validateRules,
  type RuleInput,
} from './collection-rules';
import type { QueryParam } from '../database/database.service';
import { ReorderCollectionsDto } from './dto/reorder-collections.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { deleteMetafieldValues } from '../metafields/metafield-cleanup';

@Injectable()
export class CollectionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
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
    return { ...rows[0], rules: await this.loadRules(ctx.shopId, id) };
  }

  private async loadRules(shopId: number, collectionId: number) {
    const rows = await this.db.query<(CollectionruleRow & RowDataPacket)[]>(
      `SELECT id, field, operator, value FROM collectionrule
        WHERE collectionId = ? AND shopId = ? ORDER BY position ASC, id ASC`,
      [collectionId, shopId],
    );
    return rows.map((r) => ({
      id: r.id,
      field: r.field,
      operator: r.operator,
      value: r.value,
    }));
  }

  // Rules are validated against the allowlist, and a "Category" condition may only
  // point at a MANUAL collection of the SAME shop (an automated one has no
  // productcollection rows to match, and a foreign id must never be accepted).
  private async assertRulesValid(
    ctx: TenantContext,
    rules: RuleInput[],
    ownId?: number,
  ) {
    validateRules(rules);
    const ids = [
      ...new Set(
        rules.filter((r) => r.field === 'category').map((r) => Number(r.value)),
      ),
    ];
    if (ids.length === 0) return;
    if (ownId !== undefined && ids.includes(ownId)) {
      throw new BadRequestException('A Category condition cannot point at the collection itself');
    }
    const found = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM collection
        WHERE shopId = ? AND collectionType = 'manual' AND id IN (${ids.map(() => '?').join(', ')})`,
      [ctx.shopId, ...ids],
    );
    if (found.length !== ids.length) {
      throw new BadRequestException(
        'A Category condition must point at a manual collection of this shop',
      );
    }
  }

  private async replaceRules(
    conn: PoolConnection,
    shopId: number,
    collectionId: number,
    rules: RuleInput[],
  ) {
    await conn.query(`DELETE FROM collectionrule WHERE collectionId = ? AND shopId = ?`, [
      collectionId,
      shopId,
    ]);
    for (let i = 0; i < rules.length; i++) {
      await conn.query(
        `INSERT INTO collectionrule (shopId, collectionId, position, field, operator, value)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [shopId, collectionId, i, rules[i].field, rules[i].operator, rules[i].value ?? null],
      );
    }
  }

  // Members of an automated collection (or of an unsaved rule set, for the editor
  // preview), paginated. Evaluated at read time, always scoped to the shop.
  async previewRules(ctx: TenantContext, dto: PreviewRulesDto) {
    await this.assertRulesValid(ctx, dto.rules);
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const where = buildMembershipWhere(
      ctx.shopId,
      { matchMode: dto.matchMode, rules: dto.rules },
      { onlyAvailable: false },
    );
    const [countRows, products] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM product p WHERE ${where.sql}`,
        where.params,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT p.id, p.name, p.price, p.status, p.thumbnail FROM product p
          WHERE ${where.sql} ORDER BY p.id ASC LIMIT ? OFFSET ?`,
        [...where.params, pageSize, (page - 1) * pageSize] as QueryParam[],
      ),
    ]);
    return {
      total: Number(countRows[0].total),
      page,
      pageSize,
      products: products.map((p) => ({
        id: p.id as number,
        name: p.name as string,
        price: p.price as string,
        status: p.status as string,
        thumbnail: p.thumbnail as string | null,
      })),
    };
  }

  async create(ctx: TenantContext, dto: CreateCollectionDto) {
    if (dto.parentCollectionId !== undefined) {
      await this.assertParentBelongsToShop(ctx, dto.parentCollectionId);
    }

    const collectionType = dto.collectionType ?? 'manual';
    const rules = collectionType === 'automated' ? (dto.rules ?? []) : [];
    if (collectionType === 'manual' && dto.rules && dto.rules.length > 0) {
      throw new BadRequestException('Conditions are only for automated collections');
    }
    await this.assertRulesValid(ctx, rules);

    try {
      const insertId = await this.db.transaction(async (conn) => {
        const [result] = await conn.query<ResultSetHeader>(
          `INSERT INTO collection (shopId, name, slug, parentCollectionId, displayOrder, image, isFeatured, description, collectionType, matchMode)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ctx.shopId,
            dto.name,
            dto.slug ?? slugify(dto.name),
            dto.parentCollectionId ?? null,
            dto.displayOrder ?? 0,
            dto.image ?? null,
            dto.isFeatured ?? false,
            dto.description ?? null,
            collectionType,
            dto.matchMode ?? 'all',
          ],
        );
        await this.replaceRules(conn, ctx.shopId, result.insertId, rules);
        return result.insertId;
      });
      return this.findOne(ctx, insertId);
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async update(ctx: TenantContext, id: number, dto: UpdateCollectionDto) {
    await this.findOne(ctx, id);

    if (dto.parentCollectionId !== undefined && dto.parentCollectionId !== null) {
      if (dto.parentCollectionId === id) {
        throw new BadRequestException('A collection cannot be its own parent');
      }
      await this.assertParentBelongsToShop(ctx, dto.parentCollectionId);
      await this.assertNoCycle(ctx, id, dto.parentCollectionId);
    }

    // Switching to manual drops the conditions; switching to (or staying) automated
    // replaces them only when `rules` is sent.
    const existing = await this.findOne(ctx, id);
    const nextType = dto.collectionType ?? existing.collectionType;
    let nextRules: RuleInput[] | undefined = dto.rules;
    if (nextType === 'manual') {
      if (dto.rules && dto.rules.length > 0) {
        throw new BadRequestException('Conditions are only for automated collections');
      }
      if (existing.collectionType === 'automated') nextRules = [];
    }
    if (nextRules !== undefined) await this.assertRulesValid(ctx, nextRules, id);

    try {
      const set = buildSetClause({
        name: dto.name,
        slug: dto.slug,
        displayOrder: dto.displayOrder,
        isFeatured: dto.isFeatured,
        parentCollectionId: dto.parentCollectionId,
        image: dto.image,
        description: dto.description,
        collectionType: dto.collectionType,
        matchMode: dto.matchMode,
      });
      await this.db.transaction(async (conn) => {
        if (set) {
          await conn.query(`UPDATE collection SET ${set.setClause} WHERE id = ? AND shopId = ?`, [
            ...set.params,
            id,
            ctx.shopId,
          ]);
        }
        if (nextRules !== undefined) {
          await this.replaceRules(conn, ctx.shopId, id, nextRules);
        }
      });
      return this.findOne(ctx, id);
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
    const productCount = Number(productRows[0].c);
    if (childCount > 0 || productCount > 0) {
      throw new ConflictException(
        `Cannot delete: this collection has ${childCount} sub-collection${childCount === 1 ? '' : 's'} and ${productCount} product${productCount === 1 ? '' : 's'} assigned. Reassign or remove them first.`,
      );
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
