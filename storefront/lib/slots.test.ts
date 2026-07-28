import { describe, expect, it } from "vitest";
import { generateTimeSlots, isDateBlocked } from "./slots";
import type { DayHours } from "./types";

// A Wednesday.
const wed = new Date("2026-07-22T12:00:00");

describe("generateTimeSlots", () => {
  it("falls back to a 9am-9pm window when no hours are configured", () => {
    const slots = generateTimeSlots(wed, null, 60);
    expect(slots[0]).toBe("9:00 AM - 10:00 AM");
    expect(slots.at(-1)).toBe("8:00 PM - 9:00 PM");
    expect(slots).toHaveLength(12);
  });

  it("returns no slots when the day is marked closed", () => {
    const hours = { wed: { closed: true, open: "09:00", close: "21:00" } } as unknown as DayHours;
    expect(generateTimeSlots(wed, hours, 60)).toEqual([]);
  });

  it("respects a configured open/close window and gap", () => {
    const hours = { wed: { closed: false, open: "10:00", close: "12:00" } } as unknown as DayHours;
    expect(generateTimeSlots(wed, hours, 30)).toEqual([
      "10:00 AM - 10:30 AM",
      "10:30 AM - 11:00 AM",
      "11:00 AM - 11:30 AM",
      "11:30 AM - 12:00 PM",
    ]);
  });

  it("treats a non-positive gap as 60 minutes", () => {
    const hours = { wed: { closed: false, open: "10:00", close: "12:00" } } as unknown as DayHours;
    expect(generateTimeSlots(wed, hours, 0)).toEqual(["10:00 AM - 11:00 AM", "11:00 AM - 12:00 PM"]);
  });

  it("drops a trailing partial slot that doesn't fit before close", () => {
    const hours = { wed: { closed: false, open: "10:00", close: "11:15" } } as unknown as DayHours;
    expect(generateTimeSlots(wed, hours, 60)).toEqual(["10:00 AM - 11:00 AM"]);
  });
});

describe("isDateBlocked", () => {
  const today = new Date("2026-07-22T09:00:00");
  const todayStr = "2026-07-22";
  const tomorrowStr = "2026-07-23";

  it("does not block when no date is picked yet", () => {
    expect(isDateBlocked("", today, false, false)).toBe(false);
  });

  it("blocks a same-day pick when same-day orders are disabled", () => {
    expect(isDateBlocked(todayStr, today, false, true)).toBe(true);
  });

  it("allows a same-day pick when same-day orders are enabled (or unset)", () => {
    expect(isDateBlocked(todayStr, today, true, true)).toBe(false);
    expect(isDateBlocked(todayStr, today, undefined, true)).toBe(false);
  });

  it("blocks a next-day pick when next-day orders are disabled", () => {
    expect(isDateBlocked(tomorrowStr, today, true, false)).toBe(true);
  });

  it("does not block dates further out regardless of the flags", () => {
    expect(isDateBlocked("2026-07-30", today, false, false)).toBe(false);
  });
});
