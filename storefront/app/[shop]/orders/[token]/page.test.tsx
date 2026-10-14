import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { OrderLookupResult } from "@/lib/types";
import OrderConfirmationPage from "./page";

const TOKEN = "A1B2C3D4E5F60718293A4B5C6D7E8F90";

const params = vi.hoisted(() => ({ value: { shop: "rose", token: "A1B2C3D4E5F60718293A4B5C6D7E8F90" } as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useParams: () => params.value,
  // The page must not care: a forged ?paid=1 is the whole point of the tests below.
  useSearchParams: () => new URLSearchParams("paid=1"),
}));

const shopState = vi.hoisted(() => ({
  value: {
    shop: {
      whatsappCountryCode: "971",
      whatsappNumber: "501112222",
      contactNumbers: ["+971 4 123 4567"],
      email: "hello@rose.test",
    },
    shopSlug: "rose",
    shopBasePath: "/rose",
  } as Record<string, unknown>,
}));
vi.mock("@/lib/shop-context", () => ({ useShop: () => shopState.value }));

const clear = vi.fn();
vi.mock("@/lib/cart", () => ({ useCart: () => ({ clear }) }));

const trackFn = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => trackFn(...a) }));

const lookupOrder = vi.fn();
vi.mock("@/lib/api", () => {
  class HttpError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    HttpError,
    lookupOrder: (...a: unknown[]) => lookupOrder(...a),
    resolveImageUrl: (p: string | null) => (p ? (p.startsWith("/") ? `http://api.test${p}` : p) : null),
  };
});
import { HttpError } from "@/lib/api";

function makeOrder(over: Partial<OrderLookupResult> = {}): OrderLookupResult {
  return {
    id: 9001,
    shopOrderNumber: 7,
    shopName: "Rose Shop",
    outletName: "Main",
    customerName: "Sara",
    status: "pending",
    orderType: "delivery",
    createdAt: "2026-10-13T10:00:00.000Z",
    paymentMethod: "cash_on_delivery",
    paymentStatus: "unpaid",
    onlinePayment: false,
    paymentFailed: false,
    deliveryDate: "2026-10-20",
    deliveryTimeSlot: "10:00 - 11:00",
    estimatedTime: null,
    items: [
      {
        productName: "Red Roses",
        variantLabel: "Large",
        quantity: 2,
        priceAtPurchase: "100",
        lineTotal: "200",
        imageUrl: "/uploads/rose.jpg",
        note: null,
      },
    ],
    currency: "AED",
    subtotal: "200",
    discountCode: null,
    discountAmount: null,
    deliveryFee: "15",
    taxAmount: null,
    taxInclusive: false,
    giftCardAmount: null,
    storeCreditAmount: null,
    total: "215",
    amountDue: "215",
    deliveryAddress: "9 Palm Street",
    region: { id: 1, nameEn: "Dubai", nameAr: "دبي" },
    area: "Marina",
    pickupLocation: null,
    hasAccount: false,
    ...over,
  };
}
const ONLINE_UNPAID = { paymentMethod: "card_online", onlinePayment: true } as const;

async function renderPage() {
  const r = render(<OrderConfirmationPage />);
  await act(async () => {});
  return r;
}
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
// One act per interval, as in a browser: React renders between timers, so the
// state a tick sets is visible to the next one. (A single long advance batches
// every render to the end and would not stop the poll.)
async function tickEvery2s(n: number) {
  for (let i = 0; i < n; i++) await tick(2000);
}

