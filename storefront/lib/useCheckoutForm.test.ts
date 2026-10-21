import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createOrder } from "@/lib/api";
import { useCheckoutForm } from "./useCheckoutForm";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/cart", () => ({
  useCart: () => ({
    items: [{ productId: 1, name: "Item", price: 10, quantity: 1, thumbnail: "" }],
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
