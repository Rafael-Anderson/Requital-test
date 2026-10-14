import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExternalDeliveryOrdersTabPage from "./page";
import { listExternalDeliveryReport, listOutlets } from "@/lib/api";
import type { ExternalDeliveryRow } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  listExternalDeliveryReport: vi.fn(),
  listOutlets: vi.fn(),
}));
vi.mock("@/lib/useShopMode", () => ({ useShopMode: () => "advanced" }));
vi.mock("@/components/ReportsFilterBar", () => ({ default: () => null }));
vi.mock("@/components/OrdersTabs", () => ({ default: () => null }));
vi.mock("@/components/BranchBar", () => ({ default: () => null }));
vi.mock("@/components/OrderDetailModal", () => ({
  default: ({ orderId }: { orderId: number | null }) =>
    orderId === null ? null : <div>MODAL-{orderId}</div>,
}));
vi.mock("@/components/SimpleOrderDetailModal", () => ({ default: () => null }));

const row: ExternalDeliveryRow = {
  id: 1,
  orderId: 4821,
  shopOrderNumber: 17,
  outletName: "Main",
  customerName: "Sara Ahmed",
  customerPhone: "+971500000000",
  carrier: "Slider",
  vehicleType: "bike",
  price: "12",
  destination: "Dubai",
  status: "searching_rider",
  createdAt: "2026-10-13T10:00:00.000Z",
  provider: "slider",
  trackingUrl: null,
  driverName: null,
  driverPhone: null,
  currency: "AED",
};

describe("External delivery orders tab", () => {
  it("labels each row with the per-shop order number, never the global id, but opens the order by its id", async () => {
    const user = userEvent.setup();
    vi.mocked(listOutlets).mockResolvedValue([]);
    vi.mocked(listExternalDeliveryReport).mockResolvedValue({ data: [row], page: 1, pageSize: 20, total: 1 });
    render(<ExternalDeliveryOrdersTabPage />);

    await waitFor(() => expect(screen.getAllByText("#17", { exact: false }).length).toBeGreaterThan(0));
    expect(screen.queryByText("#4821", { exact: false })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open order #17" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open order #17" }));
    expect(screen.getByText("MODAL-4821")).toBeInTheDocument();
  });
});
