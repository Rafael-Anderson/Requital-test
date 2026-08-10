import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { QueryParam } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { isDuplicateKeyError } from '../database/mysql-errors';
import type { TemplateRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { slugify } from '../common/slugify';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { SetTemplateProductsDto } from './dto/set-template-products.dto';
import { SetTemplateCollectionsDto } from './dto/set-template-collections.dto';
import type { TemplateRulesDto } from './dto/template-rules.dto';

// Public-facing summary shape both PublicService (storefront) and the admin
// list reuse — full product records are resolved separately (see
// resolveProductIds' own comment on why this stays IDs-only here).
export interface TemplateSummary {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  image: string | null;
  type: string;
}

@Injectable()
export class TemplatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ---------- Admin CRUD ----------

  async findAll(ctx: TenantContext) {
    const templates = await this.db.query<(TemplateRow & RowDataPacket)[]>(
      `SELECT * FROM template WHERE shopId = ? ORDER BY displayOrder ASC, title ASC`,
      [ctx.shopId],
    );
    // RULE_BASED membership isn't a stored relation (see resolveProductIds),
    // so a real product count means actually resolving each one — no
    // shortcut here, that would just report 0 for every rule-based row.
    // Shop-scale template counts make this cheap enough not to need a
    // lighter count-only path.
    return Promise.all(
      templates.map(async (c) => {
        const productIds = await this.resolveProductIds(ctx.shopId, c);
        return this.toAdminResponse(c, productIds.length);
      }),
    );
  }

  async findOne(ctx: TenantContext, id: number) {
    const template = await this.assertBelongsToShop(ctx, id);
    const productIds = await this.resolveProductIds(ctx.shopId, template);
    // COLLECTION_GROUP's own membership editor needs the raw
    // templatecollection rows (which Collections, in what order) — a
    // different shape than productIds (the resolved union of their
    // products), which every type already returns above.
    const collectionMemberships =
      template.type === 'COLLECTION_GROUP'
        ? await this.db.query<RowDataPacket[]>(
            `SELECT collectionId, sortOrder FROM templatecollection WHERE templateId = ? ORDER BY sortOrder ASC`,
            [id],
          )
        : undefined;
    return {
      ...this.toAdminResponse(template, productIds.length),
      productIds,
      ...(collectionMemberships && { collections: collectionMemberships }),
    };
  }

  async create(ctx: TenantContext, dto: CreateTemplateDto) {
    this.assertRulesMatchType(dto.type, dto.rules);
    let insertId: number;
    try {
      const result = await this.db.execute(
        `INSERT INTO template (shopId, title, slug, description, image, type, rules, isActive, displayOrder)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.shopId,
          dto.title,
          dto.slug ?? slugify(dto.title),
          dto.description ?? null,
          dto.image ?? null,
          dto.type,
          dto.type === 'RULE_BASED' ? JSON.stringify(dto.rules) : null,
          dto.isActive ?? true,
          dto.displayOrder ?? 0,
        ],
      );
      insertId = result.insertId;
    } catch (error) {
      this.handleDbError(error);
    }
    // Routed through findOne rather than returning the raw insert result —
    // same shape (productCount included) every other admin response has.
    return this.findOne(ctx, insertId);
  }

  async update(ctx: TenantContext, id: number, dto: UpdateTemplateDto) {
    const existing = await this.assertBelongsToShop(ctx, id);
    const effectiveType =
      dto.type ??
      (existing.type as 'MANUAL' | 'RULE_BASED' | 'COLLECTION_GROUP');
    // Rules are only re-validated when this request actually touches type or
    // rules — a plain title/description edit shouldn't need to resend rules.
    const touchesRules = dto.type !== undefined || dto.rules !== undefined;
    if (touchesRules) {
      this.assertRulesMatchType(
        effectiveType,
        dto.rules ?? (existing.rules as TemplateRulesDto | null) ?? undefined,
      );
    }
    // Mirrors the pre-migration semantics exactly: touching type/rules while
    // staying RULE_BASED with no new rules payload leaves the existing rules
    // untouched (validated above against the existing fallback); flipping to
    // a non-RULE_BASED type always clears rules to null.
    let rulesValue: string | null | undefined;
    if (touchesRules) {
      rulesValue =
        effectiveType === 'RULE_BASED'
          ? dto.rules !== undefined
            ? JSON.stringify(dto.rules)
            : undefined
          : null;
    }

    try {
      const set = buildSetClause({
        title: dto.title,
        slug: dto.slug,
        description: dto.description,
        image: dto.image,
        type: dto.type,
        rules: rulesValue,
        isActive: dto.isActive,
        displayOrder: dto.displayOrder,
      });
      if (set) {
        await this.db.execute(`UPDATE template SET ${set.setClause} WHERE id = ?`, [
          ...set.params,
          id,
        ]);
      }
    } catch (error) {
      this.handleDbError(error);
    }
    return this.findOne(ctx, id);
  }

  async remove(ctx: TenantContext, id: number) {
    const template = await this.assertBelongsToShop(ctx, id);
    await this.db.execute(`DELETE FROM template WHERE id = ?`, [id]);
    await this.auditLogService.logCtx(ctx, {
      action: 'template.deleted',
      entityType: 'template',
      entityId: id,
      before: { title: template.title },
    });
    return { id, deleted: true };
  }

  // MANUAL only — full replace of membership + order, same "caller sends
  // the complete desired state" convention as reorderBioLinks. Every
  // productId must belong to this shop, checked up front so a bad id
  // rejects the whole request rather than partially saving.
  async setProducts(
    ctx: TenantContext,
    id: number,
    dto: SetTemplateProductsDto,
  ) {
    const template = await this.assertBelongsToShop(ctx, id);
    if (template.type !== 'MANUAL') {
      throw new BadRequestException(
        'Only a MANUAL template has an explicit product list to set',
      );
    }
    const productIds = dto.products.map((p) => p.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException('productId must not repeat');
    }
    if (productIds.length > 0) {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM product WHERE id IN (${productIds.map(() => '?').join(', ')}) AND shopId = ?`,
        [...productIds, ctx.shopId],
      );
      if (Number(rows[0].c) !== productIds.length) {
        throw new BadRequestException(
          'One or more productIds are invalid for this shop',
        );
      }
    }

    await this.db.transaction(async (conn) => {
      await conn.query(`DELETE FROM templateproduct WHERE templateId = ?`, [id]);
      if (dto.products.length > 0) {
        const placeholders = dto.products.map(() => '(?, ?, ?)').join(', ');
        await conn.query(
          `INSERT INTO templateproduct (templateId, productId, sortOrder) VALUES ${placeholders}`,
          dto.products.flatMap((p) => [id, p.productId, p.sortOrder]),
        );
      }
    });
    return this.findOne(ctx, id);
  }

  // COLLECTION_GROUP only — full replace of which Collections this Template
  // groups, same "caller sends the complete desired state" convention as
  // setProducts. Every collectionId must belong to this shop.
  async setCollections(
    ctx: TenantContext,
    id: number,
    dto: SetTemplateCollectionsDto,
  ) {
    const template = await this.assertBelongsToShop(ctx, id);
    if (template.type !== 'COLLECTION_GROUP') {
      throw new BadRequestException(
        'Only a COLLECTION_GROUP template has a Collections list to set',
      );
    }
    const collectionIds = dto.collections.map((c) => c.collectionId);
    if (new Set(collectionIds).size !== collectionIds.length) {
      throw new BadRequestException('collectionId must not repeat');
    }
    if (collectionIds.length > 0) {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM collection WHERE id IN (${collectionIds.map(() => '?').join(', ')}) AND shopId = ?`,
        [...collectionIds, ctx.shopId],
      );
      if (Number(rows[0].c) !== collectionIds.length) {
        throw new BadRequestException(
          'One or more collectionIds are invalid for this shop',
        );
      }
    }

    await this.db.transaction(async (conn) => {
      await conn.query(`DELETE FROM templatecollection WHERE templateId = ?`, [id]);
      if (dto.collections.length > 0) {
        const placeholders = dto.collections.map(() => '(?, ?, ?)').join(', ');
        await conn.query(
          `INSERT INTO templatecollection (templateId, collectionId, sortOrder) VALUES ${placeholders}`,
          dto.collections.flatMap((c) => [id, c.collectionId, c.sortOrder]),
        );
      }
    });
    return this.findOne(ctx, id);
  }

  // ---------- Public (storefront) ----------

  async listPublic(shopId: number): Promise<TemplateSummary[]> {
    return this.db.query<(TemplateSummary & RowDataPacket)[]>(
      `SELECT id, title, slug, description, image, type FROM template
       WHERE shopId = ? AND isActive = TRUE
       ORDER BY displayOrder ASC, title ASC`,
      [shopId],
    );
  }

  // Null (not throw) when not found/inactive — PublicService turns that
  // into the 404, same layering as every other public lookup in this app
  // (e.g. PublicService.getProductBySlug does its own NotFoundException,
  // this layer just reports absence).
  async getPublicBySlug(shopId: number, slug: string) {
    const rows = await this.db.query<(TemplateRow & RowDataPacket)[]>(
      `SELECT * FROM template WHERE shopId = ? AND slug = ? AND isActive = TRUE`,
      [shopId, slug],
    );
    const template = rows[0];
    if (!template) return null;
    const productIds = await this.resolveProductIds(shopId, template);
    return { summary: template as unknown as TemplateSummary, productIds };
  }

  // MANUAL: the merchant's own explicit order. RULE_BASED: computed at read
  // time against the live product table — membership is never stored, so a
  // price change or a newly-tagged product is reflected immediately without
  // any resync job. Ordered newest-first by default (documented, not
  // configurable — a fixed rule set doesn't need its own sort-order UI on
  // top of the condition fields it already has).
  async resolveProductIds(
    shopId: number,
    template: { id: number; type: string; rules: unknown },
  ): Promise<number[]> {
    if (template.type === 'MANUAL') {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT productId FROM templateproduct WHERE templateId = ? ORDER BY sortOrder ASC`,
        [template.id],
      );
      return rows.map((r) => r.productId as number);
    }

    if (template.type === 'COLLECTION_GROUP') {
      const memberships = await this.db.query<RowDataPacket[]>(
        `SELECT collectionId FROM templatecollection WHERE templateId = ? ORDER BY sortOrder ASC`,
        [template.id],
      );
      // Union across member Collections, de-duplicated, preserving each
      // Collection's own product order and the Collections' own sortOrder —
      // a product tagged into two member Collections only appears once.
      const seen = new Set<number>();
      const ids: number[] = [];
      for (const { collectionId } of memberships) {
        const rows = await this.db.query<RowDataPacket[]>(
          `SELECT pc.productId AS productId FROM productcollection pc
           JOIN product p ON p.id = pc.productId
           WHERE pc.collectionId = ? AND p.shopId = ? AND p.status = 'Available'`,
          [collectionId as number, shopId],
        );
        for (const { productId } of rows) {
          if (!seen.has(productId as number)) {
            seen.add(productId as number);
            ids.push(productId as number);
          }
        }
      }
      return ids;
    }

    const rules = (template.rules as TemplateRulesDto | null) ?? {};
    // EXISTS subqueries rather than JOINs — a plain JOIN against
    // productcollection/producttag can fan a single product out into
    // multiple result rows; EXISTS keeps this a pure filter, matching
    // Prisma's old `some: {...}` relation-filter semantics exactly.
    const conditions: string[] = ['p.shopId = ?', "p.status = 'Available'"];
    const params: QueryParam[] = [shopId];
    if (rules.collectionId !== undefined) {
      conditions.push(
        'EXISTS (SELECT 1 FROM productcollection pc WHERE pc.productId = p.id AND pc.collectionId = ?)',
      );
      params.push(rules.collectionId);
    }
    if (rules.tagName !== undefined) {
      conditions.push(
        'EXISTS (SELECT 1 FROM producttag pt JOIN tag t ON t.id = pt.tagId WHERE pt.productId = p.id AND t.name = ?)',
      );
      params.push(rules.tagName);
    }
    if (rules.minPrice !== undefined) {
      conditions.push('p.price >= ?');
      params.push(rules.minPrice);
    }
    if (rules.maxPrice !== undefined) {
      conditions.push('p.price <= ?');
      params.push(rules.maxPrice);
    }
    if (rules.createdWithinDays !== undefined) {
      conditions.push('p.createdAt >= ?');
      params.push(
        new Date(Date.now() - rules.createdWithinDays * 24 * 60 * 60 * 1000),
      );
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT p.id AS id FROM product p WHERE ${conditions.join(' AND ')} ORDER BY p.createdAt DESC`,
      params,
    );
    return rows.map((r) => r.id as number);
  }

  // Storefront PDP "related products" reverse lookup (Phase 8.4) — template
  // membership is a stronger merchandising signal than collection (a merchant
  // curates it on purpose), so PublicService.getRelatedProducts tries this
  // first and falls back to same-collection only when it comes up empty.
  // Reuses resolveProductIds per active template rather than a dedicated
  // reverse-rule-evaluation query — shops only ever have a handful of
  // templates (config data, not a hot list), so re-resolving each one is
  // cheap and avoids duplicating the MANUAL/RULE_BASED branching a second time.
  async findRelatedProductIds(
    shopId: number,
    productId: number,
    limit = 4,
  ): Promise<number[]> {
    const templates = await this.db.query<RowDataPacket[]>(
      `SELECT id, type, rules FROM template WHERE shopId = ? AND isActive = TRUE`,
      [shopId],
    );
    const related = new Set<number>();
    for (const template of templates) {
      const productIds = await this.resolveProductIds(shopId, {
        id: template.id as number,
        type: template.type as string,
        rules: template.rules,
      });
      if (!productIds.includes(productId)) continue;
      for (const id of productIds) {
        if (id !== productId) related.add(id);
      }
      if (related.size >= limit) break;
    }
    return [...related].slice(0, limit);
  }

  // ---------- shared helpers ----------

  private assertRulesMatchType(
    type: 'MANUAL' | 'RULE_BASED' | 'COLLECTION_GROUP',
    rules: TemplateRulesDto | undefined,
  ) {
    if (type === 'RULE_BASED') {
      const hasAnyRule =
        rules &&
        (rules.collectionId !== undefined ||
          rules.tagName !== undefined ||
          rules.minPrice !== undefined ||
          rules.maxPrice !== undefined ||
          rules.createdWithinDays !== undefined);
      if (!hasAnyRule) {
        throw new BadRequestException(
          'A RULE_BASED template needs at least one rule condition set',
        );
      }
    } else if (rules !== undefined) {
      throw new BadRequestException(
        "rules can only be set when type is 'RULE_BASED'",
      );
    }
  }

  private async assertBelongsToShop(ctx: TenantContext, id: number) {
    const rows = await this.db.query<(TemplateRow & RowDataPacket)[]>(
      `SELECT * FROM template WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Template ${id} not found`);
    }
    return rows[0];
  }

  private toAdminResponse(template: TemplateRow, productCount: number) {
    return {
      id: template.id,
      title: template.title,
      slug: template.slug,
      description: template.description,
      image: template.image,
      type: template.type,
      rules: template.rules,
      isActive: template.isActive,
      displayOrder: template.displayOrder,
      productCount,
      createdAt: template.createdAt,
    };
  }

  private handleDbError(error: unknown): never {
    if (isDuplicateKeyError(error)) {
      throw new BadRequestException(
        'A template with this slug already exists',
      );
    }
    throw error;
  }
}
