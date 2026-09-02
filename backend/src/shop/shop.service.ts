import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { trimDecimal } from '../database/decimal.util';
import type { RowDataPacket } from 'mysql2/promise';
import type { ShopRow } from '../db/types';
import { UpdateShopDto } from './dto/update-shop.dto';
import { UpdateShopDomainDto } from './dto/update-shop-domain.dto';
import { SOCIAL_PLATFORM_DOMAINS, SOCIAL_PLATFORMS } from './constants';
import { isValidCustomDomain } from './domain-validation';
import {
  VERIFY_RECORD_PREFIX,
  type CustomDomainStatus,
} from './custom-domain.constants';
import { generateOpaqueToken } from '../common/token-hash';
import { normalizeCustomDomain } from '../common/normalize';
import { DomainsService } from '../domains/domains.service';
import type { TenantContext } from '../common/tenant-context';

// Same env-driven storefront base URL every other customer-facing link in
// this codebase resolves from (see e.g. payments.service.ts's own
// STOREFRONT_URL) — the root domain a shop's own subdomain hangs off of,
// not the full base URL, since a subdomain-type shop's storefrontUrl is
// {subdomain}.{root}, not {STOREFRONT_URL}/{subdomain} like the existing
// path-based storefront links.
const STOREFRONT_ROOT_DOMAIN =
  process.env.STOREFRONT_ROOT_DOMAIN ?? 'requital.io';

@Injectable()
export class ShopService {
  constructor(
    private readonly db: DatabaseService,
    private readonly domains: DomainsService,
  ) {}

  async findOne(ctx: TenantContext) {
    const shop = await this.findById(ctx.shopId);
    if (!shop) throw new NotFoundException(`Shop ${ctx.shopId} not found`);
    // The admin-facing GET/PATCH /shop response never trimmed these two
    // DECIMAL(65,30) fields, unlike the storefront-facing equivalent
    // (public.service.ts already does `trimDecimal(shop.defaultDeliveryFee)`
    // correctly) — confirmed live via the QA audit, "0.000000000000000..."
    // rendered raw into Store Configuration's Default Delivery Fee input.
    //
    // whatsappCredentials (the AES-256-GCM ciphertext blob) is stripped
    // before this reaches a response. WhatsAppSettingsService already has a
    // dedicated masked endpoint (hasCredentials/maskedCredentials) for
    // surfacing connection status; this general-purpose settings fetch has
    // no business returning the encrypted value at all — security audit
    // finding, see PR description. Destructured out (not deleted off a
    // mutable copy) so `safeShop`'s type stays a plain, fully-inferred
    // ShopRow subset rather than a hand-written Omit/delete pairing.
    const { whatsappCredentials, ...safeShop } = shop;
    void whatsappCredentials;
    return {
      ...safeShop,
      defaultDeliveryFee: trimDecimal(shop.defaultDeliveryFee),
      taxRate: trimDecimal(shop.taxRate),
    };
  }

