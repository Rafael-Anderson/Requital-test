import { describe, expect, it } from "vitest";
import { derivePaymentView, formatDeliveryDate, isTrackingToken, orderStatusLabel, paymentMethodLabel, paymentStatusLabel, timelineSteps } from "./order-confirmation";

const base = { status: "pending", paymentStatus: "unpaid", onlinePayment: false, paymentFailed: false, orderType: "delivery", paymentMethod: "cash_on_delivery" };

describe("isTrackingToken", () => {
  it("accepts the two issued shapes only", () => {
    expect(isTrackingToken("A".repeat(32))).toBe(true);
    expect(isTrackingToken("a1b2c3d4e5")).toBe(true);
  });
  it("rejects a sequential order id and anything else", () => {
    for (const v of ["1", "123", "9001", "123456789", "", " ", "A".repeat(31), "A".repeat(33), "G".repeat(32), null, undefined]) {
      expect(isTrackingToken(v as string)).toBe(false);
    }
  });
});

describe("derivePaymentView", () => {
  it("is driven by the server order alone", () => {
    expect(derivePaymentView({ ...base, paymentStatus: "paid", onlinePayment: true }, false).kind).toBe("paid");
    expect(derivePaymentView({ ...base, onlinePayment: true, paymentMethod: "card_online" }, false).kind).toBe("confirming");
    expect(derivePaymentView({ ...base, onlinePayment: true, paymentMethod: "card_online" }, true).kind).toBe("unconfirmed");
    expect(derivePaymentView({ ...base, onlinePayment: true, paymentFailed: true }, false).kind).toBe("failed");
    expect(derivePaymentView({ ...base, paymentStatus: "refunded" }, false).kind).toBe("refunded");
  });
  it("cancelled beats everything", () => {
    expect(derivePaymentView({ ...base, status: "cancelled", paymentStatus: "paid" }, false).kind).toBe("cancelled");
  });
  it("tells pay on delivery from pay on pickup", () => {
    expect(derivePaymentView({ ...base, paymentMethod: "card_on_delivery" }, false).kind).toBe("on_delivery");
    expect(derivePaymentView({ ...base, orderType: "pickup", paymentMethod: "cash_on_pickup" }, false).kind).toBe("on_pickup");
    expect(derivePaymentView({ ...base, paymentMethod: "other" }, false).kind).toBe("pay_later");
  });
});

describe("timelineSteps", () => {
  it("marks done, current and upcoming steps", () => {
    const s = timelineSteps("preparing", "delivery");
    expect(s.map((x) => x.state)).toEqual(["done", "done", "current", "upcoming", "upcoming"]);
  });
  it("completes every step when delivered", () => {
    expect(timelineSteps("delivered", "delivery").every((x) => x.state === "done")).toBe(true);
  });
  it("words the last two steps for pickup", () => {
    expect(timelineSteps("pending", "pickup").map((x) => x.label).slice(3)).toEqual(["Ready for pickup", "Collected"]);
  });
});

describe("misc", () => {
  it("formats a date-only string without shifting the day", () => {
    expect(formatDeliveryDate("2026-10-20", "en-GB")).toContain("20");
    expect(formatDeliveryDate("2026-10-20", "en-GB")).toContain("Oct");
    expect(formatDeliveryDate(null)).toBeNull();
    expect(formatDeliveryDate("garbage")).toBeNull();
  });
  it("labels payment methods", () => {
    expect(paymentMethodLabel("card_online")).toBe("Card (online)");
    expect(paymentMethodLabel(null)).toBeNull();
  });
});

describe("orderStatusLabel / paymentStatusLabel", () => {
  it("never prints a raw enum value", () => {
    expect(orderStatusLabel("out_for_delivery", "delivery")).toBe("Out for delivery");
    expect(orderStatusLabel("out_for_delivery", "pickup")).toBe("Ready for pickup");
    expect(orderStatusLabel("delivered", "pickup")).toBe("Collected");
    expect(orderStatusLabel("pending", null)).toBe("Order placed");
    expect(orderStatusLabel("cancelled", "delivery")).toBe("Cancelled");
    expect(orderStatusLabel("on_hold", null)).toBe("On hold");
    expect(paymentStatusLabel("unpaid")).toBe("Unpaid");
    expect(paymentStatusLabel("partially_refunded")).toBe("Partially refunded");
  });
});
