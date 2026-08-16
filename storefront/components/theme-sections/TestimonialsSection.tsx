"use client";

import { useShop } from "@/lib/shop-context";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle } from "@/lib/theme-element-style";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

interface TestimonialBlockSettings {
  quote?: string;
  author?: string;
}

// No dedicated testimonial data model exists in this codebase (no CRUD, no
// storage) — but a testimonial is now a real, admin-addable block (settings
// is free-form JSON, shallow-validated like every other block), so a
// merchant who adds testimonial blocks in the builder gets real rendered
// quotes here. Zero blocks still falls back to an honest empty state rather
// than fabricating customer quotes. No separate "heading" block exists for
// this section type (backend constants.ts's default is an empty block
// list) — nothing to tag as section_heading without inventing a new block
// type, which is out of scope here.
export default function TestimonialsSection({ sectionId, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { previewMode } = useShop();
  const testimonials = [...blocks]
    .filter((b) => b.visible && b.type === "testimonial")
    .sort((a, b) => a.order - b.order)
    .map((b) => ({ id: b.id, settings: b.settings as TestimonialBlockSettings }))
    .filter((t) => t.settings.quote);

  if (testimonials.length === 0) {
    return (
      <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto text-center">
        <p className="text-sm text-zinc-500">Customer testimonials coming soon.</p>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {testimonials.map((t) => (
          <div key={t.id} className="p-4 border border-stroke rounded-lg">
            <p
              className="text-sm leading-relaxed"
              {...editableAttrs(previewMode, { id: t.id, sectionId, type: "testimonial_text" })}
              style={resolveTextElementStyle(t.settings as Record<string, unknown>)}
            >
              &ldquo;{t.settings.quote}&rdquo;
            </p>
            {t.settings.author && (
              // Quote and author share the same block/settings — there's no
              // separate style field for the author line, so selecting
              // either one edits (and visually affects) both together. A
              // real, documented constraint of the current schema, not a
              // bug — adding a second style field is out of scope.
              <p
                className="mt-3 text-xs font-medium opacity-70"
                {...editableAttrs(previewMode, { id: t.id, sectionId, type: "author_name" })}
              >
                {t.settings.author}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
