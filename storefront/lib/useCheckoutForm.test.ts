import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createOrder, HttpError } from "@/lib/api";
import { useCheckoutForm } from "./useCheckoutForm";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

let mockQuantity = 1;
vi.mock("@/lib/cart", () => ({
  useCart: () => ({
    items: [{ productId: 1, name: "Item", price: 10, quantity: mockQuantity, thumbnail: "" }],
    subtotal: 10,
    discountCode: undefined,
    giftCardCode: undefined,
    outletId: 1,
    clear: vi.fn(),
  }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ customer: null }),
}));

vi.mock("@/lib/payment-methods", () => ({
  resolvePaymentMethods: () => ["cod"],
}));

vi.mock("@/lib/api", () => ({
  HttpError: class HttpError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string,
    ) {
      super(message);
    }
  },
  captureAbandonedCart: vi.fn(),
  createOrder: vi.fn(),
  listMyAddresses: vi.fn().mockResolvedValue([]),
}));

let mockOutlets: { id: number; name: string; deliveryEnabled: boolean; pickupEnabled: boolean; isOpen: boolean }[] = [];
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({
    shopSlug: "test-shop",
    shopBasePath: "",
    shop: { currency: "AED" },
    outlets: mockOutlets,
  }),
}));

// useCheckoutForm.canSubmit gates the real submit button (see
// CheckoutSinglePage/CheckoutSteps) on `selectedOutlet.isOpen` — this is the
// single place that logic lives, so it's tested at the hook level rather
// than duplicated per checkout layout preset.
describe("useCheckoutForm — outlet open/closed gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks submit when the only available outlet is closed (Force Closed or Active=false — both surface as isOpen: false)", async () => {
    mockOutlets = [{ id: 1, name: "Main", deliveryEnabled: true, pickupEnabled: false, isOpen: false }];
    const { result } = renderHook(() => useCheckoutForm());

    await waitFor(() => expect(result.current.selectedOutlet?.id).toBe(1));
    expect(result.current.selectedOutlet?.isOpen).toBe(false);
    expect(result.current.canSubmit).toBe(false);
  });

  it("allows submit once the outlet is open and the auto-selected order type/payment method resolve", async () => {
    mockOutlets = [{ id: 1, name: "Main", deliveryEnabled: true, pickupEnabled: false, isOpen: true }];
    const { result } = renderHook(() => useCheckoutForm());

    await waitFor(() => expect(result.current.selectedOutlet?.id).toBe(1));
    expect(result.current.selectedOutlet?.isOpen).toBe(true);
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
  });
});

describe("useCheckoutForm - submit safety and reasons", () => {
  const openOutlet = [{ id: 1, name: "Main", deliveryEnabled: true, pickupEnabled: false, isOpen: true }];
  const submitEvent = { preventDefault: () => {} } as React.FormEvent;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOutlets = openOutlet;
    mockQuantity = 1;
    sessionStorage.clear();
  });

  it("says why Place order is off when a date is picked without a time slot", async () => {
    const { result } = renderHook(() => useCheckoutForm());
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    expect(result.current.blockedReason).toBeNull();

    act(() => result.current.setDeliveryDate("2999-01-01"));
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.blockedReason).toMatch(/time slot/i);

    act(() => result.current.setDeliveryTimeSlot("9:00 AM - 10:00 AM"));
    expect(result.current.canSubmit).toBe(true);
    expect(result.current.blockedReason).toBeNull();
  });

  it("sends one order for two submits in the same tick", async () => {
    vi.mocked(createOrder).mockResolvedValue({
      order: { id: 1, total: "10", currency: "AED", trackingToken: "t" },
      checkoutUrl: null,
    } as never);
    const { result } = renderHook(() => useCheckoutForm());
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    await act(async () => {
      void result.current.handleSubmit(submitEvent);
      void result.current.handleSubmit(submitEvent);
    });
    // The key is hashed with Web Crypto first, so the request goes out a moment
    // after both events; wait for it, then for the submit to finish.
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.submitting).toBe(false));
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("stays locked while the browser leaves for the payment gateway", async () => {
    vi.mocked(createOrder).mockResolvedValue({
      order: { id: 1, total: "10", currency: "AED", trackingToken: "t" },
      checkoutUrl: "https://pay.example/session",
    } as never);
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { href: "" } });
    try {
      const { result } = renderHook(() => useCheckoutForm());
      await waitFor(() => expect(result.current.canSubmit).toBe(true));
      await act(async () => {
        await result.current.handleSubmit(submitEvent);
      });
      expect(window.location.href).toBe("https://pay.example/session");
      expect(result.current.submitting).toBe(true);
      expect(result.current.canSubmit).toBe(false);
      await act(async () => {
        await result.current.handleSubmit(submitEvent);
      });
      expect(createOrder).toHaveBeenCalledTimes(1);

      // A pageshow that is NOT a back/forward-cache restore changes nothing.
      act(() => {
        window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
      });
      expect(result.current.submitting).toBe(true);
      // Coming back from the gateway via Back (bfcache) unlocks the button.
      act(() => {
        window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
      });
      expect(result.current.submitting).toBe(false);
      expect(result.current.canSubmit).toBe(true);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  it("unlocks after a failed order so the shopper can retry", async () => {
    vi.mocked(createOrder).mockRejectedValueOnce(new Error("Out of stock"));
    const { result } = renderHook(() => useCheckoutForm());
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    await act(async () => {
      await result.current.handleSubmit(submitEvent);
    });
    expect(result.current.error).toBe("Out of stock");
    expect(result.current.canSubmit).toBe(true);
  });
});

