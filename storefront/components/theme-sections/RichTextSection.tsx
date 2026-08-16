"use client";

import type { CSSProperties } from "react";
import { useShop } from "@/lib/shop-context";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle, themeTextPresetStyle } from "@/lib/theme-element-style";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

function typographyStyle(typography: SectionSettings["typography"]): CSSProperties {
  if (!typography) return {};
  return {
    fontFamily: typeof typography.fontFamily === "string" ? typography.fontFamily : undefined,
    fontSize: typeof typography.fontSize === "number" ? `${typography.fontSize}px` : undefined,
    fontWeight: typeof typography.fontWeight === "string" ? typography.fontWeight : undefined,
    color: typeof typography.color === "string" ? typography.color : undefined,
    letterSpacing: typeof typography.letterSpacing === "number" ? `${typography.letterSpacing}px` : undefined,
  };
}

// Plain text, not HTML — the admin RichTextSettings editor is a plain
// <Textarea>, not RichTextEditor.tsx, so there's no markup to sanitize/
// render here (see that file's own comment on the choice). Text lives on
// the section's one "text" block (see backend constants.ts's
// BLOCK_TYPES.rich_text), not a flat section.settings.text field.
export default function RichTextSection({ sectionId, settings, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { previewMode } = useShop();
  const textBlock = blocks.find((b) => b.type === "text" && b.visible);
  const text = typeof textBlock?.settings.text === "string" ? textBlock.settings.text : "";
  if (!text) return null;

  return (
    <div className="px-4 sm:px-6 py-8 max-w-3xl mx-auto">
      <p
        className="whitespace-pre-line leading-relaxed"
        {...(textBlock ? editableAttrs(previewMode, { id: textBlock.id, sectionId, type: "body_text" }) : {})}
        style={{ ...themeTextPresetStyle("paragraph"), ...typographyStyle(settings.typography), ...(textBlock ? resolveTextElementStyle(textBlock.settings) : {}) }}
      >
        {text}
      </p>
    </div>
  );
}
