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
// than fabricating customer quotes.
export default function TestimonialsSection({ blocks }: { settings: SectionSettings; blocks: ThemeBlock[] }) {
  const testimonials = [...blocks]
    .filter((b) => b.visible && b.type === "testimonial")
    .sort((a, b) => a.order - b.order)
    .map((b) => b.settings as TestimonialBlockSettings)
    .filter((t) => t.quote);

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
        {testimonials.map((t, i) => (
          <div key={i} className="p-4 border border-stroke rounded-lg">
            <p className="text-sm leading-relaxed">&ldquo;{t.quote}&rdquo;</p>
            {t.author && <p className="mt-3 text-xs font-medium opacity-70">{t.author}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
