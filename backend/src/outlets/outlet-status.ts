const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

interface DayHours {
  open: string; // "HH:MM"
  close: string; // "HH:MM"
  closed: boolean;
}

// "YYYY-MM-DD" in the given timezone — en-CA formats dates in that order,
// making same-day comparison a plain string equality check. Exported for the
// storefront's same-day/next-day order-window check (PublicService), which
// needs the identical timezone-aware date-key logic this file already has.
export function dateKeyInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// The manual override auto-expires at the next day rollover (in shop
// timezone) — check-on-read, no scheduler. A null timestamp (override set
// before this field existed, or never set) is treated as already expired
// rather than indefinitely active, since there's no evidence it was set
// "today". This only affects the computed status — the raw closedOverride
// flag itself is never written back here; it only changes on an explicit
// merchant update.
function isOverrideActive(
  closedOverride: boolean,
  closedOverrideSetAt: Date | null,
  timezone: string,
): boolean {
  if (!closedOverride) return false;
  if (!closedOverrideSetAt) return false;
  return (
    dateKeyInTimezone(closedOverrideSetAt, timezone) ===
    dateKeyInTimezone(new Date(), timezone)
  );
}

// No schedule configured yet means "open" — a freshly created outlet
// shouldn't look broken just because its hours haven't been set.
export function computeIsOpen(
  businessHours: unknown,
  closedOverride: boolean,
  closedOverrideSetAt: Date | null,
  timezone: string,
): boolean {
  if (isOverrideActive(closedOverride, closedOverrideSetAt, timezone))
    return false;
  if (!businessHours || typeof businessHours !== 'object') return true;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date());

  const weekdayShort = parts
    .find((p) => p.type === 'weekday')
    ?.value.toLowerCase();
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const dayKey = WEEKDAYS.find((d) => weekdayShort?.startsWith(d));
  if (!dayKey) return true;

  const today = (businessHours as Record<string, DayHours>)[dayKey];
  if (!today || today.closed || !today.open || !today.close) return false;

  const nowMinutes = hour * 60 + minute;
  const [openH, openM] = today.open.split(':').map(Number);
  const [closeH, closeM] = today.close.split(':').map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  // Overnight span (e.g. 22:00-02:00) wraps past midnight.
  if (closeMinutes <= openMinutes) {
    return nowMinutes >= openMinutes || nowMinutes < closeMinutes;
  }
  return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
}
