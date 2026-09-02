import { useEffect, useState } from "react";

// Rotation timing — shared by both announcement bars: the persistent chrome
// bar (components/AnnouncementBar.tsx) and the homepage-body section
// (components/theme-sections/AnnouncementBarSectionThemed.tsx).
export const ANNOUNCEMENT_ROTATION_MS: Record<string, number> = { fast: 2000, medium: 4000, slow: 6000 };
export const ANNOUNCEMENT_FADE_MS = 400;

// Stable per-message-set dismiss key: editing the messages changes the hash,
// so a re-worded announcement re-shows even for a visitor who dismissed the
// old one. djb2, base36 — short and dependency-free. Scoped per shop, same
// convention as cart.tsx / CookieConsentBanner.
export function announcementDismissKey(shopSlug: string, messages: string[]): string {
  const joined = messages.join("");
  let hash = 5381;
  for (let i = 0; i < joined.length; i++) hash = ((hash << 5) + hash + joined.charCodeAt(i)) | 0;
  return `requital_storefront_announcement_dismissed:${shopSlug}:${(hash >>> 0).toString(36)}`;
}

// Crossfade rotator for both announcement bars. `enabled` is the caller's
// "rotate" gate (false ⇒ marquee/static — e.g. the section passes
// !settings.scrolling). Rotation also stops under prefers-reduced-motion or
// with ≤1 message. Returns the active index (always valid mod
// messages.length) and the mid-transition `faded` flag.
export function useAnnouncementRotation(
  messages: string[],
  enabled: boolean,
  speed: string | undefined,
): { rotating: boolean; index: number; faded: boolean } {
  // Lazy-init from matchMedia so the mount effect only wires the listener
  // (no synchronous setState in an effect body).
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [index, setIndex] = useState(0);
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const len = messages.length;
  const rotating = enabled && !reducedMotion && len > 1;

  useEffect(() => {
    if (!rotating) return;
    const intervalMs = ANNOUNCEMENT_ROTATION_MS[speed ?? "medium"] ?? ANNOUNCEMENT_ROTATION_MS.medium;
    let fadeTimer: ReturnType<typeof setTimeout>;
    const tick = setInterval(() => {
      setFaded(true);
      fadeTimer = setTimeout(() => {
        setIndex((i) => (i + 1) % len);
        setFaded(false);
      }, ANNOUNCEMENT_FADE_MS);
    }, intervalMs);
    return () => {
      clearInterval(tick);
      clearTimeout(fadeTimer);
    };
  }, [rotating, speed, len]);

  // Derived, not reset in an effect: when not rotating, index is pinned to 0
  // and faded to false regardless of any stale state from a prior run.
  return { rotating, index: rotating && len ? index % len : 0, faded: rotating ? faded : false };
}
