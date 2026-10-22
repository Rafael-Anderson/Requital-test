import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DeliveryDateCalendar from "./DeliveryDateCalendar";

afterEach(cleanup);

// F4: minDate is the SHOP's today (dateKeyInTimezone). The grid itself is plain
// calendar arithmetic, so it must put "today" on that day and disable what is
// before it whatever the browser's own zone says.
const prevTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
  if (prevTz === undefined) delete process.env.TZ;
  else process.env.TZ = prevTz;
});

describe("DeliveryDateCalendar in a browser outside the shop's zone", () => {
  it("marks the shop's today and disables the day before it", () => {
    // Dubai is already on the 22nd while a Los Angeles browser is still on the 21st.
    render(<DeliveryDateCalendar value="" onChange={() => {}} minDate="2026-10-22" />);
    const cell = (d: string) => document.querySelector<HTMLButtonElement>(`[data-date="${d}"]`)!;
    expect(cell("2026-10-21").disabled).toBe(true);
    expect(cell("2026-10-22").disabled).toBe(false);
    expect(cell("2026-10-22").className).toMatch(/ring-1/);
    expect(cell("2026-10-21").className).not.toMatch(/ring-1/);
    expect(screen.getByText(/October 2026/)).toBeTruthy();
  });

  it("lays out the weekday columns by calendar date (1 Oct 2026 is a Thursday)", () => {
    render(<DeliveryDateCalendar value="" onChange={() => {}} minDate="2026-10-01" />);
    const grid = document.querySelector('[role="grid"]')!;
    const first = grid.children[4]; // S M T W [T]: four blank cells, then the 1st
    expect(first.getAttribute("data-date")).toBe("2026-10-01");
  });
});
