"use client";

import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";
import { listProducts, listCollections } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle, resolvePriceElementStyle, resolveButtonFillStyle, themeTextPresetStyle, productCardNameStyle } from "@/lib/theme-element-style";
import { useProductCardImageIndex } from "@/lib/use-product-card-image-index";
import { resolveProductBadge, type ResolvedProductBadge } from "@/lib/product-badge";
import { cardDensity, cardTextAlignClass, resolveCardAspectClass, resolveCardStyleClass } from "@/lib/product-card-style";
import CurrencySymbol from "@/components/CurrencySymbol";
import WishlistButton from "@/components/WishlistButton";
import type { Collection, Product } from "@/lib/types";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

// Split into a mobile piece (overridable via settings.mobileColumns, see
// mobileColumnsFor()) and a tablet/desktop piece - Tailwind classes must be
// literal strings for the JIT scanner, not template-interpolated.
const MOBILE_COLS_CLASS: Record<1 | 2, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
};
const DESKTOP_COLS_CLASS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
  6: "sm:grid-cols-6",
};

function mobileColumnsFor(desktopColumns: number, explicit: unknown): 1 | 2 {
  if (explicit === 1 || explicit === 2) return explicit;
  return desktopColumns <= 2 ? 1 : 2;
}

// Phase B1 — card style / aspect / density / align now come from
// lib/product-card-style.ts (shared with the standalone ProductCard.tsx).
// `bordered`/`shadowed` keep their exact class set (radius via .theme-round-md
// = the old `rounded-lg`), plus 5 new styles.

// Homepage teaser, not the full catalog — collection/product browsing
// already has its own real pages (see /[shop]/collections/[slug]). The
// merchant-configurable "Number of products" setting (settings.productLimit)
// overrides this default; it stays as the fallback for sections saved
// before that control existed.
const DEFAULT_PRODUCT_LIMIT = 8;

// No per-instance theme block backs the quick-add button — it's governed
// entirely by globalSettings.productCards (quickAdd/quickAddBackground/
// quickAddText/mobileQuickAdd), a Theme Settings category, not a block in
// any section's tree. PRODUCT_CARDS_SENTINEL_ID gives it something to
// carry as data-requital-id anyway: PreviewFrame.tsx's message handler
// special-cases this exact id to jump the editor straight to the Product
// cards category (same "Edit scheme" jump-link pattern SchemePicker.tsx
// already uses) instead of trying — and failing — to resolve it as a
// block selection.
export const PRODUCT_CARDS_SENTINEL_ID = "__product-cards__";

function QuickAddButton({
  product,
  outletId,
  className,
  background,
  color,
  fill,
  label,
  previewMode,
  tagProps,
}: {
  product: Product;
  outletId: number | undefined;
  className: string;
  background?: string;
  color?: string;
  fill?: string;
  label: string;
  previewMode: boolean;
  tagProps: ReturnType<typeof editableAttrs>;
}) {
  const { addItem } = useCart();
  if (outletId === undefined || product.hasVariants || product.isGiftCard) return null;
  return (
    <button
      type="button"
      {...tagProps}
      onClick={(e) => {
        // Always prevent the parent <Link>'s navigation, in every mode.
        e.preventDefault();
        // Selection-only in preview — deliberately does NOT stopPropagation
        // here (unlike the real-mode path below): the click must keep
        // bubbling to PreviewInteraction.tsx's document-level listener so
        // single-clicking this button selects it like every other tagged
        // element, rather than performing the real add-to-cart action a
        // "cart action" must never do inside the builder's preview.
        if (previewMode) return;
        e.stopPropagation();
        addItem(
          { productId: product.id, name: product.name, price: Number(product.price), thumbnail: product.thumbnail, maxStock: product.stockQuantity },
          1,
          outletId,
        );
      }}
      style={{ ...resolveButtonFillStyle(fill), background, color }}
      className={className}
    >
      {label}
    </button>
  );
}

