// The "orders this month" window of a shop: the calendar month in the shop's own
// timezone (docs/plans/phase3-billing.md section 8.1), as UTC instants for
// `createdAt >= start AND createdAt < end`. Pure; no DST assumption (an offset is
// re-derived at each boundary), though every Gulf zone is fixed-offset.
const FALLBACK_TZ = 'Asia/Dubai';

// Offset of `tz` from UTC at `instant`, in ms (positive east of Greenwich).
function offsetMs(instant: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(instant)
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return local - Math.floor(instant.getTime() / 1000) * 1000;
}

// 00:00 on the first of (year, month0) in `tz`, as a UTC instant.
function monthStart(year: number, month0: number, tz: string): Date {
  const naive = Date.UTC(year, month0, 1);
  const first = naive - offsetMs(new Date(naive), tz);
  return new Date(naive - offsetMs(new Date(first), tz));
}

export interface UsagePeriod {
  periodKey: string; // 'YYYY-MM' in the shop's timezone
  start: Date;
  endExclusive: Date;
}

export function currentUsagePeriod(now: Date, timezone: string): UsagePeriod {
  let tz = timezone;
  try {
    offsetMs(now, tz);
  } catch {
    tz = FALLBACK_TZ; // an unknown tz string must not break a read-only page
  }
  const [y, m] = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  })
    .format(now)
    .split('-')
    .map(Number);
  const next = m === 12 ? [y + 1, 0] : [y, m];
  return {
    periodKey: `${y}-${String(m).padStart(2, '0')}`,
    start: monthStart(y, m - 1, tz),
    endExclusive: monthStart(next[0], next[1], tz),
  };
}

// 0 below 80%, then the highest of 80 / 100 / 120 reached (section 8.3). Messaging
// levels only: nothing in the backend reads this to block anything.
export function usageLevel(used: number, ceiling: number | null): 0 | 80 | 100 | 120 {
  if (ceiling == null || ceiling <= 0) return 0;
  const pct = (used / ceiling) * 100;
  return pct >= 120 ? 120 : pct >= 100 ? 100 : pct >= 80 ? 80 : 0;
}
