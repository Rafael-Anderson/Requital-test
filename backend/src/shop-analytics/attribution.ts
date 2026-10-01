// MKT-14: order attribution, as stored in order.attributionJson.
//
// The browser sends this at checkout (storefront/lib/attribution.ts). It is
// untrusted input that must NEVER block an order, so this is a lenient
// sanitiser, not a validation pipe: it bounds and filters everything and returns
// what it can, instead of rejecting the request.
//
// CONSENT. `consent.marketing` is what the shopper's cookie choice was when they
// checked out: true / false, or null when the browser said nothing (unknown).
// Everything that could identify a visitor to a third party (click ids, the Meta
// browser cookies, the user agent) is kept ONLY when it is true. That is a
// structural guarantee, not a convention: with consent false/unknown those
// fields do not exist in the stored row, so nothing downstream can forward them.
// UTM parameters and the referrer are first-party campaign metadata and are kept
// regardless.

export const ATTRIBUTION_VERSION = 1;

export interface TouchData {
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
  capturedAt?: string;
}

export interface AttributionData {
  v: typeof ATTRIBUTION_VERSION;
  firstTouch?: TouchData;
  lastTouch?: TouchData;
  consent: { marketing: boolean | null };
  fbp?: string;
  fbc?: string;
  clientUserAgent?: string;
}

const MAX_SHORT = 200;
const MAX_PATH = 500;
const MAX_UA = 400;

const CLICK_ID_KEYS = ['gclid', 'fbclid', 'ttclid'] as const;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(CONTROL_CHARS, '').trim().slice(0, max);
  return cleaned === '' ? undefined : cleaned;
}

// A referrer / landing path is reduced to origin+path (or path alone): the query
// string and fragment can carry tokens or personal data and are never needed.
function stripQuery(value: string): string {
  return value.split(/[?#]/)[0];
}

function cleanReferrer(value: unknown): string | undefined {
  const s = cleanString(value, MAX_PATH);
  if (!s) return undefined;
  try {
    const url = new URL(s);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return `${url.origin}${url.pathname}`.slice(0, MAX_PATH);
  } catch {
    return undefined;
  }
}

function cleanLandingPath(value: unknown): string | undefined {
  const s = cleanString(value, MAX_PATH);
  if (!s || !s.startsWith('/')) return undefined;
  return stripQuery(s);
}

function cleanTouch(raw: unknown, marketingConsent: boolean): TouchData | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const touch: TouchData = {};
  // Lower-cased so "Google" and "google" group together in the report; campaign
  // is left as typed (campaign names are case-meaningful to the merchant).
  const source = cleanString(r.source, MAX_SHORT)?.toLowerCase();
  const medium = cleanString(r.medium, MAX_SHORT)?.toLowerCase();
  const campaign = cleanString(r.campaign, MAX_SHORT);
  const term = cleanString(r.term, MAX_SHORT);
  const content = cleanString(r.content, MAX_SHORT);
  const referrer = cleanReferrer(r.referrer);
  const landingPath = cleanLandingPath(r.landingPath);
  if (source) touch.source = source;
  if (medium) touch.medium = medium;
  if (campaign) touch.campaign = campaign;
  if (term) touch.term = term;
  if (content) touch.content = content;
  if (referrer) touch.referrer = referrer;
  if (landingPath) touch.landingPath = landingPath;
  if (marketingConsent) {
    for (const key of CLICK_ID_KEYS) {
      const v = cleanString(r[key], MAX_SHORT);
      if (v) touch[key] = v;
    }
  }
  const capturedAt = cleanString(r.capturedAt, 40);
  if (capturedAt && !Number.isNaN(Date.parse(capturedAt))) {
    touch.capturedAt = new Date(capturedAt).toISOString();
  }
  return Object.keys(touch).length > 0 ? touch : undefined;
}

// Never throws. Returns null only when the input is not an object at all (the
// browser sent nothing usable), which is stored as SQL NULL = unknown.
export function sanitizeAttribution(raw: unknown): AttributionData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const consentRaw = r.consent;
  const marketingRaw =
    consentRaw && typeof consentRaw === 'object'
      ? (consentRaw as Record<string, unknown>).marketing
      : undefined;
  const marketing = marketingRaw === true ? true : marketingRaw === false ? false : null;

  const out: AttributionData = {
    v: ATTRIBUTION_VERSION,
    consent: { marketing },
  };
  const firstTouch = cleanTouch(r.firstTouch, marketing === true);
  const lastTouch = cleanTouch(r.lastTouch, marketing === true);
  if (firstTouch) out.firstTouch = firstTouch;
  if (lastTouch) out.lastTouch = lastTouch;
  if (marketing === true) {
    const fbp = cleanString(r.fbp, MAX_SHORT);
    const fbc = cleanString(r.fbc, MAX_SHORT);
    const ua = cleanString(r.clientUserAgent, MAX_UA);
    if (fbp) out.fbp = fbp;
    if (fbc) out.fbc = fbc;
    if (ua) out.clientUserAgent = ua;
  }
  return out;
}

// True only for an explicit, recorded "yes". NULL / absent / false / malformed
// all mean no: the CAPI trigger and handler both ask this, so unknown consent
// can never send anything.
export function hasMarketingConsent(attributionJson: unknown): boolean {
  const parsed = parseAttribution(attributionJson);
  return parsed?.consent?.marketing === true;
}

// order.attributionJson is a real JSON column so mysql2 hands back an object,
// but a string is tolerated (a driver/column-type change must not silently turn
// every shop into "no consent" or crash a report).
export function parseAttribution(value: unknown): AttributionData | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return parseAttribution(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as AttributionData;
}

// What a staff member sees on the order's Source card: the touches and the
// consent state, but NOT the click ids, Meta cookies or user agent. Those exist
// to be forwarded to the ad platform, not to be read by every staff role.
export function attributionAdminView(value: unknown): {
  firstTouch: TouchData | null;
  lastTouch: TouchData | null;
  consentMarketing: boolean | null;
} | null {
  const a = parseAttribution(value);
  if (!a) return null;
  const strip = (t?: TouchData): TouchData | null => {
    if (!t) return null;
    const { gclid, fbclid, ttclid, ...rest } = t;
    void gclid;
    void fbclid;
    void ttclid;
    return rest;
  };
  return {
    firstTouch: strip(a.firstTouch),
    lastTouch: strip(a.lastTouch),
    consentMarketing:
      typeof a.consent?.marketing === 'boolean' ? a.consent.marketing : null,
  };
}

// Removes the raw column from an order-shaped object before it is returned to
// ANY client. `SELECT *` over `order` is spread into responses all over the
// backend, so a new column would otherwise leak by default; every such spot
// strips it with this and the isolation e2e asserts none of them leak.
export function stripAttribution<T extends object>(
  row: T,
): Omit<T, 'attributionJson'> {
  const copy = { ...row } as T & { attributionJson?: unknown };
  delete copy.attributionJson;
  return copy;
}
