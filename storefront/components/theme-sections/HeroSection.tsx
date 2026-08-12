import type { CSSProperties } from "react";
import type { SectionSettings } from "@/lib/theme-config-types";

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

export default function HeroSection({ settings }: { settings: SectionSettings }) {
  const heading = typeof settings.heading === "string" ? settings.heading : "";
  const subheading = typeof settings.subheading === "string" ? settings.subheading : "";
  const ctaLabel = typeof settings.ctaLabel === "string" ? settings.ctaLabel : "";
  const height = HEIGHT_CLASS[settings.height as string] ?? HEIGHT_CLASS.medium;
  const position = POSITION_CLASS[settings.contentPosition as string] ?? POSITION_CLASS["center-center"];

  return (
    <div className={`flex ${height} ${position} px-6 py-12`}>
      <div className="max-w-2xl">
        {heading && (
          <h1 className="text-3xl sm:text-4xl font-bold" style={typographyStyle(settings.typography)}>
            {heading}
          </h1>
        )}
        {subheading && <p className="mt-3 text-lg opacity-80">{subheading}</p>}
        {ctaLabel && (
          <a
            href="#shop"
            className="mt-6 inline-block px-6 py-3 text-sm font-medium text-accent-foreground bg-accent"
            style={{ borderRadius: "var(--theme-radius, 8px)" }}
          >
            {ctaLabel}
          </a>
        )}
      </div>
    </div>
  );
}
