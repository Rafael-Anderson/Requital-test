import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import type { BiolinkRow, BiolinkpageconfigRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { BIO_LINK_TARGET_FIELD, type BioLinkType } from './bio-link-constants';
import { CreateBioLinkDto } from './dto/create-bio-link.dto';
import { UpdateBioLinkDto } from './dto/update-bio-link.dto';
import { ReorderBioLinksDto } from './dto/reorder-bio-links.dto';
import { UpdateBioPageConfigDto } from './dto/update-bio-page-config.dto';
import { AuditLogService } from '../audit-log/audit-log.service';

const STOREFRONT_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3002';

const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X (Twitter)',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  youtube: 'YouTube',
  snapchat: 'Snapchat',
  pinterest: 'Pinterest',
};

interface TargetFields {
  url?: string | null;
  productId?: number | null;
  collectionId?: number | null;
  templateId?: number | null;
  socialPlatform?: string | null;
}

interface AssembledBioLink extends BiolinkRow {
  product: { id: number; name: string; slug: string; thumbnail: string; status: string } | null;
  collection: { id: number; name: string; slug: string; image: string | null } | null;
  template: { id: number; title: string; slug: string; image: string | null; isActive: boolean } | null;
}

@Injectable()
export class BioLinksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ---------- Admin CRUD ----------

  async findAll(ctx: TenantContext) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM biolink WHERE shopId = ? ORDER BY \`order\` ASC`,
      [ctx.shopId],
    );
    const ids = rows.map((r) => r.id as number);
    const links = await this.loadBioLinksWithRelations(ids);
    return ids.map((id) => this.toAdminResponse(links.get(id)!));
  }

  async create(ctx: TenantContext, dto: CreateBioLinkDto) {
    this.assertFieldsMatchType(dto.type, dto);
    this.assertLabelPresent(dto.type, dto.label);
    if (dto.productId)
      await this.assertProductBelongsToShop(ctx, dto.productId);
    if (dto.collectionId)
      await this.assertCollectionBelongsToShop(ctx, dto.collectionId);
    if (dto.templateId)
      await this.assertTemplateBelongsToShop(ctx, dto.templateId);

    const maxRows = await this.db.query<RowDataPacket[]>(
      `SELECT MAX(\`order\`) AS maxOrder FROM biolink WHERE shopId = ?`,
      [ctx.shopId],
    );
    const nextOrder =
      maxRows[0].maxOrder === null ? 0 : Number(maxRows[0].maxOrder) + 1;

    const targetFields = this.clearedTargetFields(dto.type, dto);
    const result = await this.db.execute(
      `INSERT INTO biolink (shopId, type, label, url, productId, collectionId, templateId, socialPlatform, \`order\`, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ctx.shopId,
        dto.type,
        dto.label ?? null,
        targetFields.url,
        targetFields.productId,
        targetFields.collectionId,
        targetFields.templateId,
        targetFields.socialPlatform,
        nextOrder,
        dto.active ?? true,
      ],
    );
    const links = await this.loadBioLinksWithRelations([result.insertId]);
    return this.toAdminResponse(links.get(result.insertId)!);
  }

  async update(ctx: TenantContext, id: number, dto: UpdateBioLinkDto) {
    const existing = await this.assertBelongsToShop(ctx, id);

    // Re-validated against the MERGED state (existing + incoming), same
    // principle as ShopService's payment-method check — a partial update
    // that only sends `label` must not need to resend the whole target, but
    // one that touches type or any target field must resolve to a single
    // consistent target, not a stale mix of old-type and new-type fields.
    const touchesTarget =
      dto.type !== undefined ||
      dto.url !== undefined ||
      dto.productId !== undefined ||
      dto.collectionId !== undefined ||
      dto.templateId !== undefined ||
      dto.socialPlatform !== undefined;

    const effectiveType = dto.type ?? (existing.type as BioLinkType);
    // Once type is actually changing, the OLD type's target field (e.g.
    // EXTERNAL_URL's `url`) is never still "relevant" just because this
    // request didn't explicitly clear it — only fields this request itself
    // provides count toward the new type's target. Without this distinction,
    // switching PRODUCT -> EXTERNAL_URL would merge in the still-set old
    // productId alongside the new url and fail the exactly-one-field check.
    const typeChanging = dto.type !== undefined && dto.type !== existing.type;
    let targetData: Partial<TargetFields> = {};

    if (touchesTarget) {
      const merged: TargetFields = typeChanging
        ? {
            url: dto.url,
            productId: dto.productId,
            collectionId: dto.collectionId,
            templateId: dto.templateId,
            socialPlatform: dto.socialPlatform,
          }
        : {
            url: dto.url !== undefined ? dto.url : existing.url,
            productId:
              dto.productId !== undefined ? dto.productId : existing.productId,
            collectionId:
              dto.collectionId !== undefined
                ? dto.collectionId
                : existing.collectionId,
            templateId:
              dto.templateId !== undefined
                ? dto.templateId
                : existing.templateId,
            socialPlatform:
              dto.socialPlatform !== undefined
                ? dto.socialPlatform
                : existing.socialPlatform,
          };
      this.assertFieldsMatchType(effectiveType, merged);
      targetData = this.clearedTargetFields(effectiveType, merged);
    }

    const effectiveLabel = dto.label !== undefined ? dto.label : existing.label;
    this.assertLabelPresent(effectiveType, effectiveLabel);

    if (targetData.productId)
      await this.assertProductBelongsToShop(ctx, targetData.productId);
    if (targetData.collectionId)
      await this.assertCollectionBelongsToShop(ctx, targetData.collectionId);
    if (targetData.templateId)
      await this.assertTemplateBelongsToShop(ctx, targetData.templateId);

    const set = buildSetClause({
      type: effectiveType,
      label: dto.label !== undefined ? dto.label : undefined,
      active: dto.active,
      ...targetData,
      updatedAt: new Date(),
    });
    if (set) {
      await this.db.execute(`UPDATE biolink SET ${set.setClause} WHERE id = ?`, [
        ...set.params,
        id,
      ]);
    }
    const links = await this.loadBioLinksWithRelations([id]);
    return this.toAdminResponse(links.get(id)!);
  }

  async remove(ctx: TenantContext, id: number) {
    const link = await this.assertBelongsToShop(ctx, id);
    await this.db.execute(`DELETE FROM biolink WHERE id = ?`, [id]);
    await this.auditLogService.logCtx(ctx, {
      action: 'biolink.deleted',
      entityType: 'biolink',
      entityId: id,
      before: { label: link.label },
    });
    return { success: true };
  }

  // Every id must belong to this shop (validated up front, before any
  // writes) — a stray/foreign id in the array rejects the whole request
  // rather than partially reordering. All rows written in one transaction
  // so the list is never observably half-reordered.
  async reorder(ctx: TenantContext, dto: ReorderBioLinksDto) {
    const existing = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM biolink WHERE shopId = ?`,
      [ctx.shopId],
    );
    const existingIds = new Set(existing.map((l) => l.id as number));
    const requestedIds = new Set(dto.ids);
    if (
      dto.ids.length !== existingIds.size ||
      [...existingIds].some((id) => !requestedIds.has(id))
    ) {
      throw new BadRequestException(
        "ids must be exactly the full set of this shop's bio link ids",
      );
    }

    await this.db.transaction(async (conn) => {
      for (let index = 0; index < dto.ids.length; index++) {
        await conn.query(`UPDATE biolink SET \`order\` = ?, updatedAt = ? WHERE id = ?`, [
          index,
          new Date(),
          dto.ids[index],
        ]);
      }
    });
    return this.findAll(ctx);
  }

  // ---------- Admin: page-level config (logo/background/description/meta) ----------

  async getPageConfig(ctx: TenantContext) {
    const rows = await this.db.query<(BiolinkpageconfigRow & RowDataPacket)[]>(
      `SELECT * FROM biolinkpageconfig WHERE shopId = ?`,
      [ctx.shopId],
    );
    // No row yet (never customized) is a valid, common state — same
    // "null-shape fallback" convention as ThemeService.findOne/SeoService.findOne,
    // not an error.
    return (
      rows[0] ?? {
        shopId: ctx.shopId,
        logoUrl: null,
        backgroundUrl: null,
        description: null,
        metaTitle: null,
        metaDescription: null,
      }
    );
  }

  async updatePageConfig(ctx: TenantContext, dto: UpdateBioPageConfigDto) {
    const set = buildSetClause({ ...dto });
    const updateClause = set
      ? set.setClause
      : 'shopId = shopId'; // no-op update when dto is empty, matches Prisma's upsert(update: {}) behavior
    await this.db.execute(
      `INSERT INTO biolinkpageconfig (shopId, logoUrl, backgroundUrl, description, metaTitle, metaDescription)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE ${updateClause}`,
      [
        ctx.shopId,
        dto.logoUrl ?? null,
        dto.backgroundUrl ?? null,
        dto.description ?? null,
        dto.metaTitle ?? null,
        dto.metaDescription ?? null,
        ...(set ? set.params : []),
      ],
    );
    const rows = await this.db.query<(BiolinkpageconfigRow & RowDataPacket)[]>(
      `SELECT * FROM biolinkpageconfig WHERE shopId = ?`,
      [ctx.shopId],
    );
    return rows[0];
  }

  // ---------- Public (storefront) ----------

  // Raw override fields only — no fallback-to-Theme/shop resolution here.
  // That chain lives storefront-side (lib/bio-page.ts, lib/seo.ts), reusing
  // fields the existing GET /public/:shopSlug response already resolves
  // (shop.logoUrl, shop.bannerUrl, shop.metaTitle, ...) rather than
  // duplicating that resolution in a second place.
  async getPublicPageConfig(shopId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM biolinkpageconfig WHERE shopId = ?`,
      [shopId],
    );
    const config = rows[0];
    return {
      logoUrl: (config?.logoUrl as string | null) ?? null,
      backgroundUrl: (config?.backgroundUrl as string | null) ?? null,
      description: (config?.description as string | null) ?? null,
      metaTitle: (config?.metaTitle as string | null) ?? null,
      metaDescription: (config?.metaDescription as string | null) ?? null,
    };
  }

  // Active links only, each resolved to display-ready data — a
  // product/collection that's been deleted or made unavailable is silently
  // excluded rather than surfaced broken (see the task's own default: hide
  // from the public response, but the row stays active/visible in admin).
  async listPublic(shop: {
    id: number;
    socialLinks: unknown;
    whatsappCountryCode: string | null;
    whatsappNumber: string | null;
  }) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM biolink WHERE shopId = ? AND active = TRUE ORDER BY \`order\` ASC`,
      [shop.id],
    );
    const ids = rows.map((r) => r.id as number);
    const linksMap = await this.loadBioLinksWithRelations(ids);
    const links = ids.map((id) => linksMap.get(id)!);

    const result: Array<{
      id: number;
      type: string;
      label: string;
      product?: { name: string; slug: string; thumbnail: string } | null;
      collection?: { name: string; slug: string; image: string | null } | null;
      template?: { title: string; slug: string; image: string | null } | null;
      socialPlatform?: string | null;
    }> = [];

    for (const link of links) {
      if (link.type === 'PRODUCT') {
        if (!link.product || link.product.status !== 'Available') continue;
        result.push({
          id: link.id,
          type: link.type,
          label: link.label ?? link.product.name,
          product: {
            name: link.product.name,
            slug: link.product.slug,
            thumbnail: link.product.thumbnail,
          },
        });
      } else if (link.type === 'COLLECTION') {
        if (!link.collection) continue;
        result.push({
          id: link.id,
          type: link.type,
          label: link.label ?? link.collection.name,
          collection: {
            name: link.collection.name,
            slug: link.collection.slug,
            image: link.collection.image,
          },
        });
      } else if (link.type === 'TEMPLATE') {
        if (!link.template || !link.template.isActive) continue;
        result.push({
          id: link.id,
          type: link.type,
          label: link.label ?? link.template.title,
          template: {
            title: link.template.title,
            slug: link.template.slug,
            image: link.template.image,
          },
        });
      } else if (link.type === 'SOCIAL_ICON') {
        if (!this.resolveSocialUrl(shop, link.socialPlatform)) continue;
        result.push({
          id: link.id,
          type: link.type,
          label: this.resolveDisplayLabel(
            link.type,
            link.label,
            link.socialPlatform,
          ),
          socialPlatform: link.socialPlatform,
        });
      } else {
        // EXTERNAL_URL
        if (!link.url) continue;
        result.push({ id: link.id, type: link.type, label: link.label ?? '' });
      }
    }
    return result;
  }

  // Resolves the redirect target for GET /public/bio-links/:id/click and
  // atomically bumps clickCount — the increment and the redirect-target
  // lookup both happen here so the controller stays a thin @Redirect()
  // wrapper. Only 'inactive' or 'shop not published' reject outright (per
  // the task); if the specific product/collection target has since vanished,
  // a real visitor who already had the click counted still lands somewhere
  // sensible (the shop's homepage) rather than a dead end — the task didn't
  // specify this edge case for the click endpoint specifically (only for the
  // list endpoint), so this is an interpretation, not a guess at a stated rule.
  async resolveClickTarget(id: number): Promise<string> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT bl.*, s.published AS shopPublished, s.subdomain AS shopSubdomain,
              s.socialLinks AS shopSocialLinks, s.whatsappCountryCode AS shopWhatsappCountryCode,
              s.whatsappNumber AS shopWhatsappNumber,
              p.slug AS productSlug, p.status AS productStatus,
              c.id AS collectionRowId,
              t.slug AS templateSlug, t.isActive AS templateIsActive
       FROM biolink bl
       JOIN shop s ON s.id = bl.shopId
       LEFT JOIN product p ON p.id = bl.productId
       LEFT JOIN collection c ON c.id = bl.collectionId
       LEFT JOIN template t ON t.id = bl.templateId
       WHERE bl.id = ?`,
      [id],
    );
    const link = rows[0];
    if (!link || !link.active || !link.shopPublished) {
      throw new NotFoundException('Bio link not found');
    }

    await this.db.execute(`UPDATE biolink SET clickCount = clickCount + 1 WHERE id = ?`, [
      id,
    ]);

    const base = `${STOREFRONT_URL}/${link.shopSubdomain as string}`;
    switch (link.type as string) {
      case 'EXTERNAL_URL':
        return (link.url as string | null) ?? base;
      case 'PRODUCT':
        return link.productSlug && link.productStatus === 'Available'
          ? `${base}/products/${link.productSlug as string}`
          : base;
      case 'COLLECTION':
        return link.collectionRowId ? `${base}?collection=${link.collectionRowId as number}` : base;
      case 'TEMPLATE':
        return link.templateSlug && link.templateIsActive
          ? `${base}/templates/${link.templateSlug as string}`
          : base;
      case 'SOCIAL_ICON':
        return (
          this.resolveSocialUrl(
            {
              socialLinks: link.shopSocialLinks,
              whatsappCountryCode: link.shopWhatsappCountryCode as string | null,
              whatsappNumber: link.shopWhatsappNumber as string | null,
            },
            link.socialPlatform as string | null,
          ) ?? base
        );
      default:
        return base;
    }
  }

  // ---------- shared helpers ----------

  // 'whatsapp' resolves from the shop's dedicated whatsapp fields (not
  // socialLinks — a distinct, pre-existing concept); everything else
  // resolves from shop.socialLinks[platform], reusing whatever the merchant
  // already configured on Online Presence rather than storing/asking for the
  // same URL twice on the bio link itself.
  private resolveSocialUrl(
    shop: {
      socialLinks: unknown;
      whatsappCountryCode: string | null;
      whatsappNumber: string | null;
    },
    platform: string | null,
  ): string | null {
    if (!platform) return null;
    if (platform === 'whatsapp') {
      if (!shop.whatsappNumber) return null;
      const digits =
        `${shop.whatsappCountryCode ?? ''}${shop.whatsappNumber}`.replace(
          /[^0-9]/g,
          '',
        );
      return digits ? `https://wa.me/${digits}` : null;
    }
    const links = (shop.socialLinks as Record<string, string> | null) ?? {};
    return links[platform] ?? null;
  }

  private resolveDisplayLabel(
    type: string,
    label: string | null,
    socialPlatform: string | null,
  ): string {
    if (label?.trim()) return label;
    if (type === 'SOCIAL_ICON' && socialPlatform)
      return PLATFORM_LABELS[socialPlatform] ?? socialPlatform;
    return '';
  }

  private toAdminResponse(link: AssembledBioLink) {
    return {
      id: link.id,
      type: link.type,
      label: this.resolveDisplayLabel(
        link.type,
        link.label,
        link.socialPlatform,
      ),
      url: link.url,
      productId: link.productId,
      productName: link.product?.name ?? null,
      collectionId: link.collectionId,
      collectionName: link.collection?.name ?? null,
      templateId: link.templateId,
      templateTitle: link.template?.title ?? null,
      socialPlatform: link.socialPlatform,
      order: link.order,
      active: link.active,
      clickCount: link.clickCount,
      createdAt: link.createdAt,
    };
  }

  // Exactly one of the four target fields may be set, and it must be the
  // one `type` expects — no DB constraint enforces this (plain-string
  // discriminated columns, same convention as the rest of this schema), so
  // it's checked here on every create/update.
  private assertFieldsMatchType(type: BioLinkType, fields: TargetFields) {
    const present = (
      [
        ['url', fields.url],
        ['productId', fields.productId],
        ['collectionId', fields.collectionId],
        ['templateId', fields.templateId],
        ['socialPlatform', fields.socialPlatform],
      ] as const
    ).filter(([, v]) => v !== undefined && v !== null);

    const expectedKey = BIO_LINK_TARGET_FIELD[type];
    if (present.length !== 1 || present[0][0] !== expectedKey) {
      throw new BadRequestException(
        `type '${type}' requires exactly '${expectedKey}' to be set, and no other target field (url/productId/collectionId/templateId/socialPlatform)`,
      );
    }
  }

  private assertLabelPresent(
    type: BioLinkType,
    label: string | null | undefined,
  ) {
    if (type !== 'SOCIAL_ICON' && !label?.trim()) {
      throw new BadRequestException(`label is required for type '${type}'`);
    }
  }

  // Sets only the field `type` expects; explicitly nulls the other three so
  // switching type (e.g. PRODUCT -> EXTERNAL_URL) can never leave a stale FK
  // value behind, even though the DB itself doesn't enforce the invariant.
  private clearedTargetFields(type: BioLinkType, fields: TargetFields) {
    return {
      url: type === 'EXTERNAL_URL' ? (fields.url ?? null) : null,
      productId: type === 'PRODUCT' ? (fields.productId ?? null) : null,
      collectionId: type === 'COLLECTION' ? (fields.collectionId ?? null) : null,
      templateId:
        type === 'TEMPLATE' ? (fields.templateId ?? null) : null,
      socialPlatform:
        type === 'SOCIAL_ICON' ? (fields.socialPlatform ?? null) : null,
    };
  }

  private async assertBelongsToShop(ctx: TenantContext, id: number) {
    const rows = await this.db.query<(BiolinkRow & RowDataPacket)[]>(
      `SELECT * FROM biolink WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Bio link ${id} not found`);
    }
    return rows[0];
  }

  private async assertProductBelongsToShop(
    ctx: TenantContext,
    productId: number,
  ) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM product WHERE id = ? AND shopId = ?`,
      [productId, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
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

  private async assertTemplateBelongsToShop(
    ctx: TenantContext,
    templateId: number,
  ) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM template WHERE id = ? AND shopId = ?`,
      [templateId, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }
  }

  // Batch-loads product/collection/template the way bioLinkInclude used to
  // fetch in one Prisma nested include.
  private async loadBioLinksWithRelations(
    ids: number[],
  ): Promise<Map<number, AssembledBioLink>> {
    const result = new Map<number, AssembledBioLink>();
    if (ids.length === 0) return result;
    const idList = ids.map(() => '?').join(', ');
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT bl.*,
              p.id AS pId, p.name AS pName, p.slug AS pSlug, p.thumbnail AS pThumbnail, p.status AS pStatus,
              c.id AS cId, c.name AS cName, c.slug AS cSlug, c.image AS cImage,
              t.id AS tId, t.title AS tTitle, t.slug AS tSlug, t.image AS tImage, t.isActive AS tIsActive
       FROM biolink bl
       LEFT JOIN product p ON p.id = bl.productId
       LEFT JOIN collection c ON c.id = bl.collectionId
       LEFT JOIN template t ON t.id = bl.templateId
       WHERE bl.id IN (${idList})`,
      ids,
    );
    for (const r of rows) {
      result.set(r.id as number, {
        id: r.id as number,
        shopId: r.shopId as number,
        type: r.type as string,
        label: r.label as string | null,
        url: r.url as string | null,
        productId: r.productId as number | null,
        collectionId: r.collectionId as number | null,
        templateId: r.templateId as number | null,
        socialPlatform: r.socialPlatform as string | null,
        order: r.order as number,
        active: Boolean(r.active),
        clickCount: r.clickCount as number,
        createdAt: r.createdAt as Date,
        updatedAt: r.updatedAt as Date,
        product:
          r.pId !== null
            ? {
                id: r.pId as number,
                name: r.pName as string,
                slug: r.pSlug as string,
                thumbnail: r.pThumbnail as string,
                status: r.pStatus as string,
              }
            : null,
        collection:
          r.cId !== null
            ? {
                id: r.cId as number,
                name: r.cName as string,
                slug: r.cSlug as string,
                image: r.cImage as string | null,
              }
            : null,
        template:
          r.tId !== null
            ? {
                id: r.tId as number,
                title: r.tTitle as string,
                slug: r.tSlug as string,
                image: r.tImage as string | null,
                isActive: Boolean(r.tIsActive),
              }
            : null,
      });
    }
    return result;
  }
}
