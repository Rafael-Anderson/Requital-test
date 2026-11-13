import { createHmac, timingSafeEqual } from 'crypto';

// Nomod signs webhooks with the Standard Webhooks scheme (the same as Svix):
//   signed content = <id> "." <timestamp> "." <RAW body>
//   signature      = base64( HMAC-SHA256( key, signed content ) )
//   key            = base64-decode( secret without its "whsec_" prefix )
// The signature header may carry several space-separated "v1,<base64>" entries
// (during a secret rotation the old one stays valid for 24h): the delivery is
// accepted when ANY of them matches. Headers are svix-id / svix-timestamp /
// svix-signature, or the webhook-* spellings of the same three.

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface WebhookHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}

export type SignatureVerdict =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'missing_headers'
        | 'bad_secret'
        | 'bad_timestamp'
        | 'timestamp_out_of_range'
        | 'no_matching_signature';
    };

// Reads the three headers from a Node/Express header bag, preferring svix-* and
// falling back to webhook-*. A repeated header (array) counts as absent: the value
// to verify must be unambiguous.
export function pickWebhookHeaders(
  headers: Record<string, string | string[] | undefined>,
): WebhookHeaders {
  const one = (name: string): string | undefined => {
    const v = headers[name];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  return {
    id: one('svix-id') ?? one('webhook-id'),
    timestamp: one('svix-timestamp') ?? one('webhook-timestamp'),
    signature: one('svix-signature') ?? one('webhook-signature'),
  };
}

function decodeSecret(secret: string): Buffer | null {
  const raw = secret.trim().replace(/^whsec_/, '');
  if (!raw || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length > 0 ? key : null;
}

export function verifyStandardWebhook(params: {
  headers: WebhookHeaders;
  rawBody: Buffer;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): SignatureVerdict {
  const { id, timestamp, signature } = params.headers;
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: 'missing_headers' };
  }
  const key = decodeSecret(params.secret);
  if (!key) return { ok: false, reason: 'bad_secret' };

  if (!/^\d{1,12}$/.test(timestamp)) {
    return { ok: false, reason: 'bad_timestamp' };
  }
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = params.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  // Older than the window (replay) OR further in the future than the window.
  if (Math.abs(now - Number(timestamp)) > tolerance) {
    return { ok: false, reason: 'timestamp_out_of_range' };
  }

  const expected = createHmac('sha256', key)
    .update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`), params.rawBody]))
    .digest();

  let matched = false;
  for (const entry of signature.split(' ')) {
    const comma = entry.indexOf(',');
    if (comma < 0) continue;
    if (entry.slice(0, comma) !== 'v1') continue;
    const given = Buffer.from(entry.slice(comma + 1), 'base64');
    // timingSafeEqual throws on a length mismatch, which a tampered header must
    // never turn into a crash: compare lengths first. Every entry is still
    // evaluated (no early exit on the first match) so timing does not reveal which
    // entry was the valid one.
    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      matched = true;
    }
  }
  return matched
    ? { ok: true }
    : { ok: false, reason: 'no_matching_signature' };
}