beforeEach(() => {
  vi.useFakeTimers();
  params.value = { shop: "rose", token: TOKEN };
  shopState.value = { ...shopState.value, shopBasePath: "/rose" };
  lookupOrder.mockReset();
  trackFn.mockReset();
  clear.mockReset();
  sessionStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("order confirmation page", () => {
  it("shows a skeleton while the order loads", () => {
    lookupOrder.mockReturnValue(new Promise(() => {}));
    render(<OrderConfirmationPage />);
    expect(screen.getByRole("status", { name: "Loading your order" })).toBeInTheDocument();
  });

  it("reads the order with the URL token and its own shop slug", async () => {
    lookupOrder.mockResolvedValue(makeOrder());
    await renderPage();
    expect(lookupOrder).toHaveBeenCalledWith(TOKEN, "rose");
  });

  it("shows the per-shop number, never the global id", async () => {
    lookupOrder.mockResolvedValue(makeOrder());
    await renderPage();
    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("9001");
  });

  it("says Payment received only when the server says paid", async () => {
    lookupOrder.mockResolvedValue(makeOrder({ ...ONLINE_UNPAID, paymentStatus: "paid" }));
    await renderPage();
    expect(screen.getByText(/Payment received\./)).toBeInTheDocument();
  });

  it("does NOT say paid for ?paid=1 when the server still has the online order unpaid", async () => {
    lookupOrder.mockResolvedValue(makeOrder({ ...ONLINE_UNPAID }));
    await renderPage();
    expect(screen.getByText(/Confirming your payment\.\.\./)).toBeInTheDocument();
    expect(screen.queryByText(/Payment received/)).not.toBeInTheDocument();
  });

  it("does NOT say paid for ?paid=1 on a pay-on-delivery order", async () => {
    lookupOrder.mockResolvedValue(makeOrder());
    await renderPage();
    expect(screen.getByText(/You will pay when your order is delivered/)).toBeInTheDocument();
    expect(screen.queryByText(/Payment received/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirming your payment/)).not.toBeInTheDocument();
  });

  it("reads right for pay on pickup", async () => {
    lookupOrder.mockResolvedValue(makeOrder({ orderType: "pickup", paymentMethod: "cash_on_pickup", deliveryAddress: null, deliveryFee: "0" }));
    await renderPage();
    expect(screen.getByText(/You will pay when you collect your order/)).toBeInTheDocument();
  });

  it("polls while confirming and stops as soon as the server reports paid", async () => {
    lookupOrder
      .mockResolvedValueOnce(makeOrder({ ...ONLINE_UNPAID }))
      .mockResolvedValueOnce(makeOrder({ ...ONLINE_UNPAID }))
      .mockResolvedValue(makeOrder({ ...ONLINE_UNPAID, paymentStatus: "paid" }));
    await renderPage();
    expect(lookupOrder).toHaveBeenCalledTimes(1);
    await tick(2000);
    expect(lookupOrder).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Confirming your payment/)).toBeInTheDocument();
    await tick(2000);
    expect(lookupOrder).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/Payment received\./)).toBeInTheDocument();
    await tickEvery2s(15);
    expect(lookupOrder).toHaveBeenCalledTimes(3);
  });

  it("gives up after the bounded window with a calm message, and Check again polls again", async () => {
    lookupOrder.mockResolvedValue(makeOrder({ ...ONLINE_UNPAID }));
    await renderPage();
    await tickEvery2s(30);
    // 1 initial read + 20 ticks, then silence.
    expect(lookupOrder).toHaveBeenCalledTimes(21);
    expect(screen.getByText(/We have not received confirmation of your payment yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Payment received/)).not.toBeInTheDocument();
    await tickEvery2s(30);
    expect(lookupOrder).toHaveBeenCalledTimes(21);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    });
    await tick(4000);
    expect(lookupOrder.mock.calls.length).toBeGreaterThan(21);
    expect(screen.getByText(/Confirming your payment/)).toBeInTheDocument();
  });

  it("does not poll while the tab is hidden", async () => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    lookupOrder.mockResolvedValue(makeOrder({ ...ONLINE_UNPAID }));
    await renderPage();
    await tick(20000);
    expect(lookupOrder).toHaveBeenCalledTimes(1);
  });

  it("shows a failed payment as failed and does not poll", async () => {
    lookupOrder.mockResolvedValue(makeOrder({ ...ONLINE_UNPAID, paymentFailed: true }));
    await renderPage();
    expect(screen.getByRole("heading", { name: /Your payment did not go through/ })).toBeInTheDocument();
    await tick(10000);
    expect(lookupOrder).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Payment received/)).not.toBeInTheDocument();
  });

  it("shows a cancelled order as cancelled with no progress timeline", async () => {
    lookupOrder.mockResolvedValue(makeOrder({ ...ONLINE_UNPAID, status: "cancelled" }));
    await renderPage();
    expect(screen.getByRole("heading", { name: /This order was cancelled/ })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Order progress" })).not.toBeInTheDocument();
    await tick(10000);
    expect(lookupOrder).toHaveBeenCalledTimes(1);
  });

  it("renders the status timeline for the order status", async () => {
    lookupOrder.mockResolvedValue(makeOrder({ status: "preparing" }));
    await renderPage();
    const list = screen.getByRole("list", { name: "Order progress" });
    expect(list.querySelector('[aria-current="step"]')?.textContent).toContain("Preparing");
  });

  it("delivery: address, region, date, slot, fee and total", async () => {
    lookupOrder.mockResolvedValue(makeOrder());
    await renderPage();
    expect(screen.getByText("9 Palm Street")).toBeInTheDocument();
    expect(screen.getByText("Marina, Dubai")).toBeInTheDocument();
    expect(screen.getByText(/10:00 - 11:00/)).toBeInTheDocument();
    expect(screen.getByText("Delivery fee")).toBeInTheDocument();
    expect(screen.getByText(/^15\.00/)).toBeInTheDocument();
    expect(screen.getByText(/^215\.00/)).toBeInTheDocument();
    expect(screen.queryByText("Pickup")).not.toBeInTheDocument();
  });

  it("delivery with a zero fee says Free", async () => {
    lookupOrder.mockResolvedValue(makeOrder({ deliveryFee: "0" }));
    await renderPage();
    expect(screen.getByText("Free")).toBeInTheDocument();
  });

  it("pickup: the outlet location and no delivery fee or address", async () => {
    lookupOrder.mockResolvedValue(
      makeOrder({
        orderType: "pickup",
        paymentMethod: "cash_on_pickup",
        deliveryAddress: null,
        deliveryFee: "0",
        pickupLocation: { name: "Downtown Branch", area: "Downtown", phone: "+971 4 000 0000", latitude: 25.2, longitude: 55.27 },
      }),
    );
    await renderPage();
    expect(screen.getByRole("heading", { name: "Pickup" })).toBeInTheDocument();
    expect(screen.getByText("Downtown Branch")).toBeInTheDocument();
    expect(screen.queryByText("Delivery fee")).not.toBeInTheDocument();
    expect(screen.queryByText("9 Palm Street")).not.toBeInTheDocument();
  });

  it("formats a three-decimal currency with three decimals, from the order's own currency", async () => {
    lookupOrder.mockResolvedValue(
      makeOrder({
        currency: "KWD",
        items: [{ productName: "Roses", variantLabel: null, quantity: 3, priceAtPurchase: "10.505", lineTotal: "31.515", imageUrl: null, note: null }],
        subtotal: "31.515",
        deliveryFee: "1.5",
        total: "33.015",
        amountDue: "33.015",
      }),
    );
    await renderPage();
    expect(screen.getByText("10.505 KWD", { exact: false, selector: "span" })).toBeInTheDocument();
    expect(screen.getAllByText("31.515 KWD").length).toBeGreaterThan(0);
    expect(screen.getByText("33.015 KWD")).toBeInTheDocument();
    expect(screen.getByText("1.500 KWD")).toBeInTheDocument();
  });

  it("shows discount, tax, gift card and store credit rows only when they have an amount, plus the amount due", async () => {
    lookupOrder.mockResolvedValue(
      makeOrder({
        discountAmount: "10",
        discountCode: "SAVE10",
        taxAmount: "9.5",
        giftCardAmount: "20",
        storeCreditAmount: "5",
        total: "209.5",
        amountDue: "184.5",
      }),
    );
    await renderPage();
    expect(screen.getByText("Discount (SAVE10)")).toBeInTheDocument();
    expect(screen.getByText("Tax")).toBeInTheDocument();
    expect(screen.getByText("Gift card")).toBeInTheDocument();
    expect(screen.getByText("Store credit")).toBeInTheDocument();
    expect(screen.getByText("Amount due")).toBeInTheDocument();
    expect(screen.getByText(/^184\.50/)).toBeInTheDocument();
  });

  it("omits zero or missing optional rows", async () => {
    lookupOrder.mockResolvedValue(makeOrder({ discountAmount: "0", taxAmount: "0", giftCardAmount: null, storeCreditAmount: "0" }));
    await renderPage();
    for (const label of ["Tax", "Includes tax", "Gift card", "Store credit", "Amount due"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/^Discount/)).not.toBeInTheDocument();
  });

  it("labels tax as included on a tax-inclusive order", async () => {
    lookupOrder.mockResolvedValue(makeOrder({ taxAmount: "9.5", taxInclusive: true }));
    await renderPage();
    expect(screen.getByText("Includes tax")).toBeInTheDocument();
  });

  it("links to the shop's contact, the tracking page and back to the shop (path mode)", async () => {
    lookupOrder.mockResolvedValue(makeOrder());
    await renderPage();
    expect(screen.getByRole("link", { name: /WhatsApp/ }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\/971501112222\?text=/);
    expect(screen.getByRole("link", { name: /\+971 4 123 4567/ }).getAttribute("href")).toBe("tel:+971 4 123 4567");
    expect(screen.getByRole("link", { name: "Track order" }).getAttribute("href")).toBe(`/rose/orders/track?token=${TOKEN}`);
    expect(screen.getByRole("link", { name: "Continue shopping" }).getAttribute("href")).toBe("/rose");
  });

  it("uses the bare paths on a subdomain or custom domain (no shop prefix)", async () => {
    shopState.value = { ...shopState.value, shopBasePath: "" };
    lookupOrder.mockResolvedValue(makeOrder());
    await renderPage();
    expect(screen.getByRole("link", { name: "Track order" }).getAttribute("href")).toBe(`/orders/track?token=${TOKEN}`);
    expect(screen.getByRole("link", { name: "Continue shopping" }).getAttribute("href")).toBe("/");
  });

  it("shows an error with Try again, and recovers on retry (never a permanent skeleton)", async () => {
    lookupOrder.mockRejectedValueOnce(new HttpError("Request failed (500)", 500)).mockResolvedValueOnce(makeOrder());
    await renderPage();
    expect(screen.getByRole("alert").textContent).toContain("We could not load your order");
    expect(screen.queryByRole("status", { name: "Loading your order" })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(screen.getByText("#7")).toBeInTheDocument();
  });

  it("says the order was not found on a 404", async () => {
    lookupOrder.mockRejectedValue(new HttpError("No order found for that tracking code", 404));
    await renderPage();
    expect(screen.getByRole("alert").textContent).toContain("We could not find that order");
  });

  it("a sequential order id in the URL opens nothing and makes no request", async () => {
    for (const id of ["1", "123", "9001", "123456789", "../9001", "123abc"]) {
      params.value = { shop: "rose", token: id };
      lookupOrder.mockReset();
      const { unmount } = await renderPage();
      expect(lookupOrder).not.toHaveBeenCalled();
      expect(screen.getByText(/We cannot open this order from here/)).toBeInTheDocument();
      expect(screen.queryByText("#7")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("sends the stashed purchase event and clears the cart only once the server says paid", async () => {
    sessionStorage.setItem("requital_purchase:9001", JSON.stringify({ transactionId: "9001", value: 215, currency: "AED", items: [] }));
    lookupOrder.mockResolvedValue(makeOrder({ ...ONLINE_UNPAID }));
    await renderPage();
    // ?paid=1 is in the URL, but the server says unpaid: nothing fires.
    expect(trackFn).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("requital_purchase:9001")).not.toBeNull();

    lookupOrder.mockResolvedValue(makeOrder({ ...ONLINE_UNPAID, paymentStatus: "paid" }));
    await tick(2000);
    expect(trackFn).toHaveBeenCalledTimes(1);
    expect(trackFn).toHaveBeenCalledWith("purchase", expect.objectContaining({ transactionId: "9001" }));
    expect(clear).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("requital_purchase:9001")).toBeNull();
  });

  it("does not clear a cart for a paid order this browser did not just check out", async () => {
    lookupOrder.mockResolvedValue(makeOrder({ ...ONLINE_UNPAID, paymentStatus: "paid" }));
    await renderPage();
    expect(clear).not.toHaveBeenCalled();
    expect(trackFn).not.toHaveBeenCalled();
  });
});
