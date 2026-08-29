import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService, type QueryParam } from '../database/database.service';
import { trimDecimal } from '../database/decimal.util';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { computeIsOpen, dateKeyInTimezone } from '../outlets/outlet-status';
import { generateValidTimeSlots } from './time-slots';
import { geocodeAddress, reverseGeocodeAddress } from '../common/nominatim';
import { createLogger } from '../common/logging/logger';

const logger = createLogger('PublicService');
import { haversineDistanceKm } from '../common/geo';
import { generateTrackingCode } from '../common/token-hash';
import { computeOrderTotals, matchDeliveryZone } from './order-pricing';
import { PaymentProviderRegistry } from '../payments/payment-provider.registry';
import { PaymentSettingsService } from '../payments/payment-settings.service';
import { CustomersService } from '../customers/customers.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { BioLinksService } from '../bio-links/bio-links.service';
import { ProductsService } from '../products/products.service';
import { buildVariantLabel } from '../products/variant-generator';
import { DiscountsService } from '../discounts/discounts.service';
import { OrderNotificationsService } from '../orders/order-notifications.service';
import { TemplatesService } from '../templates/templates.service';
import { MenuService } from '../menu/menu.service';
import { AbandonedCartsService } from '../abandoned-carts/abandoned-carts.service';
import { GiftCardsService } from '../gift-cards/gift-cards.service';
import type { ValidateDiscountDto } from '../discounts/dto/validate-discount.dto';
import { CaptureAbandonedCartDto } from '../abandoned-carts/dto/capture-abandoned-cart.dto';
import { ValidateGiftCardDto } from '../gift-cards/dto/validate-gift-card.dto';
import { CreatePublicOrderDto } from './dto/create-public-order.dto';
import { SubmitSurveyDto } from './dto/submit-survey.dto';
import { SubscribeNewsletterDto } from './dto/subscribe-newsletter.dto';
import { PolicyPagesService } from '../policy-pages/policy-pages.service';
import { ThemesService } from '../themes/themes.service';
import {
  POLICY_PAGE_TYPES,
  type PolicyPageType,
} from '../policy-pages/policy-page-constants';
import type {
  ShopRow,
  OutletRow,
  DeliveryzoneRow,
  ThemesettingsRow,
  ShopseosettingsRow,
  BannerimageRow,
  CollectionRow,
  ProductRow,
  BrandRow,
  SurveyresponseRow,
} from '../db/types';

const STOREFRONT_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3002';

