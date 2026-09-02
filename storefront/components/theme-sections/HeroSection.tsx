"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useShop } from "@/lib/shop-context";
import { resolveImageUrl } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle, resolveButtonElementStyle, resolveButtonFillStyle, themeButtonBaseStyle, themeTextPresetStyle } from "@/lib/theme-element-style";
import ThemeImageBlock from "./ThemeImageBlock";
import type { ScrollAnimation, SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

const HEIGHT_CLASS: Record<string, string> = {
  small: "min-h-[240px]",
  medium: "min-h-[400px]",
  large: "min-h-[560px]",
  full: "min-h-screen",
};

const POSITION_CLASS: Record<string, string> = {
  "top-left": "items-start justify-start text-left",
  "top-center": "items-start justify-center text-center",
  "top-right": "items-start justify-end text-right",
  "center-left": "items-center justify-start text-left",
  "center-center": "items-center justify-center text-center",
  "center-right": "items-center justify-end text-right",
  "bottom-left": "items-end justify-start text-left",
  "bottom-center": "items-end justify-center text-center",
  "bottom-right": "items-end justify-end text-right",
};

const MIN_SLIDE_DURATION_S = 2;
const DEFAULT_SLIDE_DURATION_S = 5;
const SLIDE_TRANSITION_MS = 600;

// The non-active resting state per transition mode — the active slide always
// sits at { opacity: 1, transform: none }, so switching which slide is active
// animates the incoming one in from here (and the outgoing one back to it).
const SLIDE_RESTING: Record<Exclude<ScrollAnimation, "none">, CSSProperties> = {
  "fade-in": { opacity: 0 },
  "slide-up": { opacity: 0, transform: "translateY(24px)" },
  "slide-left": { opacity: 0, transform: "translateX(24px)" },
  "slide-right": { opacity: 0, transform: "translateX(-24px)" },
};

interface HeroImage {
  url: string;
  linkUrl?: string | null;
}

// Auto-rotating backdrop for the Hero section — the banner text + image list
// that used to live in the dead "Classic homepage banner" admin sub-panel.
// One image renders static (no timer, no controls); more than one rotates.
// Respects prefers-reduced-motion (first image only) and pauses on hover.
// The block content (heading/subheading/cta) layers above this via z-10.
function HeroSlideshow({
  images,
  durationMs,
  transition,
  showIndicators = false,
}: {
  images: HeroImage[];
  durationMs: number;
  transition: ScrollAnimation;
  showIndicators?: boolean;
}) {
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [paused, setPaused] = useState(false);
  const [index, setIndex] = useState(0);
  const count = images.length;

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const rotating = count > 1 && !reducedMotion && !paused;

  useEffect(() => {
    if (!rotating) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), durationMs);
    return () => clearInterval(timer);
    // count/durationMs are the real triggers; recreating the interval on
    // every `index` change would freeze auto-advance (same note as
    // SlideshowHero.tsx).
  }, [rotating, count, durationMs]);

  // Guard against the merchant removing images while index points past the end.
  const active = count > 0 ? index % count : 0;
  const activeLink = images[active]?.linkUrl || null;
  const resting = transition === "none" ? { opacity: 1 } : SLIDE_RESTING[transition];

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {images.map((img, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${img.url}-${i}`}
          src={resolveImageUrl(img.url) ?? undefined}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            transition: transition === "none" ? undefined : `opacity ${SLIDE_TRANSITION_MS}ms ease, transform ${SLIDE_TRANSITION_MS}ms ease`,
            ...(i === active ? { opacity: 1, transform: "none" } : resting),
          }}
        />
      ))}
      {activeLink && <a href={activeLink} className="absolute inset-0" aria-label="Hero banner" />}
      {/* Phase 4 — dot pagination (over the photo, so white/translucent is
          the universal convention, not a themeable surface). Sits above the
          hero link so a dot click never triggers the banner link. */}
      {showIndicators && count > 1 && (
        <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center gap-2">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === active}
              className={`h-2 rounded-full transition-all ${i === active ? "w-6 bg-white" : "w-2 bg-white/50 hover:bg-white/75"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Falls back to the global heading font (--theme-heading-font, see
// shop-context.tsx's Google Fonts loader) when this section has no explicit
// per-section typography override — matches how every other themed element
// on this storefront layers a section-specific choice over a global default.
function typographyStyle(typography: SectionSettings["typography"]): CSSProperties {
  const fontFamily =
    typography && typeof typography.fontFamily === "string"
      ? typography.fontFamily
      : "var(--theme-heading-font, inherit)";
  if (!typography) return { fontFamily };
  return {
    fontFamily,
    fontSize: typeof typography.fontSize === "number" ? `${typography.fontSize}px` : undefined,
    fontWeight: typeof typography.fontWeight === "string" ? typography.fontWeight : undefined,
    color: typeof typography.color === "string" ? typography.color : undefined,
    letterSpacing: typeof typography.letterSpacing === "number" ? `${typography.letterSpacing}px` : undefined,
  };
}

export default function HeroSection({ sectionId, settings, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { previewMode, shop } = useShop();
  const height = HEIGHT_CLASS[settings.height as string] ?? HEIGHT_CLASS.medium;
  const position = POSITION_CLASS[settings.contentPosition as string] ?? POSITION_CLASS["center-center"];

  const bannerImages: HeroImage[] = Array.isArray(settings.bannerImages)
    ? (settings.bannerImages as HeroImage[]).filter((img) => img && typeof img.url === "string" && img.url)
    : [];
  const slideDurationS =
    typeof settings.slideDuration === "number" && settings.slideDuration >= MIN_SLIDE_DURATION_S
      ? settings.slideDuration
      : DEFAULT_SLIDE_DURATION_S;
  const slideTransition = (settings.slideTransition as ScrollAnimation) ?? "fade-in";
  const heroText = typeof settings.heroText === "string" ? settings.heroText.trim() : "";
  // Phase 4 — inset (margined + rounded) vs the default full-bleed hero, and
  // slideshow dot indicators. Both keys absent ⇒ renders exactly as before.
  const inset = settings.heroLayout === "inset";
  const cornerRadius = typeof settings.cornerRadius === "number" ? settings.cornerRadius : 0;
  const showSlideIndicators = settings.showSlideIndicators === true;

  const visible = [...blocks].filter((b) => b.visible).sort((a, b) => a.order - b.order);

  function renderBlock(block: ThemeBlock): ReactNode {
    switch (block.type) {
      case "heading": {
        const text = typeof block.settings.text === "string" ? block.settings.text : "";
        if (!text) return null;
        return (
          <h1
            key={block.id}
            {...editableAttrs(previewMode, { id: block.id, sectionId, type: "heading", reorderable: true })}
            className="text-3xl sm:text-4xl font-bold"
            style={{ ...themeTextPresetStyle("h1"), ...typographyStyle(settings.typography), ...resolveTextElementStyle(block.settings) }}
          >
            {text}
          </h1>
        );
      }
      case "subheading": {
        const text = typeof block.settings.text === "string" ? block.settings.text : "";
        if (!text) return null;
        return (
          <p
            key={block.id}
            {...editableAttrs(previewMode, { id: block.id, sectionId, type: "subheading", reorderable: true })}
            className="mt-3 text-lg opacity-80"
            style={{ ...themeTextPresetStyle("paragraph"), ...resolveTextElementStyle(block.settings) }}
          >
            {text}
          </p>
        );
      }
      case "cta": {
        const label = typeof block.settings.label === "string" ? block.settings.label : "";
        if (!label) return null;
        return (
          <a
            key={block.id}
            {...editableAttrs(previewMode, { id: block.id, sectionId, type: "cta_button", reorderable: true })}
            href="#shop"
            className="mt-6 inline-block px-6 py-3 text-sm font-medium text-accent-foreground bg-accent"
            style={{ ...themeButtonBaseStyle(), ...resolveButtonFillStyle(shop?.buttonFill), ...resolveButtonElementStyle(block.settings) }}
          >
            {label}
          </a>
        );
      }
      case "image":
        return <ThemeImageBlock key={block.id} block={block} sectionId={sectionId} previewMode={previewMode} />;
      default:
        return null;
    }
  }

  const heroInner = (
    <div
      className={`relative flex ${height} ${position} overflow-hidden px-6 py-12`}
      style={inset && cornerRadius ? { borderRadius: `${cornerRadius}px` } : undefined}
    >
      {bannerImages.length > 0 && (
        <HeroSlideshow
          images={bannerImages}
          durationMs={slideDurationS * 1000}
          transition={slideTransition}
          showIndicators={showSlideIndicators}
        />
      )}
      <div className="relative z-10 max-w-2xl">{visible.map(renderBlock)}</div>
    </div>
  );

  return (
    <>
      {inset ? (
        <div className="mx-auto px-4 sm:px-6 py-4" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
          {heroInner}
        </div>
      ) : (
        heroInner
      )}
      {heroText && <p className="bg-homepage-info px-4 py-3 text-center text-sm text-zinc-600">{heroText}</p>}
    </>
  );
}
