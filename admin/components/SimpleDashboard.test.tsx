import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import SimpleDashboard from "./SimpleDashboard";
import { getDashboardSummary, getTopProducts } from "@/lib/api";
import type { DashboardSummary, TopProduct } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getDashboardSummary: vi.fn(),
  getTopProducts: vi.fn(),
}));

vi.mock("@/lib/outlet-context", () => ({
  useOutletFilter: () => ({ selectedOutletId: null, outlets: [], loading: false }),
}));

const summary: DashboardSummary = {
  period: { from: "2026-08-22", to: "2026-08-22" },
  revenue: { current: 350, previous: 0, changePct: null },
  avgBasketValue: { current: 175, previous: 0, changePct: null },
  totalOrders: 2,
  customerGrowth: { current: 1, previous: 0, changePct: null },
  ordersByStage: { placed: 1, accepted: 0, preparing: 1, shipped: 0, delivered: 0 },
  outlets: [{ outletId: 1, name: "Main", orderCount: 2, percentage: 100 }],
  channels: [{ channel: "storefront", count: 2, percentage: 100 }],
};

const topProducts: TopProduct[] = [
  { productId: 1, name: "Rose Bouquet", thumbnail: null, unitsSold: 2, revenue: 200 },
  { productId: 2, name: "Chocolate Box", thumbnail: null, unitsSold: 1, revenue: 150 },
];

describe("SimpleDashboard", () => {
  it("shows only three stat cards — Revenue Today, Orders Today, Top Product Today — no charts", async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue(summary);
    vi.mocked(getTopProducts).mockResolvedValue(topProducts);
    render(<SimpleDashboard />);

    await waitFor(() => expect(screen.getByText("Revenue Today")).toBeInTheDocument());
    expect(screen.getByText("350 AED")).toBeInTheDocument();
    expect(screen.getByText("Orders Today")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Top Product Today")).toBeInTheDocument();
    expect(screen.getByText("Rose Bouquet")).toBeInTheDocument();
    expect(screen.getByText("Also: Chocolate Box")).toBeInTheDocument();

    expect(screen.queryByText("Sale Overview")).not.toBeInTheDocument();
    expect(screen.queryByText("Outlet Distribution")).not.toBeInTheDocument();
  });

  it("requests a today-only date range, not the full dashboard's 30-day range", async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue(summary);
    vi.mocked(getTopProducts).mockResolvedValue(topProducts);
    render(<SimpleDashboard />);

    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalled());
    const params = vi.mocked(getDashboardSummary).mock.calls[0]![0]!;
    expect(params.from).toBe(params.to);

    const topParams = vi.mocked(getTopProducts).mock.calls[0]![0]!;
    expect(topParams.limit).toBe(3);
  });

  it("shows a 'No sales yet' placeholder instead of a product name when nothing sold today", async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue({ ...summary, totalOrders: 0 });
    vi.mocked(getTopProducts).mockResolvedValue([]);
    render(<SimpleDashboard />);

    await waitFor(() => expect(screen.getByText("No sales yet")).toBeInTheDocument());
  });
});
