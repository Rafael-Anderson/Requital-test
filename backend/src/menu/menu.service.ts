import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  CreateMenuItemDto,
  MenuColumnInput,
  MenuItemStyleInput,
} from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { ReorderMenuItemsDto } from './dto/reorder-menu-items.dto';
import type { MenuItemType } from './menu-constants';

export interface CollectionSummary {
  id: number;
  name: string;
  slug: string;
}

export interface ProductSummary {
  id: number;
  name: string;
  slug: string;
}

interface AssembledColumnLink {
  id: number;
  label: string;
  linkType: string;
  featured: boolean;
  sortOrder: number;
  collection: CollectionSummary | null;
  product: ProductSummary | null;
  customUrl: string | null;
}

interface AssembledColumn {
  id: number;
  title: string;
  sortOrder: number;
  links: AssembledColumnLink[];
}

interface AssembledMenuItem {
  id: number;
  shopId: number;
  label: string;
  type: string;
  displayOrder: number;
  collectionId: number | null;
  collection: CollectionSummary | null;
  menuitemcollection: {
    collectionId: number;
    sortOrder: number;
    collection: CollectionSummary;
  }[];
  columns: AssembledColumn[];
  style: MenuItemStyleInput | null;
}

// The storefront's merchant-configurable top-bar "Menu" (Phase C) — a
// merchant-ordered list of LINK (one Collection) / DROPDOWN (several
// Collections) items. Admin-only end to end, same tier as Collections.
@Injectable()
export class MenuService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async findAll(ctx: TenantContext) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM menuitem WHERE shopId = ? ORDER BY displayOrder ASC`,
      [ctx.shopId],
    );
    const ids = rows.map((r) => r.id as number);
    const items = await this.loadMenuItemsWithRelations(ids);
    return ids.map((id) => this.toAdminResponse(items.get(id)!));
  }

  async findOne(ctx: TenantContext, id: number) {
    const item = await this.assertBelongsToShop(ctx, id);
    return this.toAdminResponse(item);
  }

  async create(ctx: TenantContext, dto: CreateMenuItemDto) {
    this.assertFieldsMatchType(dto.type, dto);
    if (dto.collectionId) {
      await this.assertCollectionBelongsToShop(ctx, dto.collectionId);
    }
    if (dto.collections?.length) {
      await this.assertCollectionsBelongToShop(
        ctx,
        dto.collections.map((c) => c.collectionId),
      );
    }
    if (dto.columns?.length) {
      await this.assertColumnLinksBelongToShop(ctx, dto.columns);
    }

    const newId = await this.db.transaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO menuitem (shopId, label, type, collectionId, displayOrder, style) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          ctx.shopId,
          dto.label,
          dto.type,
          dto.type === 'LINK' ? dto.collectionId : null,
          dto.displayOrder ?? 0,
          dto.style ? JSON.stringify(dto.style) : null,
        ],
      );
      const itemId = (result as { insertId: number }).insertId;
      if (dto.type === 'DROPDOWN' && dto.collections?.length) {
        const placeholders = dto.collections.map(() => '(?, ?, ?)').join(', ');
        await conn.query(
          `INSERT INTO menuitemcollection (menuItemId, collectionId, sortOrder) VALUES ${placeholders}`,
          dto.collections.flatMap((c) => [itemId, c.collectionId, c.sortOrder]),
        );
      }
      if (dto.type === 'MEGA' && dto.columns?.length) {
        await this.insertColumns(conn, itemId, dto.columns);
      }
      return itemId;
    });
    return this.findOne(ctx, newId);
  }

  async update(ctx: TenantContext, id: number, dto: UpdateMenuItemDto) {
    const existing = await this.assertBelongsToShop(ctx, id);

    const touchesTarget =
      dto.type !== undefined ||
      dto.collectionId !== undefined ||
      dto.collections !== undefined ||
      dto.columns !== undefined;
    const effectiveType = dto.type ?? (existing.type as MenuItemType);

    let collectionId: number | null | undefined;
    let collections: { collectionId: number; sortOrder: number }[] | undefined;
    let columns: MenuColumnInput[] | undefined;
    if (touchesTarget) {
      const merged = {
        collectionId: dto.collectionId,
        collections: dto.collections,
        columns: dto.columns,
      };
      this.assertFieldsMatchType(effectiveType, merged);
      collectionId = effectiveType === 'LINK' ? (dto.collectionId ?? null) : null;
      collections = effectiveType === 'DROPDOWN' ? dto.collections : [];
      columns = effectiveType === 'MEGA' ? dto.columns : [];

      if (collectionId) {
        await this.assertCollectionBelongsToShop(ctx, collectionId);
      }
      if (collections?.length) {
        await this.assertCollectionsBelongToShop(
          ctx,
          collections.map((c) => c.collectionId),
        );
      }
      if (columns?.length) {
        await this.assertColumnLinksBelongToShop(ctx, columns);
      }
    }

    await this.db.transaction(async (conn) => {
      const setParts: string[] = [];
      const setParams: (string | number | null)[] = [];
      if (dto.label !== undefined) {
        setParts.push('label = ?');
        setParams.push(dto.label);
      }
      if (dto.type !== undefined) {
        setParts.push('type = ?');
        setParams.push(dto.type);
      }
      if (dto.displayOrder !== undefined) {
        setParts.push('displayOrder = ?');
        setParams.push(dto.displayOrder);
      }
      if (dto.style !== undefined) {
        setParts.push('style = ?');
        setParams.push(JSON.stringify(dto.style));
      }
      if (touchesTarget) {
        setParts.push('collectionId = ?');
        setParams.push(collectionId ?? null);
      }
      if (setParts.length > 0) {
        await conn.query(`UPDATE menuitem SET ${setParts.join(', ')} WHERE id = ?`, [
          ...setParams,
          id,
        ]);
      }
      if (touchesTarget) {
        await conn.query(`DELETE FROM menuitemcollection WHERE menuItemId = ?`, [id]);
        if (collections?.length) {
          const placeholders = collections.map(() => '(?, ?, ?)').join(', ');
          await conn.query(
            `INSERT INTO menuitemcollection (menuItemId, collectionId, sortOrder) VALUES ${placeholders}`,
            collections.flatMap((c) => [id, c.collectionId, c.sortOrder]),
          );
        }
        // ON DELETE CASCADE on menucolumnlink.menuColumnId takes the links
        // with it — no separate DELETE needed for the child table.
        await conn.query(`DELETE FROM menucolumn WHERE menuItemId = ?`, [id]);
        if (columns?.length) {
          await this.insertColumns(conn, id, columns);
        }
      }
    });
    return this.findOne(ctx, id);
  }

  async remove(ctx: TenantContext, id: number) {
    const item = await this.assertBelongsToShop(ctx, id);
    await this.db.execute(`DELETE FROM menuitem WHERE id = ?`, [id]);
    await this.auditLogService.logCtx(ctx, {
      action: 'menuitem.deleted',
      entityType: 'menuitem',
      entityId: id,
      before: { label: item.label },
    });
    return { id, deleted: true };
  }

  // ---------- Public (storefront) ----------

  async listPublic(shopId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM menuitem WHERE shopId = ? ORDER BY displayOrder ASC`,
      [shopId],
    );
    const ids = rows.map((r) => r.id as number);
    const items = await this.loadMenuItemsWithRelations(ids);
    return ids.map((id) => this.toAdminResponse(items.get(id)!));
  }

  // ---------- Admin CRUD (cont'd) ----------

  // Every id must belong to this shop, same pattern as
  // BioLinksService.reorder / CollectionsService.reorder.
  async reorder(ctx: TenantContext, dto: ReorderMenuItemsDto) {
    const existing = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM menuitem WHERE shopId = ?`,
      [ctx.shopId],
    );
    const existingIds = new Set(existing.map((i) => i.id as number));
    const requestedIds = new Set(dto.ids);
    if (
      dto.ids.length !== existingIds.size ||
      [...existingIds].some((id) => !requestedIds.has(id))
    ) {
      throw new BadRequestException(
        "ids must be exactly the full set of this shop's menu item ids",
      );
    }

    await this.db.transaction(async (conn) => {
      for (let index = 0; index < dto.ids.length; index++) {
        await conn.query(`UPDATE menuitem SET displayOrder = ? WHERE id = ?`, [
          index,
          dto.ids[index],
        ]);
      }
    });
    return this.findAll(ctx);
  }

  // Batch-loads every relation menuItemInclude used to fetch in one Prisma
  // nested include, as separate WHERE...IN queries grouped in JS.
  private async loadMenuItemsWithRelations(
    ids: number[],
  ): Promise<Map<number, AssembledMenuItem>> {
    const result = new Map<number, AssembledMenuItem>();
    if (ids.length === 0) return result;
    const idList = ids.map(() => '?').join(', ');
    const [items, memberships, columnRows] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT mi.id, mi.shopId, mi.label, mi.type, mi.displayOrder, mi.collectionId, mi.style,
                c.id AS colId, c.name AS colName, c.slug AS colSlug
         FROM menuitem mi
         LEFT JOIN collection c ON c.id = mi.collectionId
         WHERE mi.id IN (${idList})`,
        ids,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT mic.menuItemId, mic.collectionId, mic.sortOrder,
                c.id AS colId, c.name AS colName, c.slug AS colSlug
         FROM menuitemcollection mic
         JOIN collection c ON c.id = mic.collectionId
         WHERE mic.menuItemId IN (${idList})
         ORDER BY mic.sortOrder ASC`,
        ids,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT id, menuItemId, title, sortOrder FROM menucolumn WHERE menuItemId IN (${idList}) ORDER BY sortOrder ASC`,
        ids,
      ),
    ]);
    const columnIds = columnRows.map((r) => r.id as number);
    const linkRows =
      columnIds.length === 0
        ? []
        : await this.db.query<RowDataPacket[]>(
            `SELECT l.id, l.menuColumnId, l.label, l.linkType, l.collectionId, l.productId, l.customUrl, l.featured, l.sortOrder,
                    c.id AS colId, c.name AS colName, c.slug AS colSlug,
                    p.id AS prodId, p.name AS prodName, p.slug AS prodSlug
             FROM menucolumnlink l
             LEFT JOIN collection c ON c.id = l.collectionId
             LEFT JOIN product p ON p.id = l.productId
             WHERE l.menuColumnId IN (${columnIds.map(() => '?').join(', ')})
             ORDER BY l.sortOrder ASC`,
            columnIds,
          );
    const linksByColumn = new Map<number, AssembledColumnLink[]>();
    for (const row of linkRows) {
      const menuColumnId = row.menuColumnId as number;
      const list = linksByColumn.get(menuColumnId) ?? [];
      list.push({
        id: row.id as number,
        label: row.label as string,
        linkType: row.linkType as string,
        featured: !!row.featured,
        sortOrder: row.sortOrder as number,
        collection:
          row.colId !== null
            ? { id: row.colId as number, name: row.colName as string, slug: row.colSlug as string }
            : null,
        product:
          row.prodId !== null
            ? { id: row.prodId as number, name: row.prodName as string, slug: row.prodSlug as string }
            : null,
        customUrl: row.customUrl as string | null,
      });
      linksByColumn.set(menuColumnId, list);
    }
    const columnsByItem = new Map<number, AssembledColumn[]>();
    for (const row of columnRows) {
      const menuItemId = row.menuItemId as number;
      const list = columnsByItem.get(menuItemId) ?? [];
      list.push({
        id: row.id as number,
        title: row.title as string,
        sortOrder: row.sortOrder as number,
        links: linksByColumn.get(row.id as number) ?? [],
      });
      columnsByItem.set(menuItemId, list);
    }
    const membershipsByItem = new Map<
      number,
      { collectionId: number; sortOrder: number; collection: CollectionSummary }[]
    >();
    for (const row of memberships) {
      const menuItemId = row.menuItemId as number;
      const list = membershipsByItem.get(menuItemId) ?? [];
      list.push({
        collectionId: row.collectionId as number,
        sortOrder: row.sortOrder as number,
        collection: {
          id: row.colId as number,
          name: row.colName as string,
          slug: row.colSlug as string,
        },
      });
      membershipsByItem.set(menuItemId, list);
    }
    for (const item of items) {
      const id = item.id as number;
      result.set(id, {
        id,
        shopId: item.shopId as number,
        label: item.label as string,
        type: item.type as string,
        displayOrder: item.displayOrder as number,
        collectionId: item.collectionId as number | null,
        collection:
          item.colId !== null
            ? {
                id: item.colId as number,
                name: item.colName as string,
                slug: item.colSlug as string,
              }
            : null,
        menuitemcollection: membershipsByItem.get(id) ?? [],
        columns: columnsByItem.get(id) ?? [],
        style: (item.style as MenuItemStyleInput | null) ?? null,
      });
    }
    return result;
  }

  private assertFieldsMatchType(
    type: MenuItemType,
    fields: {
      collectionId?: number;
      collections?: { collectionId: number; sortOrder: number }[];
      columns?: MenuColumnInput[];
    },
  ) {
    if (type === 'LINK') {
      if (!fields.collectionId) {
        throw new BadRequestException(
          "type 'LINK' requires collectionId to be set",
        );
      }
      if (fields.collections?.length) {
        throw new BadRequestException(
          "type 'LINK' must not set collections (that's DROPDOWN-only)",
        );
      }
      if (fields.columns?.length) {
        throw new BadRequestException(
          "type 'LINK' must not set columns (that's MEGA-only)",
        );
      }
    } else if (type === 'DROPDOWN') {
      if (fields.collectionId) {
        throw new BadRequestException(
          "type 'DROPDOWN' must not set collectionId (that's LINK-only)",
        );
      }
      if (!fields.collections?.length) {
        throw new BadRequestException(
          "type 'DROPDOWN' requires at least one collection",
        );
      }
      if (fields.columns?.length) {
        throw new BadRequestException(
          "type 'DROPDOWN' must not set columns (that's MEGA-only)",
        );
      }
    } else {
      if (fields.collectionId || fields.collections?.length) {
        throw new BadRequestException(
          "type 'MEGA' must not set collectionId/collections (use columns instead)",
        );
      }
      if (!fields.columns?.length) {
        throw new BadRequestException(
          "type 'MEGA' requires at least one column",
        );
      }
      for (const column of fields.columns) {
        if (!column.links?.length) {
          throw new BadRequestException(
            `Column '${column.title}' requires at least one link`,
          );
        }
        for (const link of column.links) {
          this.assertColumnLinkFieldsMatchType(link);
        }
      }
    }
  }

  private assertColumnLinkFieldsMatchType(link: {
    label: string;
    linkType: string;
    collectionId?: number;
    productId?: number;
    customUrl?: string;
  }) {
    const setFields = [link.collectionId, link.productId, link.customUrl].filter(
      (v) => v !== undefined && v !== null && v !== '',
    );
    if (setFields.length !== 1) {
      throw new BadRequestException(
        `Link '${link.label}' must set exactly one of collectionId/productId/customUrl`,
      );
    }
    if (link.linkType === 'COLLECTION' && link.collectionId === undefined) {
      throw new BadRequestException(
        `Link with linkType 'COLLECTION' requires collectionId`,
      );
    }
    if (link.linkType === 'PRODUCT' && link.productId === undefined) {
      throw new BadRequestException(
        `Link with linkType 'PRODUCT' requires productId`,
      );
    }
    if (link.linkType === 'CUSTOM' && !link.customUrl) {
      throw new BadRequestException(
        `Link with linkType 'CUSTOM' requires customUrl`,
      );
    }
  }

  private async assertBelongsToShop(
    ctx: TenantContext,
    id: number,
  ): Promise<AssembledMenuItem> {
    const ownRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM menuitem WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (ownRows.length === 0) {
      throw new NotFoundException(`Menu item ${id} not found`);
    }
    const items = await this.loadMenuItemsWithRelations([id]);
    return items.get(id)!;
  }

  private async assertCollectionBelongsToShop(
    ctx: TenantContext,
    collectionId: number,
  ) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM collection WHERE id = ? AND shopId = ?`,
      [collectionId, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Collection ${collectionId} not found`);
    }
  }

  private async assertCollectionsBelongToShop(
    ctx: TenantContext,
    collectionIds: number[],
  ) {
    const uniqueIds = [...new Set(collectionIds)];
    if (uniqueIds.length === 0) return;
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM collection WHERE id IN (${uniqueIds.map(() => '?').join(', ')}) AND shopId = ?`,
      [...uniqueIds, ctx.shopId],
    );
    if (Number(rows[0].c) !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more collectionIds are invalid for this shop',
      );
    }
  }

  private async assertProductsBelongToShop(
    ctx: TenantContext,
    productIds: number[],
  ) {
    const uniqueIds = [...new Set(productIds)];
    if (uniqueIds.length === 0) return;
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM product WHERE id IN (${uniqueIds.map(() => '?').join(', ')}) AND shopId = ?`,
      [...uniqueIds, ctx.shopId],
    );
    if (Number(rows[0].c) !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more productIds are invalid for this shop',
      );
    }
  }

  private async assertColumnLinksBelongToShop(
    ctx: TenantContext,
    columns: MenuColumnInput[],
  ) {
    const collectionIds = columns
      .flatMap((c) => c.links)
      .map((l) => l.collectionId)
      .filter((id): id is number => id !== undefined);
    const productIds = columns
      .flatMap((c) => c.links)
      .map((l) => l.productId)
      .filter((id): id is number => id !== undefined);
    await Promise.all([
      this.assertCollectionsBelongToShop(ctx, collectionIds),
      this.assertProductsBelongToShop(ctx, productIds),
    ]);
  }

  // Full replace helper shared by create()/update() — caller has already
  // deleted any prior menucolumn rows for this item (cascading to their
  // links) before calling this, or is inserting for the first time.
  private async insertColumns(
    conn: PoolConnection,
    menuItemId: number,
    columns: MenuColumnInput[],
  ) {
    for (const column of columns) {
      const [result] = await conn.query(
        `INSERT INTO menucolumn (menuItemId, title, sortOrder) VALUES (?, ?, ?)`,
        [menuItemId, column.title, column.sortOrder],
      );
      const columnId = (result as { insertId: number }).insertId;
      const placeholders = column.links.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      await conn.query(
        `INSERT INTO menucolumnlink (menuColumnId, label, linkType, collectionId, productId, customUrl, featured, sortOrder) VALUES ${placeholders}`,
        column.links.flatMap((l) => [
          columnId,
          l.label,
          l.linkType,
          l.collectionId ?? null,
          l.productId ?? null,
          l.customUrl ?? null,
          l.featured ?? false,
          l.sortOrder,
        ]),
      );
    }
  }

  private toAdminResponse(item: AssembledMenuItem) {
    return {
      id: item.id,
      label: item.label,
      type: item.type,
      displayOrder: item.displayOrder,
      style: item.style,
      collectionId: item.collectionId,
      collection: item.collection,
      collections: item.menuitemcollection.map((mic) => ({
        collectionId: mic.collectionId,
        sortOrder: mic.sortOrder,
        collection: mic.collection,
      })),
      columns: item.columns.map((col) => ({
        id: col.id,
        title: col.title,
        sortOrder: col.sortOrder,
        links: col.links.map((link) => ({
          id: link.id,
          label: link.label,
          linkType: link.linkType,
          featured: link.featured,
          sortOrder: link.sortOrder,
          collection: link.collection,
          product: link.product,
          customUrl: link.customUrl,
        })),
      })),
    };
  }
}
