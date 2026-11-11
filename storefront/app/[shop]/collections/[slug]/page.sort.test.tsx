import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "node:fs";
import path from "node:path";
import CollectionPage from "./page";
import { COLLECTION_SORT_KEYS } from "@/lib/collection-sort";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

let mockQuery = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ shop: "test-shop", slug: "roses" }),
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/collections/roses",
  useSearchParams: () => new URLSearchParams(mockQuery),
}));
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({
    shopSlug: "test-shop",
    shopBasePath: "",
    shop: { currency: "AED", productDisplayOrientation: "grid" },
    outlets: [{ id: 7 }],
    previewToken: undefined,
    themeConfig: null,
    autoDiscounts: [],
    loading: false,
    error: null,
  }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/components/PriceRangeSlider", () => ({ default: () => null }));
vi.mock("@/components/ProductCard", () => ({
  default: ({ product }: { product: { name: string } }) => <li data-testid="product">{product.name}</li>,
}));

let mockDefaultSort: string | null = null;
const P = (id: number, name: string, price: string, salesCount: number) => ({
  id, name, price, salesCount, slug: `p${id}`, thumbnail: "", images: [], stockQuantity: null, collections: [], brand: null,
});
vi.mock("@/lib/api", () => ({
  HttpError: class HttpError extends Error { status = 0; },
  getCollectionBySlug: vi.fn(() =>
    Promise.resolve({
      id: 1, name: "Roses", slug: "roses", image: null, description: null, parentCollectionId: null,
      defaultSort: mockDefaultSort,
      products: [P(1, "Alpha", "50", 5), P(2, "Bravo", "10", 90), P(3, "Charlie", "30", 1), P(4, "Delta", "20", 40)],
    }),
  ),
  listCollections: vi.fn(() => Promise.resolve([])),
  listBrands: vi.fn(() => Promise.resolve([])),
  resolveImageUrl: (u: string | null) => u,
}));

const names = () => screen.getAllByTestId("product").map((n) => n.textContent);

describe("collection page default sort", () => {
  it("no default and no ?sort=: Newest, exactly as before (highest id first)", async () => {
    mockQuery = ""; mockDefaultSort = null;
    render(<CollectionPage />);
    await screen.findAllByTestId("product");
    expect(names()).toEqual(["Delta", "Charlie", "Bravo", "Alpha"]);
  });

  it("opens in the collection's default, and the sort control already shows it", async () => {
    mockQuery = ""; mockDefaultSort = "price_asc";
    render(<CollectionPage />);
    await screen.findAllByTestId("product");
    expect(names()).toEqual(["Bravo", "Delta", "Charlie", "Alpha"]); // 10, 20, 30, 50
    expect(screen.getByRole("button", { name: /Price: Low to High/ })).toBeInTheDocument();
  });

  it("best selling uses the existing salesCount ordering", async () => {
    mockQuery = ""; mockDefaultSort = "best_selling";
    render(<CollectionPage />);
    await screen.findAllByTestId("product");
    expect(names()).toEqual(["Bravo", "Delta", "Alpha", "Charlie"]); // 90, 40, 5, 1
  });

  it("an explicit ?sort= in the link always wins over the default", async () => {
    mockQuery = "sort=price_desc"; mockDefaultSort = "price_asc";
    render(<CollectionPage />);
    await screen.findAllByTestId("product");
    expect(names()).toEqual(["Alpha", "Charlie", "Delta", "Bravo"]);
  });

  it("an unknown ?sort= or default is ignored, falling back to Newest", async () => {
    mockQuery = "sort=popular"; mockDefaultSort = "nonsense";
    render(<CollectionPage />);
    await screen.findAllByTestId("product");
    expect(names()).toEqual(["Delta", "Charlie", "Bravo", "Alpha"]);
  });

  it("the very first painted list is already in the default order (no Newest-first flash)", async () => {
    mockQuery = ""; mockDefaultSort = "az";
    const seen: string[][] = [];
    const { container } = render(<CollectionPage />);
    const obs = new MutationObserver(() => {
      const list = Array.from(container.querySelectorAll("[data-testid=product]")).map((n) => n.textContent ?? "");
      if (list.length) seen.push(list);
    });
    obs.observe(container, { childList: true, subtree: true });
    await screen.findAllByTestId("product");
    await new Promise((r) => setTimeout(r, 50));
    obs.disconnect();
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    for (const list of seen) expect(list).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
  });

  it("the customer can still change it, and the choice is written to the link", async () => {
    const user = userEvent.setup();
    mockQuery = ""; mockDefaultSort = "price_asc";
    render(<CollectionPage />);
    await screen.findAllByTestId("product");
    await user.click(screen.getByRole("button", { name: /Price: Low to High/ }));
    await user.click(await screen.findByRole("option", { name: "Best Selling" }));
    await waitFor(() => expect(names()).toEqual(["Bravo", "Delta", "Alpha", "Charlie"]));
    expect(replace).toHaveBeenCalledWith("/collections/roses?sort=best_selling", { scroll: false });
  });

  it("the page's own sort options are exactly the keys a collection default may use", () => {
    const src = fs.readFileSync(path.join(__dirname, "page.tsx"), "utf8");
    const block = src.slice(src.indexOf("const SORT_OPTIONS"), src.indexOf("] as const;", src.indexOf("const SORT_OPTIONS")));
    const keys = Array.from(block.matchAll(/value: "([a-z_]+)"/g)).map((m) => m[1]);
    expect(keys.sort()).toEqual([...COLLECTION_SORT_KEYS].sort());
  });
});
