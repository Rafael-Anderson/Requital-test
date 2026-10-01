// The visitor's cookie choice, the single switch for everything non-essential.
//
// CookieConsentBanner writes it; lib/analytics.ts and lib/attribution.ts read it.
// "accepted" is the only value that ever allows a third-party script to load or a
// click id to be forwarded: "declined" and "no choice yet" (null) are both "no".
// Silence is not consent.
export type CookieConsentChoice = "accepted" | "declined";

export function cookieConsentStorageKey(shopSlug: string): string {
  return `requital_storefront_cookie_consent:${shopSlug}`;
}

const CONSENT_EVENT = "requital:consent-changed";

export function getConsent(shopSlug: string): CookieConsentChoice | null {
  try {
    const raw = localStorage.getItem(cookieConsentStorageKey(shopSlug));
    return raw === "accepted" || raw === "declined" ? raw : null;
  } catch {
    // Blocked storage: no recorded choice, which is "no".
    return null;
  }
}

export function setConsent(shopSlug: string, choice: CookieConsentChoice): void {
  try {
    localStorage.setItem(cookieConsentStorageKey(shopSlug), choice);
  } catch {
    // The choice still applies for this page view via the event below.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { shopSlug, choice } }));
}

// Calls back with the new choice whenever the banner records one. Returns an
// unsubscribe function.
export function onConsentChange(shopSlug: string, cb: (choice: CookieConsentChoice) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ shopSlug: string; choice: CookieConsentChoice }>).detail;
    if (detail?.shopSlug === shopSlug) cb(detail.choice);
  };
  window.addEventListener(CONSENT_EVENT, handler);
  return () => window.removeEventListener(CONSENT_EVENT, handler);
}
