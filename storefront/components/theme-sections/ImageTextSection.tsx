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

  return (
    <div className="px-4 sm:px-6 py-8 mx-auto" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
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
