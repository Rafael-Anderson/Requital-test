"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";

export type CookieConsentChoice = "accepted" | "declined";

export function cookieConsentStorageKey(shopSlug: string): string {
  return `requital_storefront_cookie_consent:${shopSlug}`;
}

// Bottom bar, not a modal — must never block page interaction (see task
// spec). Shown once per shop per browser until a choice is made; no
// analytics wiring yet, this only persists the choice (see
// requital_storefront_cookie_consent's own comment for what a future
// analytics-gating consumer would read).
export default function CookieConsentBanner() {
  const { shopSlug } = useShop();
  const [choice, setChoice] = useState<CookieConsentChoice | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(cookieConsentStorageKey(shopSlug));
      if (raw === "accepted" || raw === "declined") setChoice(raw);
    } catch {
      // corrupt/blocked storage — fall through to showing the banner again
    }
    setLoaded(true);
  }, [shopSlug]);

  function choose(next: CookieConsentChoice) {
    setChoice(next);
    try {
      localStorage.setItem(cookieConsentStorageKey(shopSlug), next);
    } catch {
      // storage blocked (private browsing, etc.) — the choice still applies
      // for this page view, it just won't persist across visits
    }
  }

  if (!loaded || choice) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-stroke bg-header text-header-fg px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
      <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
        <p className="text-sm text-zinc-500 flex-1">
          We use cookies to run this store and improve your experience.{" "}
          <Link href={`/${shopSlug}/policies/privacy`} className="underline">
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
