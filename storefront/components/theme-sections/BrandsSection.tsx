"use client";

import { useEffect, useState } from "react";
import { useShop } from "@/lib/shop-context";
import { listBrands, resolveImageUrl } from "@/lib/api";
import { themeTextPresetStyle } from "@/lib/theme-element-style";
import type { Brand } from "@/lib/types";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

// Mobile / desktop column counts per "logos per row" setting — literal
// class strings so Tailwind's JIT scanner picks them up (same pattern as
// ProductGridSection's DESKTOP_COLS_CLASS).
const COLS_CLASS: Record<number, string> = {
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-3 sm:grid-cols-5",
  6: "grid-cols-3 sm:grid-cols-6",
  7: "grid-cols-3 sm:grid-cols-7",
  8: "grid-cols-4 sm:grid-cols-8",
};

// Homepage "Brands" section — a horizontal logo strip of the shop's brands
// (from the Brands feature). An empty brandIds means "all brands"; a
// non-empty list is an explicit ordered subset. `GET /public/:slug/brands`
// already returns only brands that have an available product, so a shop
// with none renders nothing on the live storefront (a placeholder in the
// builder preview so the section isn't invisible while being configured).
export default function BrandsSection({ settings }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { shopSlug, previewToken, previewMode } = useShop();
  const [brands, setBrands] = useState<Brand[] | null>(null);

  useEffect(() => {
    listBrands(shopSlug, previewToken)
      .then(setBrands)
      .catch(() => setBrands([]));
  }, [shopSlug, previewToken]);

  const heading = typeof settings.heading === "string" ? settings.heading.trim() : "";
  const brandIds = Array.isArray(settings.brandIds) ? (settings.brandIds as string[]) : [];
  const logosPerRow = typeof settings.logosPerRow === "number" && COLS_CLASS[settings.logosPerRow] ? settings.logosPerRow : 5;

  if (brands === null) return null;

  let shown = brands;
  if (brandIds.length > 0) {
    const byId = new Map(brands.map((b) => [String(b.id), b]));
    shown = brandIds.map((id) => byId.get(id)).filter((b): b is Brand => b !== undefined);
  }

  if (shown.length === 0) {
    if (!previewMode) return null;
    return (
      <div className="mx-auto px-4 py-8 text-center text-sm text-zinc-400" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
        No brands yet. Add brands under Products to show them here.
      </div>
    );
  }

  return (
    <div className="mx-auto px-4 sm:px-6 py-8" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
      {heading && (
        <h2 className="text-xl font-semibold mb-5 text-center" style={themeTextPresetStyle("h2")}>
          {heading}
        </h2>
      )}
      <div className={`grid ${COLS_CLASS[logosPerRow]} items-center gap-x-6 gap-y-6`}>
        {shown.map((brand) => {
          const logo = resolveImageUrl(brand.logoUrl);
          return (
            <div key={brand.id} className="flex items-center justify-center">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt={brand.name} title={brand.name} className="max-h-12 w-auto max-w-full object-contain opacity-80 transition-opacity hover:opacity-100" />
              ) : (
                <span className="text-sm font-medium text-zinc-500">{brand.name}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
