import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CardGrid, { CARD_SPAN_FULL } from "./CardGrid";

afterEach(cleanup);

// jsdom has no layout, so the breakpoint behaviour is asserted on the classes that
// produce it: one column by default, two from lg, top-aligned, one gap, no physical
// (left/right) properties so RTL mirrors for free.
describe("CardGrid", () => {
  it("is one column below lg and two columns from lg, aligned to the top", () => {
    render(
      <CardGrid>
        <div>a</div>
        <div>b</div>
      </CardGrid>,
    );
    const classes = screen.getByTestId("card-grid").className.split(/\s+/);
    expect(classes).toContain("grid");
    expect(classes).toContain("grid-cols-1");
    expect(classes).toContain("lg:grid-cols-2");
    expect(classes).toContain("gap-4");
    expect(classes).toContain("items-start");
    // never stretched, never a fixed column count below lg
    expect(classes).not.toContain("items-stretch");
    expect(classes.filter((c) => /^(sm|md):grid-cols-/.test(c))).toEqual([]);
  });

  it("uses no physical direction utilities (RTL safe)", () => {
    render(<CardGrid />);
    expect(screen.getByTestId("card-grid").className).not.toMatch(/(^|\s)(-?m[lr]|-?p[lr]|left|right|text-(left|right))-/);
  });

  it("a card spans both columns only at lg", () => {
    expect(CARD_SPAN_FULL).toBe("lg:col-span-2");
  });
});
