import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "./page";
import { getDashboardSummary, getDailyRevenue, getTopProducts, getShop } from "@/lib/api";
import type { DashboardSummary, TopProduct } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getDashboardSummary: vi.fn(),
  getDailyRevenue: vi.fn(),
  getTopProducts: vi.fn(),
  getShop: vi.fn(),
  resolveImageUrl: (path: string | null | undefined) => path || null,
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { role: "admin" } }),
}));

vi.mock("@/lib/outlet-context", () => ({
  useOutletFilter: () => ({ selectedOutletId: null, outlets: [], loading: false }),
}));

const summary: DashboardSummary = {
  period: { from: "2026-08-04", to: "2026-08-04" },
  revenue: { current: 500, previous: 450, changePct: 12 },
  avgBasketValue: { current: 100, previous: 95, changePct: 5 },
  totalOrders: 4,
  customerGrowth: { current: 2, previous: 1, changePct: 1 },
  ordersByStage: { placed: 1, accepted: 1, preparing: 1, shipped: 0, delivered: 1 },
  outlets: [{ outletId: 1, name: "Main", orderCount: 4, percentage: 100 }],
  channels: [{ channel: "storefront", count: 4, percentage: 100 }],
};

const topProducts: TopProduct[] = [
  { productId: 1, name: "Roses", thumbnail: null, unitsSold: 3, revenue: 300 },
];

function renderPage() {
  return render(<DashboardPage />);
}

// Bug 6b QA-sweep fix (2026-08-22): CLAUDE.md documents a simple-mode
// SimpleDashboard as already shipped, but the component never existed and
// this page never branched on shop.productEditorMode at all (confirmed by
// grep during the audit) — every shop, simple or advanced, always saw the
// full 8-widget dashboard below. This describe block previously carried a
// comment claiming the split had been deliberately removed; that claim
// contradicts CLAUDE.md's own current documentation and was never dated or
// attributed, so it's treated here as stale rather than authoritative — the
// split is reinstated, matching the approved fix. These two tests now
// explicitly mock an "advanced"-mode shop, since that's what they're
// actually asserting (the full layout) — see SimpleDashboard.test.tsx for
// the simple-mode counterpart.
describe("DashboardPage", () => {
  it("shows the full stat/chart/breakdown layout", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "advanced" } as never);
    vi.mocked(getDashboardSummary).mockResolvedValue(summary);
    vi.mocked(getDailyRevenue).mockResolvedValue([{ date: "2026-08-04", revenue: 500 }]);
    vi.mocked(getTopProducts).mockResolvedValue(topProducts);
    renderPage();

    await waitFor(() => expect(screen.getByText("Total Revenue")).toBeInTheDocument());
    expect(screen.getByText("Sale Overview")).toBeInTheDocument();
    expect(screen.getByText("Outlet Distribution")).toBeInTheDocument();
    expect(screen.getByText("Sales Distribution by Channel")).toBeInTheDocument();
  });

  it("fetches summary, daily revenue, and top products on mount", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "advanced" } as never);
    vi.mocked(getDashboardSummary).mockResolvedValue(summary);
    vi.mocked(getDailyRevenue).mockResolvedValue([{ date: "2026-08-04", revenue: 500 }]);
    vi.mocked(getTopProducts).mockResolvedValue(topProducts);
    renderPage();

    await waitFor(() => expect(screen.getByText("Total Revenue")).toBeInTheDocument());
    expect(getDashboardSummary).toHaveBeenCalled();
    expect(getDailyRevenue).toHaveBeenCalled();
    expect(getTopProducts).toHaveBeenCalled();
  });
});
