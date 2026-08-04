import { createHmac, timingSafeEqual } from 'crypto';

// Shared by TabbyPaymentProvider/TamaraPaymentProvider — both verify their
// webhook deliveries the same way (HMAC-SHA256 of the raw request body,
// hex-encoded, compared against a signature header). Stripe doesn't use
// this: it has its own SDK-based verification (Stripe.webhooks.constructEvent)
// which additionally checks a timestamp against replay — see
// stripe-payment.provider.ts.
export function verifyHmacSha256(
  payload: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signatureHeader.trim(), 'utf8');
  // timingSafeEqual throws on a length mismatch rather than returning
  // false — a tampered/truncated signature header must never crash the
  // webhook endpoint (that would itself be exploitable as a way to probe
  // for valid header lengths), so length is checked explicitly first.
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
