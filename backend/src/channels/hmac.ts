import { createHmac, timingSafeEqual } from 'crypto';

export function hmacSha256Hex(secret: string, message: Buffer | string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

// Constant-time comparison that is also safe for unequal lengths (timingSafeEqual
// throws on those).
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase(), 'utf8');
  const y = Buffer.from(b.toLowerCase(), 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}
