import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CollectionPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ shop: "test-shop", slug: "roses" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/collections/roses",
  useSearchParams: () => new URLSearchParams(),
}));

let mockThemeConfig: unknown = null;
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({
    shopSlug: "test-shop",
    shopBasePath: "",
    shop: { currency: "AED", productDisplayOrientation: "grid" },
    outlets: [{ id: 7 }],
    previewToken: undefined,
    themeConfig: mockThemeConfig,
    autoDiscounts: [],
    loading: false,
    error: null,
  }),
}));

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/components/ProductCard", () => ({ default: () => null }));
vi.mock("@/components/PriceRangeSlider", () => ({ default: () => null }));

let mockCollectionImage: string | null = null;
vi.mock("@/lib/api", () => ({
  HttpError: class HttpError extends Error {
    status = 0;
  },
  getCollectionBySlug: vi.fn(() =>
    Promise.resolve({
      id: 1,
      name: "Roses",
      slug: "roses",
      image: mockCollectionImage,
      description: "Fresh cut roses",
      parentCollectionId: null,
      products: [],
    }),
  ),
  listCollections: vi.fn(() => Promise.resolve([])),
  listBrands: vi.fn(() => Promise.resolve([])),
  resolveImageUrl: (u: string | null) => u,
}));

function themeWith(collectionPage: Record<string, unknown>) {
  return { globalSettings: { collectionPage: { columns: 3, fontSize: 15, loadMoreStyle: "infinite", ...collectionPage } } };
}

describe("collection page banner", () => {
  it("with NO image renders no banner area at all: just a plain title block with the heading and breadcrumb", async () => {
    mockCollectionImage = null;
    mockThemeConfig = null;
    const { container } = render(<CollectionPage />);
    const block = await screen.findByTestId("collection-title-block");
    expect(screen.getByRole("heading", { name: "Roses" })).toBeInTheDocument();
    expect(block).toContainElement(screen.getByRole("heading", { name: "Roses" }));
    expect(screen.getByText("Fresh cut roses")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    // no tinted banner block and no banner image
    expect(container.querySelector(".theme-banner-h")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("E6F5F3");
  });

  it("the no-image title block follows the alignment and spacing settings", async () => {
    mockCollectionImage = null;
    mockThemeConfig = themeWith({ noBannerTitleAlign: "center", noBannerTitleSpacingTop: 40, noBannerTitleSpacingBottom: 8 });
    render(<CollectionPage />);
    const block = await screen.findByTestId("collection-title-block");
    expect(block.style.textAlign).toBe("center");
    expect(block.style.paddingTop).toBe("40px");
    expect(block.style.paddingBottom).toBe("8px");
  });

  it("an out-of-range spacing is clamped, never trusted", async () => {
    mockCollectionImage = null;
    mockThemeConfig = themeWith({ noBannerTitleSpacingTop: 99999, noBannerTitleSpacingBottom: -50 });
    render(<CollectionPage />);
    const block = await screen.findByTestId("collection-title-block");
    expect(block.style.paddingTop).toBe("200px");
    expect(block.style.paddingBottom).toBe("0px");
  });

  it("WITH an image the banner renders as before: 220px on desktop and mobile when nothing was set", async () => {
    mockCollectionImage = "https://cdn.test/roses.jpg";
    mockThemeConfig = null;
    const { container } = render(<CollectionPage />);
    await screen.findByRole("heading", { name: "Roses" });
    const banner = container.querySelector(".theme-banner-h") as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.style.getPropertyValue("--theme-banner-h")).toBe("220px");
    expect(banner.style.getPropertyValue("--theme-banner-h-m")).toBe("220px");
    const img = banner.querySelector("img") as HTMLImageElement;
    expect(img.className).toContain("object-cover");
    expect(img.className).toContain("w-full");
    expect(screen.queryByTestId("collection-title-block")).toBeNull();
  });

  it("the banner height setting applies per breakpoint and is clamped to 120 to 900", async () => {
    mockCollectionImage = "https://cdn.test/roses.jpg";
    mockThemeConfig = themeWith({ bannerHeight: 480, bannerMobileHeight: 50 });
    const { container } = render(<CollectionPage />);
    await screen.findByRole("heading", { name: "Roses" });
    const banner = container.querySelector(".theme-banner-h") as HTMLElement;
    expect(banner.style.getPropertyValue("--theme-banner-h")).toBe("480px");
    expect(banner.style.getPropertyValue("--theme-banner-h-m")).toBe("120px");
  });
});