// F8: one idempotency key per checkout ATTEMPT, so a retry of the same attempt is the
// same order and a changed or finished attempt is a new one.
describe("useCheckoutForm - idempotent checkout attempts", () => {
  const openOutlet = [{ id: 1, name: "Main", deliveryEnabled: true, pickupEnabled: false, isOpen: true }];
  const submitEvent = { preventDefault: () => {} } as React.FormEvent;
  const keyOf = (call: number) => (vi.mocked(createOrder).mock.calls[call][1] as { idempotencyKey?: string }).idempotencyKey;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOutlets = openOutlet;
    mockQuantity = 1;
    sessionStorage.clear();
  });

  async function submit(result: { current: ReturnType<typeof useCheckoutForm> }) {
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    await act(async () => {
      await result.current.handleSubmit(submitEvent);
    });
  }

  it("sends a key, and the SAME key when an unchanged order is retried after a dropped connection", async () => {
    vi.mocked(createOrder).mockRejectedValueOnce(new Error("Failed to fetch")).mockRejectedValueOnce(new Error("Failed to fetch"));
    const { result } = renderHook(() => useCheckoutForm());
    await submit(result);
    await submit(result);
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(keyOf(0)).toMatch(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{22,64})$/i);
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it("uses a NEW key once the cart changes", async () => {
    vi.mocked(createOrder).mockRejectedValue(new Error("Failed to fetch"));
    const { result, rerender } = renderHook(() => useCheckoutForm());
    await submit(result);
    mockQuantity = 3;
    rerender();
    await submit(result);
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it("starts a NEW attempt after the server ends this one (the payment gateway failed), and shows the safe message", async () => {
    vi.mocked(createOrder).mockRejectedValueOnce(
      new HttpError("We could not start your online payment. Your order was not placed.", 503, "payment_unavailable"),
    );
    const { result } = renderHook(() => useCheckoutForm());
    await submit(result);
    expect(result.current.error).toMatch(/could not start your online payment/i);
    expect(result.current.canSubmit).toBe(true);
    vi.mocked(createOrder).mockRejectedValueOnce(new Error("Failed to fetch"));
    await submit(result);
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it("keeps the key while leaving for the gateway, so Back and submit again is the same order", async () => {
    vi.mocked(createOrder).mockResolvedValue({
      order: { id: 1, total: "10", currency: "AED", trackingToken: "t" },
      checkoutUrl: "https://pay.example/session",
    } as never);
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { href: "" } });
    try {
      const { result } = renderHook(() => useCheckoutForm());
      await submit(result);
      // Back from the gateway (bfcache restore) unlocks the button.
      act(() => {
        window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
      });
      await submit(result);
      expect(createOrder).toHaveBeenCalledTimes(2);
      expect(keyOf(1)).toBe(keyOf(0));
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  it("drops the key after an order that completes without leaving the site", async () => {
    vi.mocked(createOrder).mockResolvedValue({
      order: { id: 1, total: "10", currency: "AED", trackingToken: "t" },
      checkoutUrl: null,
    } as never);
    const { result } = renderHook(() => useCheckoutForm());
    await submit(result);
    await submit(result);
    expect(keyOf(1)).not.toBe(keyOf(0));
  });
});
