"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { resolveImageUrl } from "@/lib/api";
import type { Product } from "@/lib/types";

const AUTO_ADVANCE_MS = 4000;
const MAX_PRODUCT_SLIDES = 4;

export interface Slide {
  image: string;
  label: string | null;
  linkUrl: string | null;
}

export interface BannerImageInput {
  url: string;
  linkUrl: string | null;
}

// Pure (no DOM/hooks) so slide composition is directly testable — real
// uploaded banners (BannerImage, managed in admin's Site Settings) come
// first; the shop's first few products are only a fallback for a shop
// that's switched to this layout but never uploaded a banner, so there's
// still something to rotate through rather than a blank hero. Previously
// this always mixed in product thumbnails alongside a single banner image —
// real multi-image banners replace that stand-in entirely once any exist.
export function buildSlides(banners: BannerImageInput[], products: Product[]): Slide[] {
  if (banners.length > 0) {
    return banners.map((b) => ({ image: resolveImageUrl(b.url) ?? "", label: null, linkUrl: b.linkUrl }));
  }
  return products.slice(0, MAX_PRODUCT_SLIDES).map((p) => ({ image: p.thumbnail, label: p.name, linkUrl: null }));
}

// "Slideshow" layout's hero — auto-advances, plus manual prev/next arrows
// and the existing click-a-dot jump, matching the task's "auto-advance +
// manual controls" ask. No slider UX pattern already existed elsewhere on
// this storefront to match (checked CollectionNav's mobile arrows — a
// different, horizontal-scroll-nudge interaction, not a slide-index
// carousel) — these arrows are new, styled consistently with the existing
// dot indicators (same --color-slider-fg token).
export default function SlideshowHero({
  banners,
  heroText,
  products,
}: {
  banners: BannerImageInput[];
  heroText: string | null;
  products: Product[];
}) {
  const slides = buildSlides(banners, products);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % slides.length), AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
    // slides.length only — recreating the timer on every render (e.g. from
    // `index` changing) would reset the interval and effectively freeze
    // auto-advance under React's dev double-invoke / frequent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  if (slides.length === 0) {
    return heroText ? <p className="px-4 py-3 text-sm text-center text-zinc-600 bg-homepage-info">{heroText}</p> : null;
  }

  function goTo(next: number) {
    setIndex((next + slides.length) % slides.length);
  }

  const current = slides[Math.min(index, slides.length - 1)];

  const track = (
    <div className="relative w-full h-48 sm:h-72">
      {slides.map((slide, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={slide.image}
          alt={slide.label ?? ""}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
            i === index ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}
      {current.label && (
        <p className="absolute bottom-0 inset-x-0 bg-black/40 text-white text-sm px-4 py-2">{current.label}</p>
      )}
    </div>
  );

  // Full-bleed (edge to edge) — the caller (app/[shop]/page.tsx) places
  // this outside the page's own StorefrontPageShell width cap, same
  // reasoning as ClassicHero's own full-bleed treatment.
  return (
    <div className="bg-slider-bg">
      <div className="relative">
        {current.linkUrl ? (
          <a href={current.linkUrl} className="block">
            {track}
          </a>
        ) : (
          track
        )}
        {slides.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous slide"
              onClick={() => goTo(index - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center size-8 rounded-full bg-black/30 text-white hover:bg-black/50 transition-colors cursor-pointer"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Next slide"
              onClick={() => goTo(index + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center size-8 rounded-full bg-black/30 text-white hover:bg-black/50 transition-colors cursor-pointer"
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </div>
      {slides.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 py-2 bg-slider-bg">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => goTo(i)}
              className="size-1.5 rounded-full transition-colors cursor-pointer"
              style={{ background: i === index ? "var(--color-slider-fg)" : "color-mix(in srgb, var(--color-slider-fg) 30%, transparent)" }}
            />
          ))}
        </div>
      )}
      {heroText && <p className="px-4 py-3 text-sm text-zinc-600 bg-homepage-info">{heroText}</p>}
    </div>
  );
}
