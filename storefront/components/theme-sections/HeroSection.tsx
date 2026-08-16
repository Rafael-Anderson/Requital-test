"use client";

import type { CSSProperties, ReactNode } from "react";
import { useShop } from "@/lib/shop-context";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle, resolveButtonElementStyle, resolveButtonFillStyle, themeButtonBaseStyle, themeTextPresetStyle } from "@/lib/theme-element-style";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

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

export default function HeroSection({ sectionId, settings, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { previewMode, shop } = useShop();
  const height = HEIGHT_CLASS[settings.height as string] ?? HEIGHT_CLASS.medium;
  const position = POSITION_CLASS[settings.contentPosition as string] ?? POSITION_CLASS["center-center"];

  const visible = [...blocks].filter((b) => b.visible).sort((a, b) => a.order - b.order);

  function renderBlock(block: ThemeBlock): ReactNode {
    switch (block.type) {
      case "heading": {
        const text = typeof block.settings.text === "string" ? block.settings.text : "";
        if (!text) return null;
        return (
          <h1
            key={block.id}
            {...editableAttrs(previewMode, { id: block.id, sectionId, type: "heading", reorderable: true })}
            className="text-3xl sm:text-4xl font-bold"
            style={{ ...themeTextPresetStyle("h1"), ...typographyStyle(settings.typography), ...resolveTextElementStyle(block.settings) }}
          >
            {text}
          </h1>
        );
      }
      case "subheading": {
        const text = typeof block.settings.text === "string" ? block.settings.text : "";
        if (!text) return null;
        return (
          <p
            key={block.id}
            {...editableAttrs(previewMode, { id: block.id, sectionId, type: "subheading", reorderable: true })}
            className="mt-3 text-lg opacity-80"
            style={{ ...themeTextPresetStyle("paragraph"), ...resolveTextElementStyle(block.settings) }}
          >
            {text}
          </p>
        );
      }
      case "cta": {
        const label = typeof block.settings.label === "string" ? block.settings.label : "";
        if (!label) return null;
        return (
          <a
            key={block.id}
            {...editableAttrs(previewMode, { id: block.id, sectionId, type: "cta_button", reorderable: true })}
            href="#shop"
            className="mt-6 inline-block px-6 py-3 text-sm font-medium text-accent-foreground bg-accent"
            style={{ ...themeButtonBaseStyle(), ...resolveButtonFillStyle(shop?.buttonFill), ...resolveButtonElementStyle(block.settings) }}
          >
            {label}
          </a>
        );
      }
      default:
        return null;
    }
  }

  return (
    <div className={`flex ${height} ${position} px-6 py-12`}>
      <div className="max-w-2xl">{visible.map(renderBlock)}</div>
    </div>
  );
}
