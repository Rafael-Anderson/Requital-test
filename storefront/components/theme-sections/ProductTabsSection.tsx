"use client";

import { useEffect, useState } from "react";
import { useShop } from "@/lib/shop-context";
import { listProducts } from "@/lib/api";
import { resolveProductTabs } from "@/lib/product-tabs";
import { themeTextPresetStyle } from "@/lib/theme-element-style";
import ProductCard from "@/components/ProductCard";
import type { Product } from "@/lib/types";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

// Tailwind's JIT scanner needs literal class strings — no template
// interpolation.
const COLS_CLASS: Record<number, string> = {
  2: "grid-cols-2 sm:grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-6",
};

const DEFAULT_PRODUCT_LIMIT = 8;

// Tabbed product carousel (theme-builder-expansion Phase 2). Pill toggles
// swap the product set client-side with no page load. Each tab's products
// are fetched lazily on its first activation and cached (in `byTab`) for the
// life of the component. Reuses the shared <ProductCard> (already
// theme-driven, and carries the Phase 1 badge wiring) rather than
// ProductGridSection's own sub-block card system — this section is
// deliberately the lean cut (decision TBE2: collections only).
export default function ProductTabsSection({
  settings,
}: {
  sectionId: string;
  settings: SectionSettings;
  blocks: ThemeBlock[];
}) {
  const { shopSlug, outlets, previewToken } = useShop();
  const outletId = outlets[0]?.id;

  const tabs = resolveProductTabs(settings);
  const columns = COLS_CLASS[(settings.columns as number) ?? 4] ?? COLS_CLASS[4];
  const productLimit =
    typeof settings.productLimit === "number" && settings.productLimit > 0 ? settings.productLimit : DEFAULT_PRODUCT_LIMIT;
  const sectionTitle = typeof settings.sectionTitle === "string" ? settings.sectionTitle.trim() : "";

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [byTab, setByTab] = useState<Record<string, Product[]>>({});

  // The effective active tab, derived in render (not an effect) — a selection
  // that no longer matches any tab (merchant reordered/removed one in the
  // live preview) falls back to the first tab with no cascading re-render.
  const activeId = selectedId && tabs.some((t) => t.id === selectedId) ? selectedId : (tabs[0]?.id ?? "");

  useEffect(() => {
    const tab = tabs.find((t) => t.id === activeId);
    if (!tab || byTab[tab.id] !== undefined) return;
    let cancelled = false;
    listProducts(shopSlug, outletId, tab.collectionId, undefined, previewToken)
      .then((res) => {
        if (!cancelled) setByTab((prev) => ({ ...prev, [tab.id]: res.slice(0, productLimit) }));
      })
      .catch(() => {
        if (!cancelled) setByTab((prev) => ({ ...prev, [tab.id]: [] }));
      });
    return () => {
      cancelled = true;
    };
    // byTab is deliberately not a dep — a resolved fetch must not re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, shopSlug, outletId, previewToken, productLimit]);

  if (tabs.length === 0) return null;

  const products = byTab[activeId];
  const loading = products === undefined;

  return (
    <div className="px-4 sm:px-6 py-8 mx-auto" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
      {sectionTitle && (
        <h2 className="text-xl font-semibold mb-4" style={themeTextPresetStyle("h2")}>
          {sectionTitle}
        </h2>
      )}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSelectedId(tab.id)}
            aria-pressed={tab.id === activeId}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              tab.id === activeId
                ? "bg-accent text-accent-foreground"
                : "border border-stroke text-foreground hover:bg-mouse-over/10"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={`grid ${columns} gap-4 sm:gap-6`}>
          {Array.from({ length: Math.min(productLimit, 8) }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-xl animate-pulse"
              style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}
            />
          ))}
        </div>
      ) : products.length === 0 ? (
        <p className="text-sm text-price-main">No products in this collection yet.</p>
      ) : (
        <div className={`grid ${columns} gap-4 sm:gap-6`}>
          {products.map((product) => (
            <ProductCard key={product.id} product={product} orientation="grid" />
          ))}
        </div>
      )}
    </div>
  );
}
