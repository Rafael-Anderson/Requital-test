import { describe, expect, it } from "vitest";
import { resolveScheme } from "./theme-color-scheme";
import type { ColorScheme } from "./theme-config-types";

function scheme(overrides: Partial<ColorScheme> = {}): ColorScheme {
  return {
    id: "scheme-1",
    name: "Scheme 1",
    background: "#ffffff",
    text: "#000000",
    button: "#069494",
    buttonLabel: "#ffffff",
    secondaryButtonLabel: "#069494",
    ...overrides,
  };
}

describe("resolveScheme", () => {
  it("returns null when schemeId is undefined", () => {
    expect(resolveScheme(undefined, [scheme()])).toBeNull();
  });

  it("returns null when schemeId doesn't match any known scheme", () => {
    expect(resolveScheme("scheme-missing", [scheme()])).toBeNull();
  });

  it("returns the matching scheme by id", () => {
    const target = scheme({ id: "scheme-2", name: "Dark" });
    const result = resolveScheme("scheme-2", [scheme(), target]);
    expect(result).toEqual(target);
  });

  it("returns null against an empty schemes list", () => {
    expect(resolveScheme("scheme-1", [])).toBeNull();
  });
});
