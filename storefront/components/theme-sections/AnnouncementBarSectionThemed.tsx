"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useShop } from "@/lib/shop-context";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle } from "@/lib/theme-element-style";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

const ROTATION_INTERVAL_MS: Record<string, number> = { fast: 2000, medium: 4000, slow: 6000 };
const FADE_MS = 400;

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

  const [reducedMotion, setReducedMotion] = useState(false);
  const [index, setIndex] = useState(0);
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mql.matches);
    const onChange = () => setReducedMotion(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const rotating = !settings.scrolling && !reducedMotion && texts.length > 1;

  useEffect(() => {
    if (!rotating) {
      setIndex(0);
      setFaded(false);
      return;
    }
    const speed = typeof settings.speed === "string" ? settings.speed : "medium";
    const intervalMs = ROTATION_INTERVAL_MS[speed] ?? ROTATION_INTERVAL_MS.medium;
    let fadeTimer: ReturnType<typeof setTimeout>;
    const tickTimer = setInterval(() => {
      setFaded(true);
      fadeTimer = setTimeout(() => {
        setIndex((i) => (i + 1) % texts.length);
        setFaded(false);
      }, FADE_MS);
    }, intervalMs);
    return () => {
      clearInterval(tickTimer);
      clearTimeout(fadeTimer);
    };
    // texts.length (not texts itself) is the real dependency here — editing
    // a block's own text doesn't need to restart the rotation timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotating, settings.speed, texts.length]);

  if (texts.length === 0) return null;

  const displayText = rotating ? texts[index % texts.length] : texts.join("   •   ");
  const firstBlock = visible[0];
  const tagProps = firstBlock ? editableAttrs(previewMode, { id: firstBlock.id, sectionId, type: "announcement_text" }) : {};
  const textStyle = { ...typographyStyle(settings.typography), ...(firstBlock ? resolveTextElementStyle(firstBlock.settings) : {}) };
  const fadeStyle = rotating ? { transition: "opacity 0.4s", opacity: faded ? 0 : 1 } : undefined;

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