// Meta descriptions render best under ~160 characters (Google truncates
// around there) — cuts at the last whole word rather than mid-word.
const META_DESCRIPTION_MAX = 160;
function truncateDescription(description: string | null): string | null {
  if (!description) return null;
  const trimmed = description.trim();
  if (trimmed.length <= META_DESCRIPTION_MAX) return trimmed;
  const cut = trimmed.slice(0, META_DESCRIPTION_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : META_DESCRIPTION_MAX)}…`;
}

const DELIVERY_PAYMENT_FLAGS = {
  card_online: 'deliveryPaymentCardOnline',
  cash_on_delivery: 'deliveryPaymentCashOnDelivery',
  card_on_delivery: 'deliveryPaymentCardOnDelivery',
} as const;
const PICKUP_PAYMENT_FLAGS = {
  card_online: 'pickupPaymentCardOnline',
  cash_on_pickup: 'pickupPaymentCashOnPickup',
  card_on_pickup: 'pickupPaymentCardOnPickup',
} as const;

// The independent (non-exclusive, non-card-processor) online providers from
// the Payment Gateways settings page — available for both delivery and
// pickup uniformly once enabled (unlike card_online, which still has its
// own separate delivery/pickup availability booleans), matching the "just a
// visibility toggle" framing the settings page uses for all of these.
const INDEPENDENT_ONLINE_PROVIDERS = ['paypal', 'tabby', 'tamara'] as const;

// Shape returned per product by loadPublicProductsWithRelations — replaces
// the old Prisma-payload-derived PublicProductRow/toProductResponse split
// now that assembly happens in one pass at query time (see that method).
type PublicProductResponse = Record<string, unknown>;

@Injectable()
export class PublicService {
  constructor(
    private readonly db: DatabaseService,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly paymentSettingsService: PaymentSettingsService,
    private readonly customersService: CustomersService,
    private readonly affiliateService: AffiliateService,
    private readonly bioLinksService: BioLinksService,
    private readonly productsService: ProductsService,
    private readonly discountsService: DiscountsService,
    private readonly orderNotificationsService: OrderNotificationsService,
    private readonly templatesService: TemplatesService,
    private readonly menuService: MenuService,
    private readonly abandonedCartsService: AbandonedCartsService,
    private readonly giftCardsService: GiftCardsService,
    private readonly policyPagesService: PolicyPagesService,
    private readonly themesService: ThemesService,
    private readonly jwtService: JwtService,
  ) {}

  // Backs the theme builder's live preview for a shop that hasn't published
  // yet — the most common time to actually use the builder, since a
  // merchant setting up their very first theme typically hasn't gone live.
  // assertPublished's own gate has no notion of "the shop's own staff,
  // previewing their own unpublished shop" vs. "the public" — bypassing it
  // needs real proof of the former, not just a client-suppliable
  // ?preview=true flag, which would let anyone view any unpublished shop's
  // real catalog/pricing/outlet data by guessing its slug (exactly what
  // assertPublished's own comment says must stay hidden). previewToken is a
  // separate, narrow, short-lived `typ: 'theme_preview'` token minted by
  // ThemesService.issuePreviewToken — see that method's own comment for why
  // this isn't just the staff member's real session token anymore (it
  // became an httpOnly cookie in the session-cookie migration, unreadable
  // by PreviewFrame.tsx). No DB lookup needed here: shopId rides directly
  // in the token's own claims, verified at mint time against the staff
  // member's real ctx.shopId, rather than re-derived from a `sub` user id.
  private async isAuthorizedPreview(
    shopId: number,
    previewToken?: string,
  ): Promise<boolean> {
    if (!previewToken) return false;
    let payload: { shopId?: number; typ?: string };
    try {
      payload = await this.jwtService.verifyAsync(previewToken);
    } catch {
      return false;
    }
    if (payload.typ !== 'theme_preview') return false;
    return payload.shopId === shopId;
  }

  private async assertPublishedOrPreview(
    shop: { id: number; subdomain: string; published: boolean },
    previewToken?: string,
  ) {
    if (shop.published) return;
    if (await this.isAuthorizedPreview(shop.id, previewToken)) return;
    throw new NotFoundException(`Shop '${shop.subdomain}' not found`);
  }

  // New visual theme builder's storefront-facing read. Non-preview responses
  // are cached (see ThemeConfigCache); preview responses (draft config, live
  // while the merchant edits) are never cached and require themeId, scoped
  // to this shop by ThemesService.getPublicConfig itself. Returns null when
  // the shop has no published new-system theme — the storefront falls back
  // to its existing legacy homepageLayout/topBarLayout/etc. dispatch in that
  // case (see app/[shop]/page.tsx, TopBar.tsx, Footer.tsx,
  // AnnouncementBar.tsx).
  async getThemeConfig(
    shopSlug: string,
    opts: { preview: boolean; themeId?: number },
  ) {
    const shop = await this.resolveShop(shopSlug);
    return this.themesService.getPublicConfig(shop.id, opts);
  }

  async getPolicyPage(shopSlug: string, type: string) {
    const shop = await this.resolveShop(shopSlug);
    if (!(POLICY_PAGE_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException(`Unknown policy page type '${type}'`);
    }
    return this.policyPagesService.findPublic(shop.id, type as PolicyPageType);
  }

  async captureAbandonedCart(shopSlug: string, dto: CaptureAbandonedCartDto) {
    const shop = await this.resolveShop(shopSlug);
    return this.abandonedCartsService.capture(shop.id, dto);
  }

  async recoverAbandonedCart(token: string) {
    return this.abandonedCartsService.resolveByToken(token);
  }

  async validateGiftCard(shopSlug: string, dto: ValidateGiftCardDto) {
    const shop = await this.resolveShop(shopSlug);
    return this.giftCardsService.validateCode(shop.id, dto.code);
  }

  // No dedicated module for this — it's a single insert-or-409, not enough
  // surface to justify a service of its own the way abandoned carts/gift
  // cards have. Dedup is enforced by the table's own (shopId, email) unique
  // index (see that migration's comment for why this isn't `customer`), not
  // a pre-check — same TOCTOU-avoidance reasoning as the webhook/discount
  // idempotency patterns elsewhere in this codebase.
  async subscribeNewsletter(shopSlug: string, dto: SubscribeNewsletterDto) {
    const shop = await this.resolveShop(shopSlug);
    try {
      await this.db.execute(
        `INSERT INTO newslettersubscriber (shopId, email, source) VALUES (?, ?, ?)`,
        [shop.id, dto.email, 'newsletter_widget'],
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('This email is already subscribed');
      }
      throw error;
    }
    return { subscribed: true };
  }

  async getShop(shopSlug: string) {
    const shop = await this.resolveShop(shopSlug);
    const themeRows = await this.db.query<(ThemesettingsRow & RowDataPacket)[]>(
      `SELECT * FROM themesettings WHERE shopId = ?`,
      [shop.id],
    );
    const theme = themeRows[0] ?? null;
    const seoRows = await this.db.query<(ShopseosettingsRow & RowDataPacket)[]>(
      `SELECT * FROM shopseosettings WHERE shopId = ?`,
      [shop.id],
    );
    const seo = seoRows[0] ?? null;
    // Which of the independent online providers (PayPal/Tabby/Tamara) the
    // storefront should offer as their own selectable payment methods —
    // reuses PaymentSettingsService.isEnabled, the exact same enabled/
    // default-state resolution the admin settings page and order-creation
    // both use, so what's shown here always matches what checkout will
    // actually accept. Whether *any* card processor (Nomod/Stripe) is
    // active — used to gate card_online client-side alongside the existing
    // deliveryPaymentCardOnline/pickupPaymentCardOnline booleans, so a shop
    // that's explicitly disabled both processors doesn't show a "Pay
    // online" option that would 500 at checkout.
    const [
      enabledPaymentProviders,
      cardProcessorEnabled,
      banners,
      publishedPolicyPages,
      tabbyPublicKey,
      tamaraPublicKey,
    ] = await Promise.all([
      Promise.all(
        INDEPENDENT_ONLINE_PROVIDERS.map(async (p) => ({
          provider: p,
          enabled: await this.paymentSettingsService.isEnabled(shop.id, p),
        })),
      ).then((results) =>
        results.filter((r) => r.enabled).map((r) => r.provider),
      ),
      this.paymentSettingsService.isEnabled(shop.id, shop.paymentGateway),
      this.db.query<(BannerimageRow & RowDataPacket)[]>(
        `SELECT * FROM bannerimage WHERE shopId = ? ORDER BY \`order\` ASC`,
        [shop.id],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT type FROM policypage WHERE shopId = ?`,
        [shop.id],
      ),
      // Public-safe (see resolvePublicWidgetKey's own comment) — drives the
      // PDP's Tabby/Tamara installment-promo widgets, entirely separate from
      // enabledPaymentProviders above (checkout method availability).
      this.paymentSettingsService.resolvePublicWidgetKey(shop.id, 'tabby'),
      this.paymentSettingsService.resolvePublicWidgetKey(shop.id, 'tamara'),
    ]);
    // Only the types a merchant has actually written content for — the
    // footer never links to a policy type with no content (see
    // components/Footer.tsx), so it needs to know which ones are real
    // without a second round-trip per type.
    const policyPageTypes = publishedPolicyPages.map((p) => p.type as string);
    // Deliberately not a full `...shop` spread — this is public, unauthenticated
    // data, so only the fields the storefront actually needs are exposed
    // (nothing that reads as internal/back-office, even though nothing on
    // this model is a secret today).
    return {
      // Exposed (unlike most internal shop flags) specifically so the
      // storefront itself can render a "Coming soon" placeholder with the
      // shop's own branding for an unpublished shop, rather than the shop
      // being unreachable outright — see ShopLayoutClient. Every other
      // content-serving endpoint below (products/collections/outlets/
      // checkout) is still hard-gated server-side via assertPublished,
      // regardless of what this field says client-side.
      published: shop.published,
      name: shop.name,
      displayName: shop.displayName,
      // Footer bottom-bar copyright line and (for policy content authorship
      // attribution, not currently used beyond that) — mirrors the exact
      // same trademarkFormat-driven name choice as admin's own Business
      // Information preview (see that page's trademarkPresets).
      legalName: shop.legalName,
      trademarkFormat: shop.trademarkFormat,
      email: shop.email,
      // Theme's own logo (set on the Theme tab, governs the storefront
      // specifically) takes precedence; falls back to the general business
      // logo (Business Information) if a merchant hasn't set a
      // storefront-specific one.
      logoUrl: theme?.logoUrl ?? shop.logoUrl,
      description: shop.description,
      currency: shop.currency,
      defaultLanguage: shop.defaultLanguage,
      whatsappCountryCode: shop.whatsappCountryCode,
      whatsappNumber: shop.whatsappNumber,
      whatsappFloatingButtonEnabled: shop.whatsappFloatingButtonEnabled,
      disableStoreCart: shop.disableStoreCart,
      cartDisabledMode: shop.cartDisabledMode,
      socialLinks: shop.socialLinks,
      productDisplayOrientation: shop.productDisplayOrientation,
      productImageZoomEnabled: shop.productImageZoomEnabled,
      showCollectionMenu: shop.showCollectionMenu,
      taxRate: trimDecimal(shop.taxRate),
      taxInclusive: shop.taxInclusive,
      taxDisplayText: shop.taxDisplayText,
      allowSameDayOrders: shop.allowSameDayOrders,
      allowNextDayOrders: shop.allowNextDayOrders,
      defaultDeliveryFee: trimDecimal(shop.defaultDeliveryFee),
      deliveryTimeSlotGapMinutes: shop.deliveryTimeSlotGapMinutes,
      pickupTimeSlotGapMinutes: shop.pickupTimeSlotGapMinutes,
      estimatedDeliveryTimeFrom: shop.estimatedDeliveryTimeFrom,
      estimatedDeliveryTimeTo: shop.estimatedDeliveryTimeTo,
      estimatedDeliveryTimeUnit: shop.estimatedDeliveryTimeUnit,
      pickupPreparationTimeMinutes: shop.pickupPreparationTimeMinutes,
      deliveryPreparationTimeMinutes: shop.deliveryPreparationTimeMinutes,
      businessHours: shop.businessHours,
      deliveryHours: shop.deliveryHours,
      pickupHours: shop.pickupHours,
      deliveryPaymentCardOnline: shop.deliveryPaymentCardOnline,
      deliveryPaymentCashOnDelivery: shop.deliveryPaymentCashOnDelivery,
      deliveryPaymentCardOnDelivery: shop.deliveryPaymentCardOnDelivery,
      pickupPaymentCardOnline: shop.pickupPaymentCardOnline,
      pickupPaymentCashOnPickup: shop.pickupPaymentCashOnPickup,
      pickupPaymentCardOnPickup: shop.pickupPaymentCardOnPickup,
      cardProcessorEnabled,
      enabledPaymentProviders,
      tabbyPublicKey,
      tamaraPublicKey,
      brandColor: theme?.brandColor ?? null,
      secondaryColor: theme?.secondaryColor ?? null,
      bannerUrl: theme?.bannerUrl ?? null,
      heroText: theme?.heroText ?? null,
      faviconUrl: theme?.faviconUrl ?? null,
      fontFamily: theme?.fontFamily ?? null,
      footerLogoUrl: theme?.footerLogoUrl ?? null,
      footerDescription: theme?.footerDescription ?? null,
      notificationText: theme?.notificationText ?? null,
      contactNumbers: theme?.contactNumbers ?? null,
      announcementBarEnabled: theme?.announcementBarEnabled ?? false,
      announcementBarScrolling: theme?.announcementBarScrolling ?? false,
      // Real multi-image slideshow banners — replaces bannerUrl's
      // single-image stand-in below (kept for backward compat / non-
      // slideshow layouts that only ever wanted one image; see
      // ClassicHero, which still reads bannerUrl directly).
      banners: banners.map((b) => ({
        id: b.id,
        url: b.url,
        linkUrl: b.linkUrl,
        order: b.order,
      })),
      policyPageTypes,
      // Raw per-key overrides, unresolved — the storefront applies its own
      // per-key defaults client-side (see shop-context.tsx's applyTheme),
      // same precedent as brandColor/secondaryColor/fontFamily above rather
      // than resolving defaults server-side like ogImage's fallback chain.
      colors: theme?.colors ?? null,
      homepageLayout: theme?.homepageLayout ?? 'classic',
      // Phase C — see theme/constants.ts. Same "always a real value,
      // defaults to current behavior" rule as homepageLayout.
      homeTabMode: theme?.homeTabMode ?? 'templates',
      // Theme Customizer v2 — see theme/constants.ts. Same "always a real
      // value, defaults to current behavior" rule as homepageLayout.
      topBarLayout: theme?.topBarLayout ?? 'logo_left',
      iconStyle: theme?.iconStyle ?? 'outline',
      buttonRadius: theme?.buttonRadius ?? 'rounded',
      buttonFill: theme?.buttonFill ?? 'solid',
      pdpLayout: theme?.pdpLayout ?? 'gallery_left',
      cartLayout: theme?.cartLayout ?? 'full_page',
      checkoutLayout: theme?.checkoutLayout ?? 'single_page',
      footerLayout: theme?.footerLayout ?? 'columns',
      headerDensity: theme?.headerDensity ?? 'regular',
      footerDensity: theme?.footerDensity ?? 'regular',
      // Home tab "collections" mode's own grid settings — see
      // theme/constants.ts's own comment.
      collectionsGridColumns: theme?.collectionsGridColumns ?? 3,
      collectionsGridGap: theme?.collectionsGridGap ?? 'md',
      collectionsGridShowTitle: theme?.collectionsGridShowTitle ?? true,
      collectionsGridImageAspectRatio:
        theme?.collectionsGridImageAspectRatio ?? 'portrait',
      metaTitle: seo?.metaTitle ?? null,
      metaDescription: seo?.metaDescription ?? null,
      // Falls back to Theme's banner, then its logo, then the general
      // business logo — a merchant who's set up Theme but not SEO
      // specifically still gets a real image in shared link previews
      // instead of nothing.
      ogImage:
        seo?.ogImage ??
        theme?.bannerUrl ??
        theme?.logoUrl ??
        shop.logoUrl ??
        null,
      keywords: seo?.keywords ?? null,
    };
  }

  // Backs the platform-wide sitemap (storefront's root /sitemap.xml).
  // shop.published (see migration 20260726100000_shop_published) is now the
  // real gate — a shop that's never been explicitly published, or an
  // abandoned mid-signup, never appears. Only slug + updatedAt are exposed:
  // nothing beyond what the shop's own public storefront URL already
  // reveals to anyone who visits it.
  async listShopsForSitemap() {
    const shops = await this.db.query<RowDataPacket[]>(
      `SELECT subdomain, updatedAt FROM shop WHERE published = 1 ORDER BY id ASC`,
    );
    return shops.map((s) => ({
      slug: s.subdomain as string,
      updatedAt: s.updatedAt as Date,
    }));
  }

  async listCollections(shopSlug: string, previewToken?: string) {
    const shop = await this.resolveShop(shopSlug);
    await this.assertPublishedOrPreview(shop, previewToken);
    return this.db.query<(CollectionRow & RowDataPacket)[]>(
      `SELECT * FROM collection WHERE shopId = ? ORDER BY displayOrder ASC, name ASC`,
      [shop.id],
    );
  }

  // Storefront brand filter — only brands that have at least one Available
  // product, so the filter never lists a brand that would match nothing.
  async listPublicBrands(shopSlug: string, previewToken?: string) {
    const shop = await this.resolveShop(shopSlug);
    await this.assertPublishedOrPreview(shop, previewToken);
    return this.db.query<RowDataPacket[]>(
      `SELECT b.id, b.name, b.logoUrl
       FROM brand b
       WHERE b.shopId = ?
         AND EXISTS (
           SELECT 1 FROM product p
           WHERE p.brandId = b.id AND p.status = 'Available'
         )
       ORDER BY b.name ASC`,
      [shop.id],
    );
  }

  // Collection (taxonomy node) detail page — /[shop]/collections/[slug].
  // Reuses the same loadPublicProductsWithRelations shape listProducts
  // already returns, filtered the same way listProducts' collectionId
  // param already is.
  // Bug 3 QA-sweep fix: this used the no-bypass assertPublished, unlike its
  // sibling listCollections just above (assertPublishedOrPreview) — an
  // unpublished shop's own staff previewing the theme builder's Collection
  // page template always 404'd here, even with a valid previewToken. Same
  // fix applied to getProductBySlug below (the Product page template hit
  // the identical wall) — every OTHER assertPublished call site in this
  // file is left untouched, several deliberately (see e.g. checkout's own
  // comment a few hundred lines up); this is scoped to exactly the two
  // page-detail reads the builder's page switcher needs.
  async getCollectionBySlug(
    shopSlug: string,
    slug: string,
    outletId?: number,
    previewToken?: string,
  ) {
    const shop = await this.resolveShop(shopSlug);
    await this.assertPublishedOrPreview(shop, previewToken);
    const collections = await this.db.query<(CollectionRow & RowDataPacket)[]>(
      `SELECT * FROM collection WHERE shopId = ? AND slug = ? LIMIT 1`,
      [shop.id, slug],
    );
    const collection = collections[0];
    if (!collection) {
      throw new NotFoundException(`Collection '${slug}' not found`);
    }
    const productRows = await this.db.query<RowDataPacket[]>(
      `SELECT p.id FROM product p
       JOIN productcollection pc ON pc.productId = p.id
       WHERE p.shopId = ? AND p.status = 'Available' AND pc.collectionId = ?
       ORDER BY p.id ASC`,
      [shop.id, collection.id],
    );
    const productIds = productRows.map((r) => r.id as number);
    const [products, salesCounts] = await Promise.all([
      this.loadPublicProductsWithRelations(productIds, shop.id, outletId),
      this.loadSalesCounts(productIds),
    ]);
    return {
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      image: collection.image,
      description: collection.description,
      parentCollectionId: collection.parentCollectionId,
      products: productIds
        .map((id) => products.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({
          ...p,
          salesCount: salesCounts.get(p.id as number) ?? 0,
        })),
    };
  }

  // "Best selling" sort on the storefront collection page (storefront-v2
  // Phase 2B) — units sold, excluding cancelled orders, same convention
  // ReportsService's Product Sales Report already uses. Scoped to this
  // collection's own product ids rather than added to every public product
  // listing endpoint, since it's the only sort that needs it.
  private async loadSalesCounts(
    productIds: number[],
  ): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (productIds.length === 0) return counts;
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT oi.productId AS productId, SUM(oi.quantity) AS sold
       FROM orderitem oi
       JOIN \`order\` o ON o.id = oi.orderId
       WHERE oi.productId IN (${productIds.map(() => '?').join(', ')}) AND o.status != 'cancelled'
       GROUP BY oi.productId`,
      productIds,
    );
    for (const row of rows) {
      counts.set(row.productId as number, Number(row.sold));
    }
    return counts;
  }

  // Storefront Home tab, 'templates' mode (see themesettings.homeTabMode) —
  // one section per active Template, each with its own resolved (and
  // capped) product list. Shop-scale template counts make resolving every
  // one on every homepage request cheap enough not to need caching.
  async getHomepageTemplates(shopSlug: string, outletId?: number) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    const templates = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM template WHERE shopId = ? AND isActive = 1 ORDER BY displayOrder ASC, title ASC`,
      [shop.id],
    );
    const HOMEPAGE_SECTION_PRODUCT_CAP = 12;
    return Promise.all(
      templates.map(async (template) => {
        const productIds = (
          await this.templatesService.resolveProductIds(shop.id, {
            id: template.id as number,
            type: template.type as string,
            rules: template.rules,
          })
        ).slice(0, HOMEPAGE_SECTION_PRODUCT_CAP);
        const products = await this.loadPublicProductsWithRelations(
          productIds,
          shop.id,
          outletId,
        );
        const ordered = productIds
          .map((id) => products.get(id))
          .filter((p): p is NonNullable<typeof p> => !!p);
        return {
          id: template.id,
          title: template.title,
          slug: template.slug,
          description: template.description,
          products: ordered,
        };
      }),
    );
  }

  async getMenu(shopSlug: string, previewToken?: string) {
    const shop = await this.resolveShop(shopSlug);
    await this.assertPublishedOrPreview(shop, previewToken);
    return this.menuService.listPublic(shop.id);
  }

  async listBioLinks(shopSlug: string) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    return this.bioLinksService.listPublic(shop);
  }

  // Raw bio-specific overrides only — the storefront resolves the
  // fallback-to-Theme/shop-meta chain itself, reusing the shop fields this
  // same GET /public/:shopSlug already returns (see BioLinksService.getPublicPageConfig).
  async getBioPageConfig(shopSlug: string) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    return this.bioLinksService.getPublicPageConfig(shop.id);
  }

  async listTemplates(shopSlug: string) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    return this.templatesService.listPublic(shop.id);
  }

  // Product formatting reuses loadPublicProductsWithRelations (the exact
  // same shape listProducts/getProduct return) rather than TemplatesService
  // duplicating that — it only ever resolves an ordered productId list
  // (MANUAL's own order, or RULE_BASED's newest-first), see its own
  // resolveProductIds. WHERE id IN (...) doesn't preserve order, so results
  // are re-sorted here to match.
  async getTemplate(shopSlug: string, slug: string, outletId?: number) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    const resolved = await this.templatesService.getPublicBySlug(shop.id, slug);
    if (!resolved) {
      throw new NotFoundException(`Template '${slug}' not found`);
    }
    const { summary, productIds } = resolved;

    const products = await this.loadPublicProductsWithRelations(
      productIds,
      shop.id,
      outletId,
    );
    const ordered = productIds
      .map((id) => products.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p);

    return {
      id: summary.id,
      title: summary.title,
      slug: summary.slug,
      description: summary.description,
      image: summary.image,
      products: ordered,
    };
  }

  async listProducts(
    shopSlug: string,
    outletId?: number,
    collectionId?: number,
    isCheckoutAddon?: boolean,
    previewToken?: string,
    brandId?: number,
  ) {
    const shop = await this.resolveShop(shopSlug);
    await this.assertPublishedOrPreview(shop, previewToken);
    const conditions = ['shopId = ?', "status = 'Available'"];
    const params: QueryParam[] = [shop.id];
    if (collectionId !== undefined) {
      conditions.push(
        'EXISTS (SELECT 1 FROM productcollection pc WHERE pc.productId = product.id AND pc.collectionId = ?)',
      );
      params.push(collectionId);
    }
    if (isCheckoutAddon !== undefined) {
      conditions.push('isCheckoutAddon = ?');
      params.push(isCheckoutAddon);
    }
    if (brandId !== undefined) {
      conditions.push('brandId = ?');
      params.push(brandId);
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM product WHERE ${conditions.join(' AND ')} ORDER BY id ASC`,
      params,
    );
    const productIds = rows.map((r) => r.id as number);
    const products = await this.loadPublicProductsWithRelations(
      productIds,
      shop.id,
      outletId,
    );
    return productIds
      .map((id) => products.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p);
  }

  async getProduct(shopSlug: string, id: number, outletId?: number) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    const products = await this.loadPublicProductsWithRelations(
      [id],
      shop.id,
      outletId,
    );
    const product = products.get(id);
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  // Slug-based lookup for the storefront's canonical product URL — kept as
  // a sibling to getProduct (by id) rather than replacing it, since the
  // storefront's old id-based route still needs to resolve a product (to
  // find its slug and redirect) without breaking existing shared links.
  async getProductBySlug(
    shopSlug: string,
    slug: string,
    outletId?: number,
    previewToken?: string,
  ) {
    const shop = await this.resolveShop(shopSlug);
    await this.assertPublishedOrPreview(shop, previewToken);
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM product WHERE slug = ? AND shopId = ? AND status = 'Available' LIMIT 1`,
      [slug, shop.id],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`Product '${slug}' not found`);
    }
    const id = row.id as number;
    const products = await this.loadPublicProductsWithRelations(
      [id],
      shop.id,
      outletId,
    );
    return products.get(id)!;
  }

  // Template-first, same-collection fallback — see RelatedProducts.tsx on
  // the storefront and TemplatesService.findRelatedProductIds for why this
  // didn't exist before Phase 8.4 (no product -> template reverse lookup
  // on the backend, only template -> products).
  async getRelatedProducts(shopSlug: string, slug: string, outletId?: number) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    const productRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM product WHERE slug = ? AND shopId = ? AND status = 'Available' LIMIT 1`,
      [slug, shop.id],
    );
    const productRow = productRows[0];
    if (!productRow) {
      throw new NotFoundException(`Product '${slug}' not found`);
    }
    const productId = productRow.id as number;

    let relatedIds = await this.templatesService.findRelatedProductIds(
      shop.id,
      productId,
    );

    if (relatedIds.length === 0) {
      const collectionRows = await this.db.query<RowDataPacket[]>(
        `SELECT collectionId FROM productcollection WHERE productId = ? LIMIT 1`,
        [productId],
      );
      const collectionId = collectionRows[0]?.collectionId as
        number | undefined;
      if (collectionId !== undefined) {
        const rows = await this.db.query<RowDataPacket[]>(
          `SELECT p.id FROM product p
           JOIN productcollection pc ON pc.productId = p.id
           WHERE p.shopId = ? AND p.status = 'Available' AND p.id != ? AND pc.collectionId = ?
           LIMIT 4`,
          [shop.id, productId, collectionId],
        );
        relatedIds = rows.map((r) => r.id as number);
      }
    }

    if (relatedIds.length === 0) return [];

    const products = await this.loadPublicProductsWithRelations(
      relatedIds,
      shop.id,
      outletId,
    );
    return relatedIds
      .map((id) => products.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p);
  }

  // Batch-loads every relation the old publicProductInclude used to fetch
  // in one Prisma nested include, as separate WHERE...IN queries grouped in
  // JS (same technique as ProductsService.loadProductsWithRelations), and
  // assembles the final public response shape directly — there's no
  // separate toProductResponse step since nothing else consumes the
  // intermediate shape. Always re-filters by shopId + status: 'Available'
  // even though every caller already resolved its own id list that way, as
  // defense in depth against a stale/cross-shop id slipping through.
  private async loadPublicProductsWithRelations(
    productIds: number[],
    shopId: number,
    outletId: number | undefined,
  ): Promise<Map<number, PublicProductResponse>> {
    const result = new Map<number, PublicProductResponse>();
    if (productIds.length === 0) return result;
    const idList = productIds.map(() => '?').join(', ');

    // outletId's `?` (in a JOIN clause) appears before the WHERE clause's
    // `?`s in the SQL text below — params must be in that same order since
    // .query() binds positionally, not by clause (see
    // ProductsService.loadIngredientLinks's own comment on this).
    const variantStockJoin =
      outletId !== undefined
        ? 'LEFT JOIN outletingredientstock vois ON vois.ingredientId = vshadow.id AND vois.outletId = ?'
        : '';
    const variantStockColumn =
      outletId !== undefined
        ? 'vois.stockQuantity AS variantStockQuantity'
        : 'NULL AS variantStockQuantity';
    const variantParams: QueryParam[] =
      outletId !== undefined ? [outletId, ...productIds] : productIds;

    const productStockJoin =
      outletId !== undefined
        ? 'LEFT JOIN outletingredientstock ois ON ois.ingredientId = ing.id AND ois.outletId = ?'
        : '';
    const productStockColumn =
      outletId !== undefined
        ? 'ois.stockQuantity AS stockQuantity'
        : 'NULL AS stockQuantity';
    const productStockParams: QueryParam[] =
      outletId !== undefined ? [outletId, ...productIds] : productIds;

    const [
      products,
      collectionLinks,
      images,
      attributes,
      faqs,
      options,
      variants,
      shadowStock,
      brands,
    ] = await Promise.all([
      this.db.query<(ProductRow & RowDataPacket)[]>(
        `SELECT * FROM product WHERE id IN (${idList}) AND shopId = ? AND status = 'Available'`,
        [...productIds, shopId],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT pc.productId, c.* FROM productcollection pc JOIN collection c ON c.id = pc.collectionId WHERE pc.productId IN (${idList})`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT * FROM productimage WHERE productId IN (${idList}) ORDER BY \`order\` ASC`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT * FROM productattribute WHERE productId IN (${idList}) ORDER BY \`order\` ASC`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT * FROM productfaq WHERE productId IN (${idList}) ORDER BY \`order\` ASC`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT po.*, pov.id AS valueId, pov.value AS valueValue, pov.order AS valueOrder
         FROM productoption po
         LEFT JOIN productoptionvalue pov ON pov.optionId = po.id
         WHERE po.productId IN (${idList})
         ORDER BY po.\`order\` ASC, pov.\`order\` ASC`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT v.*, img.url AS imageUrl,
                ov1.value AS optionValue1Value, ov2.value AS optionValue2Value, ov3.value AS optionValue3Value,
                ${variantStockColumn}
         FROM productvariant v
         LEFT JOIN productimage img ON img.id = v.imageId
         LEFT JOIN productoptionvalue ov1 ON ov1.id = v.optionValue1Id
         LEFT JOIN productoptionvalue ov2 ON ov2.id = v.optionValue2Id
         LEFT JOIN productoptionvalue ov3 ON ov3.id = v.optionValue3Id
         LEFT JOIN ingredient vshadow ON vshadow.shadowVariantId = v.id
         ${variantStockJoin}
         WHERE v.productId IN (${idList})
         ORDER BY v.\`order\` ASC`,
        variantParams,
      ),
      // Only ever a shadow ingredient's stock (see
      // ingredient.shadowProductId's schema comment) — null for a
      // usesIngredients:true product, which never surfaces its real
      // recipe/ingredient stock to a shopper.
      this.db.query<RowDataPacket[]>(
        `SELECT ing.shadowProductId AS productId, ${productStockColumn}
         FROM ingredient ing
         ${productStockJoin}
         WHERE ing.shadowProductId IN (${idList})`,
        productStockParams,
      ),
      this.db.query<(BrandRow & RowDataPacket)[]>(
        `SELECT DISTINCT b.id, b.name, b.logoUrl
         FROM brand b JOIN product p ON p.brandId = b.id
         WHERE p.id IN (${idList})`,
        productIds,
      ),
    ]);
    const brandById = new Map(
      brands.map((b) => [
        b.id,
        { id: b.id, name: b.name, logoUrl: b.logoUrl },
      ]),
    );

    const collectionsByProduct = new Map<number, RowDataPacket[]>();
    for (const row of collectionLinks) {
      const list = collectionsByProduct.get(row.productId as number) ?? [];
      list.push(row);
      collectionsByProduct.set(row.productId as number, list);
    }
    const imagesByProduct = new Map<number, RowDataPacket[]>();
    for (const row of images) {
      const list = imagesByProduct.get(row.productId as number) ?? [];
      list.push(row);
      imagesByProduct.set(row.productId as number, list);
    }
    const attributesByProduct = new Map<number, RowDataPacket[]>();
    for (const row of attributes) {
      const list = attributesByProduct.get(row.productId as number) ?? [];
      list.push(row);
      attributesByProduct.set(row.productId as number, list);
    }
    const faqsByProduct = new Map<number, RowDataPacket[]>();
    for (const row of faqs) {
      const list = faqsByProduct.get(row.productId as number) ?? [];
      list.push(row);
      faqsByProduct.set(row.productId as number, list);
    }
    const optionsByProduct = new Map<
      number,
      Map<
        number,
        {
          id: number;
          name: string;
          order: number;
          values: { id: number; value: string; order: number }[];
        }
      >
    >();
    for (const row of options) {
      const pid = row.productId as number;
      const optMap = optionsByProduct.get(pid) ?? new Map();
      const opt = optMap.get(row.id as number) ?? {
        id: row.id as number,
        name: row.name as string,
        order: row.order as number,
        values: [],
      };
      if (row.valueId != null) {
        opt.values.push({
          id: row.valueId as number,
          value: row.valueValue as string,
          order: row.valueOrder as number,
        });
      }
      optMap.set(opt.id, opt);
      optionsByProduct.set(pid, optMap);
    }
    const variantsByProduct = new Map<number, Record<string, unknown>[]>();
    for (const v of variants) {
      const list = variantsByProduct.get(v.productId as number) ?? [];
      list.push({
        id: v.id as number,
        sku: v.sku as string | null,
        barcode: v.barcode as string | null,
        price: trimDecimal(v.price as string | null),
        compareAtPrice: trimDecimal(v.compareAtPrice as string | null),
        imageUrl: (v.imageUrl as string | null) ?? null,
        optionValue1Id: v.optionValue1Id as number | null,
        optionValue2Id: v.optionValue2Id as number | null,
        optionValue3Id: v.optionValue3Id as number | null,
        label: buildVariantLabel([
          v.optionValue1Value as string | undefined,
          v.optionValue2Value as string | undefined,
          v.optionValue3Value as string | undefined,
        ]),
        stockQuantity:
          v.variantStockQuantity !== null
            ? Number(v.variantStockQuantity)
            : null,
      });
      variantsByProduct.set(v.productId as number, list);
    }
    const shadowStockByProduct = new Map<number, number | null>();
    for (const row of shadowStock) {
      shadowStockByProduct.set(
        row.productId as number,
        row.stockQuantity !== null ? Number(row.stockQuantity) : null,
      );
    }

    for (const p of products) {
      const id = p.id;
      const options_ = [...(optionsByProduct.get(id)?.values() ?? [])];
      result.set(id, {
        ...p,
        price: trimDecimal(p.price),
        compareAtPrice: trimDecimal(p.compareAtPrice),
        costPrice: trimDecimal(p.costPrice),
        weight: trimDecimal(p.weight),
        giftCardCustomAmountMin: trimDecimal(p.giftCardCustomAmountMin),
        giftCardCustomAmountMax: trimDecimal(p.giftCardCustomAmountMax),
        collections: (collectionsByProduct.get(id) ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          image: c.image,
          displayOrder: c.displayOrder,
          isFeatured: c.isFeatured,
          parentCollectionId: c.parentCollectionId,
        })),
        images: (imagesByProduct.get(id) ?? []).map((i) => ({
          id: i.id,
          url: i.url,
          order: i.order,
        })),
        attributes: (attributesByProduct.get(id) ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          value: a.value,
          order: a.order,
        })),
        faqs: (faqsByProduct.get(id) ?? []).map((f) => ({
          id: f.id,
          question: f.question,
          answer: f.answer,
          order: f.order,
        })),
        brand: p.brandId != null ? (brandById.get(p.brandId) ?? null) : null,
        hasVariants: options_.length > 0,
        options: options_,
        variants: variantsByProduct.get(id) ?? [],
        // Same convention as the admin ProductsService: null when no outlet
        // was resolved for this request, when trackInventory is off and no
        // stock row was ever created, or when this product uses a recipe
        // (no shadow ingredient — a recipe's real availability never
        // surfaces to the storefront) — distinct from 0, which means the
        // outlet genuinely has none in stock right now.
        stockQuantity: shadowStockByProduct.get(id) ?? null,
        // Fallback chain lives here (not client-side) so every consumer of
        // this API — the storefront's generateMetadata included — gets an
        // already-sensible title/description without duplicating the logic.
        metaTitle: p.metaTitle ?? p.name,
        metaDescription:
          p.metaDescription ?? truncateDescription(p.description),
      });
    }
    return result;
  }

  async listOutlets(shopSlug: string, previewToken?: string) {
    const shop = await this.resolveShop(shopSlug);
    await this.assertPublishedOrPreview(shop, previewToken);
    const outlets = await this.db.query<(OutletRow & RowDataPacket)[]>(
      `SELECT * FROM outlet WHERE shopId = ? AND active = 1 ORDER BY id ASC`,
      [shop.id],
    );
    return outlets.map((o) => ({
      id: o.id,
      name: o.name,
      nameAr: o.nameAr,
      emirate: o.emirate,
      area: o.area,
      phone: o.phone,
      latitude: o.latitude,
      longitude: o.longitude,
      deliveryEnabled: o.deliveryEnabled,
      pickupEnabled: o.pickupEnabled,
      deliveryRadiusKm: o.deliveryRadiusKm,
      businessHours: o.businessHours,
      isOpen: computeIsOpen(
        o.businessHours,
        o.closedOverride,
        o.closedOverrideSetAt,
        shop.timezone,
      ),
    }));
  }

  async listDeliveryZones(shopSlug: string, outletId: number) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    await this.assertOutletBelongsToShop(shop.id, outletId);
    const zones = await this.db.query<(DeliveryzoneRow & RowDataPacket)[]>(
      `SELECT id, name, fee, minOrderAmount FROM deliveryzone WHERE outletId = ? AND isActive = 1 ORDER BY id ASC`,
      [outletId],
    );
    return zones.map((z) => ({
      id: z.id,
      name: z.name,
      fee: trimDecimal(z.fee),
      minOrderAmount: trimDecimal(z.minOrderAmount),
    }));
  }

  geocode(query?: string) {
    return geocodeAddress(query);
  }

  reverseGeocode(lat?: number, lon?: number) {
    return reverseGeocodeAddress(lat, lon);
  }

  // Not shop-scoped by design — trackingToken is globally unique, so the
  // token alone is sufficient (and the only thing) that identifies the
  // order; no shopSlug needed in the URL. Deliberately excludes
  // customerPhone/customerEmail/customerAddress from the response even
  // though the token itself proves ownership — no reason to hand back more
  // PII than a status page needs.
  async lookupOrder(token?: string) {
    if (!token?.trim()) {
      throw new BadRequestException('A tracking code is required');
    }
    const orders = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM \`order\` WHERE trackingToken = ? LIMIT 1`,
      [token],
    );
    const order = orders[0];
    if (!order) {
      throw new NotFoundException('No order found for that tracking code');
    }

    const [items, shopRows, outletRows, customerRows] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT productName, variantLabel, quantity, priceAtPurchase FROM orderitem WHERE orderId = ?`,
        [order.id],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT name, currency, estimatedDeliveryTimeFrom, estimatedDeliveryTimeTo, estimatedDeliveryTimeUnit, pickupPreparationTimeMinutes
         FROM shop WHERE id = ?`,
        [order.shopId],
      ),
      this.db.query<RowDataPacket[]>(`SELECT name FROM outlet WHERE id = ?`, [
        order.outletId,
      ]),
      // Only for `hasAccount` below — never returning the hash itself, just
      // whether one is set. See customer.passwordHash's own comment: null =
      // guest, never registered.
      order.customerId !== null
        ? this.db.query<RowDataPacket[]>(
            `SELECT passwordHash FROM customer WHERE id = ?`,
            [order.customerId],
          )
        : Promise.resolve([] as RowDataPacket[]),
    ]);
    const shop = shopRows[0];
    const outlet = outletRows[0];
    const customer = customerRows[0];

    const estimatedTime =
      order.orderType === 'delivery'
        ? `${shop.estimatedDeliveryTimeFrom}-${shop.estimatedDeliveryTimeTo} ${shop.estimatedDeliveryTimeUnit}`
        : order.orderType === 'pickup'
          ? `${shop.pickupPreparationTimeMinutes} minutes`
          : null;

    return {
      id: order.id,
      shopName: shop.name as string,
      outletName: outlet.name as string,
      customerName: order.customerName,
      status: order.status,
      orderType: order.orderType,
      paymentStatus: order.paymentStatus,
      deliveryDate: order.deliveryDate,
      deliveryTimeSlot: order.deliveryTimeSlot,
      items: items.map((i) => ({
        productName: i.productName as string,
        variantLabel: i.variantLabel as string | null,
        quantity: i.quantity as number,
        priceAtPurchase: trimDecimal(i.priceAtPurchase as string),
      })),
      deliveryFee: trimDecimal(order.deliveryFee as string | null),
      taxAmount: trimDecimal(order.taxAmount as string | null),
      total: trimDecimal(order.total as string),
      currency: shop.currency as string,
      createdAt: order.createdAt,
      estimatedTime,
      // Lets the storefront offer a light "sign in to see all your orders"
      // nudge to a guest who happens to hold the tracking link for an order
      // whose contact info is already tied to a registered account — never
      // exposing the account's email/phone itself, just this one boolean.
      // Not a new privacy exposure: the tracking token itself already grants
      // full read access to this order and its (guest-creatable) customer
      // row, same trust boundary as everything else this endpoint returns.
      hasAccount: (customer?.passwordHash ?? null) != null,
    };
  }

  // Not shop-scoped, same reasoning as lookupOrder above — a survey token is
  // globally unique and self-sufficient. Deliberately excludes anything
  // order-identifying beyond the shop's own display name.
  async lookupSurvey(token?: string) {
    if (!token?.trim()) {
      throw new BadRequestException('A survey token is required');
    }
    const surveys = await this.db.query<(SurveyresponseRow & RowDataPacket)[]>(
      `SELECT * FROM surveyresponse WHERE token = ? LIMIT 1`,
      [token],
    );
    const survey = surveys[0];
    if (!survey) {
      throw new NotFoundException('No survey found for that token');
    }
    const shops = await this.db.query<RowDataPacket[]>(
      `SELECT name, displayName FROM shop WHERE id = ?`,
      [survey.shopId],
    );
    const shop = shops[0];
    return {
      shopName: (shop.displayName as string | null) ?? (shop.name as string),
      rating: survey.rating,
      comment: survey.comment,
      respondedAt: survey.respondedAt,
    };
  }

  async submitSurvey(token: string | undefined, dto: SubmitSurveyDto) {
    if (!token?.trim()) {
      throw new BadRequestException('A survey token is required');
    }
    const surveys = await this.db.query<(SurveyresponseRow & RowDataPacket)[]>(
      `SELECT * FROM surveyresponse WHERE token = ? LIMIT 1`,
      [token],
    );
    const survey = surveys[0];
    if (!survey) {
      throw new NotFoundException('No survey found for that token');
    }
    if (survey.respondedAt) {
      throw new BadRequestException('This survey has already been submitted');
    }
    await this.db.execute(
      `UPDATE surveyresponse SET rating = ?, comment = ?, respondedAt = ? WHERE token = ?`,
      [dto.rating, dto.comment ?? null, new Date(), token],
    );
    return { success: true };
  }

  async validateDiscount(shopSlug: string, dto: ValidateDiscountDto) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    return this.discountsService.validate(shop.id, dto);
  }

  // Every live auto-apply discount for this shop, for the storefront to
  // compute struck-through pricing on product cards/PDP with no code entry
  // and no cart-total round trip. See DiscountsService.listActiveAutoDiscounts.
  async listActiveAutoDiscounts(shopSlug: string) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    return this.discountsService.listActiveAutoDiscounts(shop.id);
  }

  async createOrder(shopSlug: string, dto: CreatePublicOrderDto) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    const outletRows = await this.db.query<(OutletRow & RowDataPacket)[]>(
      `SELECT * FROM outlet WHERE id = ? AND shopId = ? AND active = 1 LIMIT 1`,
      [dto.outletId, shop.id],
    );
    const outlet = outletRows[0];
    if (!outlet) {
      throw new BadRequestException('outletId is invalid for this shop');
    }

    if (dto.orderType === 'delivery' && !outlet.deliveryEnabled) {
      throw new BadRequestException('This outlet does not offer delivery');
    }
    if (dto.orderType === 'pickup' && !outlet.pickupEnabled) {
      throw new BadRequestException('This outlet does not offer pickup');
    }
    await this.assertPaymentMethodAvailable(
      shop as unknown as Record<string, unknown> & {
        id: number;
        paymentGateway: string;
      },
      dto.orderType,
      dto.paymentMethod,
    );
    this.assertFulfillmentOpen(shop, outlet, dto.orderType);
    if (dto.deliveryDate) {
      this.assertWithinAcceptanceWindow(shop, dto.deliveryDate);
      this.assertValidTimeSlot(shop, dto.orderType, dto.deliveryDate, dto.deliveryTimeSlot);
    }

    const resolvedItems = await this.productsService.resolveOrderItems(
      shop.id,
      dto.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        variantId: i.variantId,
        giftCardAmount: i.giftCardAmount,
      })),
    );
    for (const { product } of resolvedItems) {
      if (product.status !== 'Available') {
        throw new BadRequestException(
          `${product.name} is not currently available`,
        );
      }
    }

    let subtotal = 0;
    const itemsData = resolvedItems.map(
      (
        { product, variant, quantity, price, autoDiscountAmount, variantLabel },
        idx,
      ) => {
        subtotal += Number(price) * quantity;
        return {
          productId: product.id as number,
          productName: product.name as string,
          variantId: variant?.id ?? null,
          variantLabel: variantLabel ?? null,
          quantity,
          priceAtPurchase: price,
          autoDiscountAmount,
          note: dto.items[idx].note || null,
        };
      },
    );

    let deliveryFee =
      dto.orderType === 'pickup'
        ? 0
        : Number(await this.resolveDeliveryFee(shop, outlet, dto, subtotal));

    // Resolved before the transaction (doesn't need order.id) — an
    // invalid/expired/exhausted code throws here rather than silently
    // checking out at full price, unlike affiliate attribution below (which
    // never blocks checkout) — a discount the customer explicitly entered
    // and expects applied is a different UX contract than passive referral
    // tracking.
    let discount: { id: number; usageLimit: number | null } | null = null;
    let discountAmount = 0;
    let discountCodeSnapshot: string | undefined;
    if (dto.discountCode) {
      const resolved = await this.discountsService.resolveByCode(
        shop.id,
        dto.discountCode,
      );
      const evaluated = await this.discountsService.evaluate(resolved, {
        cartSubtotal: subtotal,
      });
      if (!evaluated.valid) {
        throw new BadRequestException(
          evaluated.message ?? 'This discount code cannot be applied',
        );
      }
      discount = resolved!;
      discountAmount = evaluated.discountAmount ?? 0;
      discountCodeSnapshot = evaluated.code;
      if (evaluated.freeShipping) {
        deliveryFee = 0;
      }
    }
    // Discount reduces the taxable base, same as a merchant discounting the
    // goods themselves — tax is computed on what the customer actually pays
    // for the products, not the pre-discount list price.
    const discountedSubtotal = Math.max(0, subtotal - discountAmount);

    const { taxAmount, total } = computeOrderTotals({
      subtotal: discountedSubtotal,
      deliveryFee,
      taxRate: Number(shop.taxRate),
      taxInclusive: shop.taxInclusive,
    });
    const orderTotal = Number(total.toFixed(2));

    // Gift card applies against the final total (after tax/delivery), not
    // the pre-tax subtotal a discount reduces — it's a payment credit, not
    // a price reduction. Resolved/validated before the transaction (same
    // "bad code fails before any writes" discipline as discountCode above),
    // the atomic balance claim happens inside it via GiftCardsService.redeem.
    let giftCard: { id: number; code: string } | null = null;
    let giftCardAmountApplied = 0;
    if (dto.giftCardCode) {
      const evaluated = await this.giftCardsService.validateCode(
        shop.id,
        dto.giftCardCode,
      );
      if (!evaluated.valid) {
        throw new BadRequestException(
          evaluated.message ?? 'This gift card cannot be applied',
        );
      }
      giftCard = { id: evaluated.giftCardId!, code: evaluated.code! };
      giftCardAmountApplied = Math.min(evaluated.remainingBalance!, orderTotal);
    }
    // What's actually owed through the selected paymentMethod after the
    // gift card credit — 0 when the card fully covers the order, in which
    // case no online-payment session is created at all (see below) and the
    // order is marked paid immediately, since nothing further is owed.
    const remainderTotal = orderTotal - giftCardAmountApplied;

    const customer = await this.customersService.findOrCreateForOrder(shop.id, {
      name: dto.customerName,
      phone: dto.customerPhone,
      email: dto.customerEmail,
    });

    // Resolved before the transaction (doesn't need order.id), applied
    // inside it (needs the order to exist) — an invalid/expired/blocked
    // code resolves to null and checkout proceeds with no attribution,
    // never a blocked order.
    const attribution = await this.affiliateService.resolveAttribution(
      shop.id,
      dto.referralCode,
      total,
    );

    const orderId = await this.db.transaction(async (conn) => {
      // Reserved at the moment the storefront customer checks out, not
      // deferred to merchant confirmation like the admin-entered order flow
      // — a real customer transaction needs the stock guarantee
      // immediately. Every product/variant resolves through
      // consumeForOrderItems now (Phase A: shadow or real recipe) — the
      // CAS-style `stockQuantity >= quantity` guard means two concurrent
      // checkouts for the last unit can't both succeed: only one UPDATE
      // matches, the other gets count 0 and this throws. See
      // orders.service.ts's channel === 'storefront' checks for why the
      // confirm-time decrement is skipped for these orders, and why
      // cancelling a still-pending one restocks immediately.
      // continueSellingOutOfStock/an untracked product skip the floor guard
      // entirely (stock may go negative) via the item's own allowNegative
      // flag rather than blocking the sale — see resolveOrderItems. A gift
      // card is never physical inventory (isGiftCard filtered out below);
      // trackInventory should already be false on one regardless, but this
      // is a defensive second guard, not the only one. actorUserId: null —
      // no authenticated staff user exists on this anonymous storefront
      // path (see stockmovement.actorUserId's schema comment).
      const ingredientsConsumed =
        await this.productsService.consumeForOrderItems(
          conn,
          shop.id,
          outlet.id,
          resolvedItems
            .filter(({ product }) => !product.isGiftCard)
            .map(({ product, variant, quantity, allowNegative }) => ({
              productId: product.id as number,
              variantId: variant?.id ?? null,
              quantity,
              allowNegative,
            })),
          -1,
          { throwOnInsufficientStock: true, actorUserId: null },
        );

      const trackingToken = generateTrackingCode();
      const [result] = await conn.query(
        `INSERT INTO \`order\` (
          shopId, ingredientsConsumedAt, outletId, customerId, customerName, customerPhone, customerEmail,
          customerAddress, emirate, area, deliveryDate, deliveryTimeSlot, deliveryNotes, receiverMessage,
          channel, orderType, paymentMethod, deliveryFee, taxAmount, discountId, discountCode, discountAmount,
          giftCardId, giftCardCode, giftCardAmount, total, paymentStatus, trackingToken
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          shop.id,
          ingredientsConsumed ? new Date() : null,
          outlet.id,
          customer.id,
          dto.customerName,
          dto.customerPhone,
          dto.customerEmail ?? null,
          dto.customerAddress,
          dto.emirate,
          dto.area ?? null,
          dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          dto.deliveryTimeSlot ?? null,
          dto.deliveryNotes ?? null,
          dto.receiverMessage ?? null,
          'storefront',
          dto.orderType,
          dto.paymentMethod,
          deliveryFee,
          Number(taxAmount.toFixed(2)),
          discount?.id ?? null,
          discountCodeSnapshot ?? null,
          discount ? discountAmount : null,
          giftCard?.id ?? null,
          giftCard?.code ?? null,
          giftCard ? giftCardAmountApplied : null,
          orderTotal,
          // Nothing left to collect through the selected paymentMethod when
          // the gift card covers the order in full — marked paid at
          // creation rather than left 'unpaid' waiting for a payment event
          // that was never going to happen (no online-payment session is
          // created for a zero remainder either, see below).
          remainderTotal <= 0 ? 'paid' : 'unpaid',
          trackingToken,
        ],
      );
      const newOrderId = (result as { insertId: number }).insertId;

      if (itemsData.length > 0) {
        const placeholders = itemsData
          .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .join(', ');
        await conn.query(
          `INSERT INTO orderitem (orderId, productId, productName, variantId, variantLabel, quantity, priceAtPurchase, autoDiscountAmount, note)
           VALUES ${placeholders}`,
          itemsData.flatMap((d) => [
            newOrderId,
            d.productId,
            d.productName,
            d.variantId,
            d.variantLabel,
            d.quantity,
            d.priceAtPurchase,
            d.autoDiscountAmount,
            d.note,
          ]),
        );
      }

      if (discount) {
        await this.discountsService.redeem(
          conn,
          discount,
          newOrderId,
          customer.id,
        );
      }

      if (giftCard && giftCardAmountApplied > 0) {
        await this.giftCardsService.redeem(
          conn,
          giftCard.id,
          giftCardAmountApplied,
          newOrderId,
        );
      }

      if (attribution) {
        await this.affiliateService.recordAttribution(
          conn,
          shop.id,
          newOrderId,
          attribution,
        );
      }

      // Gift Cards: any line item(s) that WERE themselves gift-card
      // purchases (not the giftCardCode redeemed above, which is a
      // completely separate concept — one is "paying with a card," this is
      // "buying a card") get issued as real, redeemable giftcard rows now
      // that the order exists. One card per unit — see
      // GiftCardsService.issueForOrder. Self-purchase only for this pass:
      // emailed to the order's own customerEmail, no separate recipient
      // field (see the task's own scope note on gift-to-someone-else).
      const giftCardLines = resolvedItems
        .filter(({ product }) => product.isGiftCard)
        .map(({ price, quantity }) => ({ amount: Number(price), quantity }));
      if (giftCardLines.length > 0) {
        await this.giftCardsService.issueForOrder(
          conn,
          shop.id,
          newOrderId,
          customer.id,
          giftCardLines,
          dto.customerEmail ?? null,
          shop.name,
        );
      }

      // Abandoned Cart Recovery: this completion, whenever it lands, is
      // what makes the "recovery job racing a same-window completion"
      // scenario safe — see AbandonedCartsService.markRecovered's own
      // comment on the CAS claim this performs.
      await this.abandonedCartsService.markRecovered(
        conn,
        shop.id,
        dto.customerPhone,
        newOrderId,
      );

      return newOrderId;
    });

    const orderRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM \`order\` WHERE id = ?`,
      [orderId],
    );
    const itemRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM orderitem WHERE orderId = ?`,
      [orderId],
    );
    const order = {
      ...orderRows[0],
      id: orderRows[0].id as number,
      outletId: orderRows[0].outletId as number,
      customerName: orderRows[0].customerName as string,
      customerEmail: orderRows[0].customerEmail as string | null,
      customerPhone: orderRows[0].customerPhone as string,
      orderType: orderRows[0].orderType as string | null,
      deliveryFee: trimDecimal(orderRows[0].deliveryFee as string),
      taxAmount: trimDecimal(orderRows[0].taxAmount as string),
      discountAmount: trimDecimal(orderRows[0].discountAmount as string),
      giftCardAmount: trimDecimal(orderRows[0].giftCardAmount as string),
      total: trimDecimal(orderRows[0].total as string),
      orderitem: itemRows.map((i) => ({
        ...i,
        priceAtPurchase: trimDecimal(i.priceAtPurchase as string),
        autoDiscountAmount: trimDecimal(i.autoDiscountAmount as string | null),
      })),
    };

    // Fires on order placement itself, not on payment completion — "we
    // received your order" rather than a payment receipt. Consistent for
    // every payment method (COD included), so this doesn't wait on the
    // card_online branch below.
    //
    // Not awaited, deliberately: a slow or down email/WhatsApp provider must
    // never delay (or, if it throws, fail) checkout for a real customer —
    // same fire-and-forget/.catch()-guarded discipline as
    // NotifySubscriptionsService.triggerForProduct. The order has already
    // committed by this point; a notification failure is logged, not
    // surfaced to the response.
    this.orderNotificationsService
      .notifyOrderConfirmed(shop.id, order)
      .catch((err: unknown) => {
        logger.error(`order #${order.id}: notifyOrderConfirmed failed`, {
          orderId: order.id,
          shopId: shop.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    // card_online routes to whichever card processor (Nomod/Stripe) is
    // currently active; the independent providers route to themselves
    // directly — both resolve merchant-supplied credentials the same way
    // (PaymentSettingsService.resolveCredentials, null when the shop hasn't
    // configured its own and the provider should fall back to its own
    // env-var default, if it has one — see StripePaymentProvider).
    const gatewayName =
      dto.paymentMethod === 'card_online'
        ? shop.paymentGateway
        : (INDEPENDENT_ONLINE_PROVIDERS as readonly string[]).includes(
              dto.paymentMethod,
            )
          ? dto.paymentMethod
          : null;
    // A gift card covering the order in full leaves nothing to charge — no
    // checkout session is created regardless of which online paymentMethod
    // was selected (order was already marked 'paid' at creation above).
    if (gatewayName && remainderTotal > 0) {
      const provider = this.providerRegistry.get(gatewayName);
      const credentials = await this.paymentSettingsService.resolveCredentials(
        shop.id,
        gatewayName,
      );
      const session = await provider.createCheckoutSession({
        orderId: order.id,
        amount: remainderTotal,
        currency: shop.currency,
        successUrl: `${STOREFRONT_URL}/${shopSlug}/orders/${order.id}?paid=1`,
        cancelUrl: `${STOREFRONT_URL}/${shopSlug}/checkout?orderId=${order.id}`,
        credentials,
      });
      return { order, checkoutUrl: session.checkoutUrl };
    }
    return { order, checkoutUrl: null };
  }

  private async resolveDeliveryFee(
    shop: { id: number; defaultDeliveryFee: string },
    outlet: {
      id: number;
      latitude: number | null;
      longitude: number | null;
      deliveryRadiusKm: number | null;
    },
    dto: CreatePublicOrderDto,
    subtotal: number,
  ): Promise<string> {
    // Radius is the eligibility boundary — if configured, coordinates are
    // required to prove the customer is inside it. Zones (below) then
    // decide the actual fee; radius never itself sets a fee.
    if (outlet.deliveryRadiusKm != null) {
      if (dto.latitude == null || dto.longitude == null) {
        throw new BadRequestException(
          'Your location is required to confirm delivery is available at this address',
        );
      }
      const distance = haversineDistanceKm(
        dto.latitude,
        dto.longitude,
        outlet.latitude!,
        outlet.longitude!,
      );
      if (distance > outlet.deliveryRadiusKm) {
        throw new BadRequestException(
          'This address is outside the outlet’s delivery radius',
        );
      }
    }

    const zones = await this.db.query<(DeliveryzoneRow & RowDataPacket)[]>(
      `SELECT * FROM deliveryzone WHERE outletId = ? AND isActive = 1`,
      [outlet.id],
    );
    const zone = matchDeliveryZone(zones, dto.area, dto.emirate);
    if (zone) {
      if (subtotal < Number(zone.minOrderAmount)) {
        throw new BadRequestException(
          `Minimum order amount for this area is ${zone.minOrderAmount}`,
        );
      }
      return zone.fee;
    }

    if (zones.length > 0) {
      // Zones ARE configured for this outlet, but this address didn't match
      // any of them — a merchant zone-name typo or a genuinely uncovered
      // address look identical from here, so this must never silently fall
      // through to the flat default fee. The only intentional fallback is
      // "radius-based delivery is also configured, and this address already
      // passed that check above" — in that case the outlet has explicitly
      // said "anything within N km is deliverable", so honor that, but flag
      // it loudly so a merchant can notice the zone mismatch. With no radius
      // configured either, there's no signal this address is deliverable at
      // all — block rather than guess.
      if (outlet.deliveryRadiusKm == null) {
        throw new BadRequestException(
          'Delivery is not available to this address — it did not match any configured delivery zone',
        );
      }
      logger.warn(
        'address matched no configured delivery zone — falling back to the shop default delivery fee via radius eligibility; check for a zone-name mismatch',
        { outletId: outlet.id, area: dto.area ?? null, emirate: dto.emirate },
      );
    }

    return shop.defaultDeliveryFee;
  }

  private async assertPaymentMethodAvailable(
    shop: Record<string, unknown> & { id: number; paymentGateway: string },
    orderType: 'delivery' | 'pickup',
    paymentMethod: string,
  ) {
    if (
      (INDEPENDENT_ONLINE_PROVIDERS as readonly string[]).includes(
        paymentMethod,
      )
    ) {
      // Not delivery/pickup-scoped — a single enabled flag gates both, same
      // as the Payment Gateways settings page's "visibility toggle" framing.
      const enabled = await this.paymentSettingsService.isEnabled(
        shop.id,
        paymentMethod,
      );
      if (!enabled) {
        throw new BadRequestException(
          `'${paymentMethod}' is not an available payment method`,
        );
      }
      return;
    }

    const flags =
      orderType === 'delivery' ? DELIVERY_PAYMENT_FLAGS : PICKUP_PAYMENT_FLAGS;
    const flagKey = (flags as Record<string, string>)[paymentMethod];
    if (!flagKey || !shop[flagKey]) {
      throw new BadRequestException(
        `'${paymentMethod}' is not an available payment method for ${orderType}`,
      );
    }
    if (paymentMethod === 'card_online') {
      // The boolean flag says card_online is offered, but is the shop's
      // active card processor (Nomod/Stripe) actually enabled? A merchant
      // who's explicitly turned off both would otherwise still show "Pay
      // online" client-side (see storefront's cardProcessorEnabled AND),
      // but a direct API call needs the same real check the settings page
      // enforces, not just a client-side hint.
      const processorEnabled = await this.paymentSettingsService.isEnabled(
        shop.id,
        shop.paymentGateway,
      );
      if (!processorEnabled) {
        throw new BadRequestException(
          'Online card payment is not currently available',
        );
      }
    }
  }

  private assertFulfillmentOpen(
    shop: { timezone: string; deliveryHours: unknown; pickupHours: unknown },
    outlet: {
      businessHours: unknown;
      closedOverride: boolean;
      closedOverrideSetAt: Date | null;
    },
    orderType: 'delivery' | 'pickup',
  ) {
    const outletOpen = computeIsOpen(
      outlet.businessHours,
      outlet.closedOverride,
      outlet.closedOverrideSetAt,
      shop.timezone,
    );
    if (!outletOpen) {
      throw new BadRequestException('This outlet is currently closed');
    }
    const fulfillmentHours =
      orderType === 'delivery' ? shop.deliveryHours : shop.pickupHours;
    // No override at the shop-hours level — closedOverride is an outlet-only
    // concept (already checked above); a null fulfillmentHours record means
    // "always open" for that fulfillment type, same convention as outlet
    // hours.
    const fulfillmentOpen = computeIsOpen(
      fulfillmentHours,
      false,
      null,
      shop.timezone,
    );
    if (!fulfillmentOpen) {
      throw new BadRequestException(
        `${orderType === 'delivery' ? 'Delivery' : 'Pickup'} is not available right now`,
      );
    }
  }

  private assertWithinAcceptanceWindow(
    shop: {
      timezone: string;
      allowSameDayOrders: boolean;
      allowNextDayOrders: boolean;
    },
    deliveryDate: string,
  ) {
    const requestedKey = dateKeyInTimezone(
      new Date(deliveryDate),
      shop.timezone,
    );
    const todayKey = dateKeyInTimezone(new Date(), shop.timezone);
    const tomorrowKey = dateKeyInTimezone(
      new Date(Date.now() + 24 * 60 * 60 * 1000),
      shop.timezone,
    );

    if (requestedKey < todayKey) {
      throw new BadRequestException('The selected date has already passed');
    }
    if (requestedKey === todayKey && !shop.allowSameDayOrders) {
      throw new BadRequestException(
        'Same-day orders are not available right now',
      );
    }
    if (requestedKey === tomorrowKey && !shop.allowNextDayOrders) {
      throw new BadRequestException(
        'Next-day orders are not available right now',
      );
    }
  }

  // Authoritative counterpart to the storefront's own client-side slot
  // generation (lib/slots.ts) — a time slot is required once a delivery/
  // pickup date is chosen, and the submitted value must be a real, still-
  // available slot for that date, not just any string. Regenerating the
  // valid-slot list server-side (via the hand-mirrored generateValidTimeSlots,
  // see time-slots.ts's own comment) and checking membership covers format
  // validity, business-hours compliance, and the same-day cutoff in one
  // check — closing the "held the checkout page open past the cutoff, or
  // skipped the client-side filtering entirely" bypass a client-only check
  // can't.
  private assertValidTimeSlot(
    shop: {
      timezone: string;
      deliveryHours: unknown;
      pickupHours: unknown;
      deliveryTimeSlotGapMinutes: number;
      pickupTimeSlotGapMinutes: number;
    },
    orderType: string,
    deliveryDate: string,
    deliveryTimeSlot: string | undefined,
  ) {
    if (!deliveryTimeSlot) {
      throw new BadRequestException('A time slot is required');
    }
    const hours = (
      orderType === 'pickup' ? shop.pickupHours : shop.deliveryHours
    ) as Parameters<typeof generateValidTimeSlots>[1];
    const gapMinutes =
      orderType === 'pickup'
        ? shop.pickupTimeSlotGapMinutes
        : shop.deliveryTimeSlotGapMinutes;
    const validSlots = generateValidTimeSlots(
      // Bare "YYYY-MM-DD" parses as UTC midnight per the ISO 8601 date-only
      // spec — the same construction assertWithinAcceptanceWindow already
      // uses just above, kept identical here rather than appending a local
      // "T00:00:00" (which would parse in the *server's* local timezone,
      // not the shop's, and could disagree with the already-validated date
      // key above).
      new Date(deliveryDate),
      hours,
      gapMinutes,
      shop.timezone,
      new Date(),
    );
    if (!validSlots.includes(deliveryTimeSlot)) {
      throw new BadRequestException('This time slot is no longer available');
    }
  }

  private async resolveShop(shopSlug: string): Promise<ShopRow> {
    const rows = await this.db.query<(ShopRow & RowDataPacket)[]>(
      `SELECT * FROM shop WHERE subdomain = ? LIMIT 1`,
      [shopSlug],
    );
    const shop = rows[0];
    if (!shop) {
      throw new NotFoundException(`Shop '${shopSlug}' not found`);
    }
    // A suspended shop's storefront goes fully offline — stricter than
    // assertPublished below (which two callers deliberately opt out of for
    // "coming soon"/order-tracking UX). resolveShop is the one real choke
    // point every public content-serving call routes through, so the check
    // belongs here, not in assertPublished, to actually cover all of them.
    if (shop.suspendedAt) {
      throw new NotFoundException(`Shop '${shopSlug}' not found`);
    }
    return shop;
  }

  // Every content-serving endpoint (products/collections/outlets/checkout)
  // is blocked for an unpublished shop — a 404 here reads identically to
  // "shop doesn't exist" for these endpoints, which is intentional: nothing
  // about an unpublished shop's real content should be reachable at all,
  // even by someone who knows the exact slug. getShop() deliberately does
  // NOT call this — the storefront still needs the shop's own name/branding
  // to render a "Coming soon" page instead of a dead end (see
  // ShopLayoutClient), and lookupOrder() (order tracking) also doesn't, so
  // an order placed before the shop was unpublished stays trackable.
  private assertPublished(shop: { subdomain: string; published: boolean }) {
    if (!shop.published) {
      throw new NotFoundException(`Shop '${shop.subdomain}' not found`);
    }
  }

  private async assertOutletBelongsToShop(shopId: number, outletId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ? LIMIT 1`,
      [outletId, shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Outlet ${outletId} not found`);
    }
  }
}
