import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import CollectionShowcase from "./CollectionShowcase";
import type { Collection, Shop } from "@/lib/types";

afterEach(cleanup);

const listCollections = vi.fn();
vi.mock("@/lib/api", () => ({
  listCollections: (...args: unknown[]) => listCollections(...args) as unknown,
  resolveImageUrl: (path: string | null) => path,
}));

let mockShop: Partial<Shop> | null = null;
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "test-shop", shopBasePath: "", shop: mockShop }),
}));

function collection(id: number, overrides: Partial<Collection> = {}): Collection {
  return {
    id,
    name: `Collection ${id}`,
    slug: `collection-${id}`,
    displayOrder: id,
    image: null,
    isFeatured: false,
    parentCollectionId: null,
    description: null,
    ...overrides,
  };
}

describe("CollectionShowcase — configurable grid settings", () => {
  it("defaults to 3 columns, medium gap, portrait images, titles shown when shop has no explicit settings", async () => {
    mockShop = null;
    listCollections.mockResolvedValue([collection(1)]);
    const { container, findByText } = render(<CollectionShowcase />);
    await findByText("Collection 1");

    const grid = container.querySelector(".sm\\:grid")!;
    expect(grid.className).toContain("sm:grid-cols-3");
    expect(grid.className).toContain("gap-4");
    const tile = container.querySelector("a")!;
    expect(tile.className).toContain("aspect-[4/5]");
  });

  it("applies the shop's configured columns/gap/aspect ratio as real Tailwind classes", async () => {
    mockShop = {
      collectionsGridColumns: 2,
      collectionsGridGap: "lg",
      collectionsGridImageAspectRatio: "square",
      collectionsGridShowTitle: true,
    } as Partial<Shop>;
    listCollections.mockResolvedValue([collection(1)]);
    const { container, findByText } = render(<CollectionShowcase />);
    await findByText("Collection 1");

    const grid = container.querySelector(".sm\\:grid")!;
    expect(grid.className).toContain("sm:grid-cols-2");
    expect(grid.className).toContain("gap-6");
    const tile = container.querySelector("a")!;
    expect(tile.className).toContain("aspect-square");
  });

  it("hides the title caption on an image tile when collectionsGridShowTitle is false", async () => {
    mockShop = { collectionsGridShowTitle: false } as Partial<Shop>;
    listCollections.mockResolvedValue([collection(1, { image: "/uploads/c1.jpg" })]);
    const { queryByText, findByRole } = render(<CollectionShowcase />);
    await findByRole("link");

    expect(queryByText("Collection 1")).not.toBeInTheDocument();
  });

  it("still shows the name on an imageless tile even with collectionsGridShowTitle false — otherwise it'd be a blank rectangle", async () => {
    mockShop = { collectionsGridShowTitle: false } as Partial<Shop>;
    listCollections.mockResolvedValue([collection(1, { image: null })]);
    const { findByText } = render(<CollectionShowcase />);

    expect(await findByText("Collection 1")).toBeInTheDocument();
  });
});
