import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MoneyTaxPage from "./page";
import type { Shop } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({ getShop: vi.fn(), updateShop: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
import { getShop, updateShop } from "@/lib/api";

const shop = {
  currency: "AED",
  taxRate: "5.00",
  taxInclusive: true,
  taxOnDelivery: false,
  taxDisplayText: "Including VAT",
} as unknown as Shop;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getShop).mockResolvedValue(shop);
  vi.mocked(updateShop).mockResolvedValue(shop);
});

// Moved from the Store Configuration page test (Phase 2a/A6): all seven
// currencies selectable, none labelled "coming soon", and the new-orders-only
// note. The backend half is backend/test/shop-country-lock.e2e-spec.ts.
describe("Money & Tax currency dropdown (A6)", () => {
  it("offers all seven currencies, every one selectable, none labelled coming soon", async () => {
    render(<MoneyTaxPage />);
    for (const code of ["AED", "SAR", "KWD", "QAR", "BHD", "OMR", "USD"]) {
      const option = await screen.findByRole("option", { name: code });
      expect(option).not.toBeDisabled();
    }
    const labels = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(labels.some((l) => /coming soon/i.test(l))).toBe(false);
  });

  it("says the change affects new orders only", async () => {
    render(<MoneyTaxPage />);
    expect(await screen.findByText(/Applies to new orders/i)).toBeInTheDocument();
    expect(screen.queryByText(/Only AED is supported/i)).not.toBeInTheDocument();
  });
});

describe("Money & Tax save", () => {
  // Old Basic Info payload for tax 7.5 was {taxRate:7.5, taxInclusive:true,
  // taxOnDelivery:false} (plus the same-day/next-day keys, now on Delivery).
  // Old Store Configuration sent currency and taxDisplayText ("" when blank).
  // All five now go in one save, with the same value shapes.
  it("sends the five shop-wide money and tax fields with the shapes the old pages used", async () => {
    const user = userEvent.setup();
    render(<MoneyTaxPage />);
    const rate = await screen.findByLabelText("Tax Rate (%)");
    await user.clear(rate);
    await user.type(rate, "7.5");
    await user.click(screen.getByRole("button", { name: /Save changes/ }));
    await waitFor(() => expect(updateShop).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateShop).mock.calls[0][0]).toEqual({
      currency: "AED",
      taxRate: 7.5,
      taxInclusive: true,
      taxOnDelivery: false,
      taxDisplayText: "Including VAT",
    });
  });

  it("sends a blank tax label as an empty string, as Store Configuration did", async () => {
    const user = userEvent.setup();
    vi.mocked(getShop).mockResolvedValue({ ...shop, taxDisplayText: null } as unknown as Shop);
    render(<MoneyTaxPage />);
    await user.click(await screen.findByRole("button", { name: /Save changes/ }));
    await waitFor(() => expect(updateShop).toHaveBeenCalled());
    expect(vi.mocked(updateShop).mock.calls[0][0]).toMatchObject({ taxDisplayText: "" });
  });

  it("links to Tax Classes", async () => {
    render(<MoneyTaxPage />);
    expect(await screen.findByRole("link", { name: "Tax Classes" })).toHaveAttribute("href", "/settings/business/tax-classes");
  });
});
