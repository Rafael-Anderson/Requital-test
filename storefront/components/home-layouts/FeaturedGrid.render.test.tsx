import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import FeaturedGrid from "./FeaturedGrid";
import type { Collection } from "@/lib/types";

afterEach(cleanup);

// FeaturedGrid and ClassicHero both call useShop() unconditionally — mocked
// here since this suite is only exercising the tile-count/grid-structure
// logic below it.
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shop: null, shopBasePath: "" }),
}));

function collection(id: number): Collection {
  return {
    id,
    name: `Collection ${id}`,
    slug: `collection-${id}`,
    displayOrder: id,
    image: null,
    isFeatured: false,
    parentCollectionId: null,
    description: null,
  };
}

function renderGrid(count: number) {
  const collections = Array.from({ length: count }, (_, i) => collection(i + 1));
  return render(
    <FeaturedGrid bannerUrl={null} heroText={null} collections={collections} />,
  );
}

describe("FeaturedGrid structure", () => {
  it("renders no tile container at all with 0 collections", () => {
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

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, resolveImageUrl: (p: string | null) => p };
});

describe("FeaturedGrid: thumbnails use the Icon", () => {
  it("shows the Icon, not the banner, and falls back to the banner when there is no Icon", () => {
    const collections = [
      { ...collection(1), image: "/banner-1.jpg", icon: "/icon-1.png" },
      { ...collection(2), image: "/banner-2.jpg", icon: null },
    ];
    const { container } = render(<FeaturedGrid bannerUrl={null} heroText={null} collections={collections} />);
    expect(Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"))).toEqual(["/icon-1.png", "/banner-2.jpg"]);
  });
});

