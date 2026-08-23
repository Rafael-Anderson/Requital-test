"use client";

import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";
import { listProducts } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle, resolvePriceElementStyle, resolveButtonFillStyle, themeTextPresetStyle, productCardNameStyle } from "@/lib/theme-element-style";
import { useProductCardImageIndex } from "@/lib/use-product-card-image-index";
import CurrencySymbol from "@/components/CurrencySymbol";
import type { Product } from "@/lib/types";
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

const CARD_STYLE_CLASS: Record<string, string> = {
  minimal: "",
  bordered: "border border-stroke rounded-lg p-2",
  shadowed: "rounded-lg p-2 shadow-sm shadow-black/10",
};

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
}: {
  product: Product;
  cardStyle: string;
  shopBasePath: string;
  showMedia: boolean;
  showTitle: boolean;
  showPrice: boolean;
  showCurrencyCode: boolean;
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

  return (
    <Link
      href={`${shopBasePath}/products/${product.slug}`}
      className={`theme-product-card block group relative transition-all ${cardStyle}`}
      style={{ transitionDuration: "var(--theme-card-hover-transition-duration, 300ms)" }}
      {...handlers}
    >
      {showMedia && (
        <div className="aspect-square overflow-hidden bg-black/5 relative" style={{ borderRadius: "var(--theme-radius, 8px)" }}>
          {images.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt={product.name}
              className="theme-product-image absolute inset-0 w-full h-full object-cover transition-opacity duration-150"
              style={{
                opacity: i === activeIndex ? 1 : 0,
                transitionDuration: i === activeIndex ? "150ms" : "0ms, var(--theme-card-hover-transition-duration, 300ms)",
              }}
            />
          ))}
          {desktopQuickAdd}
        </div>
      )}
      {showTitle && (
        <p
          className="mt-3 line-clamp-2"
          {...(titleBlock ? editableAttrs(previewMode, { id: titleBlock.id, sectionId, type: "product_title" }) : {})}
          style={{ ...nameStyle, ...(titleBlock ? resolveTextElementStyle(titleBlock.settings) : {}) }}
        >
          {product.name}
        </p>
      )}
      {showPrice && (
        <p
          className="mt-1 text-sm font-semibold"
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
      )}
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
  const outletId = outlets[0]?.id;
  const collectionId = typeof settings.collectionId === "number" ? settings.collectionId : undefined;
  const productLimit = typeof settings.productLimit === "number" && settings.productLimit > 0 ? settings.productLimit : DEFAULT_PRODUCT_LIMIT;
  const quickAddLabel = typeof settings.quickAddLabel === "string" && settings.quickAddLabel ? settings.quickAddLabel : "Add";
  const sectionTitle = typeof settings.sectionTitle === "string" ? settings.sectionTitle.trim() : "";

  useEffect(() => {
    listProducts(shopSlug, outletId, collectionId, undefined, previewToken)
      .then((res) => setProducts(res.slice(0, productLimit)))
      .catch(() => setProducts([]));
  }, [shopSlug, outletId, collectionId, productLimit, previewToken]);

  const desktopColumns = (settings.columns as number) ?? 3;
  const mobileColumns = mobileColumnsFor(desktopColumns, settings.mobileColumns);
  const columns = `${MOBILE_COLS_CLASS[mobileColumns]} ${DESKTOP_COLS_CLASS[desktopColumns] ?? DESKTOP_COLS_CLASS[3]}`;
  const cardStyle = CARD_STYLE_CLASS[(settings.cardStyle as string) ?? "minimal"] ?? "";

  const cardBlock = blocks.find((b) => b.type === "product_card" && b.visible);
  const subBlocks = cardBlock?.blocks ?? [];
  const titleBlock = subBlocks.find((b) => b.type === "product_title");
  const priceBlock = subBlocks.find((b) => b.type === "product_price");
  const showMedia = subBlocks.length === 0 || subBlocks.some((b) => b.type === "product_media" && b.visible);
  const showTitle = subBlocks.length === 0 || !!titleBlock?.visible;
  const showPrice = subBlocks.length === 0 || !!priceBlock?.visible;
  const showCurrencyCode = priceBlock?.settings.showCurrencyCode === true;

  const productCards = themeConfig?.globalSettings.productCards;
  const shopCartUsable = !!cardBlock && !!productCards;

  if (!products || products.length === 0) return null;

  return (
    <div className="px-4 sm:px-6 py-8 mx-auto" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
      {sectionTitle && (
        <h2 className="text-xl font-semibold mb-4" style={themeTextPresetStyle("h2")}>
          {sectionTitle}
        </h2>
      )}
      <div className={`grid ${columns} gap-4 sm:gap-6`}>
        {products.map((product) => (
          <GridProductCard
            key={product.id}
            product={product}
            cardStyle={cardStyle}
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
