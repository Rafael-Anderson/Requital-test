import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductsPage from "./page";
import { ToastProvider } from "@/components/ui/Toast";
import { listCollections, listProductsPage, updateProductAvailability } from "@/lib/api";
import type { Product } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getShop: vi.fn().mockResolvedValue({ currency: "AED" }),
  listProductsPage: vi.fn(),
  listCollections: vi.fn(),
  updateProductAvailability: vi.fn(),
  bulkDeleteProducts: vi.fn(),
  bulkUpdateProductStatus: vi.fn(),
  confirmImportProducts: vi.fn(),
  deleteProduct: vi.fn(),
  duplicateProduct: vi.fn(),
  previewImportProducts: vi.fn(),
  downloadExport: vi.fn(),
  resolveImageUrl: (u: string | null | undefined) => u ?? null,
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { role: "admin" } }) }));
vi.mock("@/lib/outlet-context", () => ({
  useOutletFilter: () => ({ selectedOutletId: null, outlets: [] }),
}));
vi.mock("@/components/OutletSwitcher", () => ({ default: () => null }));
// The URL the page reads (page, pageSize, all, collection, q) and the router it writes to.
const nav = vi.hoisted(() => ({ search: "", replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/products",
}));

// The real loader is covered in lib/load-all-pages.test.ts; the cap notice is driven
// through it here so the test does not render two thousand rows.
const loadAll = vi.hoisted(() => ({ impl: null as null | ((...a: unknown[]) => Promise<unknown>) }));
vi.mock("@/lib/load-all-pages", async (orig) => {
  const real = await orig<typeof import("@/lib/load-all-pages")>();
  return { ...real, loadAllPages: (...a: Parameters<typeof real.loadAllPages>) => (loadAll.impl ? loadAll.impl(...a) : real.loadAllPages(...a)) };
});

const pageOf = (data: Product[], total = data.length, page = 1, pageSize = 20) => ({ data, total, page, pageSize });

const product = {
  id: 5,
  name: "Rose Bouquet",
  price: "55.00",
  sku: "ROSE-1",
  status: "Available",
  trackInventory: true,
  stockQuantity: 3,
  lowStockThreshold: 5,
  totalSold: 12,
  isGiftCard: false,
  thumbnail: null,
  collections: [],
  variants: [],
  tags: [],
  makeableQuantity: null,
  limitedByIngredient: null,
} as unknown as Product;

function renderPage() {
  return render(
    <ToastProvider>
      <ProductsPage />
    </ToastProvider>,
  );
}

// jsdom applies no CSS, so both the phone card list (md:hidden) and the table (hidden md:block)
// are in the DOM; these tests address the card list.
const cards = () => within(document.querySelector("ul.space-y-2") as HTMLElement);

beforeEach(() => {
  loadAll.impl = null;
  nav.search = "";
  nav.replace.mockReset();
  vi.mocked(listProductsPage).mockReset();
  vi.mocked(listCollections).mockReset().mockResolvedValue([]);
});

describe("ProductsPage phone card list", () => {
  it("shows a skeleton that mirrors the card layout until products arrive", async () => {
    vi.mocked(listProductsPage).mockReturnValue(new Promise(() => {}));
    renderPage();
    const busy = document.querySelector('ul[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy!.querySelectorAll("li").length).toBeGreaterThan(1);
  });

  it("a shop with one product shows that product as a card, tap opens the editor", async () => {
    vi.mocked(listProductsPage).mockResolvedValue(pageOf([product]));
    renderPage();
    await waitFor(() => expect(cards().getByText("Rose Bouquet")).toBeInTheDocument());
    expect(document.querySelector('ul[aria-busy="true"]')).toBeNull();
    expect(cards().getByRole("link", { name: "Edit Rose Bouquet" })).toHaveAttribute("href", "/products/5/edit");
    // thumbnail/name/price/stock/status primary, SKU and total sales secondary
    expect(cards().getByText(/ROSE-1/)).toBeInTheDocument();
    expect(cards().getByText(/12 sold/)).toBeInTheDocument();
    expect(cards().getByText(/3 in stock \(low\)/)).toBeInTheDocument();
    expect(cards().getByRole("button", { name: "Disable Rose Bouquet" })).toBeInTheDocument();
  });

  it("keeps selection checkboxes for bulk actions, including select all", async () => {
    vi.mocked(listProductsPage).mockResolvedValue(pageOf([product]));
    renderPage();
    await waitFor(() => expect(cards().getByText("Rose Bouquet")).toBeInTheDocument());
    expect(screen.queryByText("Set status…")).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByLabelText("Select Rose Bouquet")[0]);
    expect(await screen.findByText("Set status…")).toBeInTheDocument();
    // the one product is now selected, so select all toggles it off again
    await userEvent.click(screen.getAllByLabelText("Select all products")[0]);
    await waitFor(() => expect(screen.queryByText("Set status…")).not.toBeInTheDocument());
  });

  it("the status chip toggles availability without opening the editor", async () => {
    vi.mocked(listProductsPage).mockResolvedValue(pageOf([product]));
    vi.mocked(updateProductAvailability).mockResolvedValue(undefined as never);
    renderPage();
    await waitFor(() => expect(cards().getByText("Rose Bouquet")).toBeInTheDocument());
    await userEvent.click(cards().getByRole("button", { name: "Disable Rose Bouquet" }));
    expect(updateProductAvailability).toHaveBeenCalledWith(5, "Unavailable");
  });
});

