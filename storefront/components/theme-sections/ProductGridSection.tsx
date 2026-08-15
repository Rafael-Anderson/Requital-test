"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";
import { listProducts } from "@/lib/api";
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
// already has its own real pages (see /[shop]/collections/[slug]).
const MAX_PRODUCTS = 8;

function QuickAddButton({
  product,
  outletId,
  className,
  background,
  color,
}: {
  product: Product;
  outletId: number | undefined;
  className: string;
  background?: string;
  color?: string;
}) {
  const { addItem } = useCart();
  if (outletId === undefined || product.hasVariants || product.isGiftCard) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        addItem(
          { productId: product.id, name: product.name, price: Number(product.price), thumbnail: product.thumbnail, maxStock: product.stockQuantity },
          1,
          outletId,
        );
      }}
      style={{ background, color }}
      className={className}
    >
      Add
    </button>
  );
}

// Renders via the product_card block's own sub-blocks (product_media/
// product_title/product_price), each independently toggleable — the
// biggest single rework in the storefront half of this rework, replacing
// what used to be fixed hardcoded card markup. Falls back to showing all
// three when no product_card block exists (a theme predating this rework
// would have none, per the breaking-migration note in the plan).
export default function ProductGridSection({ settings, blocks }: { settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { shopSlug, shopBasePath, outlets, themeConfig } = useShop();
  const [products, setProducts] = useState<Product[] | null>(null);
  const outletId = outlets[0]?.id;

  useEffect(() => {
    listProducts(shopSlug, outletId)
      .then((res) => setProducts(res.slice(0, MAX_PRODUCTS)))
      .catch(() => setProducts([]));
  }, [shopSlug, outletId]);

  const columns = COLUMNS_CLASS[(settings.columns as number) ?? 3] ?? COLUMNS_CLASS[3];
  const cardStyle = CARD_STYLE_CLASS[(settings.cardStyle as string) ?? "minimal"] ?? "";

  const cardBlock = blocks.find((b) => b.type === "product_card" && b.visible);
  const subBlocks = cardBlock?.blocks ?? [];
  const showMedia = subBlocks.length === 0 || subBlocks.some((b) => b.type === "product_media" && b.visible);
  const showTitle = subBlocks.length === 0 || subBlocks.some((b) => b.type === "product_title" && b.visible);
  const showPrice = subBlocks.length === 0 || subBlocks.some((b) => b.type === "product_price" && b.visible);

  const productCards = themeConfig?.globalSettings.productCards;
  const shopCartUsable = !!cardBlock && !!productCards;

  if (!products || products.length === 0) return null;

  return (
    <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto">
      <div className={`grid ${columns} gap-4 sm:gap-6`}>
        {products.map((product) => (
          <Link key={product.id} href={`${shopBasePath}/products/${product.slug}`} className={`block group relative ${cardStyle}`}>
            {showMedia && (
              <div className="aspect-square overflow-hidden bg-black/5" style={{ borderRadius: "var(--theme-radius, 8px)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={product.thumbnail}
                  alt={product.name}
                  className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-300"
                />
                {shopCartUsable && productCards.quickAdd && (
                  <QuickAddButton
                    product={product}
                    outletId={outletId}
                    background={productCards.quickAddBackground}
                    color={productCards.quickAddText}
                    className="hidden sm:group-hover:flex absolute bottom-2 right-2 items-center justify-center px-3 h-8 text-xs font-medium rounded-full shadow"
                  />
                )}
              </div>
            )}
            {showTitle && <p className="mt-3 text-sm font-medium line-clamp-2">{product.name}</p>}
            {showPrice && <p className="mt-1 text-sm font-semibold">{product.price}</p>}
            {shopCartUsable && productCards.mobileQuickAdd && (
              <QuickAddButton
                product={product}
                outletId={outletId}
                background={productCards.quickAddBackground}
                color={productCards.quickAddText}
                className="sm:hidden mt-2 w-full h-8 text-xs font-medium rounded-full border border-stroke"
              />
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
