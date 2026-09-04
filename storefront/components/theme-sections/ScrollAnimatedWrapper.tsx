"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SectionEntrance } from "@/lib/theme-config-types";
import type { ResolvedSectionMotion } from "@/lib/section-motion";

const ANIMATION_CLASS: Record<Exclude<SectionEntrance, "none">, string> = {
  "fade-in": "theme-anim-fade-in",
  "slide-up": "theme-anim-slide-up",
  "slide-left": "theme-anim-slide-left",
  "slide-right": "theme-anim-slide-right",
  // Phase A — new entrance vocabulary.
  "scale-in": "theme-anim-scale-in",
  "blur-in": "theme-anim-blur-in",
  "mask-reveal": "theme-anim-mask-reveal",
};

// Generalises the one existing IntersectionObserver usage in
// app/[shop]/products/[slug]/ProductDetailClient.tsx into a reusable "add an
// entrance class once visible" wrapper.
//
// Phase A: takes a resolved motion descriptor (lib/section-motion.ts) instead
// of a raw enum. `entrance: 'none'` (or an unrecognised value) ⇒ renders the
// children untouched, exactly as before. `trigger: 'load'` skips the observer
// and reveals on the next frame after mount. `animateOnce: false` keeps
// observing and re-hides when the section scrolls out (default `true` = the
// old one-shot behaviour). `stagger` only stamps `data-stagger` — no section
// wires the `--i` child indices yet (Amendment 1), so it is inert for now.
// `prefers-reduced-motion` is handled entirely by the single blanket rule in
// globals.css.
export default function ScrollAnimatedWrapper({
  motion,
  children,
}: {
  motion: ResolvedSectionMotion;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  const animated = motion.entrance !== "none";
  const { trigger, animateOnce, stagger } = motion;

  useEffect(() => {
    if (!animated) return;
    const el = ref.current;
    if (!el) return;

    if (trigger === "load") {
      // Reveal on the next frame so the base ("hidden") class paints first —
      // same flash-avoidance the two-class split gives for the scroll path.
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          if (animateOnce) observer.unobserve(el);
        } else if (!animateOnce) {
          setVisible(false);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [animated, trigger, animateOnce]);

  if (motion.entrance === "none") return <>{children}</>;

  return (
    <div
      ref={ref}
      className={`${ANIMATION_CLASS[motion.entrance]} ${visible ? "theme-anim-visible" : ""}`}
      {...(stagger ? { "data-stagger": "true" } : {})}
    >
      {children}
    </div>
  );
}
