"use client";

import type { CSSProperties, ReactNode } from "react";
import { useShop } from "@/lib/shop-context";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle, themeTextPresetStyle } from "@/lib/theme-element-style";
import { sanitizeDescriptionHtml } from "@/lib/sanitize-html";
import ThemeImageBlock from "./ThemeImageBlock";
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

// HTML, not plain text — the admin editor for this block (RichTextBlockEditor.tsx,
// a contenteditable field, not a plain <Textarea>) stores/produces the
// selection's innerHTML so a merchant can bold/italicize/underline a run of
// text (see that file's own comment). Sanitized with the same
// sanitizeDescriptionHtml() used for product descriptions/policy pages
// (lib/sanitize-html.ts) — same threat model (admin-authored HTML rendered
// on a public storefront page), and its allowed-tag list already covers
// b/strong/i/em/u, the only tags execCommand('bold'/'italic'/'underline')
// produces here. Text lives on the section's own "text" block (see backend
// constants.ts's BLOCK_TYPES.rich_text), not a flat section.settings.text
// field. 'image' blocks (storefront-v2 Phase 4B) render in the same
// document order alongside it — this used to only ever look for the single
// text block; now it walks every visible block like HeroSection does.
// contentWidth (Atelier sets "narrow" for its manifesto strip; free-form
// SectionSettings key). "narrow" is a centred, tighter column — an opening
// statement, not a paragraph block. Absent ⇒ today's exact max-w-3xl,
// left-aligned (byte-identical for every existing rich_text section).
const CONTENT_WIDTH: Record<string, { maxW: string; center: boolean }> = {
  narrow: { maxW: "max-w-2xl", center: true },
  medium: { maxW: "max-w-3xl", center: false },
  wide: { maxW: "max-w-5xl", center: false },
};

export default function RichTextSection({ sectionId, settings, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { previewMode } = useShop();
  const visible = [...blocks].filter((b) => b.visible).sort((a, b) => a.order - b.order);
  const hasContent = visible.some(
    (b) => (b.type === "text" && typeof b.settings.text === "string" && b.settings.text) || b.type === "image",
  );
  if (!hasContent) return null;

  const width = CONTENT_WIDTH[settings.contentWidth as string] ?? CONTENT_WIDTH.medium;
  // Inside a scheme-tinted band the wrapper (SectionWrapper) supplies the
  // generous --section-band-py; the section drops its own theme-section-py so
  // the two don't stack. Not banded ⇒ theme-section-py exactly as before.
  const vPad = settings.schemeId ? "" : "theme-section-py";

  function renderBlock(block: ThemeBlock): ReactNode {
    if (block.type === "text") {
      const html = typeof block.settings.text === "string" ? block.settings.text : "";
      if (!html) return null;
      return (
        <div
          key={block.id}
          // #15 — the editor is now a full WYSIWYG (headings, lists,
          // alignment, inline colour/size/font); Tailwind preflight resets
          // list markers + heading sizes, so restore them here.
          className={`whitespace-pre-line leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold${width.center ? " text-center" : ""}`}
          {...editableAttrs(previewMode, { id: block.id, sectionId, type: "body_text" })}
          style={{ ...themeTextPresetStyle("paragraph"), ...typographyStyle(settings.typography), ...resolveTextElementStyle(block.settings) }}
          dangerouslySetInnerHTML={{ __html: sanitizeDescriptionHtml(html) }}
        />
      );
    }
    if (block.type === "image") {
      return <ThemeImageBlock key={block.id} block={block} sectionId={sectionId} previewMode={previewMode} />;
    }
    return null;
  }

  return (
    <div className={`theme-gutter-x ${vPad} ${width.maxW} mx-auto space-y-4`}>{visible.map(renderBlock)}</div>
  );
}
