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

  it('unhit takes a hit back without going below zero', () => {
    const l = new FixedWindowLimiter(2, 60_000, () => 0);
    l.hit('a');
    l.hit('a');
    l.unhit('a');
    expect(l.peek('a').count).toBe(1);
    l.unhit('a');
    l.unhit('a');
    expect(l.peek('a').count).toBe(0);
    expect(l.hit('a')).toBe(true);
  });

  it('never tracks more than maxKeys keys, evicting the oldest, and stays cheap', () => {
    let now = 0;
    const l = new FixedWindowLimiter(1, 60_000, () => now, 100);
    for (let i = 0; i < 10_000; i++) l.hit(`k${i}`);
    const size = () =>
      (l as unknown as { windows: Map<string, unknown> }).windows.size;
    expect(size()).toBeLessThanOrEqual(100);
    // the newest keys survive, the oldest were dropped
    expect(l.peek('k9999').count).toBe(1);
    expect(l.peek('k0').count).toBe(0);
    // expired windows are reclaimed before live ones are evicted
    now += 60_001;
    for (let i = 0; i < 50; i++) l.hit(`fresh${i}`);
    expect(l.peek('fresh0').count).toBe(1);
  });

  it('peek reads a window without counting and reports the wait', () => {
    let now = 1000;
    const l = new FixedWindowLimiter(3, 60_000, () => now);
    expect(l.peek('a')).toEqual({ count: 0, retryAfterMs: 0 });
    l.hit('a');
    l.peek('a');
    l.peek('a');
    now += 10_000;
    expect(l.peek('a')).toEqual({ count: 1, retryAfterMs: 50_000 });
    now += 50_000;
    expect(l.peek('a')).toEqual({ count: 0, retryAfterMs: 0 });
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
