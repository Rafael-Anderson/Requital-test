import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductsPage from "./page";
import { ToastProvider } from "@/components/ui/Toast";
import { listCollections, listProducts, updateProductAvailability } from "@/lib/api";
import type { Product } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getShop: vi.fn().mockResolvedValue({ currency: "AED" }),
  listProducts: vi.fn(),
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/products",
}));

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
  vi.mocked(listProducts).mockReset();
  vi.mocked(listCollections).mockReset().mockResolvedValue([]);
});

describe("ProductsPage phone card list", () => {
  it("shows a skeleton that mirrors the card layout until products arrive", async () => {
    vi.mocked(listProducts).mockReturnValue(new Promise(() => {}));
    renderPage();
    const busy = document.querySelector('ul[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy!.querySelectorAll("li").length).toBeGreaterThan(1);
  });

  it("a shop with one product shows that product as a card, tap opens the editor", async () => {
    vi.mocked(listProducts).mockResolvedValue([product]);
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
    vi.mocked(listProducts).mockResolvedValue([product]);
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
    vi.mocked(listProducts).mockResolvedValue([product]);
    vi.mocked(updateProductAvailability).mockResolvedValue(undefined as never);
    renderPage();
    await waitFor(() => expect(cards().getByText("Rose Bouquet")).toBeInTheDocument());
    await userEvent.click(cards().getByRole("button", { name: "Disable Rose Bouquet" }));
    expect(updateProductAvailability).toHaveBeenCalledWith(5, "Unavailable");
  });
});

describe("ProductsPage loading never sticks", () => {
  it("shows the products even when the collections request fails", async () => {
    vi.mocked(listProducts).mockResolvedValue([product]);
    vi.mocked(listCollections).mockRejectedValue(new Error("collections down"));
    renderPage();
    await waitFor(() => expect(cards().getByText("Rose Bouquet")).toBeInTheDocument());
    expect(document.querySelector('ul[aria-busy="true"]')).toBeNull();
  });

  it("shows the products even when the collections request never answers", async () => {
    vi.mocked(listProducts).mockResolvedValue([product]);
    vi.mocked(listCollections).mockReturnValue(new Promise(() => {}));
    renderPage();
    await waitFor(() => expect(cards().getByText("Rose Bouquet")).toBeInTheDocument());
  });

  it("a failed products request ends in an error with Try again, not a skeleton forever", async () => {
    vi.mocked(listProducts).mockRejectedValueOnce(new Error("boom"));
    renderPage();
    expect(await screen.findAllByText("Could not load products.")).not.toHaveLength(0);
    expect(document.querySelector('ul[aria-busy="true"]')).toBeNull();
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(0);
    vi.mocked(listProducts).mockResolvedValue([product]);
    await userEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);
    await waitFor(() => expect(cards().getByText("Rose Bouquet")).toBeInTheDocument());
  });
});
