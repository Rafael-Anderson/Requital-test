import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import BrandPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

let mockBrandId = "1";
vi.mock("next/navigation", () => ({
  useParams: () => ({ shop: "test-shop", brandId: mockBrandId }),
}));

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({
    shopSlug: "test-shop",
    shopBasePath: "",
    outlets: [{ id: 7 }],
    previewToken: undefined,
    shop: { currency: "AED" },
    themeConfig: null,
    autoDiscounts: [],
  }),
}));

const listBrands = vi.fn();
const listProducts = vi.fn();
vi.mock("@/lib/api", () => ({
  listBrands: (...a: unknown[]) => listBrands(...a),
  listProducts: (...a: unknown[]) => listProducts(...a),
  resolveImageUrl: (u: string | null) => u,
}));

const BRANDS = [{ id: 1, name: "Rosewood", logoUrl: "https://cdn.test/rosewood.png" }];
function product(id: number, name: string, price: string) {
  return {
    id,
    slug: `p-${id}`,
    name,
    thumbnail: "https://cdn.test/p.jpg",
    images: [],
    price,
    stockQuantity: null,
    collections: [],
    brand: { id: 1, name: "Rosewood", logoUrl: null },
  };
}

describe("BrandPage", () => {
  it("renders the brand name as the heading and lists its products filtered by brandId", async () => {
    mockBrandId = "1";
    listBrands.mockResolvedValue(BRANDS);
    listProducts.mockResolvedValue([product(10, "Rose Bouquet", "120"), product(11, "Rose Box", "90")]);

    render(<BrandPage />);

    expect(await screen.findByRole("heading", { name: "Rosewood" })).toBeInTheDocument();
    expect(screen.getByText("Rose Bouquet")).toBeInTheDocument();
    expect(screen.getByText("2 products")).toBeInTheDocument();
    // brandId (6th arg) forwarded to listProducts
    expect(listProducts).toHaveBeenCalledWith("test-shop", 7, undefined, undefined, undefined, 1);
  });

  it("shows an empty state when the brand has no products", async () => {
    mockBrandId = "1";
    listBrands.mockResolvedValue(BRANDS);
    listProducts.mockResolvedValue([]);

    render(<BrandPage />);

    expect(await screen.findByText(/No products from this brand yet/i)).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown brand id", async () => {
    mockBrandId = "999";
    listBrands.mockResolvedValue(BRANDS);
    listProducts.mockResolvedValue([]);

    render(<BrandPage />);

    expect(await screen.findByRole("heading", { name: "Brand not found" })).toBeInTheDocument();
  });
});
