import { describe, expect, it } from "vitest";
import { defaultBusinessHours, summarizeHours } from "./business-hours";

describe("summarizeHours", () => {
  it("describes a uniform week", () => {
    expect(summarizeHours(defaultBusinessHours())).toBe("Every day, 09:00 to 18:00");
  });
  it("treats missing hours as the default week", () => {
    expect(summarizeHours(null)).toBe("Every day, 09:00 to 18:00");
  });
  it("counts open days when some are closed", () => {
    const h = defaultBusinessHours();
    h.sat.closed = true;
    h.sun.closed = true;
    expect(summarizeHours(h)).toBe("5 of 7 days, 09:00 to 18:00");
  });
  it("says when hours differ between open days", () => {
    const h = defaultBusinessHours();
    h.fri.close = "14:00";
    expect(summarizeHours(h)).toBe("7 of 7 days (hours vary)");
  });
  it("says closed when every day is closed", () => {
    const h = defaultBusinessHours();
    for (const d of Object.keys(h) as (keyof typeof h)[]) h[d].closed = true;
    expect(summarizeHours(h)).toBe("Closed every day");
  });
});
