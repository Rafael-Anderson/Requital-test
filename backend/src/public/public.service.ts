import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RowDataPacket } from 'mysql2/promise';
import { PrismaService } from '../prisma/prisma.service';
import { DatabaseService } from '../database/database.service';
import { trimDecimal } from '../database/decimal.util';
import { computeIsOpen, dateKeyInTimezone } from '../outlets/outlet-status';
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
import { PolicyPagesService } from '../policy-pages/policy-pages.service';
import {
  POLICY_PAGE_TYPES,
  type PolicyPageType,
} from '../policy-pages/policy-page-constants';

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

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
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
  ) {}

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

  async getShop(shopSlug: string) {
    const shop = await this.resolveShop(shopSlug);
    const theme = await this.prisma.themesettings.findUnique({
      where: { shopId: shop.id },
    });
    const seo = await this.prisma.shopseosettings.findUnique({
      where: { shopId: shop.id },
    });
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
      this.prisma.bannerimage.findMany({
        where: { shopId: shop.id },
        orderBy: { order: 'asc' },
      }),
      this.prisma.policypage.findMany({
        where: { shopId: shop.id },
        select: { type: true },
      }),
    ]);
    // Only the types a merchant has actually written content for — the
    // footer never links to a policy type with no content (see
    // components/Footer.tsx), so it needs to know which ones are real
    // without a second round-trip per type.
    const policyPageTypes = publishedPolicyPages.map((p) => p.type);
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
      taxRate: shop.taxRate,
      taxInclusive: shop.taxInclusive,
      taxDisplayText: shop.taxDisplayText,
      allowSameDayOrders: shop.allowSameDayOrders,
      allowNextDayOrders: shop.allowNextDayOrders,
      defaultDeliveryFee: shop.defaultDeliveryFee,
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
      colors: (theme?.colors as Record<string, string> | null) ?? null,
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
    const shops = await this.prisma.shop.findMany({
      where: { published: true },
      select: { subdomain: true, updatedAt: true },
      orderBy: { id: 'asc' },
    });
    return shops.map((s) => ({ slug: s.subdomain, updatedAt: s.updatedAt }));
  }

  async listCollections(shopSlug: string) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    return this.prisma.collection.findMany({
      where: { shopId: shop.id },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  // Collection (taxonomy node) detail page — /[shop]/collections/[slug].
  // Reuses the same publicProductInclude/toProductResponse shape
  // listProducts already returns, filtered the same way listProducts'
  // collectionId param already is.
  async getCollectionBySlug(
    shopSlug: string,
    slug: string,
    outletId?: number,
  ) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    const collection = await this.prisma.collection.findFirst({
      where: { shopId: shop.id, slug },
    });
    if (!collection) {
      throw new NotFoundException(`Collection '${slug}' not found`);
    }
    const products = await this.prisma.product.findMany({
      where: {
        shopId: shop.id,
        status: 'Available',
        productcollection: { some: { collectionId: collection.id } },
      },
      include: this.publicProductInclude(outletId),
      orderBy: { id: 'asc' },
    });
    return {
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      image: collection.image,
      products: products.map((p) => this.toProductResponse(p)),
    };
  }

  // Storefront Home tab, 'templates' mode (see themesettings.homeTabMode) —
  // one section per active Template, each with its own resolved (and
  // capped) product list. Shop-scale template counts make resolving every
  // one on every homepage request cheap enough not to need caching.
  async getHomepageTemplates(shopSlug: string, outletId?: number) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    const templates = await this.prisma.template.findMany({
      where: { shopId: shop.id, isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { title: 'asc' }],
    });
    const HOMEPAGE_SECTION_PRODUCT_CAP = 12;
    return Promise.all(
      templates.map(async (template) => {
        const productIds = (
          await this.templatesService.resolveProductIds(shop.id, template)
        ).slice(0, HOMEPAGE_SECTION_PRODUCT_CAP);
        const products = await this.prisma.product.findMany({
          where: { id: { in: productIds }, shopId: shop.id, status: 'Available' },
          include: this.publicProductInclude(outletId),
        });
        const byId = new Map(products.map((p) => [p.id, p]));
        const ordered = productIds
          .map((id) => byId.get(id))
          .filter((p): p is NonNullable<typeof p> => !!p);
        return {
          id: template.id,
          title: template.title,
          slug: template.slug,
          description: template.description,
          products: ordered.map((p) => this.toProductResponse(p)),
        };
      }),
    );
  }

  async getMenu(shopSlug: string) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
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

  // Product formatting reuses toProductResponse/publicProductInclude
  // (the exact same shape listProducts/getProduct return) rather than
  // TemplatesService duplicating that — it only ever resolves an ordered
  // productId list (MANUAL's own order, or RULE_BASED's newest-first), see
  // its own resolveProductIds. findMany doesn't preserve `id IN (...)`
  // order, so results are re-sorted here to match.
  async getTemplate(shopSlug: string, slug: string, outletId?: number) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    const resolved = await this.templatesService.getPublicBySlug(
      shop.id,
      slug,
    );
    if (!resolved) {
      throw new NotFoundException(`Template '${slug}' not found`);
    }
    const { summary, productIds } = resolved;

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, shopId: shop.id, status: 'Available' },
      include: this.publicProductInclude(outletId),
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const ordered = productIds
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p);

    return {
      id: summary.id,
      title: summary.title,
      slug: summary.slug,
      description: summary.description,
      image: summary.image,
      products: ordered.map((p) => this.toProductResponse(p)),
    };
  }

  async listProducts(
    shopSlug: string,
    outletId?: number,
    collectionId?: number,
    isCheckoutAddon?: boolean,
  ) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    const products = await this.prisma.product.findMany({
      where: {
        shopId: shop.id,
        status: 'Available',
        ...(collectionId !== undefined && {
          productcollection: { some: { collectionId } },
        }),
        ...(isCheckoutAddon !== undefined && { isCheckoutAddon }),
      },
      include: this.publicProductInclude(outletId),
      orderBy: { id: 'asc' },
    });
    return products.map((p) => this.toProductResponse(p));
  }

  async getProduct(shopSlug: string, id: number, outletId?: number) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    const product = await this.prisma.product.findFirst({
      where: { id, shopId: shop.id, status: 'Available' },
      include: this.publicProductInclude(outletId),
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return this.toProductResponse(product);
  }

  // Slug-based lookup for the storefront's canonical product URL — kept as
  // a sibling to getProduct (by id) rather than replacing it, since the
  // storefront's old id-based route still needs to resolve a product (to
  // find its slug and redirect) without breaking existing shared links.
  async getProductBySlug(shopSlug: string, slug: string, outletId?: number) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    const product = await this.prisma.product.findFirst({
      where: { slug, shopId: shop.id, status: 'Available' },
      include: this.publicProductInclude(outletId),
    });
    if (!product) {
      throw new NotFoundException(`Product '${slug}' not found`);
    }
    return this.toProductResponse(product);
  }

  // Template-first, same-collection fallback — see RelatedProducts.tsx on
  // the storefront and TemplatesService.findRelatedProductIds for why this
  // didn't exist before Phase 8.4 (no product -> template reverse lookup
  // on the backend, only template -> products).
  async getRelatedProducts(shopSlug: string, slug: string, outletId?: number) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    const product = await this.prisma.product.findFirst({
      where: { slug, shopId: shop.id, status: 'Available' },
      include: { productcollection: true },
    });
    if (!product) {
      throw new NotFoundException(`Product '${slug}' not found`);
    }

    let relatedIds = await this.templatesService.findRelatedProductIds(
      shop.id,
      product.id,
    );

    if (relatedIds.length === 0) {
      const collectionId = product.productcollection[0]?.collectionId;
      if (collectionId !== undefined) {
        const rows = await this.prisma.product.findMany({
          where: {
            shopId: shop.id,
            status: 'Available',
            id: { not: product.id },
            productcollection: { some: { collectionId } },
          },
          select: { id: true },
          take: 4,
        });
        relatedIds = rows.map((r) => r.id);
      }
    }

    if (relatedIds.length === 0) return [];

    const products = await this.prisma.product.findMany({
      where: { id: { in: relatedIds }, shopId: shop.id },
      include: this.publicProductInclude(outletId),
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return relatedIds
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => this.toProductResponse(p));
  }

  private publicProductInclude(outletId: number | undefined) {
    return {
      productcollection: { include: { collection: true } },
      productimage: { orderBy: { order: 'asc' as const } },
      productattribute: { orderBy: { order: 'asc' as const } },
      productfaq: { orderBy: { order: 'asc' as const } },
      productoption: {
        orderBy: { order: 'asc' as const },
        include: { productoptionvalue: { orderBy: { order: 'asc' as const } } },
      },
      productvariant: {
        orderBy: { order: 'asc' as const },
        include: {
          image: true,
          optionValue1: true,
          optionValue2: true,
          optionValue3: true,
          // Only ever a shadow ingredient's stock (see
          // ingredient.shadowVariantId's schema comment) — null for a
          // usesIngredients:true variant, which never surfaces its real
          // recipe/ingredient stock to a shopper. Selecting only
          // stockQuantity keeps the ingredient's own id/name out of this
          // response entirely, preserving the "no ingredient identity ever
          // leaks to /public" invariant.
          ...(outletId !== undefined && {
            shadowIngredient: {
              select: {
                outletingredientstock: {
                  where: { outletId },
                  select: { stockQuantity: true },
                },
              },
            },
          }),
        },
      },
      ...(outletId !== undefined && {
        shadowIngredient: {
          select: {
            outletingredientstock: {
              where: { outletId },
              select: { stockQuantity: true },
            },
          },
        },
      }),
    } satisfies Prisma.productInclude;
  }

  async listOutlets(shopSlug: string) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    const outlets = await this.prisma.outlet.findMany({
      where: { shopId: shop.id, active: true },
      orderBy: { id: 'asc' },
    });
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
    return this.prisma.deliveryzone.findMany({
      where: { outletId, isActive: true },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, fee: true, minOrderAmount: true },
    });
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
    const order = await this.prisma.order.findUnique({
      where: { trackingToken: token },
      include: {
        orderitem: {
          select: {
            productName: true,
            variantLabel: true,
            quantity: true,
            priceAtPurchase: true,
          },
        },
        shop: {
          select: {
            name: true,
            currency: true,
            estimatedDeliveryTimeFrom: true,
            estimatedDeliveryTimeTo: true,
            estimatedDeliveryTimeUnit: true,
            pickupPreparationTimeMinutes: true,
          },
        },
        outlet: { select: { name: true } },
        // Only for `hasAccount` below — never returning the hash itself,
        // just whether one is set. See customer.passwordHash's own comment:
        // null = guest, never registered.
        customer: { select: { passwordHash: true } },
      },
    });
    if (!order) {
      throw new NotFoundException('No order found for that tracking code');
    }

    const estimatedTime =
      order.orderType === 'delivery'
        ? `${order.shop.estimatedDeliveryTimeFrom}-${order.shop.estimatedDeliveryTimeTo} ${order.shop.estimatedDeliveryTimeUnit}`
        : order.orderType === 'pickup'
          ? `${order.shop.pickupPreparationTimeMinutes} minutes`
          : null;

    return {
      id: order.id,
      shopName: order.shop.name,
      outletName: order.outlet.name,
      customerName: order.customerName,
      status: order.status,
      orderType: order.orderType,
      paymentStatus: order.paymentStatus,
      deliveryDate: order.deliveryDate,
      deliveryTimeSlot: order.deliveryTimeSlot,
      items: order.orderitem,
      deliveryFee: order.deliveryFee,
      taxAmount: order.taxAmount,
      total: order.total,
      currency: order.shop.currency,
      createdAt: order.createdAt,
      estimatedTime,
      // Lets the storefront offer a light "sign in to see all your orders"
      // nudge to a guest who happens to hold the tracking link for an order
      // whose contact info is already tied to a registered account — never
      // exposing the account's email/phone itself, just this one boolean.
      // Not a new privacy exposure: the tracking token itself already grants
      // full read access to this order and its (guest-creatable) customer
      // row, same trust boundary as everything else this endpoint returns.
      hasAccount: order.customer?.passwordHash != null,
    };
  }

  // Not shop-scoped, same reasoning as lookupOrder above — a survey token is
  // globally unique and self-sufficient. Deliberately excludes anything
  // order-identifying beyond the shop's own display name.
  async lookupSurvey(token?: string) {
    if (!token?.trim()) {
      throw new BadRequestException('A survey token is required');
    }
    const survey = await this.prisma.surveyresponse.findUnique({
      where: { token },
      include: { shop: { select: { name: true, displayName: true } } },
    });
    if (!survey) {
      throw new NotFoundException('No survey found for that token');
    }
    return {
      shopName: survey.shop.displayName ?? survey.shop.name,
      rating: survey.rating,
      comment: survey.comment,
      respondedAt: survey.respondedAt,
    };
  }

  async submitSurvey(token: string | undefined, dto: SubmitSurveyDto) {
    if (!token?.trim()) {
      throw new BadRequestException('A survey token is required');
    }
    const survey = await this.prisma.surveyresponse.findUnique({
      where: { token },
    });
    if (!survey) {
      throw new NotFoundException('No survey found for that token');
    }
    if (survey.respondedAt) {
      throw new BadRequestException('This survey has already been submitted');
    }
    await this.prisma.surveyresponse.update({
      where: { token },
      data: {
        rating: dto.rating,
        comment: dto.comment ?? null,
        respondedAt: new Date(),
      },
    });
    return { success: true };
  }

  async validateDiscount(shopSlug: string, dto: ValidateDiscountDto) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    return this.discountsService.validate(shop.id, dto);
  }

  async createOrder(shopSlug: string, dto: CreatePublicOrderDto) {
    const shop = await this.resolveShop(shopSlug);
    this.assertPublished(shop);
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: dto.outletId, shopId: shop.id, active: true },
    });
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
      shop,
      dto.orderType,
      dto.paymentMethod,
    );
    this.assertFulfillmentOpen(shop, outlet, dto.orderType);
    if (dto.deliveryDate) {
      this.assertWithinAcceptanceWindow(shop, dto.deliveryDate);
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
      ({ product, variant, quantity, price, variantLabel }, idx) => {
        subtotal += Number(price) * quantity;
        return {
          productId: product.id as number,
          productName: product.name as string,
          variantId: variant?.id ?? null,
          variantLabel: variantLabel ?? null,
          quantity,
          priceAtPurchase: price,
          note: dto.items[idx].note || null,
        };
      },
    );

    let deliveryFee =
      dto.orderType === 'pickup'
        ? 0
        : Number(
            await this.resolveDeliveryFee(shop, outlet, dto, subtotal),
          );

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
        const placeholders = itemsData.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        await conn.query(
          `INSERT INTO orderitem (orderId, productId, productName, variantId, variantLabel, quantity, priceAtPurchase, note)
           VALUES ${placeholders}`,
          itemsData.flatMap((d) => [
            newOrderId,
            d.productId,
            d.productName,
            d.variantId,
            d.variantLabel,
            d.quantity,
            d.priceAtPurchase,
            d.note,
          ]),
        );
      }

      if (discount) {
        await this.discountsService.redeem(conn, discount, newOrderId, customer.id);
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
      total: trimDecimal(orderRows[0].total as string) as string,
      orderitem: itemRows.map((i) => ({
        ...i,
        priceAtPurchase: trimDecimal(i.priceAtPurchase as string),
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
        orderId: order.id as number,
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
    shop: { id: number; defaultDeliveryFee: Prisma.Decimal },
    outlet: {
      id: number;
      latitude: number | null;
      longitude: number | null;
      deliveryRadiusKm: number | null;
    },
    dto: CreatePublicOrderDto,
    subtotal: number,
  ): Promise<Prisma.Decimal> {
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

    const zones = await this.prisma.deliveryzone.findMany({
      where: { outletId: outlet.id, isActive: true },
    });
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

  private async resolveShop(shopSlug: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { subdomain: shopSlug },
    });
    if (!shop) {
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
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: outletId, shopId },
    });
    if (!outlet) {
      throw new NotFoundException(`Outlet ${outletId} not found`);
    }
  }

  private toProductResponse(product: PublicProductRow) {
    const {
      productcollection,
      productimage,
      productattribute,
      productfaq,
      productoption,
      productvariant,
      shadowIngredient,
      metaTitle,
      metaDescription,
      description,
      ...rest
    } = product;
    return {
      ...rest,
      description,
      collections: productcollection.map((pc) => pc.collection),
      images: productimage.map((i) => ({
        id: i.id,
        url: i.url,
        order: i.order,
      })),
      attributes: productattribute.map((a) => ({
        id: a.id,
        name: a.name,
        value: a.value,
        order: a.order,
      })),
      faqs: productfaq.map((f) => ({
        id: f.id,
        question: f.question,
        answer: f.answer,
        order: f.order,
      })),
      hasVariants: productoption.length > 0,
      options: productoption.map((o) => ({
        id: o.id,
        name: o.name,
        order: o.order,
        values: o.productoptionvalue.map((v) => ({
          id: v.id,
          value: v.value,
          order: v.order,
        })),
      })),
      // Sku/barcode included for parity with the admin shape even though
      // the storefront UI itself never displays them to shoppers.
      variants: productvariant.map((v) => ({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        imageUrl: v.image?.url ?? null,
        optionValue1Id: v.optionValue1Id,
        optionValue2Id: v.optionValue2Id,
        optionValue3Id: v.optionValue3Id,
        label: buildVariantLabel([
          v.optionValue1?.value,
          v.optionValue2?.value,
          v.optionValue3?.value,
        ]),
        stockQuantity:
          v.shadowIngredient?.outletingredientstock?.[0]?.stockQuantity ?? null,
      })),
      // Same convention as the admin ProductsService: null when no outlet
      // was resolved for this request, when trackInventory is off and no
      // stock row was ever created, or when this product uses a recipe
      // (shadowIngredient is null — a recipe's real availability never
      // surfaces to the storefront, same as before Phase A) — distinct from
      // 0, which means the outlet genuinely has none in stock right now.
      stockQuantity:
        shadowIngredient?.outletingredientstock?.[0]?.stockQuantity ?? null,
      // Fallback chain lives here (not client-side) so every consumer of
      // this API — the storefront's generateMetadata included — gets an
      // already-sensible title/description without duplicating the logic.
      metaTitle: metaTitle ?? product.name,
      metaDescription: metaDescription ?? truncateDescription(description),
    };
  }
}

type PublicProductRow = Omit<
  Prisma.productGetPayload<{
    include: {
      productcollection: { include: { collection: true } };
      productimage: true;
      productattribute: true;
      productfaq: true;
      productoption: { include: { productoptionvalue: true } };
      productvariant: {
        include: {
          image: true;
          optionValue1: true;
          optionValue2: true;
          optionValue3: true;
        };
      };
    };
  }>,
  'productvariant'
> & {
  // Prisma's payload-inference generics can't narrow a relation whose
  // include shape is computed dynamically (publicProductInclude branches on
  // outletId) rather than passed as an inline literal — same known
  // limitation this codebase's own `(response as any).stockByOutlet` cast
  // in products.service.ts already works around. Loosely typed here (only
  // ever actually shaped `{ outletingredientstock: {...}[] } | null` at
  // runtime, per publicProductInclude's own `select`) rather than fighting
  // Prisma's generics for a field this method reads exactly once.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shadowIngredient?: any;
  productvariant: (Prisma.productvariantGetPayload<{
    include: {
      image: true;
      optionValue1: true;
      optionValue2: true;
      optionValue3: true;
    };
  }> & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shadowIngredient?: any;
  })[];
};
