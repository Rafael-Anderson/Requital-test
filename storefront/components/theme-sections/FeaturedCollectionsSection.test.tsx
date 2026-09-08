import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import FeaturedCollectionsSection from "./FeaturedCollectionsSection";
import type { Collection } from "@/lib/types";
import type { SectionSettings } from "@/lib/theme-config-types";

afterEach(() => {
  cleanup();
  themeConfig = undefined;
});

function headerWithViewAll(viewAllSettings: Record<string, unknown>) {
  return [
    {
      id: "hdr",
      type: "collection_header",
      visible: true,
      order: 0,
      settings: {},
      blocks: [
        { id: "vt", type: "collection_title", visible: true, order: 0, settings: { text: "Shop" } },
        { id: "va", type: "view_all_button", visible: true, order: 1, settings: { label: "View all", ...viewAllSettings } },
      ],
    },
  ] as unknown as Parameters<typeof FeaturedCollectionsSection>[0]["blocks"];
}

const listCollections = vi.fn();
vi.mock("@/lib/api", () => ({
  listCollections: (...args: unknown[]) => listCollections(...args) as unknown,
  resolveImageUrl: (path: string | null) => path,
}));

let themeConfig: unknown = undefined;
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "test-shop", shopBasePath: "", previewToken: undefined, previewMode: false, themeConfig }),
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

  describe("view_all_button (§8.13.C item 2)", () => {
    it("no-op: unset style ⇒ the plain accent text link, no border, no theme-btn-*", async () => {
      listCollections.mockResolvedValue([collection(1)]);
      const { findByText } = render(
        <FeaturedCollectionsSection sectionId="s" settings={{} as SectionSettings} blocks={headerWithViewAll({})} />,
      );
      const el = await findByText("View all");
      expect(el.tagName).toBe("A");
      expect(el.className).toContain("text-accent");
      expect(el.className).toContain("hover:underline");
      expect(el.className).not.toMatch(/theme-btn-/);
      expect(el.getAttribute("style") ?? "").not.toContain("border");
    });

    it("style: 'button' ⇒ an outline secondary button with border + no hover:underline", async () => {
      listCollections.mockResolvedValue([collection(1)]);
      const { findByText } = render(
        <FeaturedCollectionsSection sectionId="s" settings={{} as SectionSettings} blocks={headerWithViewAll({ style: "button" })} />,
      );
      const el = await findByText("View all");
      expect(el.tagName).toBe("A");
      expect(el.className).not.toContain("hover:underline");
      expect(el.className).toContain("inline-block");
      expect(el.getAttribute("style") ?? "").toContain("border-style: solid");
      expect(el.getAttribute("style") ?? "").not.toContain("background");
    });

    it("style: 'button' + buttons.secondary.hoverEffect 'border-fill' ⇒ theme-btn-border-fill in the class", async () => {
      themeConfig = { globalSettings: { buttons: { secondary: { hoverEffect: "border-fill" } } } };
      listCollections.mockResolvedValue([collection(1)]);
      const { findByText } = render(
        <FeaturedCollectionsSection sectionId="s" settings={{} as SectionSettings} blocks={headerWithViewAll({ style: "button" })} />,
      );
      const el = await findByText("View all");
      expect(el.className).toContain("theme-btn-border-fill");
    });
  });

  describe("tile grid controls (Phase 4)", () => {
    it("defaults to sm:grid-cols-4 / aspect-square / name below when unset", async () => {
      listCollections.mockResolvedValue([{ ...collection(1), image: "/img.jpg" }]);
      const { container, findByText } = render(
        <FeaturedCollectionsSection sectionId="s" settings={{} as SectionSettings} blocks={[]} />,
      );
      await findByText("Collection 1");
      expect(container.querySelector(".grid.sm\\:grid-cols-4")).not.toBeNull();
      expect(container.querySelector(".aspect-square")).not.toBeNull();
      // name rendered as the <p> below, not an overlay <span>
      expect(container.querySelector("p.truncate")?.textContent).toBe("Collection 1");
    });

    it("applies columns / aspectRatio and moves the name into an overlay when overlayText is on", async () => {
      listCollections.mockResolvedValue([{ ...collection(1), image: "/img.jpg" }]);
      const settings = { columns: 3, aspectRatio: "portrait", overlayText: true } as unknown as SectionSettings;
      const { container, findByText } = render(
        <FeaturedCollectionsSection sectionId="s" settings={settings} blocks={[]} />,
      );
      await findByText("Collection 1");
      expect(container.querySelector(".grid.sm\\:grid-cols-3")).not.toBeNull();
      expect(container.querySelector(".aspect-\\[3\\/4\\]")).not.toBeNull();
      expect(container.querySelector("p.truncate")).toBeNull();
      expect(container.querySelector("span.text-white")?.textContent).toBe("Collection 1");
    });

    it("supports up to 8 columns for the large-tile grid", async () => {
      listCollections.mockResolvedValue([{ ...collection(1), image: "/img.jpg" }]);
      const settings = { columns: 8 } as unknown as SectionSettings;
      const { container, findByText } = render(
        <FeaturedCollectionsSection sectionId="s" settings={settings} blocks={[]} />,
      );
      await findByText("Collection 1");
      expect(container.querySelector(".grid.sm\\:grid-cols-8")).not.toBeNull();
    });
  });

  describe("quick_icons display style (#9/#14)", () => {
    it("renders a scrollable circular-icon row, not the tile grid, and caps at 20", async () => {
      listCollections.mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => ({ ...collection(i + 1), image: `/img-${i}.jpg` })),
      );
      const settings = { displayStyle: "quick_icons" } as unknown as SectionSettings;
      const { container, findAllByRole } = render(
        <FeaturedCollectionsSection sectionId="s" settings={settings} blocks={[]} />,
      );
      const links = await findAllByRole("link");
      expect(links).toHaveLength(20); // QUICK_ICONS_MAX
      expect(container.querySelector(".grid")).toBeNull(); // no tile grid
      expect(container.querySelector(".overflow-x-auto")).not.toBeNull();
      expect(container.querySelector(".rounded-full")).not.toBeNull();
    });

    it("falls back to a first-letter monogram circle when a collection has no image", async () => {
      listCollections.mockResolvedValue([{ ...collection(1), name: "Roses", image: null }]);
      const settings = { displayStyle: "quick_icons" } as unknown as SectionSettings;
      const { findByText } = render(
        <FeaturedCollectionsSection sectionId="s" settings={settings} blocks={[]} />,
      );
      expect((await findByText("R")).className).toContain("uppercase");
    });
  });
});
