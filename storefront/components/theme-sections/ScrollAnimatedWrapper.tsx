"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ScrollAnimation } from "@/lib/theme-config-types";

const ANIMATION_CLASS: Record<Exclude<ScrollAnimation, "none">, string> = {
  "fade-in": "theme-anim-fade-in",
  "slide-up": "theme-anim-slide-up",
  "slide-left": "theme-anim-slide-left",
  "slide-right": "theme-anim-slide-right",
};

// Generalizes the one existing IntersectionObserver usage in
// app/[shop]/products/[slug]/ProductDetailClient.tsx (a sticky-CTA
// visibility toggle) into a reusable "add an entrance class once visible"
// wrapper. Fires once — unobserves after the first trigger, so an entrance
// animation never replays on scroll-back-up. A section already in the
// viewport on initial page load still gets its entrance class applied (the
// observer's first callback fires immediately for an already-intersecting
// element), it just animates from mount rather than looking "stuck
// hidden." `prefers-reduced-motion` is handled entirely in globals.css
// (the animation classes no-op under that media query), not here.
export default function ScrollAnimatedWrapper({
  animation,
  children,
}: {
  animation: ScrollAnimation | undefined;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!animation || animation === "none") return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [animation]);

  if (!animation || animation === "none") return <>{children}</>;

  return (
    <div ref={ref} className={`${ANIMATION_CLASS[animation]} ${visible ? "theme-anim-visible" : ""}`}>
      {children}
    </div>
  );
}
