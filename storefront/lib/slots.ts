import type { DayHours } from "./types";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

// Mirrors the backend's outlet-status weekday key derivation, but for a
// specific calendar date the customer picked rather than "now".
function weekdayKey(date: Date): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[date.getDay()];
}

// Generates "HH:MM - HH:MM" slot labels stepping by gapMinutes across the
// open/close window for the given date's weekday. Falls back to a generic
// 9am-9pm window when no hours are configured yet (same "unset = open"
// convention the backend uses), so a shop that hasn't filled in delivery/
// pickup hours still gets a usable picker instead of an empty one.
export function generateTimeSlots(date: Date, hours: DayHours | null, gapMinutes: number): string[] {
  const day = hours?.[weekdayKey(date)];
  if (day?.closed) return [];

  const [openH, openM] = (day?.open ?? "09:00").split(":").map(Number);
  const [closeH, closeM] = (day?.close ?? "21:00").split(":").map(Number);
  let cursor = openH * 60 + openM;
  const end = closeH * 60 + closeM;
  const step = gapMinutes > 0 ? gapMinutes : 60;

  const slots: string[] = [];
  while (cursor + step <= end) {
    slots.push(`${formatMinutes(cursor)} - ${formatMinutes(cursor + step)}`);
    cursor += step;
  }
  return slots;
}

// Same-day/next-day order acceptance gating, mirroring the backend's
// acceptance-window check — pulled out as a pure function (rather than
// left inline in the checkout page) so this real gating logic is testable
// directly instead of only through a full component render.
export function isDateBlocked(
  deliveryDate: string,
  referenceDate: Date,
  allowSameDayOrders: boolean | undefined,
  allowNextDayOrders: boolean | undefined,
): boolean {
  if (!deliveryDate) return false;
  const minDate = referenceDate.toISOString().slice(0, 10);
  const tomorrow = new Date(referenceDate.getTime() + 86400000).toISOString().slice(0, 10);
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