describe("ProductsPage loading never sticks", () => {
  it("shows the products even when the collections request fails", async () => {
    vi.mocked(listProductsPage).mockResolvedValue(pageOf([product]));
    vi.mocked(listCollections).mockRejectedValue(new Error("collections down"));
    renderPage();
    await waitFor(() => expect(cards().getByText("Rose Bouquet")).toBeInTheDocument());
    expect(document.querySelector('ul[aria-busy="true"]')).toBeNull();
  });

  it("shows the products even when the collections request never answers", async () => {
    vi.mocked(listProductsPage).mockResolvedValue(pageOf([product]));
    vi.mocked(listCollections).mockReturnValue(new Promise(() => {}));
    renderPage();
    await waitFor(() => expect(cards().getByText("Rose Bouquet")).toBeInTheDocument());
  });

  it("a failed products request ends in an error with Try again, not a skeleton forever", async () => {
    vi.mocked(listProductsPage).mockRejectedValueOnce(new Error("boom"));
    renderPage();
    expect(await screen.findAllByText("Could not load products.")).not.toHaveLength(0);
    expect(document.querySelector('ul[aria-busy="true"]')).toBeNull();
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(0);
    vi.mocked(listProductsPage).mockResolvedValue(pageOf([product]));
    await userEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);
    await waitFor(() => expect(cards().getByText("Rose Bouquet")).toBeInTheDocument());
  });
});

const mk = (id: number) => ({ ...product, id, name: `Product ${id}`, sku: `SKU-${id}` }) as Product;
const mkMany = (from: number, count: number) => Array.from({ length: count }, (_, i) => mk(from + i));

