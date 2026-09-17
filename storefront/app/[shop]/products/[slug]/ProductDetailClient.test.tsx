import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ProductDetailClient from "./ProductDetailClient";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// jsdom has no IntersectionObserver (used by the sticky-mobile-CTA effect,
// irrelevant to what's under test here) — same stubGlobal pattern as
// ScrollAnimatedWrapper.test.tsx, just a no-op since nothing here drives it.
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

vi.mock("next/navigation", () => ({
  useParams: () => ({ shop: "test-shop", slug: "test-product" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({
    shopSlug: "test-shop",
    shopBasePath: "",
    shop: {
      currency: "AED",
      estimatedDeliveryTimeFrom: 30,
      estimatedDeliveryTimeTo: 60,
      estimatedDeliveryTimeUnit: "minutes",
      productImageZoomEnabled: false,
      disableStoreCart: false,
    },
    outlets: [{ id: 1, deliveryEnabled: true, pickupEnabled: false }],
    previewToken: undefined,
    autoDiscounts: [],
    themeConfig: null,
  }),
}));

vi.mock("@/lib/cart", () => ({
  useCart: () => ({ addItem: vi.fn(), clear: vi.fn() }),
}));

vi.mock("@/lib/fly-to-cart", () => ({
  useFlyToCart: () => ({ flyToCart: vi.fn() }),
}));

const getProductBySlug = vi.fn();
vi.mock("@/lib/api", () => ({
  getProductBySlug: (...a: unknown[]) => getProductBySlug(...a),
  listProducts: () => Promise.resolve([]),
  listCollections: () => Promise.resolve([]),
}));

// Unrelated subtrees — irrelevant to the stock/delivery-time line under test.
vi.mock("@/components/ProductGallery", () => ({ default: () => null }));
vi.mock("@/components/RelatedProducts", () => ({ default: () => null }));
vi.mock("@/components/NotifyMeForm", () => ({ default: () => null }));
vi.mock("@/components/AdditionalInfoAccordion", () => ({ default: () => null }));
vi.mock("@/components/BnplWidgetCard", () => ({ default: () => null }));

function fakeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: "test-product",
    name: "Test Product",
    thumbnail: "https://cdn.test/p.jpg",
    images: [],
    price: "100",
    compareAtPrice: null,
    isNew: false,
    sku: "SKU1",
    status: "Available",
    trackInventory: true,
    hasVariants: false,
    variants: [],
    options: [],
    stockQuantity: 20,
    isGiftCard: false,
    giftCardDenominations: null,
    collections: [],
    description: null,
    estimatedDeliveryTimeFrom: null,
    estimatedDeliveryTimeTo: null,
    estimatedDeliveryTimeUnit: null,
    ...overrides,
  };
}

// The stock/delivery-time line renders as two adjacent text nodes
// ({"● "}{label}) inside one <span>, so an exact-string text query never
// matches the concatenated content — assert against the span's own
// textContent instead.
function findStockLine(text: string) {
  return screen.findByText((_, element) => element?.tagName.toLowerCase() === "span" && element.textContent === text);
}
function queryStockLine(text: string) {
  return screen.queryByText((_, element) => element?.tagName.toLowerCase() === "span" && element.textContent === text);
}

describe("ProductDetailClient — stock/delivery-time line", () => {
  it("shows the shop-default delivery estimate for a product with no override", async () => {
    getProductBySlug.mockResolvedValue(fakeProduct());
    render(<ProductDetailClient />);

    expect(await findStockLine("● Delivered in 30-60 minutes")).toBeInTheDocument();
    expect(queryStockLine("● In stock")).not.toBeInTheDocument();
  });

  it("shows the product's own override instead of the shop default", async () => {
    getProductBySlug.mockResolvedValue(
      fakeProduct({
        estimatedDeliveryTimeFrom: 1,
        estimatedDeliveryTimeTo: 1,
        estimatedDeliveryTimeUnit: "days",
      }),
    );
    render(<ProductDetailClient />);

    expect(await findStockLine("● Delivered next day")).toBeInTheDocument();
    expect(queryStockLine("● Delivered in 30-60 minutes")).not.toBeInTheDocument();
  });

  it("shows Out of stock, never a delivery estimate, when stock is genuinely zero", async () => {
    getProductBySlug.mockResolvedValue(fakeProduct({ stockQuantity: 0 }));
    render(<ProductDetailClient />);

    expect(await findStockLine("● Out of stock")).toBeInTheDocument();
    expect(
      screen.queryByText((_, element) => Boolean(element?.textContent?.startsWith("● Delivered"))),
    ).not.toBeInTheDocument();
  });
});
