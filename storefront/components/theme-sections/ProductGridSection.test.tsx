import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import ProductGridSection from "./ProductGridSection";
import type { Product } from "@/lib/types";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

afterEach(cleanup);

const listProducts = vi.fn();
vi.mock("@/lib/api", () => ({
  listProducts: (...args: unknown[]) => listProducts(...args) as unknown,
  resolveImageUrl: (path: string | null) => path,
}));

vi.mock("@/lib/cart", () => ({
  useCart: () => ({ addItem: vi.fn() }),
}));

// No themeConfig (productCards is undefined) — QuickAddButton never renders,
// so only the collectionId/productLimit plumbing this suite is exercising
// matters, matching FeaturedGrid.render.test.tsx's own "mock the minimum the
// component actually branches on" convention.
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({
    shopSlug: "test-shop",
    shopBasePath: "",
    shop: { currency: "AED", buttonFill: "solid" },
    outlets: [{ id: 7 }],
    themeConfig: null,
    previewToken: undefined,
    previewMode: false,
  }),
}));

function product(id: number): Product {
  return {
    id,
    slug: `product-${id}`,
    name: `Product ${id}`,
    thumbnail: "https://example.com/p.jpg",
    images: [],
    price: "10.00",
    hasVariants: false,
    isGiftCard: false,
    stockQuantity: null,
  } as unknown as Product;
}

const cardBlock: ThemeBlock = {
  id: "blk-card",
  type: "product_card",
  visible: true,
  order: 0,
  settings: {},
  blocks: [
    { id: "blk-media", type: "product_media", visible: true, order: 0, settings: {} },
    { id: "blk-title", type: "product_title", visible: true, order: 1, settings: {} },
    { id: "blk-price", type: "product_price", visible: true, order: 2, settings: {} },
  ],
};

describe("ProductGridSection", () => {
  it("passes the section's collectionId through to listProducts and slices to productLimit", async () => {
    listProducts.mockResolvedValue(Array.from({ length: 10 }, (_, i) => product(i + 1)));
    const settings = { collectionId: 42, productLimit: 3 } as unknown as SectionSettings;

    const { findAllByRole } = render(
      <ProductGridSection sectionId="sec-1" settings={settings} blocks={[cardBlock]} />,
    );

    const links = await findAllByRole("link");
    expect(links).toHaveLength(3);
    expect(listProducts).toHaveBeenCalledWith("test-shop", 7, 42, undefined, undefined);
  });

  it("passes no collection filter and falls back to the default 8-product limit when unset", async () => {
    listProducts.mockResolvedValue(Array.from({ length: 10 }, (_, i) => product(i + 1)));
    const settings = {} as unknown as SectionSettings;

    const { findAllByRole } = render(
      <ProductGridSection sectionId="sec-1" settings={settings} blocks={[cardBlock]} />,
    );

    const links = await findAllByRole("link");
    expect(links).toHaveLength(8);
    expect(listProducts).toHaveBeenCalledWith("test-shop", 7, undefined, undefined, undefined);
  });
});
