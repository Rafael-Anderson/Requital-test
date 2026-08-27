import { dateKeyInTimezone } from '../outlets/outlet-status';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

interface DayHours {
  open: string;
  close: string;
  closed: boolean;
}

type WeekHours = Partial<Record<(typeof WEEKDAYS)[number], DayHours>>;

function weekdayKeyInTimezone(
  date: Date,
  timezone: string,
): (typeof WEEKDAYS)[number] {
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  })
    .format(date)
    .toLowerCase();
  return WEEKDAYS.find((d) => short.startsWith(d)) ?? 'sun';
}

// Same technique outlet-status.ts's computeIsOpen already uses to read
// "now" in shop-local wall-clock terms, just returned as raw minutes
// instead of separate hour/minute parts.
function minutesSinceMidnightInTimezone(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// Hand-mirrors storefront lib/slots.ts's generateTimeSlots exactly (no
// shared package between the two apps — same convention as every other
// frontend/backend-duplicated validator in this codebase), plus a same-day
// cutoff the storefront copy applies for UX but this copy is what actually
// enforces it: PublicService.createOrder regenerates this same list
// server-side and checks the submitted deliveryTimeSlot is a member of it,
// so a stale/spoofed request (page left open past the cutoff, or a client
// that skips the filtering entirely) can't submit an already-passed slot.
// `now` is an explicit parameter, not read internally, so callers/tests can
// pin it.
export function generateValidTimeSlots(
  targetDate: Date,
  hours: WeekHours | null | undefined,
  gapMinutes: number,
  timezone: string,
  now: Date,
): string[] {
  const day = hours?.[weekdayKeyInTimezone(targetDate, timezone)];
  if (day?.closed) return [];

  const [openH, openM] = (day?.open ?? '09:00').split(':').map(Number);
  const [closeH, closeM] = (day?.close ?? '21:00').split(':').map(Number);
  let cursor = openH * 60 + openM;
  const end = closeH * 60 + closeM;
  const step = gapMinutes > 0 ? gapMinutes : 60;

  const isToday =
    dateKeyInTimezone(targetDate, timezone) === dateKeyInTimezone(now, timezone);
  const nowMinutes = isToday
    ? minutesSinceMidnightInTimezone(now, timezone)
    : -Infinity;

  const slots: string[] = [];
  while (cursor + step <= end) {
    // A slot starting exactly "now" is still selectable — only a slot whose
    // start has strictly already passed is excluded (matches the task's own
    // "slots before 8:00 PM must not be selectable" framing).
    if (cursor >= nowMinutes) {
      slots.push(`${formatMinutes(cursor)} - ${formatMinutes(cursor + step)}`);
    }
    cursor += step;
  }
  return slots;
}
