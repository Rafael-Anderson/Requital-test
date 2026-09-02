import { describe, expect, it } from "vitest";
import { resolveProductTabs } from "./product-tabs";
import type { SectionSettings } from "./theme-config-types";

const s = (tabs: unknown): SectionSettings => ({ tabs }) as SectionSettings;

describe("resolveProductTabs", () => {
  it("returns [] when tabs is absent or not an array", () => {
    expect(resolveProductTabs(undefined)).toEqual([]);
    expect(resolveProductTabs({} as SectionSettings)).toEqual([]);
    expect(resolveProductTabs(s("nope"))).toEqual([]);
    expect(resolveProductTabs(s(null))).toEqual([]);
  });

  it("keeps only structurally-valid tabs, dropping malformed ones (no throw)", () => {
    const out = resolveProductTabs(
      s([
        { id: "a", label: "Best Selling", collectionId: 3 },
        { id: "b", label: "  ", collectionId: 4 }, // blank label
        { id: "", label: "No id", collectionId: 5 }, // empty id
        { id: "c", label: "Bad collection", collectionId: "7" }, // wrong type
        { id: "d", label: "Zero", collectionId: 0 }, // non-positive
        { label: "Missing id", collectionId: 9 }, // no id
        "garbage",
        null,
        { id: "e", label: "Seasonal", collectionId: 12 },
      ]),
    );
    expect(out).toEqual([
      { id: "a", label: "Best Selling", collectionId: 3 },
      { id: "e", label: "Seasonal", collectionId: 12 },
    ]);
  });

  it("trims the label and de-dupes by id (first wins)", () => {
    const out = resolveProductTabs(
      s([
        { id: "x", label: "  Roses  ", collectionId: 1 },
        { id: "x", label: "Roses again", collectionId: 2 },
      ]),
    );
    expect(out).toEqual([{ id: "x", label: "Roses", collectionId: 1 }]);
  });
});
