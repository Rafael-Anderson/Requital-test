"use client";

import { useShop } from "@/lib/shop-context";
import { resolveImageUrl } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle, resolveImageElementStyle, themeTextPresetStyle } from "@/lib/theme-element-style";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

// image/text content now each live on their own block (see backend
// constants.ts's BLOCK_TYPES.image_text) — imagePosition stays a
// section-level layout setting since it's about arrangement, not content.
export default function ImageTextSection({ sectionId, settings, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { previewMode } = useShop();
  const imageBlock = blocks.find((b) => b.type === "image" && b.visible);
  const textBlock = blocks.find((b) => b.type === "text" && b.visible);
  const imageUrl = resolveImageUrl((imageBlock?.settings.imageUrl as string) ?? null);
  const text = typeof textBlock?.settings.text === "string" ? textBlock.settings.text : "";
  const imageOnRight = settings.imagePosition === "right";

  if (!imageUrl && !text) return null;

  // Inside a scheme-tinted band the wrapper supplies --section-band-py; the
  // section drops its own theme-section-py so the two don't stack.
  const vPad = settings.schemeId ? "" : "theme-section-py";

  // A scheme-banded image_text with NO image is a statement strip (Bloom's
  // "Pick it. Personalise it.", Heritage's "A family business…"), not a
  // half-and-half layout — render it full-width, centred, at a readable size
  // instead of a squeezed left-half column. Only when banded: a non-banded
  // text-only image_text keeps today's exact rendering.
  if (settings.schemeId && !imageUrl && text && textBlock) {
    return (
      <div className={`theme-gutter-x ${vPad} max-w-3xl mx-auto text-center`}>
        <p
          {...editableAttrs(previewMode, { id: textBlock.id, sectionId, type: "body_text", reorderable: true })}
          className="whitespace-pre-line leading-relaxed"
          style={{ ...themeTextPresetStyle("paragraph"), ...resolveTextElementStyle(textBlock.settings) }}
        >
          {text}
        </p>
      </div>
    );
  }

  return (
    <div className={`theme-gutter-x ${vPad} mx-auto`} style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
      <div className={`flex flex-col sm:flex-row items-center gap-8 ${imageOnRight ? "sm:flex-row-reverse" : ""}`}>
        {imageUrl && imageBlock && (
          <div
            {...editableAttrs(previewMode, { id: imageBlock.id, sectionId, type: "section_image", reorderable: true })}
            className="w-full sm:w-1/2 aspect-video overflow-hidden bg-black/5"
            style={{ borderRadius: "var(--theme-radius, 8px)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" className="w-full h-full object-cover" style={resolveImageElementStyle(imageBlock.settings)} />
          </div>
        )}
        {text && textBlock && (
          <div className="w-full sm:w-1/2">
            <p
              {...editableAttrs(previewMode, { id: textBlock.id, sectionId, type: "body_text", reorderable: true })}
              className="whitespace-pre-line text-sm leading-relaxed opacity-80"
              style={{ ...themeTextPresetStyle("paragraph"), ...resolveTextElementStyle(textBlock.settings) }}
            >
              {text}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
