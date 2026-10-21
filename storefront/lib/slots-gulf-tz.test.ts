import { beforeAll, describe, expect, it } from "vitest";
import { isDateBlocked, localDateKey } from "./slots";

// A Gulf shopper (UTC+4). Date.toISOString() is UTC, so 01:00 local on the 21st
// used to be called the 20th, and the calendar's local-midnight reference date
// for "today" was read as yesterday.
beforeAll(() => {
  process.env.TZ = "Asia/Dubai";
});

describe("local date keys in a UTC+4 browser", () => {
  it("names the viewer's own day, even just after local midnight", () => {
    expect(localDateKey(new Date(2026, 9, 21, 1, 0))).toBe("2026-10-21");
    expect(localDateKey(new Date(2026, 9, 21, 23, 30))).toBe("2026-10-21");
  });

  it("applies same-day and next-day blocks to the right calendar days", () => {
    const todayMidnight = new Date("2026-10-21T00:00:00");
    expect(isDateBlocked("2026-10-21", todayMidnight, false, true)).toBe(true);
    expect(isDateBlocked("2026-10-20", todayMidnight, false, true)).toBe(false);
    expect(isDateBlocked("2026-10-22", todayMidnight, true, false)).toBe(true);
    expect(isDateBlocked("2026-10-21", todayMidnight, true, false)).toBe(false);
  });
});
