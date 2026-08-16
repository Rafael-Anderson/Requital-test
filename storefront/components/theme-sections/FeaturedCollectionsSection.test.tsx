import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import FeaturedCollectionsSection from "./FeaturedCollectionsSection";
import type { Collection } from "@/lib/types";
import type { SectionSettings } from "@/lib/theme-config-types";

afterEach(cleanup);

const listCollections = vi.fn();
vi.mock("@/lib/api", () => ({
  listCollections: (...args: unknown[]) => listCollections(...args) as unknown,
  resolveImageUrl: (path: string | null) => path,
}));

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "test-shop", shopBasePath: "", previewToken: undefined, previewMode: false }),
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
  };
}

describe("FeaturedCollectionsSection", () => {
  it("shows only the merchant-chosen collections, in the chosen order, when collectionIds is set", async () => {
    listCollections.mockResolvedValue([collection(1), collection(2), collection(3)]);
    const settings = { collectionIds: ["3", "1"] } as unknown as SectionSettings;

    const { findAllByRole } = render(
      <FeaturedCollectionsSection sectionId="sec-1" settings={settings} blocks={[]} />,
    );

    const links = await findAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/collections/collection-3",
      "/collections/collection-1",
    ]);
  });

  it("falls back to every top-level collection when collectionIds is unset", async () => {
    listCollections.mockResolvedValue([collection(1), collection(2)]);
    const settings = {} as unknown as SectionSettings;

    const { findAllByRole } = render(
      <FeaturedCollectionsSection sectionId="sec-1" settings={settings} blocks={[]} />,
    );

    const links = await findAllByRole("link");
    expect(links).toHaveLength(2);
  });

  it("caps the auto (no collectionIds) list at maxCollections", async () => {
    listCollections.mockResolvedValue([collection(1), collection(2), collection(3)]);
    const settings = { maxCollections: 1 } as unknown as SectionSettings;

    const { findAllByRole } = render(
      <FeaturedCollectionsSection sectionId="sec-1" settings={settings} blocks={[]} />,
    );

    const links = await findAllByRole("link");
    expect(links).toHaveLength(1);
  });
});
