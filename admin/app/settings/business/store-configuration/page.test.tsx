import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import StoreConfigurationPage from "./page";
import type { Shop } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  getShop: vi.fn(),
  updateShop: vi.fn(),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => vi.fn(),
}));

import { getShop } from "@/lib/api";

// Only the fields this page reads on mount; the rest of Shop is irrelevant here.
const shop = {
  currency: "AED",
  businessType: "Florist",
  defaultLanguage: "en",
  productDisplayOrientation: "vertical",
  businessHours: null,
} as unknown as Shop;

// Phase 2a/A6 removed the AED-only lock. This guards the UI half: before it,
// six of the seven options were rendered `disabled` with "(coming soon)"
// appended, so a merchant outside the UAE could see their currency but not pick
// it. The backend half (SUPPORTED_CURRENCIES) is covered by
// backend/test/shop-country-lock.e2e-spec.ts.
describe("StoreConfigurationPage currency dropdown (A6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getShop).mockResolvedValue(shop);
  });

  it("offers all seven currencies, every one of them selectable", async () => {
    render(<StoreConfigurationPage />);
    await waitFor(() => expect(getShop).toHaveBeenCalled());

    for (const code of ["AED", "SAR", "KWD", "QAR", "BHD", "OMR", "USD"]) {
      const option = await screen.findByRole("option", { name: code });
      expect(option).toBeInTheDocument();
      // The assertion that actually encodes A6: none is disabled any more.
      expect(option).not.toBeDisabled();
    }
  });

  // Scoped to the dropdown's own options on purpose: this page also has a
  // legitimate, unrelated "Coming Soon" section for shop.xEnabled toggles that
  // ship ahead of the features they gate (see CLAUDE.md). A blanket
  // queryByText(/coming soon/i) matches that heading and would fail for the
  // wrong reason - which is exactly what it did on the first run of this test.
  it('no longer labels any currency option "(coming soon)"', async () => {
    render(<StoreConfigurationPage />);
    await waitFor(() => expect(getShop).toHaveBeenCalled());
    const labels = screen
      .getAllByRole("option")
      .map((o) => o.textContent ?? "");
    expect(labels.some((l) => /coming soon/i.test(l))).toBe(false);
    expect(labels).toContain("KWD");
  });

  it("no longer claims only AED is supported, and says the change affects new orders only", async () => {
    render(<StoreConfigurationPage />);
    await waitFor(() => expect(getShop).toHaveBeenCalled());
    expect(screen.queryByText(/Only AED is supported/i)).not.toBeInTheDocument();
    // Because A1 captures the currency per order, past totals never re-denominate.
    expect(screen.getByText(/Applies to new orders/i)).toBeInTheDocument();
  });
});
