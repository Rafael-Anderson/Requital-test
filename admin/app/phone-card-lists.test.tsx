import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

// The remaining list pages show one tappable card per row below md (the table's trailing
// action columns are off screen on a phone) and keep the table from md up. jsdom applies no
// CSS, so both are in the DOM: these address the card list (ul.space-y-2) and check the table
// is the md-and-up one.
const impl = vi.hoisted(() => ({ map: {} as Record<string, () => Promise<unknown>> }));
const never = () => new Promise<never>(() => {});
const ok = (v: unknown) => () => Promise.resolve(v);

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const [name, fn] of Object.entries(actual)) {
    if (typeof fn === "function" && /^(list|get)[A-Z]/.test(name) && name !== "getStaffCsrfToken") {
      wrapped[name] = vi.fn(() => (impl.map[name] ?? never)());
    }
  }
  return wrapped;
});
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin", name: "Ada", email: "a@b.c", outletId: null }, loading: false }),
}));
vi.mock("@/lib/outlet-context", () => ({
  useOutletFilter: () => ({ selectedOutletId: 4, outlets: [{ id: 4, name: "Main" }], setSelectedOutletId: () => {} }),
}));
vi.mock("@/components/OutletSwitcher", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "1", outletId: "1" }),
}));

import { ToastProvider } from "@/components/ui/Toast";

beforeEach(() => {
  impl.map = {};
});
afterEach(cleanup);

const mount = (el: ReactElement) => render(<ToastProvider>{el}</ToastProvider>);
const cards = () => within(document.querySelector("ul.space-y-2") as HTMLElement);
// the list renders once the request answers
const cardsReady = () => waitFor(() => expect(document.querySelector("ul.space-y-2")).not.toBeNull());
const tableWrapper = () => document.querySelector("table")!.closest("[data-scroll-fade]")!;

describe("phone card lists", () => {
  it("suppliers: a card opens the supplier, its menu keeps edit, archive and delete, the table is md and up", async () => {
    impl.map = {
      listSuppliers: ok([
        { id: 5, shopId: 1, name: "Al Quoz Market", status: "active", paymentTerms: "Net 30", leadTimeDays: 3, currency: "AED", minimumOrderAmount: null, notes: null, createdAt: "", updatedAt: "", itemCount: 2, primaryContactName: "Hamad", primaryContactEmail: "h@x.co", primaryContactPhone: null },
      ]),
    };
    const { default: Page } = await import("./inventory/suppliers/page");
    mount(<Page />);
    await cardsReady();
    expect(await cards().findByRole("link", { name: "Open Al Quoz Market" })).toHaveAttribute("href", "/inventory/suppliers/5");
    expect(cards().getByText(/Net 30/)).toBeInTheDocument();
    await userEvent.click(cards().getByRole("button", { name: "More actions for Al Quoz Market" }));
    for (const item of ["Edit", "Archive", "Delete"]) expect(await screen.findByRole("menuitem", { name: item })).toBeInTheDocument();
    expect(tableWrapper().className).toMatch(/\bhidden\b.*\bmd:block\b/);
  });

  it("discounts: the status chip toggles without opening, tapping the card opens the editor", async () => {
    impl.map = {
      listDiscounts: ok([
        { id: 1, code: "SAVE10", discountType: "code", type: "PERCENTAGE", value: "10", minPurchaseAmount: null, appliesTo: "ALL_PRODUCTS", products: [], collections: [], usageLimit: 100, usageLimitPerCustomer: null, startsAt: null, endsAt: null, active: true, timesUsed: 4, createdAt: "", updatedAt: "" },
      ]),
      listProducts: ok([]),
      listCollections: ok([]),
    };
    const { default: Page } = await import("./products/discounts/page");
    mount(<Page />);
    await cardsReady();
    expect(await cards().findByText("SAVE10")).toBeInTheDocument();
    expect(cards().getByText(/10% off/)).toBeInTheDocument();
    expect(cards().getByRole("button", { name: "Deactivate SAVE10" })).toBeInTheDocument();
    expect(cards().getByRole("button", { name: "Edit SAVE10" })).toBeInTheDocument();
    expect(tableWrapper().className).toMatch(/\bmd:block\b/);
  });

  it("gift cards: balance and the enable/disable action are on the card", async () => {
    impl.map = {
      listGiftCards: ok([
        { id: 1, code: "GC-ABCD", initialValue: "100.00", remainingBalance: "60.00", status: "active", expiresAt: null, purchasedByCustomerId: null, purchasedByCustomer: null, purchaseOrderId: null, createdAt: "", updatedAt: "" },
      ]),
    };
    const { default: Page } = await import("./products/gift-cards/page");
    mount(<Page />);
    await cardsReady();
    expect(await cards().findByText("GC-ABCD")).toBeInTheDocument();
    expect(cards().getByText("60.00")).toBeInTheDocument();
    expect(cards().getByRole("button", { name: "Disable GC-ABCD" })).toBeInTheDocument();
  });

  it("ingredients: stock shows on the card and the stock actions stay in its menu", async () => {
    impl.map = {
      listIngredients: ok([
        { id: 3, name: "Red roses", unit: "stem", trackInventory: true, image: null, description: null, costPerUnit: null, supplier: null, categoryId: null, categoryName: "Flowers", createdAt: "", stockQuantity: 2, lowStockThreshold: 5 },
      ]),
      listIngredientCategories: ok([]),
    };
    const { default: Page } = await import("./inventory/page");
    mount(<Page />);
    await cardsReady();
    expect(await cards().findByText("Red roses")).toBeInTheDocument();
    expect(cards().getByText(/2 stem \(low\)/)).toBeInTheDocument();
    await userEvent.click(cards().getByRole("button", { name: "More actions for Red roses" }));
    for (const item of ["Edit", "Adjust stock", "Transfer stock", "Delete"]) {
      expect(await screen.findByRole("menuitem", { name: item })).toBeInTheDocument();
    }
  });

  it("branch status: both toggles are on the card", async () => {
    impl.map = {
      listOutlets: ok([{ id: 4, name: "Main Branch", pickupEnabled: true, deliveryEnabled: false }]),
    };
    const { default: Page } = await import("./orders/branch-status/page");
    mount(<Page />);
    await cardsReady();
    expect(await cards().findByText("Main Branch")).toBeInTheDocument();
    expect(cards().getByText("Accepting pickup orders")).toBeInTheDocument();
    expect(cards().getByText("Accepting delivery orders")).toBeInTheDocument();
    expect(cards().getAllByRole("switch")).toHaveLength(2);
  });

  it("tax classes: the default class has no delete in its menu", async () => {
    impl.map = {
      listTaxClasses: ok([
        { id: 1, shopId: 1, name: "Standard", rate: "5.00", type: "standard", isDefault: true, createdAt: "", updatedAt: "" },
        { id: 2, shopId: 1, name: "Zero", rate: "0.00", type: "zero", isDefault: false, createdAt: "", updatedAt: "" },
      ]),
    };
    const { default: Page } = await import("./settings/business/tax-classes/page");
    mount(<Page />);
    await cardsReady();
    expect(await cards().findByText("Zero")).toBeInTheDocument();
    await userEvent.click(cards().getByRole("button", { name: "More actions for Standard" }));
    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
  });
});
