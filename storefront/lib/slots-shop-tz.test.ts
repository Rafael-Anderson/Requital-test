import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDaysToDateKey,
  dateKeyInTimezone,
  generateTimeSlots,
  isDateBlocked,
  minutesSinceMidnightInTimezone,
  weekdayKeyForDateKey,
} from "./slots";
import type { DayHours } from "./types";

// F4: the checkout read "today", the same-day cutoff and the weekday off the
// BROWSER clock, while the server enforces them in shop.timezone
// (backend/src/public/time-slots.ts). The browser here is in Los Angeles
// (UTC-7 in October); the shop is in Dubai (UTC+4), eleven hours ahead.
const prevTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
  if (prevTz === undefined) delete process.env.TZ;
  else process.env.TZ = prevTz;
});

// 2026-10-21 22:30Z = 02:30 on Thursday 22 October in Dubai, but still
// 15:30 on Wednesday 21 October in Los Angeles.
const NOW = new Date("2026-10-21T22:30:00Z");
const hours = { wed: { closed: false, open: "10:00", close: "12:00" }, thu: { closed: false, open: "09:00", close: "12:00" } } as unknown as DayHours;

describe("the shop's own calendar and clock", () => {
  it("names the shop's day, not the browser's", () => {
    expect(dateKeyInTimezone(NOW, "Asia/Dubai")).toBe("2026-10-22");
    expect(dateKeyInTimezone(NOW, "America/Los_Angeles")).toBe("2026-10-21");
    // the browser's own local reading is the one that is wrong for this shop
    expect(NOW.getDate()).toBe(21);
  });

  it("reads wall-clock minutes in the shop's zone", () => {
    expect(minutesSinceMidnightInTimezone(NOW, "Asia/Dubai")).toBe(2 * 60 + 30);
    expect(minutesSinceMidnightInTimezone(NOW, "America/Los_Angeles")).toBe(15 * 60 + 30);
    // midnight is 0, never 24 (engines that emit "24" with a 12h-off cycle)
    expect(minutesSinceMidnightInTimezone(new Date("2026-10-21T20:00:00Z"), "Asia/Dubai")).toBe(0);
  });

  it("falls back to Asia/Dubai when the shop carries no timezone, like the earliest-delivery label", () => {
    expect(dateKeyInTimezone(NOW, undefined)).toBe("2026-10-22");
    expect(dateKeyInTimezone(NOW, "")).toBe("2026-10-22");
  });

  it("fails closed (null) on an invalid timezone instead of reverting to the browser clock", () => {
    expect(dateKeyInTimezone(NOW, "Not/AZone")).toBeNull();
    expect(minutesSinceMidnightInTimezone(NOW, "Not/AZone")).toBeNull();
  });
});

describe("weekday of a calendar day does not depend on the browser zone", () => {
  it("a date key is read at UTC noon", () => {
    expect(weekdayKeyForDateKey("2026-10-21")).toBe("wed");
    expect(weekdayKeyForDateKey("2026-10-22")).toBe("thu");
    // the old derivation: a date-only string is UTC midnight, which is still the
    // previous day on a Los Angeles browser
    expect(WEEKDAYS_OLD[new Date("2026-10-21").getDay()]).toBe("tue");
  });

  it("picks Thursday's hours for Thursday's key on a Los Angeles browser", () => {
    expect(generateTimeSlots("2026-10-22", hours, 60)[0]).toBe("9:00 AM - 10:00 AM");
    expect(generateTimeSlots("2026-10-21", hours, 60)[0]).toBe("10:00 AM - 11:00 AM");
  });

  it("walks month and year ends without the browser's DST or offset", () => {
    expect(addDaysToDateKey("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateKey("2026-03-08", 1)).toBe("2026-03-09"); // a US DST change day
  });
});

describe("same-day cutoff uses the shop's clock", () => {
  const open = { thu: { closed: false, open: "09:00", close: "21:00" } } as unknown as DayHours;

  it("14:00 in Dubai drops every slot before 2 PM even though it is 03:00 in Los Angeles", () => {
    const at = new Date("2026-10-22T10:00:00Z"); // 14:00 Dubai, 03:00 LA
    const today = dateKeyInTimezone(at, "Asia/Dubai")!;
    const slots = generateTimeSlots(today, open, 60, minutesSinceMidnightInTimezone(at, "Asia/Dubai")!);
    expect(slots[0]).toBe("2:00 PM - 3:00 PM");
    // the browser's own reading would have offered the whole day
    expect(generateTimeSlots(today, open, 60, minutesSinceMidnightInTimezone(at, "America/Los_Angeles")!)).toHaveLength(12);
  });

  it("after the shop has closed there is nothing left today", () => {
    const at = new Date("2026-10-22T18:30:00Z"); // 22:30 Dubai
    const today = dateKeyInTimezone(at, "Asia/Dubai")!;
    expect(generateTimeSlots(today, open, 60, minutesSinceMidnightInTimezone(at, "Asia/Dubai")!)).toEqual([]);
  });
});

describe("same-day and next-day blocks use the shop's today", () => {
  it("blocks the shop's today and tomorrow, not the browser's", () => {
    const today = dateKeyInTimezone(NOW, "Asia/Dubai")!; // 2026-10-22
    expect(isDateBlocked("2026-10-22", today, false, true)).toBe(true);
    expect(isDateBlocked("2026-10-21", today, false, true)).toBe(false);
    expect(isDateBlocked("2026-10-23", today, true, false)).toBe(true);
    expect(isDateBlocked("2026-10-22", today, true, false)).toBe(false);
  });

  it("still reads a Date on the viewer's own calendar (older callers)", () => {
    const localToday = new Date(2026, 9, 21, 12, 0);
    expect(isDateBlocked("2026-10-21", localToday, false, true)).toBe(true);
    expect(isDateBlocked("2026-10-22", localToday, true, false)).toBe(true);
  });
});

const WEEKDAYS_OLD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
