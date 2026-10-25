import { currentUsagePeriod, usageLevel } from './usage-period';

describe('currentUsagePeriod', () => {
  it('uses the shop timezone for the month boundary (Dubai, UTC+4)', () => {
    // 2026-10-31 21:00 UTC is already 2026-11-01 01:00 in Dubai.
    const p = currentUsagePeriod(new Date('2026-10-31T21:00:00Z'), 'Asia/Dubai');
    expect(p.periodKey).toBe('2026-11');
    expect(p.start.toISOString()).toBe('2026-10-31T20:00:00.000Z');
    expect(p.endExclusive.toISOString()).toBe('2026-11-30T20:00:00.000Z');
  });

  it('the same instant is still October in UTC', () => {
    const p = currentUsagePeriod(new Date('2026-10-31T21:00:00Z'), 'UTC');
    expect(p.periodKey).toBe('2026-10');
    expect(p.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(p.endExclusive.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('rolls December into January', () => {
    const p = currentUsagePeriod(new Date('2026-12-15T12:00:00Z'), 'Asia/Kuwait');
    expect(p.periodKey).toBe('2026-12');
    expect(p.endExclusive.toISOString()).toBe('2026-12-31T21:00:00.000Z');
  });

  it('falls back instead of throwing on an unknown timezone', () => {
    expect(currentUsagePeriod(new Date('2026-10-10T00:00:00Z'), 'Nope/Zone').periodKey).toBe(
      '2026-10',
    );
  });
});

describe('usageLevel', () => {
  it('has no level without a ceiling', () => {
    expect(usageLevel(10_000, null)).toBe(0);
    expect(usageLevel(5, 0)).toBe(0);
  });
  it('steps at 80, 100 and 120 percent', () => {
    expect(usageLevel(239, 300)).toBe(0);
    expect(usageLevel(240, 300)).toBe(80);
    expect(usageLevel(300, 300)).toBe(100);
    expect(usageLevel(359, 300)).toBe(100);
    expect(usageLevel(360, 300)).toBe(120);
    expect(usageLevel(900, 300)).toBe(120);
  });
});
