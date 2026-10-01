"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { cookieConsentStorageKey, getConsent, setConsent, type CookieConsentChoice } from "@/lib/consent";
import { purgeClickIds } from "@/lib/attribution";

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

  if (!loaded || choice) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-stroke bg-header text-header-fg px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
      <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
        <p className="text-sm text-zinc-500 flex-1">
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
            className="h-9 px-4 rounded-lg border border-stroke text-sm font-medium hover:border-black/30 cursor-pointer"
          >
            Decline non-essential
          </button>
          <button
            type="button"
            onClick={() => choose("accepted")}
            className="h-9 px-4 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 cursor-pointer"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
