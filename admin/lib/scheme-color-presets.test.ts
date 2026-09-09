import { describe, expect, it } from "vitest";
import { schemeColorPresets } from "./scheme-color-presets";
import type { ColorScheme } from "./types";

function scheme(over: Partial<ColorScheme>): ColorScheme {
  return {
    id: "s",
    name: "Scheme 1",
    background: "#ffffff",
    text: "#111111",
    button: "#3355ff",
    buttonLabel: "#ffffff",
    secondaryButtonLabel: "#000000",
    ...over,
  };
}

describe("schemeColorPresets", () => {
  it("returns [] for undefined / empty", () => {
    expect(schemeColorPresets(undefined)).toEqual([]);
    expect(schemeColorPresets([])).toEqual([]);
  });

  it("flattens a scheme's roles, first occurrence wins the label, dupes dropped", () => {
    const out = schemeColorPresets([scheme({ name: "Main" })]);
    // background/text/button distinct; buttonLabel #ffffff dupes background -> dropped
    expect(out).toEqual([
      { label: "Main background", value: "#ffffff" },
      { label: "Main text", value: "#111111" },
      { label: "Main button", value: "#3355ff" },
    ]);
  });

  it("skips non-hex values and caps at 16", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      scheme({
        name: `S${i}`,
        background: `#${i}${i}${i}${i}${i}${i}`,
        text: "not-a-hex",
        button: `#a${i}a${i}a${i}`,
        buttonLabel: `#b${i}b${i}b${i}`,
      }),
    );
    const out = schemeColorPresets(many);
    expect(out.length).toBe(16);
    expect(out.every((p) => /^#[0-9a-f]{6}$/i.test(p.value))).toBe(true);
  });
});
