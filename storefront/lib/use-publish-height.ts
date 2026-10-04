"use client";

import { useEffect, type RefObject } from "react";

// Publishes a fixed bar's height on :root as a CSS variable while it is mounted (and `active`), so other fixed
// bottom elements can stack above it, the way the cookie banner publishes --cookie-banner-h. The variable is
// removed when the bar goes away. Used by the PDP's sticky add-to-cart bar (--sticky-bar-h): the back-to-top,
// WhatsApp and custom floating buttons used to sit underneath it on a phone.
export function usePublishHeight(ref: RefObject<HTMLElement | null>, cssVar: string, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty(cssVar, `${Math.ceil(el.getBoundingClientRect().height)}px`);
    publish();
    // jsdom and very old browsers have no ResizeObserver: the one measure above stands.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty(cssVar);
    };
    // ref is a stable object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cssVar]);
}
