"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";
import { listProducts } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle, resolvePriceElementStyle, resolveButtonFillStyle } from "@/lib/theme-element-style";
import type { Product } from "@/lib/types";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

const COLUMNS_CLASS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

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

  useEffect(() => {
    listProducts(shopSlug, outletId, collectionId, undefined, previewToken)
      .then((res) => setProducts(res.slice(0, productLimit)))
      .catch(() => setProducts([]));
  }, [shopSlug, outletId, collectionId, productLimit, previewToken]);

  const columns = COLUMNS_CLASS[(settings.columns as number) ?? 3] ?? COLUMNS_CLASS[3];
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
      <div className={`grid ${columns} gap-4 sm:gap-6`}>
        {products.map((product) => (
          <Link key={product.id} href={`${shopBasePath}/products/${product.slug}`} className={`block group relative ${cardStyle}`}>
            {showMedia && (
              <div className="aspect-square overflow-hidden bg-black/5" style={{ borderRadius: "var(--theme-radius, 8px)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={product.thumbnail}
                  alt={product.name}
                  className="theme-product-image w-full h-full object-cover transition-transform"
                  style={{ transitionDuration: "var(--theme-card-hover-transition-duration, 300ms)" }}
                />
                {shopCartUsable && productCards.quickAdd && (
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
                )}
              </div>
            )}
            {showTitle && (
              <p
                className="mt-3 text-sm font-medium line-clamp-2"
                {...(titleBlock ? editableAttrs(previewMode, { id: titleBlock.id, sectionId, type: "product_title" }) : {})}
                style={titleBlock ? resolveTextElementStyle(titleBlock.settings) : undefined}
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
                {showCurrencyCode && shop ? `${shop.currency} ` : ""}
                {product.price}
              </p>
            )}
            {shopCartUsable && productCards.mobileQuickAdd && (
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
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
