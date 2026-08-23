import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrdersPage from "./page";
import { ToastProvider } from "@/components/ui/Toast";
import { getShop, listOrders } from "@/lib/api";
import type { Order } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getShop: vi.fn(),
  listOrders: vi.fn(),
  cancelOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { role: "admin" } }),
}));

vi.mock("@/lib/outlet-context", () => ({
  useOutletFilter: () => ({ selectedOutletId: null }),
}));

vi.mock("@/components/OutletSwitcher", () => ({ default: () => null }));

vi.mock("@/components/OrderDetailModal", () => ({
  default: ({ orderId }: { orderId: number | null }) =>
    orderId === null ? null : <div>ADVANCED-MODAL-{orderId}</div>,
}));
vi.mock("@/components/SimpleOrderDetailModal", () => ({
  default: ({ orderId }: { orderId: number | null }) =>
    orderId === null ? null : <div>SIMPLE-MODAL-{orderId}</div>,
}));

const order: Order = {
  id: 101,
  outletId: 1,
  customerName: "Sara Ahmed",
  customerPhone: "+971500000000",
  customerEmail: null,
  customerAddress: "123 Street",
  emirate: "Dubai",
  area: null,
  deliveryDate: "2026-08-05",
  deliveryTimeSlot: "10am-12pm",
  deliveryNotes: null,
  receiverMessage: null,
  channel: null,
  orderType: null,
  status: "pending",
  paymentStatus: "paid",
  deliveryFee: "10",
  total: "150.00",
  createdAt: new Date().toISOString(),
  paymentLinkToken: null,
  paymentLinkExpiresAt: null,
  orderitem: [],
};

function renderPage() {
  return render(
    <ToastProvider>
      <OrdersPage />
    </ToastProvider>,
  );
}

describe("OrdersPage — simple/advanced mode", () => {
  it("simple mode: still shows the Order History tab (tabs are the same in both modes)", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "simple" } as never);
    vi.mocked(listOrders).mockResolvedValue({ data: [order], total: 1 } as never);
    renderPage();

    await waitFor(() => expect(screen.getByText("Sara Ahmed")).toBeInTheDocument());
    expect(screen.getByText("Order History")).toBeInTheDocument();
  });

  it("simple mode: still shows the delivery date (a same-day-delivery merchant needs it), but omits 'Ordered ago'", async () => {
    // Bug 6a QA-sweep fix: the delivery-date line used to be gated behind
    // !isSimple too, meaning a simple-mode merchant had no way to see when
    // an order was due anywhere in the Orders UI. Only "Ordered X ago"
    // stays hidden in simple mode.
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "simple" } as never);
    vi.mocked(listOrders).mockResolvedValue({ data: [order], total: 1 } as never);
    renderPage();

    await waitFor(() => expect(screen.getByText("Sara Ahmed")).toBeInTheDocument());
    expect(screen.getByText(/10am-12pm/)).toBeInTheDocument();
    expect(screen.queryByText(/Ordered/)).not.toBeInTheDocument();
  });

  it("simple mode: clicking an order opens the condensed modal", async () => {
    const user = userEvent.setup();
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "simple" } as never);
    vi.mocked(listOrders).mockResolvedValue({ data: [order], total: 1 } as never);
    renderPage();

    await waitFor(() => expect(screen.getByText("Sara Ahmed")).toBeInTheDocument());
    await user.click(screen.getByText("Sara Ahmed"));
    expect(await screen.findByText("SIMPLE-MODAL-101")).toBeInTheDocument();
    expect(screen.queryByText("ADVANCED-MODAL-101")).not.toBeInTheDocument();
  });

  it("advanced mode: shows the Order History tab", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "advanced" } as never);
    vi.mocked(listOrders).mockResolvedValue({ data: [order], total: 1 } as never);
    renderPage();

    await waitFor(() => expect(screen.getByText("Order History")).toBeInTheDocument());
  });

  it("advanced mode: shows delivery date and 'Ordered ago' on the card", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "advanced" } as never);
    vi.mocked(listOrders).mockResolvedValue({ data: [order], total: 1 } as never);
    renderPage();

    await waitFor(() => expect(screen.getByText(/10am-12pm/)).toBeInTheDocument());
    expect(screen.getByText(/Ordered/)).toBeInTheDocument();
  });

  it("advanced mode: clicking an order opens the full detail modal", async () => {
    const user = userEvent.setup();
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "advanced" } as never);
    vi.mocked(listOrders).mockResolvedValue({ data: [order], total: 1 } as never);
    renderPage();

    await waitFor(() => expect(screen.getByText("Sara Ahmed")).toBeInTheDocument());
    await user.click(screen.getByText("Sara Ahmed"));
    expect(await screen.findByText("ADVANCED-MODAL-101")).toBeInTheDocument();
    expect(screen.queryByText("SIMPLE-MODAL-101")).not.toBeInTheDocument();
  });
});
