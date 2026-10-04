import { isIP } from 'net';

// TRUST_PROXY: which direct peers may tell us the real client address via
// X-Forwarded-For. Express's `trust proxy` setting, validated strictly.
//
// Unset (or blank) = false = trust nothing: req.ip is the socket address, a
// forwarded header is ignored. That is the pre-existing behaviour.
//
// Accepted:
//   - a hop count, "1".."10": trust that many proxies counted from the socket.
//     Weaker: it trusts whoever is on the socket, even a client that reached
//     the port directly. Prefer the list form.
//   - a comma-separated list of the keywords loopback / linklocal / uniquelocal,
//     IP addresses, or CIDR ranges. Express then takes the right-most
//     X-Forwarded-For entry that is NOT in the list, so a client-supplied
//     entry (always to the left of what a trusted proxy appended) can never
//     choose the address, and a peer outside the list is never believed.
//
// Refused on purpose: true / false / * / all, a wide-open range (0.0.0.0/0,
// ::/0, anything shorter than /8 for IPv4 or /16 for IPv6), a bare "0".
// "Trust everything" lets any client pick its own IP, which would turn every
// per-IP throttle (login, MFA, signup) into a bypass.
export type TrustProxySetting = false | number | string[];

const KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const MAX_HOPS = 10;
const MIN_V4_PREFIX = 8;
const MIN_V6_PREFIX = 16;

function isValidEntry(entry: string): boolean {
  if (KEYWORDS.has(entry)) return true;
  const [addr, prefix, ...rest] = entry.split('/');
  if (rest.length > 0) return false;
  const family = isIP(addr);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return family === 4
    ? bits >= MIN_V4_PREFIX && bits <= 32
    : bits >= MIN_V6_PREFIX && bits <= 128;
}

export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  if (raw === undefined || raw.trim() === '') return false;
  const value = raw.trim();
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops < 1 || hops > MAX_HOPS) {
      throw new Error(
        `TRUST_PROXY hop count must be between 1 and ${MAX_HOPS} (leave it unset to trust no proxy)`,
      );
    }
    return hops;
  }
  const entries = value.split(',').map((e) => e.trim().toLowerCase());
  const bad = entries.filter((e) => !isValidEntry(e));
  if (bad.length > 0) {
    throw new Error(
      `TRUST_PROXY has invalid entries (${bad.map((b) => JSON.stringify(b)).join(', ')}): ` +
        'use a hop count (1-10) or a comma-separated list of loopback, linklocal, uniquelocal, ' +
        `IP addresses or CIDR ranges (IPv4 /${MIN_V4_PREFIX}+ , IPv6 /${MIN_V6_PREFIX}+). "true" and trust-all ranges are refused`,
    );
  }
  return entries;
}

export function isValidTrustProxy(raw: string): boolean {
  try {
    parseTrustProxy(raw);
    return true;
  } catch {
    return false;
  }
}
