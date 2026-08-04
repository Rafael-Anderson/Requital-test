import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import FeaturedGrid from "./FeaturedGrid";
import type { Category } from "@/lib/types";

afterEach(cleanup);

// FeaturedGrid always renders ClassicHero above the tile grid, which calls
// useShop() unconditionally — mocked here since this suite is only
// exercising the tile-count/grid-structure logic below it.
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shop: null, shopSlug: "test-shop" }),
}));

function category(id: number): Category {
  return {
    id,
    name: `Category ${id}`,
    slug: `category-${id}`,
    displayOrder: id,
    image: null,
    isFeatured: false,
    parentCategoryId: null,
  };
}

function renderGrid(count: number) {
  const categories = Array.from({ length: count }, (_, i) => category(i + 1));
  return render(
    <FeaturedGrid shopSlug="test-shop" bannerUrl={null} heroText={null} categories={categories} />,
  );
}

describe("FeaturedGrid structure", () => {
  it("renders no tile container at all with 0 categories", () => {
    const { container } = renderGrid(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("renders 1 tile in a single-column grid", () => {
    const { container } = renderGrid(1);
    const grid = container.querySelector(".grid");
    expect(grid).toHaveClass("grid-cols-1");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("renders 2 tiles in a two-column grid", () => {
    const { container } = renderGrid(2);
    const grid = container.querySelector(".grid");
    expect(grid).toHaveClass("grid-cols-2");
    expect(container.querySelectorAll("a")).toHaveLength(2);
  });

  it("renders 3 tiles with the third spanning both columns", () => {
    const { container } = renderGrid(3);
    const tiles = container.querySelectorAll("a");
    expect(tiles).toHaveLength(3);
    expect(tiles[2]).toHaveClass("col-span-2");
    expect(tiles[0]).not.toHaveClass("col-span-2");
  });

  it("renders 4 tiles in the unchanged responsive 2x4 grid", () => {
    const { container } = renderGrid(4);
    const grid = container.querySelector(".grid");
    expect(grid).toHaveClass("sm:grid-cols-4");
    expect(container.querySelectorAll("a")).toHaveLength(4);
  });
});
