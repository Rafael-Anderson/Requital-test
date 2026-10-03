import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import DateRangePicker from "./DateRangePicker";

afterEach(cleanup);

describe("DateRangePicker", () => {
  it("wraps and shrinks instead of forcing the page wider than a phone", () => {
    const { container } = render(<DateRangePicker value={{ from: "2026-09-01", to: "2026-09-30" }} onChange={vi.fn()} />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toMatch(/\bflex-wrap\b/);
    expect(row.className).toMatch(/\bmax-w-full\b/);
    for (const input of container.querySelectorAll("input")) expect(input.className).toMatch(/\bmin-w-0\b/);
  });
});
