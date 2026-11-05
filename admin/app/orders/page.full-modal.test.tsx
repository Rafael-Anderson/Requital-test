import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrdersPage from "./page";
import { ToastProvider } from "@/components/ui/Toast";
import type { Order } from "@/lib/types";

// The REAL OrderDetailModal (and its real status timeline) is rendered here, not a
// stand-in: the regression this pins is a shop in "simple" editor mode being handed a
// condensed modal with no timeline and no details (commit 2939e6b1's mode split).
afterEach(cleanup);

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getShop: vi.fn(),
    listOrders: vi.fn(),
    getOrder: vi.fn(),
    getOrderHistory: vi.fn(),
    getOrderReturns: vi.fn(),
    cancelOrder: vi.fn(),
    updateOrderStatus: vi.fn(),
  };
});
import { getOrder, getOrderHistory, getOrderReturns, getShop, listOrders } from "@/lib/api";

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { role: "admin" } }),
}));
vi.mock("@/lib/outlet-context", () => ({
  useOutletFilter: () => ({ selectedOutletId: null }),
}));
vi.mock("@/components/OutletSwitcher", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/orders",
}));

const order = {
  id: 101,
  shopOrderNumber: 7,
  currency: "AED",
  outletId: 1,
  customerName: "Sara Ahmed",
  customerPhone: "+971500000000",
  customerEmail: null,
  customerAddress: "123 Street",
  area: "Marina",
  deliveryDate: "2026-08-05",
  deliveryTimeSlot: "10am-12pm",
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
  total: "150.00",
  createdAt: new Date().toISOString(),
  trackingToken: null,
  paymentLinkToken: null,
  paymentLinkExpiresAt: null,
  addressUnverified: true,
  orderitem: [],
} as unknown as Order;

describe("OrdersPage with productEditorMode 'simple' (one screen for every shop)", () => {
  it("opens the FULL order modal: status timeline, delivery details and the unverified-address notice, plus the Kanban and History tabs", async () => {
    const user = userEvent.setup();
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "simple", taxDisplayText: null } as never);
    vi.mocked(listOrders).mockResolvedValue({ data: [order], total: 1 } as never);
    vi.mocked(getOrder).mockResolvedValue(order);
    vi.mocked(getOrderReturns).mockResolvedValue([]);
    vi.mocked(getOrderHistory).mockResolvedValue([
      { status: "pending", timestamp: "2026-08-05T08:00:00.000Z", actorName: null },
      { status: "confirmed", timestamp: "2026-08-05T08:05:00.000Z", actorName: "Maya" },
    ] as never);

    render(<ToastProvider><OrdersPage /></ToastProvider>);

    // Kanban + History tabs are there for a simple-mode shop
    await waitFor(() => expect(screen.getByText("Sara Ahmed")).toBeInTheDocument());
    expect(screen.getByText("Order History")).toBeInTheDocument();
    expect(screen.getByText("New Orders")).toBeInTheDocument();

    await user.click(screen.getByText("Sara Ahmed"));

    // the order timeline
    expect(await screen.findByText("Status timeline")).toBeInTheDocument();
    expect(await screen.findByText("Order Placed")).toBeInTheDocument();
    expect(screen.getByText("by Maya")).toBeInTheDocument();
    // the details and the F9 notice survive in the full modal
    expect(screen.getAllByText(/Address not verified on a map/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Marina/)).toBeInTheDocument();
  });
});
