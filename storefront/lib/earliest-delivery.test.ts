import { describe, expect, it } from "vitest";
import { resolveEarliestDeliveryLabel } from "./earliest-delivery";

const DUBAI = "Asia/Dubai"; // UTC+4, no DST

describe("resolveEarliestDeliveryLabel", () => {
  it("returns null when no cutoff is configured (feature off)", () => {
    expect(resolveEarliestDeliveryLabel(null, DUBAI)).toBeNull();
    expect(resolveEarliestDeliveryLabel(undefined, DUBAI)).toBeNull();
    expect(resolveEarliestDeliveryLabel("", DUBAI)).toBeNull();
  });

  it("returns null for a malformed cutoff string", () => {
    expect(resolveEarliestDeliveryLabel("6pm", DUBAI)).toBeNull();
    expect(resolveEarliestDeliveryLabel("25:00", DUBAI)).toBeNull();
    expect(resolveEarliestDeliveryLabel("18:70", DUBAI)).toBeNull();
  });

  it("'Today' before the cutoff, 'Tomorrow' after it, in the SHOP timezone", () => {
    // 2026-09-15T12:00:00Z = 16:00 in Dubai. Cutoff 18:00 → Today; 15:00 → Tomorrow.
    const now = new Date("2026-09-15T12:00:00Z");
    expect(resolveEarliestDeliveryLabel("18:00", DUBAI, now)).toBe("Today");
    expect(resolveEarliestDeliveryLabel("15:00", DUBAI, now)).toBe("Tomorrow");
  });

  it("'Today' exactly at the cutoff minute", () => {
    const now = new Date("2026-09-15T14:00:00Z"); // 18:00 in Dubai
    expect(resolveEarliestDeliveryLabel("18:00", DUBAI, now)).toBe("Today");
  });

  it("uses the shop timezone, not the server/browser one", () => {
    // 2026-09-15T17:00:00Z: 21:00 in Dubai (past a 20:00 cutoff → Tomorrow),
    // but 10:00 in Los Angeles that same day (well before it → Today).
    const now = new Date("2026-09-15T17:00:00Z");
    expect(resolveEarliestDeliveryLabel("20:00", DUBAI, now)).toBe("Tomorrow");
    expect(resolveEarliestDeliveryLabel("20:00", "America/Los_Angeles", now)).toBe("Today");
  });

  it("returns null (fails closed) for an invalid timezone", () => {
    expect(resolveEarliestDeliveryLabel("18:00", "Not/AZone", new Date("2026-09-15T12:00:00Z"))).toBeNull();
  });
});
