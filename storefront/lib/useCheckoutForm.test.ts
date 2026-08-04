import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
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
