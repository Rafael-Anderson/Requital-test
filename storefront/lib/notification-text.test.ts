import { describe, expect, it } from "vitest";
import { parseJsonField, parseNotificationMessages } from "./notification-text";

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

describe("parseJsonField", () => {
  describe("contactNumbers shape (string[], fallback [])", () => {
    it("returns a real array as-is", () => {
      expect(parseJsonField<string[]>(["+971500000000"], [])).toEqual(["+971500000000"]);
    });

    it("parses a JSON-stringified array back into a real array (the actual production bug shape)", () => {
      expect(parseJsonField<string[]>('["+971500000000","+971511111111"]', [])).toEqual([
        "+971500000000",
        "+971511111111",
      ]);
    });

    it("returns [] for a JSON-stringified empty array (the exact shape that crashed arabian-petals-com/paradise)", () => {
      expect(parseJsonField<string[]>("[]", [])).toEqual([]);
    });

    it("returns the fallback for null", () => {
      expect(parseJsonField<string[]>(null, [])).toEqual([]);
    });

    it("returns the fallback for undefined", () => {
      expect(parseJsonField<string[]>(undefined, [])).toEqual([]);
    });

    it("returns the fallback (not a wrapped array) for a non-JSON string — unlike parseNotificationMessages, this data has no sensible single-item fallback", () => {
      expect(parseJsonField<string[]>("not valid json", [])).toEqual([]);
    });
  });

  describe("colors shape (Record<string, string>, fallback {})", () => {
    it("returns a real object as-is", () => {
      expect(parseJsonField<Record<string, string>>({ buttonColor: "#069494" }, {})).toEqual({
        buttonColor: "#069494",
      });
    });

    it("parses a JSON-stringified object back into a real object (the actual production bug shape)", () => {
      expect(parseJsonField<Record<string, string>>('{"buttonColor":"#069494"}', {})).toEqual({
        buttonColor: "#069494",
      });
    });

    it("returns {} for a JSON-stringified empty object", () => {
      expect(parseJsonField<Record<string, string>>("{}", {})).toEqual({});
    });

    it("returns the fallback for null", () => {
      expect(parseJsonField<Record<string, string>>(null, {})).toEqual({});
    });

    it("returns the fallback for undefined", () => {
      expect(parseJsonField<Record<string, string>>(undefined, {})).toEqual({});
    });

    it("returns the fallback for a non-JSON string", () => {
      expect(parseJsonField<Record<string, string>>("not valid json", {})).toEqual({});
    });
  });
});
