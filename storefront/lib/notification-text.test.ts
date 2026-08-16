import { describe, expect, it } from "vitest";
import { parseNotificationMessages } from "./notification-text";

describe("parseNotificationMessages", () => {
  it("returns a real array as-is", () => {
    expect(parseNotificationMessages(["a", "b"])).toEqual(["a", "b"]);
  });

  it("returns [] for an empty array", () => {
    expect(parseNotificationMessages([])).toEqual([]);
  });

  it("parses a JSON-stringified array back into a real array (the actual production bug shape)", () => {
    expect(parseNotificationMessages('["Special Offer is going on"]')).toEqual(["Special Offer is going on"]);
    expect(parseNotificationMessages('["Top Deals","Free Delivery more than 100 order"]')).toEqual([
      "Top Deals",
      "Free Delivery more than 100 order",
    ]);
  });

  it("returns [] for a JSON-stringified empty array", () => {
    expect(parseNotificationMessages("[]")).toEqual([]);
  });

  it("wraps a plain, non-JSON string into a single-element array", () => {
    expect(parseNotificationMessages("Free shipping today")).toEqual(["Free shipping today"]);
  });

  it("returns [] for an empty string", () => {
    expect(parseNotificationMessages("")).toEqual([]);
  });

  it("wraps valid JSON that isn't an array (e.g. a quoted string) into a single-element array of the raw text", () => {
    expect(parseNotificationMessages('"hello"')).toEqual(['"hello"']);
    expect(parseNotificationMessages("42")).toEqual(["42"]);
  });

  it("returns [] for null", () => {
    expect(parseNotificationMessages(null)).toEqual([]);
  });

  it("returns [] for undefined", () => {
    expect(parseNotificationMessages(undefined)).toEqual([]);
  });
});