// One product tile — its own component (not inline in the outer .map())
// because useProductCardImageIndex is a hook and needs one instance per
// card, not one shared across the whole grid.
function GridProductCard({
  product,
  cardStyle,
  cardStyleKey,
  aspectClass,
  nameMargin,
  alignClass,
  shopBasePath,
  showMedia,
  showTitle,
  showPrice,
  showCurrencyCode,
  shopCurrency,
  titleBlock,
  priceBlock,
  previewMode,
  sectionId,
  cardHoverEffect,
  showCarousel,
  desktopQuickAdd,
  mobileQuickAdd,
  nameStyle,
  badge,
}: {
  product: Product;
  cardStyle: string;
  // Phase B1 — the raw style key (for the `overlay` render branch) + the
  // resolved image-aspect / name-margin / text-align classes.
  cardStyleKey: string;
  aspectClass: string;
  nameMargin: string;
  alignClass: string;
  shopBasePath: string;
  showMedia: boolean;
  showTitle: boolean;
  showPrice: boolean;
  showCurrencyCode: boolean;
  // globalSettings.badges-driven Sold out chip (Phase 1) — resolved in the
  // parent since this component has no useShop() of its own. null for an
  // in-stock product or an un-themed shop.
  badge: ResolvedProductBadge | null;
  // Bug 7 fix: holds the raw currency CODE (e.g. "AED") now, not a
  // pre-computed text symbol - rendered via <CurrencySymbol /> below so
  // AED gets the real glyph instead of being stuck as plain text.
  shopCurrency: string | undefined;
  titleBlock: ThemeBlock | undefined;
  priceBlock: ThemeBlock | undefined;
  previewMode: boolean;
  sectionId: string;
  cardHoverEffect: string | undefined;
  showCarousel: boolean;
  desktopQuickAdd: ReactNode;
  mobileQuickAdd: ReactNode;
  nameStyle: CSSProperties;
}) {
  const images = product.images.length > 0 ? product.images.map((i) => i.url) : [product.thumbnail];
  const { activeIndex, handlers } = useProductCardImageIndex(images.length, {
    cycle: showCarousel,
    swapOnHover: cardHoverEffect === "swap",
  });
  const isOverlay = cardStyleKey === "overlay";

  const titleEl = showTitle ? (
    <p
      className={`${isOverlay ? "truncate text-white" : `${nameMargin} truncate`} ${alignClass}`}
      title={product.name}
      {...(titleBlock ? editableAttrs(previewMode, { id: titleBlock.id, sectionId, type: "product_title" }) : {})}
      style={{ ...(isOverlay ? {} : nameStyle), ...(titleBlock ? resolveTextElementStyle(titleBlock.settings) : {}) }}
    >
      {product.name}
    </p>
  ) : null;

  const priceEl = showPrice ? (
    <p
      className={`${isOverlay ? "text-sm font-semibold text-white/90" : "mt-1 text-sm font-semibold"} ${alignClass}`}
      {...(priceBlock ? editableAttrs(previewMode, { id: priceBlock.id, sectionId, type: "product_price" }) : {})}
      style={priceBlock ? resolvePriceElementStyle(priceBlock.settings) : undefined}
    >
      {showCurrencyCode && shopCurrency ? (
        <>
          <CurrencySymbol code={shopCurrency} />{" "}
        </>
      ) : (
        ""
      )}
      {product.price}
    </p>
  ) : null;

  return (
    <Link
      href={`${shopBasePath}/products/${product.slug}`}
      className={`theme-product-card block group relative transition-all ${cardStyle}`}
      style={{ transitionDuration: "var(--theme-card-hover-transition-duration, 300ms)" }}
      {...handlers}
    >
      {showMedia && (
        <div className={`${aspectClass} overflow-hidden bg-black/5 relative`} style={{ borderRadius: "var(--theme-radius, 8px)" }}>
          {images.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt={product.name}
              className="theme-product-image absolute inset-0 w-full h-full object-cover transition-opacity"
              style={{
                opacity: i === activeIndex ? 1 : 0,
                // Phase A — crossfade duration from the motion token (150ms
                // fallback = today).
                transitionDuration:
                  i === activeIndex
                    ? "var(--motion-duration-fast, 150ms)"
                    : "0ms, var(--theme-card-hover-transition-duration, 300ms)",
              }}
            />
          ))}
          {badge && (
            <span className={`absolute ${badge.positionClass} px-2 py-0.5 text-xs font-medium`} style={badge.style}>
              {badge.label}
            </span>
          )}
          <WishlistButton productId={product.id} />
          {desktopQuickAdd}
          {/* Phase B1 — `overlay` card style: title + price in a gradient
              strip over the image (mirrors FeaturedCollectionsSection's
              overlayText). */}
          {isOverlay && (titleEl || priceEl) && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-2 pt-6">
              {titleEl}
              {priceEl}
            </div>
          )}
        </div>
      )}
      {!isOverlay && titleEl}
      {!isOverlay && priceEl}
      {mobileQuickAdd}
    </Link>
  );
}

