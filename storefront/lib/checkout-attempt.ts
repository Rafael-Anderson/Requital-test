// F8: one idempotency key per checkout ATTEMPT.
//
// The server answers a repeat of the same key with the SAME order (never a second
// order, never a second debit of a gift card, store credit or discount), so the
// key must survive exactly the retries that are the same attempt and nothing else:
//  - survives: a double click, a response that never arrived, Back from the
//    payment gateway, a reload of the checkout page (sessionStorage, per tab);
//  - is replaced: when the request changes (a different cart, quantity, address,
//    code, payment method...: the signature differs), after the order succeeds
//    without leaving for a gateway, when the order is seen paid, and when the
//    server says the attempt is over (payment_unavailable, a closed or reused key);
//  - expires after TTL_MS so a stale tab never replays an old order.
const TTL_MS = 2 * 60 * 60 * 1000;

interface StoredAttempt {
  key: string;
  // A SHA-256 of the request signature, never the request itself: sessionStorage
  // is readable by any script on the page, and the request holds a name, phone
  // and address.
  signature: string;
  at: number;
}

function storageKey(shopSlug: string): string {
  return `requital_checkout_attempt:${shopSlug}`;
}

function mintKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // fall through
  }
  // Only reached where no Web Crypto exists at all; 32 chars, over the server's 22 minimum.
  const rand = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `${rand()}${rand()}${rand()}${rand()}`;
}

// Hex SHA-256 via Web Crypto. Where it is missing (an old browser, a test env) a
// non-reversible 53-bit hash stands in: it only has to tell two requests apart.
async function digest(text: string): Promise<string> {
  try {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // fall through
  }
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `f${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined || v === null) continue;
      out[k] = canonical(v);
    }
    return out;
  }
  return value;
}

// What identifies "the same request": the order payload without the marketing
// attribution (whose consent state may change between two submits of one order).
export function payloadSignature(payload: object): string {
  return JSON.stringify(canonical(payload));
}

export async function checkoutAttemptKey(
  shopSlug: string,
  signature: string,
  now: number = Date.now(),
): Promise<string> {
  const hashed = await digest(signature);
  try {
    const raw = sessionStorage.getItem(storageKey(shopSlug));
    if (raw) {
      const stored = JSON.parse(raw) as StoredAttempt;
      if (stored.signature === hashed && now - stored.at < TTL_MS) return stored.key;
    }
  } catch {
    // unreadable storage: mint a fresh key below
  }
  const key = mintKey();
  try {
    sessionStorage.setItem(storageKey(shopSlug), JSON.stringify({ key, signature: hashed, at: now } satisfies StoredAttempt));
  } catch {
    // best effort: without storage a retry simply mints another key
  }
  return key;
}

export function discardCheckoutAttempt(shopSlug: string): void {
  try {
    sessionStorage.removeItem(storageKey(shopSlug));
  } catch {
    // nothing to do
  }
}

export function hasCheckoutAttempt(shopSlug: string, now: number = Date.now()): boolean {
  try {
    const raw = sessionStorage.getItem(storageKey(shopSlug));
    if (!raw) return false;
    return now - (JSON.parse(raw) as StoredAttempt).at < TTL_MS;
  } catch {
    return false;
  }
}

// The server's reasons an attempt is over for good (see PublicService.createOrder).
const ENDED = new Set(["payment_unavailable", "idempotency_key_reused", "checkout_attempt_closed"]);
export function attemptEnded(code: string | undefined): boolean {
  return !!code && ENDED.has(code);
}
