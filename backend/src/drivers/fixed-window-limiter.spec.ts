import { FixedWindowLimiter } from './fixed-window-limiter';
import { LINK_TOKEN_SHAPE, newLinkToken } from './driver-link';

describe('FixedWindowLimiter', () => {
  it('allows up to the limit per key per window, then resets', () => {
    let now = 1000;
    const l = new FixedWindowLimiter(3, 60_000, () => now);
    expect([1, 2, 3, 4].map(() => l.hit('a'))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(l.hit('b')).toBe(true); // other keys are independent
    now += 60_001;
    expect(l.hit('a')).toBe(true);
  });
});

describe('newLinkToken', () => {
  it('is 256 bits, url-safe, and never repeats', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = newLinkToken();
      expect(t).toMatch(LINK_TOKEN_SHAPE);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });
});
