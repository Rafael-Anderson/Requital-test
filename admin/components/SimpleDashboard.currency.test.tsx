import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import SimpleDashboard from "./SimpleDashboard";
import { getDashboardSummary, getTopProducts } from "@/lib/api";
import type { DashboardSummary, TopProduct } from "@/lib/types";

// The case that is unreachable in production today (shop.currency is DTO-locked
// to AED until A6) and is the entire point of A5b: a shop on a THREE-decimal
// currency must render its money with three decimals and its own code.
//
// Before A5b every admin site inlined `${x.toFixed(2)} AED`, so this shop would
// have seen "1234.50 AED" — the wrong code AND a different number, since 2
// decimals silently drops the third minor digit KWD actually has.
vi.mock("@/lib/useShopCurrency", () => ({
  useShopCurrency: () => "KWD",
}));

vi.mock("@/lib/api", () => ({
  getDashboardSummary: vi.fn(),
  getTopProducts: vi.fn(),
}));

vi.mock("@/lib/outlet-context", () => ({
  useOutletFilter: () => ({ selectedOutletId: null, outlets: [], loading: false }),
}));

const summary: DashboardSummary = {
  period: { from: "2026-08-22", to: "2026-08-22" },
  revenue: { current: 1234.5, previous: 0, changePct: null },
  avgBasketValue: { current: 0, previous: 0, changePct: null },
  totalOrders: 3,
  customerGrowth: { current: 1, previous: 0, changePct: null },
  experienceRating: { average: null, count: 0 },
  ordersByStage: { placed: 3, accepted: 0, preparing: 0, shipped: 0, delivered: 0 },
  outlets: [{ outletId: 1, name: "Main", orderCount: 3, percentage: 100 }],
  channels: [{ channel: "storefront", count: 3, percentage: 100 }],
};

describe("SimpleDashboard on a non-AED shop", () => {
  it("renders three decimals and the shop's own code, not two and AED", async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue(summary);
    vi.mocked(getTopProducts).mockResolvedValue([] as TopProduct[]);

    render(<SimpleDashboard />);

    await waitFor(() =>
      expect(screen.getByText("1,234.500 KWD")).toBeInTheDocument(),
    );
    // The pre-A5b output, explicitly asserted absent.
    expect(screen.queryByText("1234.50 AED")).not.toBeInTheDocument();
  });
});
