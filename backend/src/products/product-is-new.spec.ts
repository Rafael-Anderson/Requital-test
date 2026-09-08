import { resolveProductIsNew } from './product-is-new';

describe('resolveProductIsNew', () => {
  const DUBAI = 'Asia/Dubai'; // UTC+4, no DST

  it('is false when the merchant flag is off, regardless of date', () => {
    expect(resolveProductIsNew(false, null, DUBAI)).toBe(false);
    expect(resolveProductIsNew(false, '2099-01-01', DUBAI)).toBe(false);
  });

  it('is true when flagged and no expiry is set', () => {
    expect(resolveProductIsNew(true, null, DUBAI)).toBe(true);
  });

  it('is true on the expiry day itself (new "through the end of" that day)', () => {
    // 2026-09-15 21:00 UTC = 2026-09-16 01:00 in Dubai — the expiry day
    // in Dubai is the 16th, so a newUntil of 2026-09-16 is still current.
    const now = new Date('2026-09-15T21:00:00Z');
    expect(resolveProductIsNew(true, '2026-09-16', DUBAI, now)).toBe(true);
  });

  it('is false once the shop-local date has passed the expiry', () => {
    const now = new Date('2026-09-16T21:00:00Z'); // 2026-09-17 in Dubai
    expect(resolveProductIsNew(true, '2026-09-16', DUBAI, now)).toBe(false);
  });

  it('uses the SHOP timezone, not UTC, for the day boundary', () => {
    // 2026-09-16T02:00:00Z is still 2026-09-15 in Los Angeles but already
    // 2026-09-16 06:00 in Dubai. A newUntil of 2026-09-15 must read as
    // expired for a Dubai shop.
    const now = new Date('2026-09-16T02:00:00Z');
    expect(resolveProductIsNew(true, '2026-09-15', DUBAI, now)).toBe(false);
    expect(resolveProductIsNew(true, '2026-09-15', 'America/Los_Angeles', now)).toBe(true);
  });
});
