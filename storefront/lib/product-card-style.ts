// Phase B1 (design-token foundation) — pure resolvers for the product-card
// style / image-aspect / density enums. No DOM, no React. Consumed by
// ProductGridSection.tsx's GridProductCard and components/ProductCard.tsx.
//
// Every resolver's `undefined` input returns today's exact default
// (aspect-square / "minimal" `""` / comfortable), so a shop with none of the
// new `productCards.*` keys renders byte-identically.

import type { CardStyle, ImageAspect, ProductCardSettings } from "./theme-config-types";

const ASPECT_CLASS: Record<ImageAspect, string> = {
  square: "aspect-square",
  portrait: "aspect-[3/4]",
  landscape: "aspect-[4/3]",
  tall: "aspect-[2/3]",
};

export function resolveCardAspectClass(aspect: ImageAspect | string | undefined | null): string {
  return typeof aspect === "string" && aspect in ASPECT_CLASS
    ? ASPECT_CLASS[aspect as ImageAspect]
    : "aspect-square";
}

// Radius classes use `.theme-round-*` (globals.css) so they follow
// globalSettings.radius; the literal fallbacks are the exact pre-B1 values
// (`bordered`/`shadowed` were `rounded-lg` = `--theme-round-md` fallback `0.5rem`).
const CARD_STYLE_BASE: Record<CardStyle, string> = {
  minimal: "",
  bordered: "border border-stroke theme-round-md",
  shadowed: "theme-round-md shadow-sm shadow-black/10",
  elevated: "theme-round-md shadow-md shadow-black/10",
  "outlined-hover": "theme-round-md border border-transparent hover:border-stroke transition-colors",
  filled: "theme-round-md bg-black/[0.03]",
  polaroid: "theme-round-sm bg-background shadow-sm shadow-black/10",
  overlay: "theme-round-md overflow-hidden relative",
};
const NO_PAD_STYLES = new Set<string>(["minimal", "overlay"]);

export function resolveCardStyleClass(
  style: CardStyle | string | undefined | null,
  density?: ProductCardSettings["density"],
): string {
  const key = (typeof style === "string" && style in CARD_STYLE_BASE ? style : "minimal") as CardStyle;
  const base = CARD_STYLE_BASE[key];
  if (NO_PAD_STYLES.has(key)) return base;
  const pad =
    key === "polaroid"
      ? density === "compact"
        ? "p-1 pb-3"
        : "p-2 pb-4"
      : density === "compact"
        ? "p-1"
        : "p-2";
  return `${base} ${pad}`.trim();
}

export interface CardDensity {
  nameMargin: string; // the `mt-*` on the product-name <p>
  showExcerpt: boolean; // whether the description excerpt may render (ProductCard only)
}

export function cardDensity(density?: ProductCardSettings["density"]): CardDensity {
  return density === "compact"
    ? { nameMargin: "mt-2", showExcerpt: false }
    : { nameMargin: "mt-3", showExcerpt: true };
}

export function cardTextAlignClass(textAlign?: ProductCardSettings["textAlign"]): string {
  return textAlign === "center" ? "text-center" : "";
}
