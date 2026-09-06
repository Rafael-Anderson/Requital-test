"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { resolveImageUrl } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { useScrollValue } from "@/lib/use-scroll-value";
import { useMinWidth } from "@/lib/use-min-width";
import {
  resolveTextElementStyle,
  resolveButtonElementStyle,
  resolveButtonFillStyle,
  resolveButtonHoverClass,
  themeButtonBaseStyle,
  themeTextPresetStyle,
} from "@/lib/theme-element-style";
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

// Phase A — the crossfade duration + easing now come from the motion tokens
// (the `var(…, <literal>)` fallbacks — 600ms, `ease` — are today's values).
const SLIDE_TRANSITION = "var(--motion-duration-slow, 600ms) var(--motion-ease, ease)";

// The non-active resting state per transition mode — the active slide always
// sits at { opacity: 1, transform: none }, so switching which slide is active
// animates the incoming one in from here (and the outgoing one back to it).
// The translate distance defers to --motion-entrance-distance (24px fallback).
const SLIDE_RESTING: Record<Exclude<ScrollAnimation, "none">, CSSProperties> = {
  "fade-in": { opacity: 0 },
  "slide-up": { opacity: 0, transform: "translateY(var(--motion-entrance-distance, 24px))" },
  "slide-left": { opacity: 0, transform: "translateX(var(--motion-entrance-distance, 24px))" },
  "slide-right": { opacity: 0, transform: "translateX(calc(-1 * var(--motion-entrance-distance, 24px)))" },
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
  kenBurns = false,
  indicatorStyle,
  parallax = false,
}: {
  images: HeroImage[];
  durationMs: number;
  transition: ScrollAnimation;
  showIndicators?: boolean;
  // §8.13.C item 10 — slow zoom on the active slide. §8.13.C item 11 —
  // 'progress' swaps the dot row for a bar that fills over slideDuration.
  // §8.13.C item 15 — parallax: the whole backdrop layer lags the page on
  // scroll (translateY via useScrollValue, NOT background-attachment: fixed).
  // Mutually exclusive with kenBurns (§3.7 — one continuous transform per
  // hero); parallax wins if both are set. All absent ⇒ today's render.
  kenBurns?: boolean;
  indicatorStyle?: string;
  parallax?: boolean;
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
  // §8.13.C item 15 — parallax wins over kenBurns when both are set.
  const wideEnough = useMinWidth(640);
  const parallaxOn = parallax && !reducedMotion && count > 0 && wideEnough;
  const kenBurnsOn = kenBurns && !parallaxOn && !reducedMotion && count > 0;
  const showDots = count > 1 && showIndicators && (!indicatorStyle || indicatorStyle === "dots");
  const showProgress = count > 1 && indicatorStyle === "progress" && !reducedMotion;

  const { y: scrollY } = useScrollValue();
  // The backdrop lags: as the page scrolls up by scrollY, the layer
  // translates down (factor < 1), clamped so it never drifts past the
  // scale(1.15) bleed room. Only computed when parallaxOn.
  const parallaxStyle: CSSProperties = parallaxOn
    ? { transform: `translateY(${Math.min(scrollY * 0.15, 40)}px) scale(1.15)`, willChange: "transform" }
    : {};

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={parallaxStyle}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {images.map((img, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${img.url}-${i}`}
          src={resolveImageUrl(img.url) ?? undefined}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover${kenBurnsOn && i === active ? " theme-ken-burns" : ""}`}
          style={{
            transition: transition === "none" ? undefined : `opacity ${SLIDE_TRANSITION}, transform ${SLIDE_TRANSITION}`,
            ...(i === active ? { opacity: 1, transform: "none" } : resting),
            // The Ken Burns keyframe runs over the full slide duration; while
            // it animates it overrides the inline transform above.
            ...(kenBurnsOn && i === active ? { animationDuration: `${durationMs}ms` } : {}),
          }}
        />
      ))}
      {activeLink && <a href={activeLink} className="absolute inset-0" aria-label="Hero banner" />}
      {/* Phase 4 — dot pagination (over the photo, so white/translucent is
          the universal convention, not a themeable surface). Sits above the
          hero link so a dot click never triggers the banner link. */}
      {showDots && (
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
      {/* §8.13.C item 11 — progress-bar indicator. The inner fill is keyed on
          the active slide so it remounts and the scaleX keyframe restarts each
          slide; pauses with the slideshow on hover. */}
      {showProgress && (
        <div className="absolute inset-x-0 bottom-0 z-20 h-0.5 bg-white/30">
          <div
            key={active}
            className="theme-hero-progress h-full bg-white"
            style={{ animationDuration: `${durationMs}ms`, animationPlayState: paused ? "paused" : "running" }}
          />
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
  const { previewMode, shop, themeConfig } = useShop();
  const primaryButton = themeConfig?.globalSettings.buttons.primary;
  const buttonHover = resolveButtonHoverClass(primaryButton?.hoverEffect, primaryButton?.pressEffect);
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
  // §8.13.C items 10/11 — both absent ⇒ HeroSlideshow renders exactly as before.
  const kenBurns = settings.kenBurns === true;
  const indicatorStyle = typeof settings.indicatorStyle === "string" ? settings.indicatorStyle : undefined;
  // §8.13.C item 15 — hero.settings.parallax. Absent ⇒ no scroll transform.
  const parallax = settings.parallax === true;

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
            className={`mt-6 inline-block px-6 py-3 text-sm font-medium text-accent-foreground bg-accent ${buttonHover.className}`}
            style={{ ...themeButtonBaseStyle(), ...resolveButtonFillStyle(shop?.buttonFill), ...resolveButtonElementStyle(block.settings) }}
          >
            {label}
            {buttonHover.showIcon && <ArrowRight className="theme-btn-icon inline-block ml-1.5 size-4 align-[-3px]" aria-hidden="true" />}
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
      // §8.7 item 2 — a DOM marker, not a threaded ref: ThemeDrivenHeader is
      // global chrome mounted independently of this section (only ever
      // present together on the homepage route), so 'reveal-on-hero'
      // measures this element's real rendered height via
      // getBoundingClientRect() instead of a cross-tree ref.
      data-theme-hero="true"
      className={`relative flex ${height} ${position} overflow-hidden px-6 py-12`}
      style={inset && cornerRadius ? { borderRadius: `${cornerRadius}px` } : undefined}
    >
      {bannerImages.length > 0 && (
        <HeroSlideshow
          images={bannerImages}
          durationMs={slideDurationS * 1000}
          transition={slideTransition}
          showIndicators={showSlideIndicators}
          kenBurns={kenBurns}
          indicatorStyle={indicatorStyle}
          parallax={parallax}
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
