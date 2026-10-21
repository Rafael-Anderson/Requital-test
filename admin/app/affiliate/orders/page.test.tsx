import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AffiliateOrdersPage from "./page";
import { ToastProvider } from "@/components/ui/Toast";
import { listAffiliateOrders } from "@/lib/api";

vi.mock("@/lib/api", () => ({ listAffiliateOrders: vi.fn(), updateAffiliateOrderStatus: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("affiliate orders page", () => {
  it("shows the per-shop order number and the order's own currency decimals", async () => {
    vi.mocked(listAffiliateOrders).mockResolvedValue({
      data: [
        { id: 1, orderId: 56410, shopOrderNumber: 12, currency: "KWD", customerName: "Sara", orderTotal: 10.5, code: "SARA10", affiliateName: "Sara", commissionAmount: 1.05, status: "pending", createdAt: "2026-10-01T10:00:00Z" },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    render(
      <ToastProvider>
        <AffiliateOrdersPage />
      </ToastProvider>,
    );
    expect((await screen.findAllByText(/#12/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/56410/)).toBeNull();
    expect(screen.getAllByText(/10\.500 KWD/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1\.050 KWD/).length).toBeGreaterThan(0);
  });
});
