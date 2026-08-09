import { describe, expect, it } from "vitest";
import { gridClassName, selectTiles, tileClassName } from "./FeaturedGrid";
import type { Collection } from "@/lib/types";

function collection(overrides: Partial<Collection>): Collection {
  return {
    id: 1,
    name: "Collection",
    slug: "collection",
    displayOrder: 0,
    image: null,
    isFeatured: false,
    parentCollectionId: null,
    ...overrides,
  };
}

describe("selectTiles", () => {
  it("excludes subcollections — only top-level collections become tiles", () => {
    const tiles = selectTiles([
      collection({ id: 1, name: "Flowers", parentCollectionId: null }),
      collection({ id: 2, name: "Roses", parentCollectionId: 1 }),
    ]);
    expect(tiles.map((c) => c.id)).toEqual([1]);
  });

  it("sorts featured collections first, then by displayOrder", () => {
    const tiles = selectTiles([
      collection({ id: 1, name: "A", displayOrder: 0, isFeatured: false }),
      collection({ id: 2, name: "B", displayOrder: 1, isFeatured: true }),
      collection({ id: 3, name: "C", displayOrder: 0, isFeatured: false }),
    ]);
    expect(tiles.map((c) => c.id)).toEqual([2, 1, 3]);
  });

  it("returns every top-level collection when none are marked featured, rather than an empty grid", () => {
    const tiles = selectTiles([collection({ id: 1 }), collection({ id: 2 })]);
    expect(tiles).toHaveLength(2);
  });

  it("returns an empty array for a shop with no collections yet", () => {
    expect(selectTiles([])).toEqual([]);
  });
});

describe("gridClassName", () => {
  it("uses a single column for 0 or 1 tiles", () => {
    expect(gridClassName(0)).toContain("grid-cols-1");
    expect(gridClassName(1)).toContain("grid-cols-1");
  });

  it("uses two equal columns for 2 tiles", () => {
    expect(gridClassName(2)).toBe("grid grid-cols-2 gap-3");
  });

  it("uses two columns for 3 tiles (third tile spans full width via tileClassName)", () => {
    expect(gridClassName(3)).toBe("grid grid-cols-2 gap-3");
  });

  it("keeps the original 2x4 responsive grid unchanged for 4+ tiles", () => {
    expect(gridClassName(4)).toBe("grid grid-cols-2 sm:grid-cols-4 gap-3");
    expect(gridClassName(5)).toBe("grid grid-cols-2 sm:grid-cols-4 gap-3");
  });
});

describe("tileClassName", () => {
  it("spans the third tile across both columns only when there are exactly 3 tiles", () => {
    expect(tileClassName(3, 2)).toBe("col-span-2");
    expect(tileClassName(3, 0)).toBe("");
    expect(tileClassName(3, 1)).toBe("");
  });

  it("never spans for counts other than 3", () => {
    expect(tileClassName(4, 2)).toBe("");
    expect(tileClassName(2, 1)).toBe("");
    expect(tileClassName(1, 0)).toBe("");
  });
});