// Renders via the product_card block's own sub-blocks (product_media/
// product_title/product_price), each independently toggleable — the
// biggest single rework in the storefront half of this rework, replacing
// what used to be fixed hardcoded card markup. Falls back to showing all
// three when no product_card block exists (a theme predating this rework
// would have none, per the breaking-migration note in the plan).
export default function ProductGridSection({ sectionId, settings, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { shopSlug, shopBasePath, shop, outlets, themeConfig, previewToken, previewMode } = useShop();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const outletId = outlets[0]?.id;
  const collectionId = typeof settings.collectionId === "number" ? settings.collectionId : undefined;
  const productLimit = typeof settings.productLimit === "number" && settings.productLimit > 0 ? settings.productLimit : DEFAULT_PRODUCT_LIMIT;
  const quickAddLabel = typeof settings.quickAddLabel === "string" && settings.quickAddLabel ? settings.quickAddLabel : "Add";
  const sectionTitle = typeof settings.sectionTitle === "string" ? settings.sectionTitle.trim() : "";
  // Defaults to shown, same "on by default, opt out" reasoning as
  // showCurrencyCode above — a merchant scoping a section to a collection
  // gets a working "View all" link with no extra step. Only ever has a real
  // target when collectionId is set (there's no "all products" browse page
  // in this app — see FeaturedCollectionsSection.tsx's own comment), so it's
  // gated on collectionSlug resolving below regardless of this setting.
  const showViewAll = settings.showViewAllButton !== false;
  const viewAllLabel = (typeof settings.viewAllLabel === "string" && settings.viewAllLabel.trim()) || "View all";

  useEffect(() => {
    listProducts(shopSlug, outletId, collectionId, undefined, previewToken)
      .then((res) => setProducts(res.slice(0, productLimit)))
      .catch(() => setProducts([]));
  }, [shopSlug, outletId, collectionId, productLimit, previewToken]);

  // Only fetched when scoped to a real collection — the common "all
  // products" case (collectionId unset) has no "View all" target at all, so
  // it skips this network call entirely.
  useEffect(() => {
    if (collectionId === undefined) {
      setCollections([]);
      return;
    }
    listCollections(shopSlug, previewToken)
      .then(setCollections)
      .catch(() => setCollections([]));
  }, [shopSlug, collectionId, previewToken]);

  const collectionSlug = collectionId !== undefined ? collections.find((c) => c.id === collectionId)?.slug : undefined;

  const desktopColumns = (settings.columns as number) ?? 3;
  const mobileColumns = mobileColumnsFor(desktopColumns, settings.mobileColumns);
  const columns = `${MOBILE_COLS_CLASS[mobileColumns]} ${DESKTOP_COLS_CLASS[desktopColumns] ?? DESKTOP_COLS_CLASS[3]}`;
  // Phase B1 — the section's own settings.cardStyle wins over the global
  // productCards.cardStyle default; density/align come from the global.
  const cardStyleKey =
    (settings.cardStyle as string) ?? themeConfig?.globalSettings.productCards?.cardStyle ?? "minimal";
  const cardDensityValue = themeConfig?.globalSettings.productCards?.density;
  const cardStyle = resolveCardStyleClass(cardStyleKey, cardDensityValue);
  const density = cardDensity(cardDensityValue);
  const alignClass = cardTextAlignClass(themeConfig?.globalSettings.productCards?.textAlign);
  // Per-section settings.imageAspect wins over the global productCards.imageAspect.
  const aspectClass = resolveCardAspectClass(
    (settings.imageAspect as string) ?? themeConfig?.globalSettings.productCards?.imageAspect,
  );

  const cardBlock = blocks.find((b) => b.type === "product_card" && b.visible);
  const subBlocks = cardBlock?.blocks ?? [];
  const titleBlock = subBlocks.find((b) => b.type === "product_title");
  const priceBlock = subBlocks.find((b) => b.type === "product_price");
  const showMedia = subBlocks.length === 0 || subBlocks.some((b) => b.type === "product_media" && b.visible);
  const showTitle = subBlocks.length === 0 || !!titleBlock?.visible;
  const showPrice = subBlocks.length === 0 || !!priceBlock?.visible;
  // Defaults to shown, not hidden — every other price display in this app
  // (PDP, cart, checkout, the legacy ProductCard.tsx) always shows the
  // currency symbol unconditionally; this toggle only exists so a merchant
  // can deliberately opt OUT for a minimalist look, not so a bare number
  // ships by default on a freshly-created section (the reported bug: cards
  // showing "199" with no glyph at all).
  const showCurrencyCode = priceBlock?.settings.showCurrencyCode !== false;

  const productCards = themeConfig?.globalSettings.productCards;
  const shopCartUsable = !!cardBlock && !!productCards;

  if (!products || products.length === 0) return null;

  return (
    <div className="px-4 sm:px-6 theme-section-py mx-auto" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
      {(sectionTitle || (showViewAll && collectionSlug)) && (
        <div className="flex items-center justify-between theme-heading-gap">
          {sectionTitle && (
            <h2 className="text-xl font-semibold" style={themeTextPresetStyle("h2")}>
              {sectionTitle}
            </h2>
          )}
          {showViewAll && collectionSlug && (
            <Link href={`${shopBasePath}/collections/${collectionSlug}`} className="text-sm font-medium text-accent hover:underline">
              {viewAllLabel}
            </Link>
          )}
        </div>
      )}
      <div className={`grid ${columns} theme-grid-gap`}>
        {products.map((product) => (
          <GridProductCard
            key={product.id}
            product={product}
            cardStyle={cardStyle}
            cardStyleKey={cardStyleKey}
            aspectClass={aspectClass}
            nameMargin={density.nameMargin}
            alignClass={alignClass}
            shopBasePath={shopBasePath}
            showMedia={showMedia}
            showTitle={showTitle}
            showPrice={showPrice}
            showCurrencyCode={showCurrencyCode}
            shopCurrency={shop?.currency}
            titleBlock={titleBlock}
            priceBlock={priceBlock}
            previewMode={previewMode}
            sectionId={sectionId}
            cardHoverEffect={themeConfig?.globalSettings.animations.cardHoverEffect}
            showCarousel={!!productCards?.showCarousel}
            nameStyle={productCards ? productCardNameStyle(productCards) : {}}
            badge={
              product.stockQuantity !== null && product.stockQuantity <= 0
                ? resolveProductBadge("sold_out", themeConfig?.globalSettings.badges, themeConfig?.globalSettings.colorSchemes)
                : null
            }
            desktopQuickAdd={
              shopCartUsable && productCards.quickAdd ? (
                <QuickAddButton
                  product={product}
                  outletId={outletId}
                  background={productCards.quickAddBackground}
                  color={productCards.quickAddText}
                  fill={shop?.buttonFill}
                  label={quickAddLabel}
                  previewMode={previewMode}
                  tagProps={editableAttrs(previewMode, { id: PRODUCT_CARDS_SENTINEL_ID, sectionId, type: "add_to_cart_button" })}
                  className="hidden sm:group-hover:flex absolute bottom-2 right-2 items-center justify-center px-3 h-8 text-xs font-medium rounded-full shadow"
                />
              ) : null
            }
            mobileQuickAdd={
              shopCartUsable && productCards.mobileQuickAdd ? (
                <QuickAddButton
                  product={product}
                  outletId={outletId}
                  background={productCards.quickAddBackground}
                  color={productCards.quickAddText}
                  fill={shop?.buttonFill}
                  label={quickAddLabel}
                  previewMode={previewMode}
                  tagProps={editableAttrs(previewMode, { id: PRODUCT_CARDS_SENTINEL_ID, sectionId, type: "add_to_cart_button" })}
                  className="sm:hidden mt-2 w-full h-8 text-xs font-medium rounded-full border border-stroke"
                />
              ) : null
            }
          />
        ))}
      </div>
    </div>
  );
}
