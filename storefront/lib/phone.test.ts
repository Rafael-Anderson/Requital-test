import { describe, expect, it } from "vitest";
import { sanitizePhoneInput } from "./phone";

describe("sanitizePhoneInput", () => {
  it("keeps digits, spaces, hyphens", () => {
    expect(sanitizePhoneInput("050 123-4567")).toBe("050 123-4567");
  });

  it("strips letters and symbols", () => {
    expect(sanitizePhoneInput("abc050!@#123")).toBe("050123");
  });

  it("keeps only a single leading plus", () => {
    expect(sanitizePhoneInput("+971 50 123")).toBe("+971 50 123");
  });

  it("strips a plus that isn't leading", () => {
    expect(sanitizePhoneInput("050+123")).toBe("050123");
  });

  it("drops a plus typed after other characters were entered", () => {
    // e.g. user types "05", then moves cursor to the start and types "+"
    // after already having non-leading content — sanitizer only preserves
    // a leading "+", it doesn't reconstruct cursor-position intent.
    expect(sanitizePhoneInput("05+0123")).toBe("050123");
  });
});
