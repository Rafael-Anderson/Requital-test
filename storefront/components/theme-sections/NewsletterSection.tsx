"use client";

import { useShop } from "@/lib/shop-context";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle, resolveButtonElementStyle, resolveButtonFillStyle, themeButtonBaseStyle } from "@/lib/theme-element-style";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

// Presentational only — no newsletter/email-capture backend endpoint exists
// anywhere in this codebase, and none was scoped for this plan (the spec
// names "Newsletter signup" as a section type, not a capture feature). The
// form renders but intentionally does nothing on submit rather than either
// crashing or faking a success message; wiring a real capture endpoint is a
// separate, out-of-scope addition. heading/text/button copy now come from
// this section's own blocks (see backend constants.ts's
// BLOCK_TYPES.newsletter), not flat section.settings fields.
export default function NewsletterSection({ sectionId, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { previewMode, shop } = useShop();
  const headingBlock = blocks.find((b) => b.type === "heading" && b.visible);
  const textBlock = blocks.find((b) => b.type === "text" && b.visible);
  const formBlock = blocks.find((b) => b.type === "email_form" && b.visible);
  const heading = typeof headingBlock?.settings.text === "string" ? headingBlock.settings.text : "";
  const subtext = typeof textBlock?.settings.text === "string" ? textBlock.settings.text : "";
  const buttonLabel =
    typeof formBlock?.settings.buttonLabel === "string" && formBlock.settings.buttonLabel ? formBlock.settings.buttonLabel : "Subscribe";

  if (!formBlock) return null;

  return (
    <div className="px-4 sm:px-6 py-10 max-w-xl mx-auto text-center">
      {heading && headingBlock && (
        <h2
          {...editableAttrs(previewMode, { id: headingBlock.id, sectionId, type: "heading", reorderable: true })}
          className="text-xl font-semibold mb-2"
          style={resolveTextElementStyle(headingBlock.settings)}
        >
          {heading}
        </h2>
      )}
      {subtext && textBlock && (
        <p
          {...editableAttrs(previewMode, { id: textBlock.id, sectionId, type: "subtext", reorderable: true })}
          className="text-sm opacity-70 mb-5"
          style={resolveTextElementStyle(textBlock.settings)}
        >
          {subtext}
        </p>
      )}
      <form onSubmit={(e) => e.preventDefault()} className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          placeholder="you@example.com"
          className="flex-1 h-10 px-3 text-sm border border-stroke bg-transparent"
          style={{ borderRadius: "var(--theme-radius, 8px)" }}
        />
        <button
          type="submit"
          {...editableAttrs(previewMode, { id: formBlock.id, sectionId, type: "cta_button", reorderable: true })}
          className="h-10 px-5 text-sm font-medium text-accent-foreground bg-accent"
          style={{ ...themeButtonBaseStyle(), ...resolveButtonFillStyle(shop?.buttonFill), ...resolveButtonElementStyle(formBlock.settings) }}
        >
          {buttonLabel}
        </button>
      </form>
    </div>
  );
}
