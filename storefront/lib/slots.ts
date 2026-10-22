import type { DayHours } from "./types";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

// Same fallback lib/earliest-delivery.ts uses when a shop carries no timezone.
const DEFAULT_TIMEZONE = "Asia/Dubai";

// "What day and time is it for the SHOP?" The checkout used the browser clock
// for this, so a shopper (or a travelling customer ordering for home) outside
// the shop's zone saw a different "today", a different same-day cutoff and a
// different weekday than the server enforces (backend/src/public/time-slots.ts
// reads everything in shop.timezone). These mirror that file and
// lib/earliest-delivery.ts: Intl formatToParts, "24" normalised to 0, and a
// bad timezone string answers null so the caller fails closed (no same-day
// slots) instead of silently reverting to the browser's clock.
function zoneParts(now: Date, timezone: string | undefined, opts: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || DEFAULT_TIMEZONE,
      hourCycle: "h23",
      ...opts,
    }).formatToParts(now);
  } catch {
    return null; // invalid timezone string
  }
}

// YYYY-MM-DD of `now` on the shop's wall calendar, or null for an unusable timezone.
export function dateKeyInTimezone(now: Date, timezone: string | undefined): string | null {
  const parts = zoneParts(now, timezone, { year: "numeric", month: "2-digit", day: "2-digit" });
  if (!parts) return null;
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Minutes since midnight on the shop's wall clock, or null for an unusable timezone.
export function minutesSinceMidnightInTimezone(now: Date, timezone: string | undefined): number | null {
  const parts = zoneParts(now, timezone, { hour: "2-digit", minute: "2-digit" });
  if (!parts) return null;
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

// A date KEY names a calendar day, so its weekday needs no timezone at all.
// Parsed at UTC noon so no offset in either direction can move it across a
// midnight (new Date("2026-10-21") is UTC midnight, which getDay() in a
// browser west of UTC calls the 20th).
function keyToUtcNoon(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00Z`);
}

export function weekdayKeyForDateKey(dateKey: string): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[keyToUtcNoon(dateKey).getUTCDay()];
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const d = keyToUtcNoon(dateKey);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// A Date is read on the viewer's own calendar (what every caller did before
// date keys existed); a string is already a calendar day.
function asDateKey(date: Date | string): string {
  return typeof date === "string" ? date : localDateKey(date);
}

// Generates "HH:MM - HH:MM" slot labels stepping by gapMinutes across the
// open/close window for the given date's weekday. Falls back to a generic
// 9am-9pm window when no hours are configured yet (same "unset = open"
// convention the backend uses), so a shop that hasn't filled in delivery/
// pickup hours still gets a usable picker instead of an empty one.
//
// `date` is a YYYY-MM-DD calendar day (or a Date, read on the viewer's own
// calendar). `nowMinutes` is optional and only meaningful when `date` is the
// SHOP's today — pass the shop's wall-clock time as minutes-since-midnight
// (minutesSinceMidnightInTimezone; see useCheckoutForm.ts's own call site) to drop any slot whose start has
// already passed. Omitted entirely for a non-today date, since the cutoff
// only ever applies to today. This is optimistic client-side UX only — the
// backend independently regenerates and re-checks this same list at
// order-submit time (backend/src/public/time-slots.ts, hand-mirroring this
// function), since a page left open across the cutoff must still be
// rejected server-side.
export function generateTimeSlots(
  date: Date | string,
  hours: DayHours | null,
  gapMinutes: number,
  nowMinutes?: number,
): string[] {
  const day = hours?.[weekdayKeyForDateKey(asDateKey(date))];
  if (day?.closed) return [];

  const [openH, openM] = (day?.open ?? "09:00").split(":").map(Number);
  const [closeH, closeM] = (day?.close ?? "21:00").split(":").map(Number);
  let cursor = openH * 60 + openM;
  const end = closeH * 60 + closeM;
  const step = gapMinutes > 0 ? gapMinutes : 60;

  const slots: string[] = [];
  while (cursor + step <= end) {
    // A slot starting exactly "now" is still selectable — only a slot whose
    // start has strictly already passed is excluded.
    if (nowMinutes === undefined || cursor >= nowMinutes) {
      slots.push(`${formatMinutes(cursor)} - ${formatMinutes(cursor + step)}`);
    }
    cursor += step;
  }
  return slots;
}

// Same-day/next-day order acceptance gating, mirroring the backend's
// acceptance-window check — pulled out as a pure function (rather than
// left inline in the checkout page) so this real gating logic is testable
// directly instead of only through a full component render.
// YYYY-MM-DD in the viewer's own calendar. toISOString() is UTC, which in the
// Gulf (UTC+4) names yesterday for the first four hours of every day, and turns
// a local-midnight Date into the previous day's key.
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// `referenceDate` is the shop's "today" as a date key (dateKeyInTimezone), or a
// Date read on the viewer's own calendar.
export function isDateBlocked(
  deliveryDate: string,
  referenceDate: Date | string,
  allowSameDayOrders: boolean | undefined,
  allowNextDayOrders: boolean | undefined,
): boolean {
  if (!deliveryDate) return false;
  const minDate = asDateKey(referenceDate);
  const tomorrow = addDaysToDateKey(minDate, 1);
  const dateIsToday = deliveryDate === minDate;
  const dateIsTomorrow = deliveryDate === tomorrow;
  return (dateIsToday && allowSameDayOrders === false) || (dateIsTomorrow && allowNextDayOrders === false);
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}
