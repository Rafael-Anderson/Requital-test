const REF_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — matches the task's "reasonable expiry" ask.

function storageKey(shopSlug: string): string {
  return `requital_ref:${shopSlug}`;
}

// Reads ?ref=<code> off the current URL (if present) and persists it,
// surviving browsing before checkout — same per-shop localStorage
// namespacing convention as lib/cart.tsx. A page load with no ?ref param
// leaves whatever's already stored untouched (so navigating deeper into the
// site doesn't drop an earlier-captured code).
export function captureReferralFromUrl(shopSlug: string): void {
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (!ref?.trim()) return;
  localStorage.setItem(
    storageKey(shopSlug),
    JSON.stringify({ code: ref.trim(), expiresAt: Date.now() + REF_EXPIRY_MS }),
  );
}

// Null once expired (and cleans up after itself) or if nothing was ever
// captured for this shop.
export function getStoredReferralCode(shopSlug: string): string | null {
  const raw = localStorage.getItem(storageKey(shopSlug));
  if (!raw) return null;
  try {
    const { code, expiresAt } = JSON.parse(raw) as { code: string; expiresAt: number };
    if (Date.now() > expiresAt) {
      localStorage.removeItem(storageKey(shopSlug));
      return null;
    }
    return code;
  } catch {
    return null;
  }
}
