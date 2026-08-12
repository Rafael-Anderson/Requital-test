import type { SectionSettings } from "@/lib/theme-config-types";

// Separate from the legacy, persistent components/AnnouncementBar.tsx (which
// stays global chrome on every page, governed by shop.announcementBarEnabled
// — untouched by the new builder per the plan's scope decision). This is a
// homepage-body section rendered wherever it's ordered among the other
// sections, matching every other section type's per-instance settings shape
// (not a chrome slot).
export default function AnnouncementBarSectionThemed({ settings }: { settings: SectionSettings }) {
  const text = typeof settings.text === "string" ? settings.text : "";
  if (!text) return null;

  if (settings.scrolling) {
    return (
      <div className="overflow-hidden whitespace-nowrap bg-accent text-accent-foreground text-xs py-1.5">
        <div className="inline-block marquee-track">
          <span className="px-4">{text}</span>
          <span className="px-4" aria-hidden="true">
            {text}
          </span>
        </div>
      </div>
    );
  }

  return <div className="bg-accent text-accent-foreground text-xs text-center py-1.5 px-4">{text}</div>;
}
