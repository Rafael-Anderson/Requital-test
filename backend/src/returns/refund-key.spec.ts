import { refundIdempotencyKey } from './refund-key';

describe('refundIdempotencyKey', () => {
  it('is stable: the same refund always gets the same key', () => {
    expect(refundIdempotencyKey(7, 0, 4500)).toBe(
      refundIdempotencyKey(7, 0, 4500),
    );
  });

  it('is 40 hex characters', () => {
    expect(refundIdempotencyKey(7, 0, 4500)).toMatch(/^[0-9a-f]{40}$/);
  });

  it('differs per order, per amount and per amount already refunded', () => {
    const base = refundIdempotencyKey(7, 0, 4500);
    expect(refundIdempotencyKey(8, 0, 4500)).not.toBe(base);
    expect(refundIdempotencyKey(7, 0, 4501)).not.toBe(base);
    // the same amount refunded a second time is a different refund
    expect(refundIdempotencyKey(7, 4500, 4500)).not.toBe(base);
  });

  it('fields cannot collide by concatenation', () => {
    expect(refundIdempotencyKey(1, 23, 4)).not.toBe(
      refundIdempotencyKey(12, 3, 4),
    );
  });
});
