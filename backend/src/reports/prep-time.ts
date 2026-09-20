// Pure aggregation for the prep-time truth report, split out so the stats are
// testable without a database.
//
// Why the measured pair is confirmed -> out_for_delivery: `confirmed` is the
// moment the shop accepted responsibility for the order, `out_for_delivery` is
// the moment it left. That span is what a merchant is implicitly promising
// when they set a preparation time. confirmed -> preparing is queue time (the
// order is sitting untouched), and preparing -> out_for_delivery is the
// hands-on portion - reported alongside as `handsOnMedianMinutes`, since a
// long total with a short hands-on time is a staffing problem, not a recipe
// problem, and the merchant can only tell those apart if both are shown.

export interface PrepTimeSample {
  outletId: number;
  outletName: string;
  // When the order was confirmed, used for the day-of-week bucket.
  confirmedAt: Date;
  totalMinutes: number;
  // Null-safe rather than expected: the status machine refuses
  // confirmed -> out_for_delivery directly, so in practice every measured
  // order has a preparing step. Kept nullable for orders whose log predates
  // a transition being recorded at all.
  handsOnMinutes: number | null;
}

export interface PrepTimeBucket {
  outletId: number;
  outletName: string;
  // 0 = Sunday, matching JS getDay(), resolved in the SHOP's timezone.
  dayOfWeek: number;
  orderCount: number;
  medianMinutes: number;
  averageMinutes: number;
  // The slowest 10% boundary. A median that looks fine while p90 is triple it
  // is the case a merchant most needs to see.
  p90Minutes: number;
  handsOnMedianMinutes: number | null;
}

const DAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// Day-of-week in the shop's own timezone, not the server's. A 01:00 Dubai
// order is the previous day in UTC, and bucketing it there would quietly
// shift a chunk of every shop's evening trade into the wrong column - the
// same class of error dateKeyInTimezone already exists to prevent for dates.
export function dayOfWeekInTimezone(date: Date, timezone: string): number {
  try {
    const short = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    }).format(date);
    return DAY_INDEX[short] ?? date.getDay();
  } catch {
    // An invalid timezone must not take the whole report down; fall back to
    // the server's own reckoning, same fail-open shape as
    // resolveEarliestDeliveryLabel.
    return date.getDay();
  }
}

export function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  // Nearest-rank on an already-sorted array. Deliberately not interpolating:
  // these are whole-minute operational numbers a merchant compares against a
  // whole-minute setting, and an interpolated 37.4 reads as false precision.
  const rank = Math.ceil(fraction * sortedValues.length);
  return sortedValues[Math.min(rank, sortedValues.length) - 1];
}

export function median(sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0;
  const mid = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[mid - 1] + sortedValues[mid]) / 2
    : sortedValues[mid];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// One bucket per (outlet, day-of-week) that actually has orders. Empty
// buckets are omitted rather than zero-filled: a zero would read as "0
// minutes", when it means "no orders that day".
export function bucketPrepTimes(
  samples: PrepTimeSample[],
  timezone: string,
): PrepTimeBucket[] {
  const groups = new Map<string, PrepTimeSample[]>();
  for (const sample of samples) {
    const dow = dayOfWeekInTimezone(sample.confirmedAt, timezone);
    const key = `${sample.outletId}:${dow}`;
    const list = groups.get(key) ?? [];
    list.push(sample);
    groups.set(key, list);
  }

  const buckets: PrepTimeBucket[] = [];
  for (const [key, list] of groups) {
    const [outletId, dayOfWeek] = key.split(':').map(Number);
    const totals = list.map((s) => s.totalMinutes).sort((a, b) => a - b);
    const handsOn = list
      .map((s) => s.handsOnMinutes)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    buckets.push({
      outletId,
      outletName: list[0].outletName,
      dayOfWeek,
      orderCount: list.length,
      medianMinutes: round1(median(totals)),
      averageMinutes: round1(
        totals.reduce((sum, v) => sum + v, 0) / totals.length,
      ),
      p90Minutes: round1(percentile(totals, 0.9)),
      handsOnMedianMinutes: handsOn.length > 0 ? round1(median(handsOn)) : null,
    });
  }

  return buckets.sort(
    (a, b) =>
      a.outletName.localeCompare(b.outletName) || a.dayOfWeek - b.dayOfWeek,
  );
}
