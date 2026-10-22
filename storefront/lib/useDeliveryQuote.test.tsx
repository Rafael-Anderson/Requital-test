import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { CartItem } from "@/lib/cart";
import type { DeliveryQuote } from "@/lib/api";
import { buildQuoteRequest, quoteBlocksSubmit, useDeliveryQuote } from "./useDeliveryQuote";

const quoteDelivery = vi.fn();
vi.mock("@/lib/api", () => ({ quoteDelivery: (...a: unknown[]) => quoteDelivery(...a) }));

const item = (over: Partial<CartItem> = {}): CartItem => ({
  productId: 1,
  name: "Rose",
  price: 10,
  thumbnail: "",
  quantity: 2,
  maxStock: null,
  ...over,
});
const base = { items: [item()], outletId: 5, orderType: "delivery" as const, regionId: null, area: "", coords: null, discountCode: null };
const quote = (over: Partial<DeliveryQuote> = {}): DeliveryQuote => ({
  status: "quoted", reason: null, zone: null, currency: "AED", subtotal: "20", discountAmount: "0",
  discountCode: null, taxAmount: "1", deliveryFee: "15", total: "36", ...over,
});

afterEach(() => {
  cleanup();
  quoteDelivery.mockReset();
  vi.useRealTimers();
});

describe("buildQuoteRequest", () => {
  it("is null until a delivery address gives something to place (never a guess)", () => {
    expect(buildQuoteRequest(base)).toBeNull();
    expect(buildQuoteRequest({ ...base, regionId: 3 })).not.toBeNull();
    expect(buildQuoteRequest({ ...base, coords: { latitude: 1, longitude: 2 } })).not.toBeNull();
  });
  it("marks a typed-address quote only while Maps is unavailable and no pin exists (F9)", () => {
    const withArea = { ...base, area: "Jumeirah" };
    expect(buildQuoteRequest(withArea)!.addressManual).toBeUndefined();
    expect(buildQuoteRequest({ ...withArea, addressManual: true })!.addressManual).toBe(true);
    // A real pin always wins: the flag is dropped.
    expect(
      buildQuoteRequest({ ...withArea, addressManual: true, coords: { latitude: 1, longitude: 2 } })!.addressManual,
    ).toBeUndefined();
    // Pickup never carries it.
    expect(buildQuoteRequest({ ...withArea, orderType: "pickup", addressManual: true })!.addressManual).toBeUndefined();
  });
  it("needs no address for pickup and drops delivery-only fields", () => {
    const r = buildQuoteRequest({ ...base, orderType: "pickup", regionId: 3, area: "x", coords: { latitude: 1, longitude: 2 } })!;
    expect(r).toMatchObject({ orderType: "pickup", outletId: 5 });
    expect(r.regionId).toBeUndefined();
    expect(r.latitude).toBeUndefined();
  });
  it("is null with no outlet or an empty cart, and sends gift card amounts as the line price", () => {
    expect(buildQuoteRequest({ ...base, outletId: null, regionId: 3 })).toBeNull();
    expect(buildQuoteRequest({ ...base, items: [], regionId: 3 })).toBeNull();
    const r = buildQuoteRequest({ ...base, regionId: 3, items: [item({ isGiftCard: true, price: 50 })] })!;
    expect(r.items[0].giftCardAmount).toBe(50);
  });
});

describe("quoteBlocksSubmit", () => {
  it("blocks while loading and on a server rejection, not on idle, error or a good quote", () => {
    expect(quoteBlocksSubmit({ phase: "loading" })).toBe(true);
    expect(quoteBlocksSubmit({ phase: "ready", quote: quote({ status: "unavailable", reason: "Out of range", total: null }) })).toBe(true);
    expect(quoteBlocksSubmit({ phase: "ready", quote: quote({ status: "needs_address", reason: "Location required" }) })).toBe(true);
    expect(quoteBlocksSubmit({ phase: "ready", quote: quote({ status: "needs_address", reason: null }) })).toBe(false);
    expect(quoteBlocksSubmit({ phase: "ready", quote: quote() })).toBe(false);
    expect(quoteBlocksSubmit({ phase: "idle" })).toBe(false);
    expect(quoteBlocksSubmit({ phase: "error", message: "x" })).toBe(false);
  });
});

describe("useDeliveryQuote", () => {
  beforeEach(() => vi.useFakeTimers());

  it("is idle with no request and never calls the API", () => {
    const { result } = renderHook(() => useDeliveryQuote("s", null));
    expect(result.current.state.phase).toBe("idle");
    vi.advanceTimersByTime(2000);
    expect(quoteDelivery).not.toHaveBeenCalled();
  });

  it("debounces, then resolves to ready", async () => {
    quoteDelivery.mockResolvedValue(quote());
    const req = buildQuoteRequest({ ...base, regionId: 3 });
    const { result } = renderHook(() => useDeliveryQuote("s", req));
    expect(result.current.state.phase).toBe("loading");
    expect(quoteDelivery).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(quoteDelivery).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ phase: "ready", quote: quote() });
  });

  it("aborts the stale request when the inputs change and shows only the latest answer", async () => {
    const signals: AbortSignal[] = [];
    quoteDelivery.mockImplementation((_s: string, r: { regionId?: number }, signal: AbortSignal) => {
      signals.push(signal);
      return Promise.resolve(quote({ zone: `region-${r.regionId}` }));
    });
    let region = 3;
    const { result, rerender } = renderHook(() => useDeliveryQuote("s", buildQuoteRequest({ ...base, regionId: region })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    region = 4;
    rerender();
    expect(result.current.state.phase).toBe("loading"); // the old answer is not shown against new inputs
    expect(signals[0].aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current.state).toMatchObject({ phase: "ready", quote: { zone: "region-4" } });
  });

  it("surfaces an error and retry asks again", async () => {
    quoteDelivery.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(quote());
    const req = buildQuoteRequest({ ...base, regionId: 3 });
    const { result } = renderHook(() => useDeliveryQuote("s", req));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current.state).toEqual({ phase: "error", message: "boom" });
    act(() => result.current.retry());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current.state.phase).toBe("ready");
  });
});
