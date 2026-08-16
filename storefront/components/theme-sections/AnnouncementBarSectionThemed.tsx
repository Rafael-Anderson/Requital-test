"use client";

import { useShop } from "@/lib/shop-context";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle } from "@/lib/theme-element-style";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

// Separate from the legacy, persistent components/AnnouncementBar.tsx (which
// stays global chrome on every page, governed by shop.announcementBarEnabled
// — untouched by the new builder per the plan's scope decision). This is a
// homepage-body section rendered wherever it's ordered among the other
// sections, matching every other section type's per-instance settings shape
// (not a chrome slot). Repeatable "announcement" blocks (matching Dawn's
// real max_blocks: 12) join into one line — merchants add several rotating
// messages the same way they'd add several in Shopify, this storefront just
// concatenates rather than auto-rotating between them. Since they render as
// ONE joined text node, selection is tied to the FIRST visible block only
// (editing its style visually affects the whole joined line anyway, since
// nothing here differentiates styling per block today).
export default function AnnouncementBarSectionThemed({ sectionId, settings, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { previewMode } = useShop();
  const visible = [...blocks].filter((b) => b.visible && b.type === "announcement").sort((a, b) => a.order - b.order);
  const texts = visible.map((b) => (typeof b.settings.text === "string" ? b.settings.text : "")).filter(Boolean);

  if (texts.length === 0) return null;
  const text = texts.join("   •   ");
  const firstBlock = visible[0];
  const tagProps = firstBlock ? editableAttrs(previewMode, { id: firstBlock.id, sectionId, type: "announcement_text" }) : {};
  const textStyle = firstBlock ? resolveTextElementStyle(firstBlock.settings) : undefined;

  if (settings.scrolling) {
    return (
      <div className="overflow-hidden whitespace-nowrap bg-accent text-accent-foreground text-xs py-1.5">
        <div className="inline-block marquee-track">
          <span className="px-4" {...tagProps} style={textStyle}>
            {text}
          </span>
          <span className="px-4" aria-hidden="true" style={textStyle}>
            {text}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-accent text-accent-foreground text-xs text-center py-1.5 px-4" {...tagProps} style={textStyle}>
      {text}
    </div>
  );
}
