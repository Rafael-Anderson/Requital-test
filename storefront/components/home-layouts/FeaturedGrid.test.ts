import { describe, expect, it } from "vitest";
import { selectTiles } from "./FeaturedGrid";
import type { Category } from "@/lib/types";

function category(overrides: Partial<Category>): Category {
  return {
    id: 1,
    name: "Category",
    slug: "category",
    displayOrder: 0,
    image: null,
    isFeatured: false,
    parentCategoryId: null,
    ...overrides,
  };
}

describe("selectTiles", () => {
  it("excludes subcategories — only top-level categories become tiles", () => {
    const tiles = selectTiles([
      category({ id: 1, name: "Flowers", parentCategoryId: null }),
      category({ id: 2, name: "Roses", parentCategoryId: 1 }),
    ]);
    expect(tiles.map((c) => c.id)).toEqual([1]);
  });

  it("sorts featured categories first, then by displayOrder", () => {
    const tiles = selectTiles([
      category({ id: 1, name: "A", displayOrder: 0, isFeatured: false }),
      category({ id: 2, name: "B", displayOrder: 1, isFeatured: true }),
      category({ id: 3, name: "C", displayOrder: 0, isFeatured: false }),
    ]);
    expect(tiles.map((c) => c.id)).toEqual([2, 1, 3]);
  });

  it("returns every top-level category when none are marked featured, rather than an empty grid", () => {
    const tiles = selectTiles([category({ id: 1 }), category({ id: 2 })]);
    expect(tiles).toHaveLength(2);
  });

  it("returns an empty array for a shop with no categories yet", () => {
    expect(selectTiles([])).toEqual([]);
  });
});
