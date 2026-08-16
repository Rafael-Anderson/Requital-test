"use client";

import { useShop } from "@/lib/shop-context";
import { parseNotificationMessages } from "@/lib/notification-text";

// Slim bar above the header. Color is bg-accent/text-accent-foreground —
// the same theme-derived, WCAG-guarded pairing every other themed element
// on this storefront resolves to (see shop-context.tsx's
// resolveThemeCssVars/getReadableTextColor) — not a new color-mix tint or a
// standalone color field, since this pairing already IS "derived from
// existing Theme colors" and additionally guarantees readable contrast,
// which a low-opacity tint wouldn't for every possible accent color.
//
// Off by default even with saved messages — announcementBarEnabled is a
// real toggle, not just "array is non-empty" (see the schema field's own
// comment) — a merchant can hide the bar without losing their saved text.
export default function AnnouncementBar() {
  const { shop } = useShop();
  const messages = parseNotificationMessages(shop?.notificationText);
  if (!shop?.announcementBarEnabled || messages.length === 0) return null;

  const text = messages.join("   •   ");

  if (shop.announcementBarScrolling) {
    return (
      <div className="overflow-hidden whitespace-nowrap bg-accent text-accent-foreground text-xs py-1.5">
        {/* Track renders the text twice back-to-back and translates by
            exactly -50% — a seamless loop with no visible jump, pure CSS
            (see globals.css's .animate-marquee), no JS-driven interval. */}
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
