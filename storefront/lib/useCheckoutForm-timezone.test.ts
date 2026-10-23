import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useCheckoutForm } from "./useCheckoutForm";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
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
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ customer: null }) }));
vi.mock("@/lib/payment-methods", () => ({ resolvePaymentMethods: () => ["cod"] }));
vi.mock("@/lib/api", () => ({
  captureAbandonedCart: vi.fn(),
  createOrder: vi.fn(),
  listMyAddresses: vi.fn().mockResolvedValue([]),
}));

let mockTimezone: string | undefined = "Asia/Dubai";
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({
    shopSlug: "test-shop",
    shopBasePath: "",
    shop: {
      currency: "AED",
      timezone: mockTimezone,
      deliveryHours: { thu: { closed: false, open: "09:00", close: "21:00" } },
      deliveryTimeSlotGapMinutes: 60,
      allowSameDayOrders: false,
    },
    outlets: [{ id: 1, name: "Main", deliveryEnabled: true, pickupEnabled: false, isOpen: true }],
  }),
}));

// F4: the browser is in Los Angeles, the shop in Dubai (eleven hours ahead).
const prevTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
  if (prevTz === undefined) delete process.env.TZ;
  else process.env.TZ = prevTz;
});

function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

describe("useCheckoutForm reads today and now in the shop's timezone", () => {
  beforeEach(() => {
    mockTimezone = "Asia/Dubai";
  });

  it("calls the shop's day today, and blocks it when same-day orders are off", async () => {
    at("2026-10-21T22:30:00Z"); // Thu 02:30 in Dubai, Wed 15:30 in Los Angeles
    const { result } = renderHook(() => useCheckoutForm());
    await waitFor(() => expect(result.current.selectedOutlet?.id).toBe(1));
    expect(result.current.minDate).toBe("2026-10-22");
    act(() => result.current.setDeliveryDate("2026-10-22"));
    expect(result.current.dateBlocked).toBe(true);
    act(() => result.current.setDeliveryDate("2026-10-21"));
    expect(result.current.dateBlocked).toBe(false);
  });

  it("applies the same-day cutoff on the shop's clock, not the browser's", async () => {
    at("2026-10-22T10:00:00Z"); // 14:00 in Dubai, 03:00 in Los Angeles
    const { result } = renderHook(() => useCheckoutForm());
    await waitFor(() => expect(result.current.selectedOutlet?.id).toBe(1));
    act(() => result.current.setDeliveryDate("2026-10-22"));
    expect(result.current.timeSlots[0]).toBe("2:00 PM - 3:00 PM");
    expect(result.current.todayFullyBooked).toBe(false);
    // a later day is never cutoff-filtered, and is read against its own weekday
    act(() => result.current.setDeliveryDate("2026-10-29"));
    expect(result.current.timeSlots[0]).toBe("9:00 AM - 10:00 AM");
  });

  it("has no slots left today once the shop has closed, whatever the browser's hour", async () => {
    at("2026-10-22T18:30:00Z"); // 22:30 in Dubai, 11:30 in Los Angeles
    const { result } = renderHook(() => useCheckoutForm());
    await waitFor(() => expect(result.current.selectedOutlet?.id).toBe(1));
    expect(result.current.todayFullyBooked).toBe(true);
  });

  it("fails closed on an invalid timezone: no same-day slots, later days still work", async () => {
    mockTimezone = "Not/AZone";
    at("2026-10-22T10:00:00Z");
    const { result } = renderHook(() => useCheckoutForm());
    await waitFor(() => expect(result.current.selectedOutlet?.id).toBe(1));
    expect(result.current.todayFullyBooked).toBe(true);
    act(() => result.current.setDeliveryDate(result.current.minDate));
    expect(result.current.timeSlots).toEqual([]);
  });
});
