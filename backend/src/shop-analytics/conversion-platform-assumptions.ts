// EVERY provider wire detail for the TikTok Events API and the Snap Conversions
// API lives in this one file, and EVERY value in it is an UNVERIFIED ASSUMPTION
// written from memory of the providers' public documentation. No request has
// ever been made to either provider from this codebase (tests use the fakes in
// conversion-clients.fake.ts). Before a merchant relies on these, the owner must
// check each line below against the provider's current docs and its test tool
// (TikTok Events Manager "Test events", Snap Events Manager test mode).
//
// Nothing in the builders or clients hardcodes a URL, header name, event name or
// normalisation rule: they read it from here, so a correction is a one-file edit.
import { normalizePhoneToE164 } from '../common/phone';
import { sha256Hex } from './meta-capi';

export const TIKTOK_ASSUMPTIONS = {
  // UNVERIFIED: Events API 2.0 "track" endpoint.
  endpoint: 'https://business-api.tiktok.com/open_api/v1.3/event/track/',
  // UNVERIFIED: the token travels in this request header (never the URL).
  tokenHeader: 'Access-Token',
  // UNVERIFIED: the browser vocabulary already uses CompletePayment
  // (storefront/lib/analytics.ts TIKTOK_EVENTS.purchase); the server must match
  // it or TikTok will not deduplicate the pair.
  eventName: 'CompletePayment',
  // UNVERIFIED: "web" for events that originate in a browser session.
  eventSource: 'web',
  // UNVERIFIED: the dedupe key is event_id, shared with the browser pixel's
  // { event_id } option, within TikTok's own (unknown to us) dedupe window.
  // Unix SECONDS for event_time.
  timeUnit: 'seconds',
  // UNVERIFIED: phone is hashed AS E.164 INCLUDING the leading "+".
  phoneIncludesPlus: true,
} as const;

export const SNAP_ASSUMPTIONS = {
  // UNVERIFIED: v3 events endpoint; {pixelId} is substituted. Snap's docs may
  // instead require the token as an `access_token` QUERY parameter. We send it
  // as a Bearer header; if Snap rejects that the owner must decide whether a
  // URL-borne token is acceptable (it would then need log redaction at every hop).
  endpoint: 'https://tr.snapchat.com/v3/{pixelId}/events',
  tokenHeader: 'Authorization', // value: `Bearer <token>`
  // UNVERIFIED: matches the browser vocabulary (SNAP_EVENTS.purchase).
  eventName: 'PURCHASE',
  // UNVERIFIED: success is judged by HTTP status ONLY (any 2xx). TikTok's client
  // also checks a body `code !== 0`; Snap's real response shape is unknown, so
  // a 200 carrying a rejection in its body would be treated as success.
  successBy: 'http-status',
  // UNVERIFIED
  actionSource: 'WEB',
  // UNVERIFIED: Snap's server field for dedupe is event_id; the BROWSER pixel's
  // field for the same id is client_dedup_id (see storefront/lib/analytics.ts).
  // Unix SECONDS for event_time (Snap may want milliseconds).
  timeUnit: 'seconds',
  // UNVERIFIED: phone hashed as digits only, country code included, no "+".
  phoneIncludesPlus: false,
} as const;

// UNVERIFIED: both providers want the email trimmed, lower-cased, SHA-256 hex.
export function hashEmailForAdPlatform(email: string | null | undefined): string | null {
  const normalised = email?.trim().toLowerCase();
  if (!normalised || !normalised.includes('@')) return null;
  return sha256Hex(normalised);
}

// A value that cannot be normalised is omitted, never sent raw or hashed as garbage.
export function hashPhoneForAdPlatform(
  phone: string | null | undefined,
  countryCode: string | null | undefined,
  includePlus: boolean,
): string | null {
  if (!phone) return null;
  const e164 = normalizePhoneToE164(phone, countryCode);
  if (!e164) return null;
  const digits = e164.replace(/\D/g, '');
  return sha256Hex(includePlus ? `+${digits}` : digits);
}
