// MKT-14: first- and last-touch attribution, kept in first-party storage.
//
// Captured on every full page load of a shop (lib/shop-context.tsx), sent once at
// checkout (useCheckoutForm -> createOrder `attribution`) and persisted by the
// backend as order.attributionJson.
//
// WHAT NEEDS CONSENT. UTM parameters, the referrer host and the landing path are
// first-party campaign metadata and are captured regardless. Ad click ids
// (gclid / fbclid / ttclid), the Meta browser cookies (_fbp / _fbc) and the user
// agent exist only to be forwarded to an ad platform, so buildOrderAttribution
// includes them ONLY when the visitor accepted the cookie banner, and declining
// purges the stored click ids (purgeClickIds). The server re-enforces the same
// rule (backend shop-analytics/attribution.ts), so a modified client cannot
// smuggle them in without consent either.
import { getConsent } from "./consent";

export interface AttributionTouch {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  referrer?: string;
  landingPath?: string;
  gclid?: string;
  fbclid?: string;
  ttclid?: string;
  capturedAt: string;
}

interface StoredAttribution {
  first?: AttributionTouch;
  last?: AttributionTouch;
}

const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const CLICK_ID_KEYS = ["gclid", "fbclid", "ttclid"] as const;

// A customer returning from a payment page is not a traffic source, and would
// otherwise overwrite the real last touch of every online-paid order.
const PAYMENT_REFERRER_HOSTS = ["stripe.com", "paypal.com", "tabby.ai", "tamara.co", "nomod.com"];

function storageKey(shopSlug: string): string {
  return `requital_attr:${shopSlug}`;
}

function readStored(shopSlug: string, now: number): StoredAttribution {
  try {
    const raw = localStorage.getItem(storageKey(shopSlug));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredAttribution;
    const fresh = (t?: AttributionTouch) => (t && now - Date.parse(t.capturedAt) < MAX_AGE_MS ? t : undefined);
    return { first: fresh(parsed.first), last: fresh(parsed.last) };
  } catch {
    return {};
  }
}

function writeStored(shopSlug: string, value: StoredAttribution): void {
  try {
    localStorage.setItem(storageKey(shopSlug), JSON.stringify(value));
  } catch {
    // blocked storage: attribution is best-effort, never a checkout problem
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function externalReferrerHost(referrer: string, currentHost: string): string | null {
  const host = hostOf(referrer);
  if (!host || host === currentHost) return null;
  if (PAYMENT_REFERRER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  return host.replace(/^www\./, "");
}

// Pure: what one page load tells us about where the visitor came from.
export function deriveTouch(
  url: URL,
  referrer: string,
  now: Date,
): { touch: AttributionTouch; direct: boolean } {
  const q = url.searchParams;
  const get = (k: string) => q.get(k)?.trim() || undefined;
  const gclid = get("gclid");
  const fbclid = get("fbclid");
  const ttclid = get("ttclid");
  const utmSource = get("utm_source");
  const utmMedium = get("utm_medium");
  const refHost = externalReferrerHost(referrer, url.hostname.toLowerCase());

  const hasCampaign = Boolean(utmSource || utmMedium || get("utm_campaign") || gclid || fbclid || ttclid);
  const direct = !hasCampaign && !refHost;

  let source = utmSource;
  let medium = utmMedium;
  if (!source) {
    source = gclid ? "google" : fbclid ? "facebook" : ttclid ? "tiktok" : (refHost ?? "(direct)");
  }
  if (!medium) {
    medium = gclid ? "cpc" : fbclid || ttclid ? "social" : refHost ? "referral" : "(none)";
  }

  const touch: AttributionTouch = {
    source: source.toLowerCase(),
    medium: medium.toLowerCase(),
    campaign: get("utm_campaign"),
    term: get("utm_term"),
    content: get("utm_content"),
    // Origin + path only: a referrer's query string can carry anything.
    referrer: refHost ? `${new URL(referrer).origin}${new URL(referrer).pathname}` : undefined,
    landingPath: url.pathname,
    gclid,
    fbclid,
    ttclid,
    capturedAt: now.toISOString(),
  };
  for (const k of Object.keys(touch) as (keyof AttributionTouch)[]) {
    if (touch[k] === undefined) delete touch[k];
  }
  return { touch, direct };
}

// First touch is written once and kept; last touch is replaced by every
// non-direct visit (a direct visit never overwrites a real campaign touch).
export function mergeTouch(
  stored: StoredAttribution,
  current: { touch: AttributionTouch; direct: boolean },
): StoredAttribution {
  return {
    first: stored.first ?? current.touch,
    last: current.direct && stored.last ? stored.last : current.touch,
  };
}

// Call once per full page load. Safe to call anywhere on the client.
export function captureAttribution(shopSlug: string, now: Date = new Date()): void {
  const current = deriveTouch(new URL(window.location.href), document.referrer, now);
  writeStored(shopSlug, mergeTouch(readStored(shopSlug, now.getTime()), current));
}

export function purgeClickIds(shopSlug: string): void {
  const stored = readStored(shopSlug, Date.now());
  const scrub = (t?: AttributionTouch) => {
    if (!t) return t;
    const copy = { ...t };
    for (const k of CLICK_ID_KEYS) delete copy[k];
    return copy;
  };
  writeStored(shopSlug, { first: scrub(stored.first), last: scrub(stored.last) });
}

function readCookie(name: string): string | undefined {
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

export interface OrderAttributionPayload {
  consent: { marketing: boolean | null };
  firstTouch?: AttributionTouch;
  lastTouch?: AttributionTouch;
  fbp?: string;
  fbc?: string;
  clientUserAgent?: string;
}

// What createOrder sends. `consent.marketing` is true / false / null (no choice
// yet = unknown), and everything that identifies the visitor to an ad platform
// is present only when it is true.
export function buildOrderAttribution(shopSlug: string): OrderAttributionPayload {
  const choice = getConsent(shopSlug);
  const marketing = choice === "accepted" ? true : choice === "declined" ? false : null;
  const stored = readStored(shopSlug, Date.now());
  const withoutClickIds = (t?: AttributionTouch): AttributionTouch | undefined => {
    if (!t) return undefined;
    const copy = { ...t };
    for (const k of CLICK_ID_KEYS) delete copy[k];
    return copy;
  };
  const out: OrderAttributionPayload = {
    consent: { marketing },
    firstTouch: marketing ? stored.first : withoutClickIds(stored.first),
    lastTouch: marketing ? stored.last : withoutClickIds(stored.last),
  };
  if (marketing) {
    const fbp = readCookie("_fbp");
    const fbclid = stored.last?.fbclid ?? stored.first?.fbclid;
    // Meta's documented fbc construction from a click id when the pixel has not
    // written the cookie (version.subdomainIndex.creationTime.fbclid).
    const fbc =
      readCookie("_fbc") ?? (fbclid ? `fb.1.${Date.parse((stored.last ?? stored.first)!.capturedAt)}.${fbclid}` : undefined);
    if (fbp) out.fbp = fbp;
    if (fbc) out.fbc = fbc;
    out.clientUserAgent = navigator.userAgent;
  }
  return out;
}
