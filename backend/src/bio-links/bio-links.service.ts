import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

const bioLinkInclude = {
  product: {
    select: { id: true, name: true, slug: true, thumbnail: true, status: true },
  },
  collection: { select: { id: true, name: true, slug: true, image: true } },
  template: {
    select: { id: true, title: true, slug: true, image: true, isActive: true },
  },
} satisfies Prisma.biolinkInclude;

@Injectable()
export class BioLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ---------- Admin CRUD ----------

  async findAll(ctx: TenantContext) {
    const links = await this.prisma.biolink.findMany({
      where: { shopId: ctx.shopId },
      include: bioLinkInclude,
      orderBy: { order: 'asc' },
    });
    return links.map((l) => this.toAdminResponse(l));
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

    const { _max } = await this.prisma.biolink.aggregate({
      where: { shopId: ctx.shopId },
      _max: { order: true },
    });
    const nextOrder = (_max.order ?? -1) + 1;

    const created = await this.prisma.biolink.create({
      data: {
        shopId: ctx.shopId,
        type: dto.type,
        label: dto.label ?? null,
        ...this.clearedTargetFields(dto.type, dto),
        order: nextOrder,
        active: dto.active ?? true,
      },
      include: bioLinkInclude,
    });
    return this.toAdminResponse(created);
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

    const updated = await this.prisma.biolink.update({
      where: { id },
      data: {
        type: effectiveType,
        label: dto.label !== undefined ? dto.label : undefined,
        active: dto.active,
        ...targetData,
      },
      include: bioLinkInclude,
    });
    return this.toAdminResponse(updated);
  }

  async remove(ctx: TenantContext, id: number) {
    const link = await this.assertBelongsToShop(ctx, id);
    await this.prisma.biolink.delete({ where: { id } });
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
    const existing = await this.prisma.biolink.findMany({
      where: { shopId: ctx.shopId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((l) => l.id));
    const requestedIds = new Set(dto.ids);
    if (
      dto.ids.length !== existingIds.size ||
      [...existingIds].some((id) => !requestedIds.has(id))
    ) {
      throw new BadRequestException(
        "ids must be exactly the full set of this shop's bio link ids",
      );
    }

    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.biolink.update({ where: { id }, data: { order: index } }),
      ),
    );
    return this.findAll(ctx);
  }

  // ---------- Admin: page-level config (logo/background/description/meta) ----------

  async getPageConfig(ctx: TenantContext) {
    const config = await this.prisma.biolinkpageconfig.findUnique({
      where: { shopId: ctx.shopId },
    });
    // No row yet (never customized) is a valid, common state — same
    // "null-shape fallback" convention as ThemeService.findOne/SeoService.findOne,
    // not an error.
    return (
      config ?? {
        shopId: ctx.shopId,
        logoUrl: null,
        backgroundUrl: null,
        description: null,
        metaTitle: null,
        metaDescription: null,
      }
    );
  }

  updatePageConfig(ctx: TenantContext, dto: UpdateBioPageConfigDto) {
    return this.prisma.biolinkpageconfig.upsert({
      where: { shopId: ctx.shopId },
      create: { shopId: ctx.shopId, ...dto },
      update: dto,
    });
  }

  // ---------- Public (storefront) ----------

  // Raw override fields only — no fallback-to-Theme/shop resolution here.
  // That chain lives storefront-side (lib/bio-page.ts, lib/seo.ts), reusing
  // fields the existing GET /public/:shopSlug response already resolves
  // (shop.logoUrl, shop.bannerUrl, shop.metaTitle, ...) rather than
  // duplicating that resolution in a second place.
  async getPublicPageConfig(shopId: number) {
    const config = await this.prisma.biolinkpageconfig.findUnique({
      where: { shopId },
    });
    return {
      logoUrl: config?.logoUrl ?? null,
      backgroundUrl: config?.backgroundUrl ?? null,
      description: config?.description ?? null,
      metaTitle: config?.metaTitle ?? null,
      metaDescription: config?.metaDescription ?? null,
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
    const links = await this.prisma.biolink.findMany({
      where: { shopId: shop.id, active: true },
      include: bioLinkInclude,
      orderBy: { order: 'asc' },
    });

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
    const link = await this.prisma.biolink.findUnique({
      where: { id },
      include: { shop: true, product: true, collection: true, template: true },
    });
    if (!link || !link.active || !link.shop.published) {
      throw new NotFoundException('Bio link not found');
    }

    await this.prisma.biolink.update({
      where: { id },
      data: { clickCount: { increment: 1 } },
    });

    const base = `${STOREFRONT_URL}/${link.shop.subdomain}`;
    switch (link.type) {
      case 'EXTERNAL_URL':
        return link.url ?? base;
      case 'PRODUCT':
        return link.product && link.product.status === 'Available'
          ? `${base}/products/${link.product.slug}`
          : base;
      case 'COLLECTION':
        return link.collection ? `${base}?collection=${link.collection.id}` : base;
      case 'TEMPLATE':
        return link.template && link.template.isActive
          ? `${base}/templates/${link.template.slug}`
          : base;
      case 'SOCIAL_ICON':
        return this.resolveSocialUrl(link.shop, link.socialPlatform) ?? base;
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

  private toAdminResponse(
    link: Prisma.biolinkGetPayload<{ include: typeof bioLinkInclude }>,
  ) {
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
    const link = await this.prisma.biolink.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!link) {
      throw new NotFoundException(`Bio link ${id} not found`);
    }
    return link;
  }

  private async assertProductBelongsToShop(
    ctx: TenantContext,
    productId: number,
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, shopId: ctx.shopId },
    });
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
  }

  private async assertCollectionBelongsToShop(
    ctx: TenantContext,
    collectionId: number,
  ) {
    const collection = await this.prisma.collection.findFirst({
      where: { id: collectionId, shopId: ctx.shopId },
    });
    if (!collection) {
      throw new NotFoundException(`Collection ${collectionId} not found`);
    }
  }

  private async assertTemplateBelongsToShop(
    ctx: TenantContext,
    templateId: number,
  ) {
    const template = await this.prisma.template.findFirst({
      where: { id: templateId, shopId: ctx.shopId },
    });
    if (!template) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }
  }
}
