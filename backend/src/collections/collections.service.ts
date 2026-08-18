import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
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
    return rows[0];
  }

  async create(ctx: TenantContext, dto: CreateCollectionDto) {
    if (dto.parentCollectionId !== undefined) {
      await this.assertParentBelongsToShop(ctx, dto.parentCollectionId);
    }

    try {
      const result = await this.db.execute(
        `INSERT INTO collection (shopId, name, slug, parentCollectionId, displayOrder, image, isFeatured, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.shopId,
          dto.name,
          dto.slug ?? slugify(dto.name),
          dto.parentCollectionId ?? null,
          dto.displayOrder ?? 0,
          dto.image ?? null,
          dto.isFeatured ?? false,
          dto.description ?? null,
        ],
      );
      return this.findById(result.insertId);
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

    try {
      const set = buildSetClause({
        name: dto.name,
        slug: dto.slug,
        displayOrder: dto.displayOrder,
        isFeatured: dto.isFeatured,
        parentCollectionId: dto.parentCollectionId,
        image: dto.image,
        description: dto.description,
      });
      if (set) {
        await this.db.execute(
          `UPDATE collection SET ${set.setClause} WHERE id = ?`,
          [...set.params, id],
        );
      }
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
    const productCount = Number(productRows[0].c);
    if (childCount > 0 || productCount > 0) {
      throw new ConflictException(
        `Cannot delete: this collection has ${childCount} sub-collection${childCount === 1 ? '' : 's'} and ${productCount} product${productCount === 1 ? '' : 's'} assigned. Reassign or remove them first.`,
      );
    }

    await this.db.execute(`DELETE FROM collection WHERE id = ?`, [id]);
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
