"use client";

import { ArrowUp } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { useScrollValue } from "@/lib/use-scroll-value";
import { useReducedMotion } from "@/lib/use-reduced-motion";

const SHOW_AFTER_Y = 400;

// C1/C2 batch — globalSettings.floatingElements.backToTop, not
// footer.settings (matches its original Phase F home and the motion/
// radius/density object-wrapper convention). Reads the already-shipped
// useScrollValue() ("ships unused, for the later phases" per CLAUDE.md;
// this is that later phase). Mounted from ThemeDrivenFooter — the setting's
// read source moved off the footer, the render location didn't need to.
// Fixed bottom-5 left-5, opposite WhatsAppFloatingButton's default
// bottom-5 right-5 corner, so the two never collide without any new
// cross-component coordination.
export default function BackToTopButton() {
  const { themeConfig } = useShop();
  const { y } = useScrollValue();
  const reducedMotion = useReducedMotion();
  const enabled = !!themeConfig?.globalSettings.floatingElements?.backToTop?.enabled;
  if (!enabled || y <= SHOW_AFTER_Y) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" })}
      aria-label="Back to top"
      className="fixed bottom-5 left-5 z-30 flex items-center justify-center size-11 rounded-full bg-accent text-accent-foreground shadow-lg hover:opacity-90 transition-opacity"
    >
      <ArrowUp className="size-5" />
    </button>
  );
}
