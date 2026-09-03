"use client";

import { type CSSProperties } from "react";
import { useShop } from "@/lib/shop-context";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle } from "@/lib/theme-element-style";
import { useAnnouncementRotation } from "@/lib/announcement-rotation";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

// Same shape as RichTextSection.tsx's own local copy — this section-level
// override was previously set by the admin panel's TypographyControls but
// never read anywhere on the storefront (a real dead control, found during
// the theme builder usability audit's dead-control sweep).
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

// Separate from the legacy, persistent components/AnnouncementBar.tsx (which
// stays global chrome on every page, governed by shop.announcementBarEnabled
// — untouched by the new builder per the plan's scope decision). This is a
// homepage-body section rendered wherever it's ordered among the other
// sections, matching every other section type's per-instance settings shape
// (not a chrome slot). Repeatable "announcement" blocks (matching Dawn's
// real max_blocks: 12) rotate one at a time with a crossfade — unless
// "Scrolling" is on (a marquee of every message joined, unaffected by
// rotation) or the visitor has requested reduced motion, in which case every
// message is joined into one static line instead.
export default function AnnouncementBarSectionThemed({ sectionId, settings, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { previewMode } = useShop();
  const visible = [...blocks].filter((b) => b.visible && b.type === "announcement").sort((a, b) => a.order - b.order);
  const texts = visible.map((b) => (typeof b.settings.text === "string" ? b.settings.text : "")).filter(Boolean);

  // Shared crossfade rotator (also drives the persistent chrome bar) —
  // enabled = "not in marquee mode". The hook itself gates on
  // prefers-reduced-motion and message count.
  const speed = typeof settings.speed === "string" ? settings.speed : undefined;
  const { rotating, index, faded } = useAnnouncementRotation(texts, !settings.scrolling, speed);

  if (texts.length === 0) return null;

  const displayText = rotating ? texts[index % texts.length] : texts.join("   •   ");
  const firstBlock = visible[0];
  const tagProps = firstBlock ? editableAttrs(previewMode, { id: firstBlock.id, sectionId, type: "announcement_text" }) : {};
  const textStyle = { ...typographyStyle(settings.typography), ...(firstBlock ? resolveTextElementStyle(firstBlock.settings) : {}) };
  const fadeStyle = rotating ? { transition: "opacity var(--motion-duration-base, 0.4s)", opacity: faded ? 0 : 1 } : undefined;

  // A hardcoded bg-accent class here was previously always opaque, so a
  // custom settings.background (set via the admin panel's Background
  // control and genuinely applied to the outer SectionWrapper as an inline
  // style) could never actually show through — another dead-in-practice
  // control found during the audit's dead-control sweep. Only fall back to
  // bg-accent when no custom background is configured.
  const hasCustomBackground = !!(settings.background && typeof settings.background === "object" && settings.background.type);
  const bgClass = hasCustomBackground ? "" : "bg-accent";

  if (settings.scrolling) {
    return (
      <div className={`overflow-hidden whitespace-nowrap text-accent-foreground text-xs py-1.5 ${bgClass}`}>
        <div className="inline-block marquee-track">
          <span className="px-4" {...tagProps} style={textStyle}>
            {displayText}
          </span>
          <span className="px-4" aria-hidden="true" style={textStyle}>
            {displayText}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`text-accent-foreground text-xs text-center py-1.5 px-4 ${bgClass}`} {...tagProps} style={{ ...textStyle, ...fadeStyle }}>
      {displayText}
    </div>
  );
}