  // Same proxy the migration backfill used for existing shops (see
  // 20260726100000_shop_published): at least one outlet that can actually
  // take orders (deliveryEnabled or pickupEnabled — bare row existence isn't
  // a signal, every signup auto-creates one with both false) AND at least
  // one product in the catalog. Single source of truth for both the
  // GET /shop/publish-readiness endpoint (drives the admin Publish toggle's
  // disabled/tooltip state before the merchant even tries) and the write-side
  // check in update() below — the two can never drift apart.
  async getPublishReadiness(
    ctx: TenantContext,
  ): Promise<{ ready: boolean; missing: string[] }> {
    const [outletRows, productRows, userRows] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT id FROM outlet WHERE shopId = ? AND (deliveryEnabled = true OR pickupEnabled = true) LIMIT 1`,
        [ctx.shopId],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT id FROM product WHERE shopId = ? LIMIT 1`,
        [ctx.shopId],
      ),
      // Conservative enforcement point for "email verification blocks
      // nothing" (docs/audit-2026-08.md §1.1): rather than blocking login
      // (which would lock a legitimate merchant out of their own account
      // over an unrelated inbox problem), an unverified account can use the
      // admin panel freely but can't take the shop live. Checked against the
      // acting user specifically, not "any admin on the shop" — the person
      // publishing is the one who needs to have proven control of their own
      // login email.
      this.db.query<RowDataPacket[]>(
        `SELECT emailVerified FROM user WHERE id = ?`,
        [ctx.userId],
      ),
    ]);
    if (userRows.length === 0) {
      throw new NotFoundException(`User ${ctx.userId} not found`);
    }
    const missing: string[] = [];
    if (productRows.length === 0) missing.push('Add at least one product');
    if (outletRows.length === 0)
      missing.push('Enable delivery or pickup on at least one outlet');
    if (!userRows[0].emailVerified) missing.push('Verify your account email');
    return { ready: missing.length === 0, missing };
  }

  async update(ctx: TenantContext, dto: UpdateShopDto) {
    if (dto.socialLinks) {
      this.validateSocialLinks(dto.socialLinks);
    }

    // Country is settable once (at signup, or on first save here for a shop
    // that predates this field / left it blank) and locked after — no
    // "immutable once set" precedent existed elsewhere in this codebase to
    // reuse (shop.subdomain is locked by omission from this DTO entirely,
    // which doesn't fit here since country must stay settable once). A
    // same-value re-save is a no-op, not a conflict.
    if (dto.country !== undefined) {
      const current = await this.findOne(ctx);
      if (current.country && current.country !== dto.country) {
        throw new ConflictException('Country cannot be changed once set.');
      }
    }

    if (dto.published === true) {
      // Only gates the false -> true transition, not every save while
      // already published — a shop that later loses its only product (or
      // whatever) must never get silently unpublished by an unrelated
      // update, and a merchant re-saving {published: true} on an
      // already-live shop shouldn't suddenly hit a readiness error either.
      const current = await this.findOne(ctx);
      if (!current.published) {
        const readiness = await this.getPublishReadiness(ctx);
        if (!readiness.ready) {
          const sentence = readiness.missing
            .map((m, i) => (i === 0 ? m : m[0].toLowerCase() + m.slice(1)))
            .join(' and ');
          throw new BadRequestException(
            `Cannot publish yet — ${sentence} before publishing.`,
          );
        }
      }
    }

    const touchesDeliveryPayment =
      dto.deliveryPaymentCardOnline !== undefined ||
      dto.deliveryPaymentCashOnDelivery !== undefined ||
      dto.deliveryPaymentCardOnDelivery !== undefined;
    const touchesPickupPayment =
      dto.pickupPaymentCardOnline !== undefined ||
      dto.pickupPaymentCashOnPickup !== undefined ||
      dto.pickupPaymentCardOnPickup !== undefined;

    if (touchesDeliveryPayment || touchesPickupPayment) {
      // Checked against the merged (existing + incoming) state, not just
      // this request's fields — a partial update that only sends one method
      // must still know whether the other two are already on.
      const current = await this.findOne(ctx);
      if (touchesDeliveryPayment) {
        this.assertAtLeastOnePaymentMethod('delivery', [
          dto.deliveryPaymentCardOnline ?? current.deliveryPaymentCardOnline,
          dto.deliveryPaymentCashOnDelivery ??
            current.deliveryPaymentCashOnDelivery,
          dto.deliveryPaymentCardOnDelivery ??
            current.deliveryPaymentCardOnDelivery,
        ]);
      }
      if (touchesPickupPayment) {
        this.assertAtLeastOnePaymentMethod('pickup', [
          dto.pickupPaymentCardOnline ?? current.pickupPaymentCardOnline,
          dto.pickupPaymentCashOnPickup ?? current.pickupPaymentCashOnPickup,
          dto.pickupPaymentCardOnPickup ?? current.pickupPaymentCardOnPickup,
        ]);
      }
    }

    const set = buildSetClause({
      published: dto.published,
      name: dto.name,
      currency: dto.currency,
      displayName: dto.displayName,
      legalName: dto.legalName,
      trademarkFormat: dto.trademarkFormat,
      logoUrl: dto.logoUrl,
      email: dto.email,
      whatsappCountryCode: dto.whatsappCountryCode,
      whatsappNumber: dto.whatsappNumber,
      description: dto.description,
      country: dto.country,
      address: dto.address,
      timezone: dto.timezone,
      notifyWhatsapp: dto.notifyWhatsapp,
      notifyCustomersWhatsapp: dto.notifyCustomersWhatsapp,
      notifyEmail: dto.notifyEmail,
      notifyAbandonedCart: dto.notifyAbandonedCart,
      abandonedCartWindowMinutes: dto.abandonedCartWindowMinutes,
      notifyLowStockDigest: dto.notifyLowStockDigest,
      autoDeductIngredientStock: dto.autoDeductIngredientStock,
      businessType: dto.businessType,
      defaultLanguage: dto.defaultLanguage,
      defaultDeliveryFee: dto.defaultDeliveryFee,
      taxDisplayText: dto.taxDisplayText,
      productDisplayOrientation: dto.productDisplayOrientation,
      productImageZoomEnabled: dto.productImageZoomEnabled,
      showCollectionMenu: dto.showCollectionMenu,
      allowPreOrders: dto.allowPreOrders,
      customerConfirmationRequired: dto.customerConfirmationRequired,
      externalDeliveryEnabled: dto.externalDeliveryEnabled,
      asapDeliveryEnabled: dto.asapDeliveryEnabled,
      deliveryCalendarEnabled: dto.deliveryCalendarEnabled,
      businessHours: dto.businessHours,
      whatsappFloatingButtonEnabled: dto.whatsappFloatingButtonEnabled,
      birthdayDiscountEnabled: dto.birthdayDiscountEnabled,
      productEditorMode: dto.productEditorMode,
      customerSurveyEnabled: dto.customerSurveyEnabled,
      dynamicThemeBuilderEnabled: dto.dynamicThemeBuilderEnabled,
      disableStoreCart: dto.disableStoreCart,
      cartDisabledMode: dto.cartDisabledMode,
      socialLinks: dto.socialLinks
        ? JSON.stringify(dto.socialLinks)
        : undefined,
      deliveryPaymentCardOnline: dto.deliveryPaymentCardOnline,
      deliveryPaymentCashOnDelivery: dto.deliveryPaymentCashOnDelivery,
      deliveryPaymentCardOnDelivery: dto.deliveryPaymentCardOnDelivery,
      pickupPaymentCardOnline: dto.pickupPaymentCardOnline,
      pickupPaymentCashOnPickup: dto.pickupPaymentCashOnPickup,
      pickupPaymentCardOnPickup: dto.pickupPaymentCardOnPickup,
      deliveryHours: dto.deliveryHours
        ? JSON.stringify(dto.deliveryHours)
        : undefined,
      pickupHours: dto.pickupHours
        ? JSON.stringify(dto.pickupHours)
        : undefined,
      deliveryTimeSlotGapMinutes: dto.deliveryTimeSlotGapMinutes,
      deliveryPreparationTimeMinutes: dto.deliveryPreparationTimeMinutes,
      deliveryPreparationPlusDeliveryTimeMinutes:
        dto.deliveryPreparationPlusDeliveryTimeMinutes,
      estimatedDeliveryTimeFrom: dto.estimatedDeliveryTimeFrom,
      estimatedDeliveryTimeTo: dto.estimatedDeliveryTimeTo,
      estimatedDeliveryTimeUnit: dto.estimatedDeliveryTimeUnit,
      pickupTimeSlotGapMinutes: dto.pickupTimeSlotGapMinutes,
      pickupPreparationTimeMinutes: dto.pickupPreparationTimeMinutes,
      pickupPreparationPlusTimeMinutes: dto.pickupPreparationPlusTimeMinutes,
      allowSameDayOrders: dto.allowSameDayOrders,
      allowNextDayOrders: dto.allowNextDayOrders,
      taxRate: dto.taxRate,
      taxInclusive: dto.taxInclusive,
    });
    if (set) {
      await this.db.execute(`UPDATE shop SET ${set.setClause} WHERE id = ?`, [
        ...set.params,
        ctx.shopId,
      ]);
    }
    return this.findOne(ctx);
  }

  // shop.subdomain itself is immutable after signup (see update()'s country
  // check above for the established precedent on locked fields) — this
  // endpoint only toggles which one actually drives the storefront's public
  // URL, and sets/clears the custom hostname. A custom domain is only actually
  // served (and only gets a cert) once its DNS-TXT ownership check passes —
  // see CustomDomainVerificationService and docs/plans/custom-domain-resolver.md.
  async getDomainConfig(ctx: TenantContext) {
    const shop = await this.findOne(ctx);
    const status = shop.customDomainStatus as CustomDomainStatus | null;
    // The DNS TXT record the merchant must add to prove control. Present only
    // while a claim exists and is not yet verified; Phase 3's Settings page
    // renders it. storefrontUrl deliberately still points at the custom domain
    // regardless of verification state — the "is your store live yet" nuance is
    // surfaced via `status`, and reworking storefrontUrl is Phase 3's call.
    const verification =
      shop.domainType === 'custom' &&
      shop.customDomain &&
      shop.customDomainVerifyToken &&
      status !== 'verified'
        ? {
            recordName: `${VERIFY_RECORD_PREFIX}.${shop.customDomain}`,
            recordValue: shop.customDomainVerifyToken,
          }
        : null;
    return {
      type: shop.domainType,
      subdomain: shop.subdomain,
      customDomain: shop.customDomain,
      status,
      verification,
      storefrontUrl:
        shop.domainType === 'custom' && shop.customDomain
          ? `https://${shop.customDomain}`
          : `https://${shop.subdomain}.${STOREFRONT_ROOT_DOMAIN}`,
    };
  }

  async updateDomain(ctx: TenantContext, dto: UpdateShopDomainDto) {
    // Whatever custom domain this shop had before, so the resolve cache entry
    // for it is dropped on a disconnect / domain-change, not left ≤30s stale.
    const prior = await this.db.query<RowDataPacket[]>(
      `SELECT customDomain FROM shop WHERE id = ?`,
      [ctx.shopId],
    );
    const priorDomain = (prior[0]?.customDomain as string | null) ?? null;

    if (dto.type === 'custom') {
      const domain = normalizeCustomDomain(dto.customDomain ?? '');
      if (!isValidCustomDomain(domain)) {
        throw new BadRequestException(
          'Enter a valid domain (e.g. shop.example.com), with no protocol or path.',
        );
      }

      // CD2: a pending claim never blocks another shop's pending claim — only a
      // *verified* domain is exclusive. Reject early only if another shop has
      // already verified it; the customDomainVerifiedKey unique index is the
      // hard backstop at verify time (see CustomDomainVerificationService).
      const taken = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM shop
         WHERE customDomain = ? AND customDomainStatus = 'verified' AND id <> ? LIMIT 1`,
        [domain, ctx.shopId],
      );
      if (taken.length > 0) {
        throw new ConflictException(
          'That domain is already connected to another store.',
        );
      }

      // Start (or restart) a pending claim with a fresh token. Re-saving the
      // same domain, or switching to a different one, always re-arms
      // verification from scratch and rotates the token, so a stale DNS TXT
      // record from any earlier claim can't satisfy the new one.
      await this.db.execute(
        `UPDATE shop
         SET domainType = 'custom', customDomain = ?, customDomainStatus = 'pending',
             customDomainVerifyToken = ?, customDomainClaimedAt = ?,
             customDomainVerifiedAt = NULL, customDomainLastCheckedAt = NULL
         WHERE id = ?`,
        [domain, generateOpaqueToken(), new Date(), ctx.shopId],
      );
    } else {
      // Disconnect: clear everything immediately. resolveSubdomain and the
      // Caddy `ask` (both gated on customDomainStatus = 'verified') stop
      // honouring the host on the very next request — no sweep tick needed.
      // Nulling the token is the CD2 rule-4 rotation: a lingering DNS TXT
      // record can't be reused to re-verify a later claim by anyone.
      await this.db.execute(
        `UPDATE shop
         SET domainType = 'subdomain', customDomain = NULL, customDomainStatus = NULL,
             customDomainVerifyToken = NULL, customDomainClaimedAt = NULL,
             customDomainVerifiedAt = NULL, customDomainLastCheckedAt = NULL
         WHERE id = ?`,
        [ctx.shopId],
      );
    }
    // Drop the resolve-cache entry for the old and (if custom) the new
    // hostname so the change is visible on the very next storefront request.
    if (priorDomain) this.domains.invalidate(priorDomain);
    if (dto.type === 'custom' && dto.customDomain) {
      this.domains.invalidate(normalizeCustomDomain(dto.customDomain));
    }
    return this.getDomainConfig(ctx);
  }

  private async findById(
    id: number,
  ): Promise<(ShopRow & RowDataPacket) | undefined> {
    const rows = await this.db.query<(ShopRow & RowDataPacket)[]>(
      `SELECT * FROM shop WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  // Key must be a known platform; value must be a syntactically valid
  // http(s) URL whose hostname loosely matches that platform's domain. Not
  // checking the link actually resolves — just catches typos/wrong-platform
  // pastes, per the "don't over-engineer this" brief.
  private validateSocialLinks(socialLinks: Record<string, string>) {
    for (const [platform, url] of Object.entries(socialLinks)) {
      if (!SOCIAL_PLATFORMS.includes(platform)) {
        throw new BadRequestException(`Unknown social platform '${platform}'`);
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new BadRequestException(
          `'${url}' is not a valid URL for ${platform}`,
        );
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new BadRequestException(`${platform} link must be http(s)`);
      }
      const expectedDomains = SOCIAL_PLATFORM_DOMAINS[platform];
      if (!expectedDomains.some((domain) => parsed.hostname.endsWith(domain))) {
        throw new BadRequestException(
          `'${url}' doesn't look like a ${platform} link`,
        );
      }
    }
  }

  private assertAtLeastOnePaymentMethod(
    context: 'delivery' | 'pickup',
    methods: boolean[],
  ) {
    if (!methods.some(Boolean)) {
      throw new BadRequestException(
        `At least one ${context} payment method must be enabled`,
      );
    }
  }
}
