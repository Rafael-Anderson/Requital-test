import {
  bucketPrepTimes,
  dayOfWeekInTimezone,
  median,
  percentile,
  type PrepTimeSample,
} from './prep-time';

function sample(over: Partial<PrepTimeSample> = {}): PrepTimeSample {
  return {
    outletId: 1,
    outletName: 'Marina',
    confirmedAt: new Date('2026-09-14T09:00:00Z'), // a Monday in Dubai
    totalMinutes: 30,
    handsOnMinutes: 20,
    ...over,
  };
}

describe('median', () => {
  it('averages the middle pair for an even count', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });
  it('takes the middle value for an odd count', () => {
    expect(median([10, 20, 30])).toBe(20);
  });
  it('is 0 for no samples rather than NaN', () => {
    expect(median([])).toBe(0);
  });
});

describe('percentile', () => {
  it('uses nearest-rank, not interpolation', () => {
    // 10 values, p90 -> rank 9 -> the 9th smallest.
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], 0.9)).toBe(9);
  });
  it('never indexes past the end', () => {
    expect(percentile([5], 0.9)).toBe(5);
    expect(percentile([1, 2], 1)).toBe(2);
  });
});

describe('dayOfWeekInTimezone', () => {
  // The case that makes this function necessary: 22:30 UTC on a Sunday is
  // 02:30 Monday in Dubai. Bucketing on the server's clock would file a
  // chunk of every shop's late trade under the wrong day.
  it('uses the shop timezone, not the server', () => {
    const lateSunday = new Date('2026-09-13T22:30:00Z');
    expect(dayOfWeekInTimezone(lateSunday, 'Asia/Dubai')).toBe(1); // Monday
    expect(dayOfWeekInTimezone(lateSunday, 'UTC')).toBe(0); // Sunday
  });

  it('falls back instead of throwing on an invalid timezone', () => {
    const date = new Date('2026-09-14T09:00:00Z');
    expect(() => dayOfWeekInTimezone(date, 'Not/AZone')).not.toThrow();
    expect(dayOfWeekInTimezone(date, 'Not/AZone')).toBe(date.getDay());
  });
});

describe('bucketPrepTimes', () => {
  it('groups by outlet and day of week', () => {
    const buckets = bucketPrepTimes(
      [
        sample({ totalMinutes: 20 }),
        sample({ totalMinutes: 40 }),
        sample({
          outletId: 2,
          outletName: 'Downtown',
          totalMinutes: 60,
        }),
      ],
      'Asia/Dubai',
    );
    expect(buckets).toHaveLength(2);
    const marina = buckets.find((b) => b.outletName === 'Marina')!;
    expect(marina.orderCount).toBe(2);
    expect(marina.medianMinutes).toBe(30);
    expect(marina.averageMinutes).toBe(30);
  });

  it('reports median, average and p90 separately', () => {
    // One very slow order: the median stays calm, p90 does not. That gap is
    // the whole point of showing both.
    const buckets = bucketPrepTimes(
      [10, 12, 14, 15, 16, 18, 20, 22, 25, 240].map((m) =>
        sample({ totalMinutes: m, handsOnMinutes: null }),
      ),
      'Asia/Dubai',
    );
    expect(buckets[0].medianMinutes).toBe(17);
    expect(buckets[0].p90Minutes).toBe(25);
    expect(buckets[0].averageMinutes).toBeGreaterThan(buckets[0].medianMinutes);
  });

  it('reports hands-on time only from orders that passed through preparing', () => {
    const buckets = bucketPrepTimes(
      [
        sample({ totalMinutes: 40, handsOnMinutes: 10 }),
        sample({ totalMinutes: 40, handsOnMinutes: null }),
        sample({ totalMinutes: 40, handsOnMinutes: 20 }),
      ],
      'Asia/Dubai',
    );
    expect(buckets[0].orderCount).toBe(3);
    expect(buckets[0].handsOnMedianMinutes).toBe(15);
  });

  it('reports null hands-on rather than 0 when no order recorded preparing', () => {
    const buckets = bucketPrepTimes(
      [sample({ handsOnMinutes: null })],
      'Asia/Dubai',
    );
    expect(buckets[0].handsOnMedianMinutes).toBeNull();
  });

  // A zero would read as "0 minutes", which is a measurement. Absence is not.
  it('omits days with no orders instead of zero-filling them', () => {
    const buckets = bucketPrepTimes([sample()], 'Asia/Dubai');
    expect(buckets).toHaveLength(1);
    expect(buckets[0].dayOfWeek).toBe(1);
  });

  it('sorts by outlet name then day of week', () => {
    const buckets = bucketPrepTimes(
      [
        sample({
          outletId: 2,
          outletName: 'Zabeel',
          confirmedAt: new Date('2026-09-15T09:00:00Z'),
        }),
        sample({ confirmedAt: new Date('2026-09-15T09:00:00Z') }),
        sample(),
      ],
      'Asia/Dubai',
    );
    expect(buckets.map((b) => `${b.outletName}:${b.dayOfWeek}`)).toEqual([
      'Marina:1',
      'Marina:2',
      'Zabeel:2',
    ]);
  });

  it('returns nothing for no samples', () => {
    expect(bucketPrepTimes([], 'Asia/Dubai')).toEqual([]);
  });
});
