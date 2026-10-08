import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({ low: vi.fn(), sugg: vi.fn(), drafts: vi.fn() }));
vi.mock("@/lib/api", () => ({
  listReorderLowStock: api.low,
  listReorderSuggestions: api.sugg,
  createReorderDrafts: api.drafts,
  setReorderPoint: vi.fn(),
  listIngredients: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { id: 1, role: "admin", outletId: null } }) }));
vi.mock("@/lib/outlet-context", () => ({
  useOutletFilter: () => ({ selectedOutletId: 9, outlets: [{ id: 9, name: "Main" }], setSelectedOutletId: () => {} }),
}));
vi.mock("@/components/BranchBar", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/inventory/reorder" }));

import { ToastProvider } from "@/components/ui/Toast";
import ReorderPage from "./page";

const group = {
  outletId: 9,
  supplierId: 3,
  supplierName: "Bloom Co",
  currency: "KWD",
  subtotal: 31.515,
  belowMinimumOrderAmount: false,
  lines: [{ ingredientId: 1, name: "Rose", unit: "unit", quantity: 3, unitCost: "10.505", lineTotal: 31.515, priceComparable: true, alternatives: 0, stock: 0, onOrder: 0, reorderPoint: 2 }],
};

beforeEach(() => {
  api.low.mockReset();
  api.sugg.mockReset();
  api.drafts.mockReset();
});
afterEach(cleanup);
const mount = () => render(<ToastProvider><ReorderPage /></ToastProvider>);

describe("Reorder page", () => {
  it("the suggestions render when the low-stock request fails, and the failure offers Try again", async () => {
    api.low.mockRejectedValue(new Error("boom"));
    api.sugg.mockResolvedValue({ groups: [group], noSupplier: [{ outletId: 9, ingredientId: 2, name: "Fern", reason: "no_supplier" }] });
    mount();
    expect(await screen.findByText("Bloom Co")).toBeInTheDocument();
    expect(screen.getByText("Fern")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load low stock");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("creates drafts for one supplier at the group's outlet, then reloads", async () => {
    api.low.mockResolvedValue({ data: [] });
    api.sugg.mockResolvedValue({ groups: [group], noSupplier: [] });
    api.drafts.mockResolvedValue({ created: [{ id: 1, supplierId: 3, currency: "KWD", subtotal: 31.515, lines: 1 }] });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(api.drafts).toHaveBeenCalledWith({ outletId: 9, supplierId: 3 }));
    await waitFor(() => expect(api.sugg).toHaveBeenCalledTimes(2));
  });

  it("shows the empty state, not a skeleton, when nothing is at its point", async () => {
    api.low.mockResolvedValue({ data: [] });
    api.sugg.mockResolvedValue({ groups: [], noSupplier: [] });
    mount();
    expect(await screen.findByText("Nothing is below its reorder point")).toBeInTheDocument();
    expect(await screen.findByText("Nothing to order")).toBeInTheDocument();
  });
});
