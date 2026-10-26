import { beforeEach, describe, expect, it } from "vitest";
import {
  attemptEnded,
  checkoutAttemptKey,
  discardCheckoutAttempt,
  hasCheckoutAttempt,
  payloadSignature,
} from "./checkout-attempt";

beforeEach(() => sessionStorage.clear());

const KEY_SHAPE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{22,64})$/i;

describe("checkout attempt key", () => {
  it("is stable for the same request, a key the server accepts, and per shop", async () => {
    const a = await checkoutAttemptKey("shop-a", "sig");
    expect(a).toMatch(KEY_SHAPE);
    expect(await checkoutAttemptKey("shop-a", "sig")).toBe(a);
    expect(await checkoutAttemptKey("shop-b", "sig")).not.toBe(a);
  });

  it("changes when the request changes, and after it is discarded or expires", async () => {
    const a = await checkoutAttemptKey("s", "one", 1_000);
    expect(await checkoutAttemptKey("s", "two", 1_001)).not.toBe(a);
    const b = await checkoutAttemptKey("s", "two", 1_002);
    discardCheckoutAttempt("s");
    expect(await checkoutAttemptKey("s", "two", 1_003)).not.toBe(b);
    const c = await checkoutAttemptKey("s", "two", 5_000);
    expect(await checkoutAttemptKey("s", "two", 5_000 + 3 * 60 * 60 * 1000)).not.toBe(c);
  });

  it("stores a hash of the request, never the request (name, phone and address stay out of sessionStorage)", async () => {
    const signature = JSON.stringify({ customerName: "Aisha Rahman", customerPhone: "0501234567", customerAddress: "Villa 9" });
    await checkoutAttemptKey("s", signature);
    const raw = sessionStorage.getItem("requital_checkout_attempt:s")!;
    expect(raw).not.toContain("Aisha");
    expect(raw).not.toContain("0501234567");
    expect(raw).not.toContain("Villa");
    expect(JSON.parse(raw).signature).toMatch(/^[0-9a-f]{16,64}$/);
  });

  it("hasCheckoutAttempt reflects what is stored", async () => {
    expect(hasCheckoutAttempt("s")).toBe(false);
    await checkoutAttemptKey("s", "sig");
    expect(hasCheckoutAttempt("s")).toBe(true);
    discardCheckoutAttempt("s");
    expect(hasCheckoutAttempt("s")).toBe(false);
  });

  it("works with unusable storage (a fresh key each time, never throws)", async () => {
    const spy = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(await checkoutAttemptKey("s", "sig")).toMatch(KEY_SHAPE);
      expect(() => discardCheckoutAttempt("s")).not.toThrow();
      expect(hasCheckoutAttempt("s")).toBe(false);
    } finally {
      Object.defineProperty(window, "sessionStorage", spy);
    }
  });
});

describe("payloadSignature", () => {
  it("ignores key order and undefined, differs when a value does", () => {
    expect(payloadSignature({ a: 1, b: { c: 2, d: undefined } })).toBe(payloadSignature({ b: { c: 2 }, a: 1 }));
    expect(payloadSignature({ items: [{ q: 1 }] })).not.toBe(payloadSignature({ items: [{ q: 2 }] }));
  });
});

describe("attemptEnded", () => {
  it("is true only for the server's attempt-over codes", () => {
    for (const c of ["payment_unavailable", "idempotency_key_reused", "checkout_attempt_closed"]) {
      expect(attemptEnded(c)).toBe(true);
    }
    expect(attemptEnded("something_else")).toBe(false);
    expect(attemptEnded(undefined)).toBe(false);
  });
});