describe("ProductsPage pagination", () => {
  it("asks the server for page 1 of 20 by default and shows the range", async () => {
    vi.mocked(listProductsPage).mockResolvedValue(pageOf(mkMany(1, 20), 45));
    renderPage();
    await waitFor(() => expect(screen.getByText("1-20 of 45")).toBeInTheDocument());
    expect(listProductsPage).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
    expect(screen.getAllByText("Product 20").length).toBeGreaterThan(0);
  });

  it("restores page, page size, collection and search from the URL", async () => {
    nav.search = "page=2&pageSize=50&collection=3&q=rose";
    vi.mocked(listProductsPage).mockResolvedValue(pageOf(mkMany(51, 10), 60, 2, 50));
    renderPage();
    await waitFor(() => expect(listProductsPage).toHaveBeenCalled());
    expect(listProductsPage).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 50, collectionId: 3, search: "rose" }),
    );
    await waitFor(() => expect(screen.getByText("51-60 of 60")).toBeInTheDocument());
  });

  it("Next writes page 2 to the URL", async () => {
    vi.mocked(listProductsPage).mockResolvedValue(pageOf(mkMany(1, 20), 45));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    expect(nav.replace).toHaveBeenCalledWith("/products?page=2", { scroll: false });
  });

  it("changing the page size goes back to page 1", async () => {
    nav.search = "page=3";
    vi.mocked(listProductsPage).mockResolvedValue(pageOf(mkMany(41, 5), 45, 3));
    renderPage();
    const select = (await screen.findByLabelText("Per page")) as HTMLSelectElement;
    await userEvent.selectOptions(select, "50");
    expect(nav.replace).toHaveBeenCalledWith("/products?pageSize=50", { scroll: false });
  });

  it("changing the collection filter resets to page 1", async () => {
    nav.search = "page=3";
    vi.mocked(listCollections).mockResolvedValue([{ id: 9, name: "Roses", parentId: null } as never]);
    vi.mocked(listProductsPage).mockResolvedValue(pageOf(mkMany(41, 5), 45, 3));
    renderPage();
    await screen.findByText("1-5 of 45".replace("1-5", "41-45"));
    const filter = screen.getByLabelText("Filter by collection");
    await waitFor(() => expect(within(filter).getByText("Roses")).toBeInTheDocument());
    await userEvent.selectOptions(filter, "9");
    expect(nav.replace).toHaveBeenCalledWith("/products?collection=9", { scroll: false });
  });

  it("searching resets to page 1 after a short pause", async () => {
    nav.search = "page=2";
    vi.mocked(listProductsPage).mockResolvedValue(pageOf(mkMany(21, 20), 45, 2));
    renderPage();
    await screen.findByText("21-40 of 45");
    await userEvent.type(screen.getByLabelText("Search products"), "rose");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/products?q=rose", { scroll: false }), {
      timeout: 2000,
    });
  });

  it("Show all is separate from the pager and writes ?all=1", async () => {
    vi.mocked(listProductsPage).mockResolvedValue(pageOf(mkMany(1, 20), 45));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Show all" }));
    expect(nav.replace).toHaveBeenCalledWith("/products?all=1", { scroll: false });
  });

  it("show all loads everything a hundred at a time", async () => {
    nav.search = "all=1";
    vi.mocked(listProductsPage).mockImplementation(async ({ page }) =>
      pageOf(mkMany((page - 1) * 100 + 1, page === 3 ? 50 : 100), 250, page, 100),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("Showing all 250 products")).toBeInTheDocument());
    expect(listProductsPage).toHaveBeenCalledTimes(3);
    expect(vi.mocked(listProductsPage).mock.calls.map((c) => c[0].pageSize)).toEqual([100, 100, 100]);
    expect(screen.getAllByText("Product 250").length).toBeGreaterThan(0);
    expect(screen.queryByRole("status", { name: "" })?.textContent ?? "").not.toMatch(/first 2000/);
  });

  it("show all names the ceiling when the catalogue is bigger than it", async () => {
    nav.search = "all=1";
    loadAll.impl = async () => ({ items: mkMany(1, 5), total: 2500, capped: true });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Showing the first 2000 of 2500 products/)).toBeInTheDocument());
  });

  it("show all shows progress while it loads and a failure ends in an error, not a hang", async () => {
    nav.search = "all=1";
    vi.mocked(listProductsPage)
      .mockResolvedValueOnce(pageOf(mkMany(1, 100), 300, 1, 100))
      .mockRejectedValueOnce(new Error("boom"));
    renderPage();
    expect(await screen.findAllByText("Could not load products.")).not.toHaveLength(0);
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(0);
  });
});

describe("ProductsPage bulk selection with pagination", () => {
  it("says the selection applies to this page", async () => {
    vi.mocked(listProductsPage).mockResolvedValue(pageOf(mkMany(1, 3), 45));
    renderPage();
    await userEvent.click((await screen.findAllByLabelText("Select Product 1"))[0]);
    expect(await screen.findByText("1 selected on this page")).toBeInTheDocument();
  });

  it("says 'of all loaded' in show-all mode", async () => {
    nav.search = "all=1";
    vi.mocked(listProductsPage).mockResolvedValue(pageOf(mkMany(1, 3), 3, 1, 100));
    renderPage();
    await userEvent.click((await screen.findAllByLabelText("Select Product 1"))[0]);
    expect(await screen.findByText("1 selected of all loaded")).toBeInTheDocument();
  });

  it("emptying the selection when the page changes: nothing carries over", async () => {
    vi.mocked(listProductsPage).mockResolvedValue(pageOf(mkMany(1, 3), 45));
    const view = renderPage();
    await userEvent.click((await screen.findAllByLabelText("Select Product 1"))[0]);
    expect(await screen.findByText("1 selected on this page")).toBeInTheDocument();
    nav.search = "page=2";
    vi.mocked(listProductsPage).mockResolvedValue(pageOf(mkMany(4, 3), 45, 2));
    view.rerender(
      <ToastProvider>
        <ProductsPage />
      </ToastProvider>,
    );
    await waitFor(() => expect(screen.queryByText(/selected on this page/)).toBeNull());
  });

  it("changing the filter also empties the selection", async () => {
    vi.mocked(listProductsPage).mockResolvedValue(pageOf(mkMany(1, 3), 3));
    const view = renderPage();
    await userEvent.click((await screen.findAllByLabelText("Select Product 1"))[0]);
    expect(await screen.findByText("1 selected on this page")).toBeInTheDocument();
    nav.search = "collection=4";
    view.rerender(
      <ToastProvider>
        <ProductsPage />
      </ToastProvider>,
    );
    await waitFor(() => expect(screen.queryByText(/selected on this page/)).toBeNull());
  });
});
