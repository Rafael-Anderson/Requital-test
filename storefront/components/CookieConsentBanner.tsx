"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { cookieConsentStorageKey, getConsent, setConsent, type CookieConsentChoice } from "@/lib/consent";
import { purgeClickIds } from "@/lib/attribution";

// Every other fixed bottom element (WhatsApp float, floating custom buttons,
// back-to-top, the bottom-bar mobile nav, the PDP sticky add-to-cart bar)
// offsets itself with `bottom-[calc(<base>+var(--cookie-banner-h,0px))]` so
// none of them sits under the banner. The variable is the banner's whole fixed
// box (card + its margin + the safe-area inset), published on :root while the
// banner shows and removed the moment it goes away.
export const COOKIE_BANNER_HEIGHT_VAR = "--cookie-banner-h";

export { cookieConsentStorageKey };
export type { CookieConsentChoice };

// Bottom bar, not a modal — must never block page interaction (see task
// spec). Shown once per shop per browser until a choice is made. This is the
// real switch for third-party tracking: lib/analytics.ts loads no provider
// script and lib/attribution.ts forwards no click id until the visitor accepts
// here. Declining (or never answering) means neither ever happens.
export default function CookieConsentBanner() {
  const { shopSlug, shopBasePath } = useShop();
  const [choice, setChoice] = useState<CookieConsentChoice | null>(null);
  const [loaded, setLoaded] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Blocked/corrupt storage reads as "no choice yet": the banner shows again.
    const stored = getConsent(shopSlug);
    if (stored) setChoice(stored);
    setLoaded(true);
  }, [shopSlug]);

  function choose(next: CookieConsentChoice) {
    setChoice(next);
    // Persists the choice and tells lib/analytics.ts (storage blocked, e.g.
    // private browsing: it still applies for this page view).
    setConsent(shopSlug, next);
    // Declining discards the ad click ids captured on arrival: they exist only
    // to be forwarded to an ad platform, which this visitor has refused.
    if (next === "declined") purgeClickIds(shopSlug);
  }

  const visible = loaded && !choice;
  useEffect(() => {
    const el = boxRef.current;
    if (!visible || !el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty(COOKIE_BANNER_HEIGHT_VAR, `${Math.ceil(el.getBoundingClientRect().height)}px`);
    publish();
    // jsdom and very old browsers have no ResizeObserver: the one measure above stands.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty(COOKIE_BANNER_HEIGHT_VAR);
    };
  }, [visible]);

  if (!visible) return null;

  // Under sm (640px, the same phone/tablet line the PDP sticky bar uses) a
  // full-width bottom sheet whose own background runs under the home indicator;
  // from sm up a compact card, centred with a margin, because a 1440px strip
  // for two lines of copy is mostly empty bar. The outer box is click-through
  // so only the card takes pointer events.
  return (
    <div ref={boxRef} data-cookie-banner className="fixed inset-x-0 bottom-0 z-40 pointer-events-none sm:p-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto mx-auto w-full sm:max-w-[720px] border-t sm:border border-stroke bg-header text-header-fg px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3 sm:rounded-2xl shadow-[0_-4px_16px_color-mix(in_srgb,var(--color-header-fg)_12%,transparent)]">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <p className="text-sm text-header-fg/70 flex-1">
            We use cookies to run this store and improve your experience.{" "}
            <Link href={`${shopBasePath}/policies/privacy`} className="underline">
              Learn more
            </Link>
            .
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => choose("declined")}
              className="flex-1 sm:flex-none min-h-11 px-4 py-2 rounded-lg border border-stroke text-sm font-medium leading-tight hover:border-header-fg/30 cursor-pointer"
            >
              Decline non-essential
            </button>
            <button
              type="button"
              onClick={() => choose("accepted")}
              className="flex-1 sm:flex-none min-h-11 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium leading-tight hover:opacity-90 cursor-pointer"
            >
              Accept all
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
