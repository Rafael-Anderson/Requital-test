import { isIP } from 'net';

// The key a per-IP throttle buckets a request under. The address comes from
// req.ip (the one place TRUST_PROXY is applied), never from a raw header.
//
// IPv4-mapped IPv6 (::ffff:1.2.3.4) and plain IPv4 are the same client. An
// IPv6 client owns a whole /64, so keying on the full address would let it
// rotate through 2^64 addresses and never meet a limit: bucket by the /64.
export function throttleKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const addr = ip.split('%')[0].toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped) return mapped[1];
  if (isIP(addr) !== 6) return addr;
  // Expand "::" and keep the first four 16-bit groups.
  const [head, tail] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups =
    tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  // ::ffff:7f00:1 is the hex spelling of the mapped form above.
  if (groups.slice(0, 5).every((g) => /^0+$/.test(g)) && groups[5] === 'ffff') {
    const hi = parseInt(groups[6], 16);
    const lo = parseInt(groups[7], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':') + '::/64';
}
