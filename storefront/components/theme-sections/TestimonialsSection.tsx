"use client";

import type { CSSProperties } from "react";
import { useShop } from "@/lib/shop-context";
import { resolveImageUrl } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { sanitizeDescriptionHtml } from "@/lib/sanitize-html";
import { resolveTextElementStyle, themeTextPresetStyle } from "@/lib/theme-element-style";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

interface TestimonialBlockSettings {
  quote?: string;
  author?: string;
  photoUrl?: string;
  rating?: number;
}

function StarRating({ rating }: { rating: number }) {
  const filled = Math.max(1, Math.min(5, Math.round(rating)));
  return (
    <div className="mb-2 text-amber-500" aria-label={`${filled} out of 5 stars`}>
      {"★".repeat(filled)}
      <span className="text-zinc-300">{"★".repeat(5 - filled)}</span>
    </div>
  );
}

// No dedicated testimonial data model exists in this codebase (no CRUD, no
// storage) — but a testimonial is now a real, admin-addable block (settings
// is free-form JSON, shallow-validated like every other block), so a
// merchant who adds testimonial blocks in the builder gets real rendered
// quotes here. Zero blocks still falls back to an honest empty state rather
// than fabricating customer quotes. The section's own optional "heading"
// block (backend constants.ts's BLOCK_TYPES.testimonials) mirrors Featured
// Collections' collection_header pattern.
export default function TestimonialsSection({ sectionId, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { previewMode } = useShop();
  const headingBlock = blocks.find((b) => b.type === "heading" && b.visible);
  const heading = typeof headingBlock?.settings.text === "string" ? headingBlock.settings.text : "";
  const testimonials = [...blocks]
    .filter((b) => b.visible && b.type === "testimonial")
    .sort((a, b) => a.order - b.order)
    .map((b) => ({ id: b.id, settings: b.settings as TestimonialBlockSettings }))
    .filter((t) => t.settings.quote);

  if (testimonials.length === 0) {
    return (
      <div className="theme-gutter-x theme-section-py mx-auto text-center" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
        <p className="text-sm text-zinc-500">Customer testimonials coming soon.</p>
      </div>
    );
  }

  return (
    <div className="theme-gutter-x theme-section-py mx-auto" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
      {heading && headingBlock && (
        <h2
          className="text-xl font-semibold theme-heading-gap text-center"
          {...editableAttrs(previewMode, { id: headingBlock.id, sectionId, type: "heading", reorderable: true })}
          style={{ ...themeTextPresetStyle("h2"), ...resolveTextElementStyle(headingBlock.settings) }}
          dangerouslySetInnerHTML={{ __html: sanitizeDescriptionHtml(heading) }}
        />
      )}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {testimonials.map((t, i) => {
          const photoUrl = resolveImageUrl(t.settings.photoUrl);
          return (
            <div key={t.id} className="p-4 border border-stroke theme-round-md theme-stagger-child" style={{ "--i": i } as CSSProperties}>
              {typeof t.settings.rating === "number" && <StarRating rating={t.settings.rating} />}
              {/* Quote is a full rich-text field (T1). The decorative
                  curly quotes stay as CSS pseudo-elements so a legacy
                  plain-text quote still renders exactly as "…"; `[&_p]:inline`
                  keeps the editor's paragraph wrapper hugging them. */}
              <div
                className="text-sm leading-relaxed [&_p]:m-0 [&_p]:inline before:content-['“'] after:content-['”']"
                {...editableAttrs(previewMode, { id: t.id, sectionId, type: "testimonial_text" })}
                style={{ ...themeTextPresetStyle("paragraph"), ...resolveTextElementStyle(t.settings as Record<string, unknown>) }}
                dangerouslySetInnerHTML={{ __html: sanitizeDescriptionHtml((t.settings.quote as string) ?? "") }}
              />
              {t.settings.author && (
                // Quote/author/photo/rating all share the same block/
                // settings — there's no separate style field for the author
                // line, so selecting any of them edits (and visually
                // affects) the whole block together. A real, documented
                // constraint of the current schema, not a bug.
                <div className="mt-3 flex items-center gap-2">
                  {photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                  )}
                  <p
                    className="text-xs font-medium opacity-70"
                    {...editableAttrs(previewMode, { id: t.id, sectionId, type: "author_name" })}
                  >
                    {t.settings.author}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
