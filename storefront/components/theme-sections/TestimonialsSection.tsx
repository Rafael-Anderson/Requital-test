import type { SectionSettings } from "@/lib/theme-config-types";

// No real testimonial-content data model exists in this codebase (no CRUD,
// no storage) — the admin's TestimonialsSettings only exposes a heading
// today, so this renders that heading plus an honest empty-state rather
// than fabricating customer quotes. A real content mechanism (quotes,
// author, rating) would be a separate, larger addition to both the admin
// settings panel and this component, out of this plan's scope.
export default function TestimonialsSection({ settings }: { settings: SectionSettings }) {
  const heading = typeof settings.heading === "string" ? settings.heading : "";

  return (
    <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto text-center">
      {heading && <h2 className="text-xl font-semibold mb-2">{heading}</h2>}
      <p className="text-sm text-zinc-500">Customer testimonials coming soon.</p>
    </div>
  );
}
