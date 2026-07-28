import { describe, expect, it } from "vitest";
import { iconStyleProps } from "./icon-style";

describe("iconStyleProps", () => {
  it("outline (default/undefined): no fill, uses the caller's stroke width", () => {
    expect(iconStyleProps(undefined, 1.75)).toEqual({ fill: "none", strokeWidth: 1.75 });
    expect(iconStyleProps("outline", 2)).toEqual({ fill: "none", strokeWidth: 2 });
  });

  it("solid: fills with currentColor and drops to a hairline stroke, regardless of the caller's requested stroke width", () => {
    expect(iconStyleProps("solid", 1.75)).toEqual({ fill: "currentColor", strokeWidth: 0.5 });
    expect(iconStyleProps("solid", 2)).toEqual({ fill: "currentColor", strokeWidth: 0.5 });
  });
});
