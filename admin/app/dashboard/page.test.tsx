import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "./page";
import { getDashboardSummary, getDailyRevenue, getShop, getTopProducts } from "@/lib/api";
import type { DashboardSummary, TopProduct } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getShop: vi.fn(),
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

describe("DashboardPage — simple/advanced mode", () => {
  it("simple mode: shows only the 3 focused cards", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "simple" } as never);
    vi.mocked(getDashboardSummary).mockResolvedValue(summary);
    vi.mocked(getTopProducts).mockResolvedValue(topProducts);
    renderPage();

    await waitFor(() => expect(screen.getByText("Revenue Today")).toBeInTheDocument());
    expect(screen.getByText("Orders Today")).toBeInTheDocument();
    expect(screen.getByText("Top 3 Products")).toBeInTheDocument();
  });

  it("simple mode: hides the date range picker and chart/breakdown sections", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "simple" } as never);
    vi.mocked(getDashboardSummary).mockResolvedValue(summary);
    vi.mocked(getTopProducts).mockResolvedValue(topProducts);
    renderPage();

    await waitFor(() => expect(screen.getByText("Revenue Today")).toBeInTheDocument());
    expect(screen.queryByText("Sale Overview")).not.toBeInTheDocument();
    expect(screen.queryByText("Outlet Distribution")).not.toBeInTheDocument();
    expect(screen.queryByText("Sales Distribution by Channel")).not.toBeInTheDocument();
    expect(getDailyRevenue).not.toHaveBeenCalled();
  });

  it("advanced mode: shows the full stat/chart/breakdown layout", async () => {
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

  it("advanced mode: does not render the simple-mode 'Revenue Today'/'Orders Today' cards", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "advanced" } as never);
    vi.mocked(getDashboardSummary).mockResolvedValue(summary);
    vi.mocked(getDailyRevenue).mockResolvedValue([{ date: "2026-08-04", revenue: 500 }]);
    vi.mocked(getTopProducts).mockResolvedValue(topProducts);
    renderPage();

    await waitFor(() => expect(screen.getByText("Total Revenue")).toBeInTheDocument());
    expect(screen.queryByText("Revenue Today")).not.toBeInTheDocument();
    expect(screen.queryByText("Orders Today")).not.toBeInTheDocument();
  });
});
