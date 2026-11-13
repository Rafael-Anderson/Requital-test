import { createHash } from 'crypto';

// The idempotency key sent with a provider refund. Deterministic: the same order,
// the same amount already refunded before it (minor units) and the same amount now
// give the same key, so a retry of THIS refund presents the key the gateway has
// already seen and cannot be applied twice; the next refund (a different
// "already refunded") gets its own. 40 hex characters.
export function refundIdempotencyKey(
  orderId: number,
  alreadyRefundedMinor: number,
  providerPortionMinor: number,
): string {
  return createHash('sha256')
    .update(`refund|${orderId}|${alreadyRefundedMinor}|${providerPortionMinor}`)
    .digest('hex')
    .slice(0, 40);
}
