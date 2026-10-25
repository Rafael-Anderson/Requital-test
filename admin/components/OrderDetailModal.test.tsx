import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderDetailModal from "./OrderDetailModal";
import { ToastProvider } from "@/components/ui/Toast";
import type { Order } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { role: "admin" } }),
}));

vi.mock("@/lib/api", () => ({
  getOrder: vi.fn(),
  getShop: vi.fn(),
  cancelOrder: vi.fn(),
  createExternalDelivery: vi.fn(),
  updateExternalDelivery: vi.fn(),
  updateOrderDeliveryFee: vi.fn(),
  updateOrderStatus: vi.fn(),
  getOrderReturns: vi.fn().mockResolvedValue([]),
  createOrderReturn: vi.fn(),
  getOrderHistory: vi.fn().mockResolvedValue([]),
}));
import { getOrder, getShop, updateExternalDelivery } from "@/lib/api";

function fakeOrder(): Order {
  return {
    id: 42,
    shopOrderNumber: 3,
    currency: "AED",
    outletId: 1,
    customerName: "Jane Shopper",
    customerPhone: "0501234567",
    customerEmail: null,
    customerAddress: "123 Street",
    area: null,
    deliveryDate: null,
    deliveryTimeSlot: null,
    deliveryNotes: null,
    receiverMessage: null,
    channel: "storefront",
    orderType: "delivery",
    status: "confirmed",
    paymentStatus: "paid",
    paymentMethod: null,
    cashCollectedAt: null,
    cashCollectedBy: null,
    cashCollectedByName: null,
    deliveryFee: "10",
    total: "60",
    createdAt: new Date().toISOString(),
    trackingToken: null,
    paymentLinkToken: null,
    paymentLinkExpiresAt: null,
    orderitem: [],
    externaldelivery: {
      id: 1,
      currency: "AED",
      orderId: 42,
      carrier: "Careem",
      vehicleType: null,
      price: "20",
      destination: "123 Street",
      status: "pending",
      createdAt: new Date().toISOString(),
      provider: "manual",
      sliderOrderNumber: null,
      trackingUrl: null,
      driverName: null,
      driverPhone: null,
      driverLat: null,
      driverLng: null,
      estimatedDeliveryMinutes: null,
    },
  } as Order;
}

describe("OrderDetailModal — external delivery status picker", () => {
  it("renders the status picker as a Combobox, not a native select", async () => {
    vi.mocked(getOrder).mockResolvedValue(fakeOrder());
    vi.mocked(getShop).mockResolvedValue({ taxDisplayText: null } as never);
    render(<ToastProvider><OrderDetailModal orderId={42} onClose={vi.fn()} /></ToastProvider>);

    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });

  it("selecting a new status calls updateExternalDelivery", async () => {
    const user = userEvent.setup();
    vi.mocked(getOrder).mockResolvedValue(fakeOrder());
    vi.mocked(getShop).mockResolvedValue({ taxDisplayText: null } as never);
    vi.mocked(updateExternalDelivery).mockResolvedValue({} as never);
    render(<ToastProvider><OrderDetailModal orderId={42} onClose={vi.fn()} /></ToastProvider>);

    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "delivered" }));

    await waitFor(() => {
      expect(updateExternalDelivery).toHaveBeenCalledWith(42, { status: "delivered" });
    });
  });
});

describe("OrderDetailModal — order identifier", () => {
  it("the cancel confirmation names the per-shop order number, not the global id", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.mocked(getOrder).mockResolvedValue({ ...fakeOrder(), status: "pending" } as Order);
    vi.mocked(getShop).mockResolvedValue({ taxDisplayText: null } as never);
    render(<ToastProvider><OrderDetailModal orderId={42} onClose={vi.fn()} /></ToastProvider>);

    await user.click(await screen.findByRole("button", { name: /cancel order/i }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const message = confirmSpy.mock.calls[0][0] as string;
    expect(message).toContain("#3");
    expect(message).not.toContain("#42");
    confirmSpy.mockRestore();
  });
});

describe("OrderDetailModal: marketplace orders", () => {
  it("a pending marketplace order shows its source and points to the desk, with no Cancel or Accept here", async () => {
    vi.mocked(getOrder).mockResolvedValue({ ...fakeOrder(), channel: "deliveroo", status: "pending" } as Order);
    vi.mocked(getShop).mockResolvedValue({ taxDisplayText: null } as never);
    render(<ToastProvider><OrderDetailModal orderId={42} onClose={vi.fn()} /></ToastProvider>);

    const link = await screen.findByRole("link", { name: "Open Marketplace desk" });
    expect(link).toHaveAttribute("href", "/orders/marketplace");
    expect(screen.getByText("Deliveroo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel order/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
  });

  it("after acceptance the kitchen steps stay available but a generic cancel does not", async () => {
    vi.mocked(getOrder).mockResolvedValue({ ...fakeOrder(), channel: "deliveroo", status: "confirmed" } as Order);
    vi.mocked(getShop).mockResolvedValue({ taxDisplayText: null } as never);
    render(<ToastProvider><OrderDetailModal orderId={42} onClose={vi.fn()} /></ToastProvider>);

    expect(await screen.findByRole("button", { name: "Start preparing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel order/i })).not.toBeInTheDocument();
  });
});

describe("OrderDetailModal: unverified delivery address (F9)", () => {
  it("warns under the delivery address only when the address was typed without a map pin", async () => {
    vi.mocked(getShop).mockResolvedValue({ taxDisplayText: null } as never);
    vi.mocked(getOrder).mockResolvedValue({ ...fakeOrder(), addressUnverified: true } as Order);
    const { unmount } = render(<ToastProvider><OrderDetailModal orderId={42} onClose={vi.fn()} /></ToastProvider>);
    expect(
      await screen.findByText("Address not verified on a map, please confirm with the customer"),
    ).toBeInTheDocument();
    unmount();

    vi.mocked(getOrder).mockResolvedValue({ ...fakeOrder(), addressUnverified: false } as Order);
    render(<ToastProvider><OrderDetailModal orderId={42} onClose={vi.fn()} /></ToastProvider>);
    await screen.findByText("Delivery address");
    expect(screen.queryByText(/Address not verified/)).not.toBeInTheDocument();
  });
});
