import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "./page";
import { getDashboardSummary, getDailyRevenue, getTopProducts } from "@/lib/api";
import type { DashboardSummary, TopProduct } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getDashboardSummary: vi.fn(),
  getDailyRevenue: vi.fn(),
  getTopProducts: vi.fn(),
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

// Dashboard used to split into a trimmed "simple" layout vs. this full one
// depending on shop.productEditorMode — that split was removed (Dashboard
// isn't a page that should differ between modes), so this now always
// renders the full stat/chart/breakdown layout regardless of shop mode, and
// no longer fetches shop data at all to decide.
describe("DashboardPage", () => {
  it("shows the full stat/chart/breakdown layout", async () => {
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
