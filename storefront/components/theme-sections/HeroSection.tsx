import type { CSSProperties, ReactNode } from "react";
import type { SectionSettings, ThemeElement } from "@/lib/theme-config-types";

const HEIGHT_CLASS: Record<string, string> = {
  small: "min-h-[240px]",
  medium: "min-h-[400px]",
  large: "min-h-[560px]",
  full: "min-h-screen",
};

const POSITION_CLASS: Record<string, string> = {
  "top-left": "items-start justify-start text-left",
  "top-center": "items-start justify-center text-center",
  "top-right": "items-start justify-end text-right",
  "center-left": "items-center justify-start text-left",
  "center-center": "items-center justify-center text-center",
  "center-right": "items-center justify-end text-right",
  "bottom-left": "items-end justify-start text-left",
  "bottom-center": "items-end justify-center text-center",
  "bottom-right": "items-end justify-end text-right",
};

// Mirrors admin/lib/default-theme-elements.ts's DEFAULT_HERO_ELEMENTS by
// hand — an untouched theme's `elements` array is empty, so this reproduces
// the original fixed heading-then-subheading-then-CTA stacking order.
const DEFAULT_ELEMENTS: ThemeElement[] = [
  { id: "heading", type: "heading", position: { zone: "top" }, settings: {} },
  { id: "subheading", type: "subheading", position: { zone: "middle" }, settings: {} },
  { id: "cta", type: "cta", position: { zone: "bottom" }, settings: {} },
];
const ZONE_ORDER = ["top", "middle", "bottom"];

// Falls back to the global heading font (--theme-heading-font, see
// shop-context.tsx's Google Fonts loader) when this section has no explicit
// per-section typography override — matches how every other themed element
// on this storefront layers a section-specific choice over a global default.
function typographyStyle(typography: SectionSettings["typography"]): CSSProperties {
  const fontFamily =
    typography && typeof typography.fontFamily === "string"
      ? typography.fontFamily
      : "var(--theme-heading-font, inherit)";
  if (!typography) return { fontFamily };
  return {
    fontFamily,
    fontSize: typeof typography.fontSize === "number" ? `${typography.fontSize}px` : undefined,
    fontWeight: typeof typography.fontWeight === "string" ? typography.fontWeight : undefined,
    color: typeof typography.color === "string" ? typography.color : undefined,
    letterSpacing: typeof typography.letterSpacing === "number" ? `${typography.letterSpacing}px` : undefined,
  };
}

export default function HeroSection({
  settings,
  elements,
}: {
  settings: SectionSettings;
  elements?: ThemeElement[];
}) {
  const heading = typeof settings.heading === "string" ? settings.heading : "";
  const subheading = typeof settings.subheading === "string" ? settings.subheading : "";
  const ctaLabel = typeof settings.ctaLabel === "string" ? settings.ctaLabel : "";
  const height = HEIGHT_CLASS[settings.height as string] ?? HEIGHT_CLASS.medium;
  const position = POSITION_CLASS[settings.contentPosition as string] ?? POSITION_CLASS["center-center"];

  const nodes: Record<string, ReactNode> = {
    heading: heading && (
      <h1 key="heading" className="text-3xl sm:text-4xl font-bold" style={typographyStyle(settings.typography)}>
        {heading}
      </h1>
    ),
    subheading: subheading && (
      <p key="subheading" className="mt-3 text-lg opacity-80">
        {subheading}
      </p>
    ),
    cta: ctaLabel && (
      <a
        key="cta"
        href="#shop"
        className="mt-6 inline-block px-6 py-3 text-sm font-medium text-accent-foreground bg-accent"
        style={{ borderRadius: "var(--theme-radius, 8px)" }}
      >
        {ctaLabel}
      </a>
    ),
  };

  // Order elements by their assigned zone (top/middle/bottom, per Phase 6's
  // ElementDragZone) rather than the fixed heading/subheading/CTA order —
  // an untouched theme's elements array is empty, so DEFAULT_ELEMENTS
  // reproduces that original order exactly.
  const activeElements = elements && elements.length > 0 ? elements : DEFAULT_ELEMENTS;
  const orderedTypes = [...activeElements]
    .sort((a, b) => ZONE_ORDER.indexOf(a.position.zone) - ZONE_ORDER.indexOf(b.position.zone))
    .map((el) => el.type);

  return (
    <div className={`flex ${height} ${position} px-6 py-12`}>
      <div className="max-w-2xl">{orderedTypes.map((type) => nodes[type] ?? null)}</div>
    </div>
  );
}
