import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import OrdersPage from "./page";
import { ToastProvider } from "@/components/ui/Toast";
import { listOrders } from "@/lib/api";
import type { Order } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getShop: vi.fn(),
  listOrders: vi.fn(),
  cancelOrder: vi.fn(),
  collectCash: vi.fn(),
  updateOrderStatus: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { role: "admin" } }) }));
vi.mock("@/lib/outlet-context", () => ({ useOutletFilter: () => ({ selectedOutletId: null }) }));
vi.mock("@/components/OutletSwitcher", () => ({ default: () => null }));
vi.mock("@/components/OrderDetailModal", () => ({ default: () => null }));

// The source filter and sort live in the URL.
const nav = vi.hoisted(() => ({ query: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.query),
  usePathname: () => "/orders",
  useRouter: () => ({ replace: nav.replace }),
}));

function makeOrder(id: number, source: Order["source"]): Order {
  return {
    id,
    shopOrderNumber: id,
    currency: "AED",
    outletId: 1,
    customerName: `Customer ${id}`,
    customerPhone: "+971500000000",
    customerEmail: null,
    customerAddress: "1 St",
    area: null,
    deliveryDate: null,
    deliveryTimeSlot: null,
    deliveryNotes: null,
    receiverMessage: null,
    channel: source === "website" ? "storefront" : null,
    source,
    orderType: null,
    status: "pending",
    paymentStatus: "paid",
    paymentMethod: null,
    cashCollectedAt: null,
    cashCollectedBy: null,
    cashCollectedByName: null,
    deliveryFee: "0",
    total: "10.00",
    createdAt: new Date().toISOString(),
    trackingToken: null,
    paymentLinkToken: null,
    paymentLinkExpiresAt: null,
    orderitem: [],
  } as Order;
}

function renderPage() {
  return render(
    <ToastProvider>
      <OrdersPage />
    </ToastProvider>,
  );
}

beforeEach(() => {
  nav.query = "";
  nav.replace.mockReset();
  vi.mocked(listOrders).mockReset();
  vi.mocked(listOrders).mockResolvedValue({
    data: [makeOrder(1, "website"), makeOrder(2, "custom"), makeOrder(3, "talabat")],
    page: 1,
    pageSize: 100,
    total: 3,
  });
});
afterEach(cleanup);

describe("Orders board: source tags, filter and sort", () => {
  it("tags every card except Website ones", async () => {
    renderPage();
    await screen.findByText("Customer 1");
    const tags = screen.getAllByTestId("order-source-tag");
    expect(tags.map((t) => t.getAttribute("data-source"))).toEqual(["custom", "talabat"]);
  });

  it("asks for every source, newest first, when the URL has neither", async () => {
    renderPage();
    await waitFor(() => expect(listOrders).toHaveBeenCalled());
    expect(vi.mocked(listOrders).mock.calls[0][0]).toMatchObject({ sources: [], sort: undefined });
    expect(screen.getByRole("button", { name: /Source:\s*All/ })).toBeInTheDocument();
  });

  it("reads the filter and the sort from the URL", async () => {
    nav.query = "sources=talabat,custom&sort=source";
    renderPage();
    await waitFor(() => expect(listOrders).toHaveBeenCalled());
    expect(vi.mocked(listOrders).mock.calls[0][0]).toMatchObject({
      sources: ["custom", "talabat"],
      sort: "source",
    });
    expect(screen.getByRole("button", { name: /Source:\s*2 selected/ })).toBeInTheDocument();
    expect((screen.getByLabelText("Sort orders") as HTMLSelectElement).value).toBe("source");
  });

  it("writes a change into the URL, keeping the rest of it", async () => {
    nav.query = "orderId=9";
    renderPage();
    await screen.findByText("Customer 1");
    fireEvent.click(screen.getByRole("button", { name: /Source:/ }));
    fireEvent.click(screen.getByLabelText("Deliveroo"));
    expect(nav.replace).toHaveBeenLastCalledWith("/orders?orderId=9&sources=deliveroo", { scroll: false });
    fireEvent.change(screen.getByLabelText("Sort orders"), { target: { value: "source" } });
    expect(nav.replace).toHaveBeenLastCalledWith("/orders?orderId=9&sort=source", { scroll: false });
  });
});
