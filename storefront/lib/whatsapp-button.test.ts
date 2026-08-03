import { describe, expect, it } from "vitest";
import { buildWhatsAppUrl, shouldShowWhatsAppButton } from "./whatsapp-button";

describe("shouldShowWhatsAppButton", () => {
  it("is false when the shop has no data at all", () => {
    expect(shouldShowWhatsAppButton(null)).toBe(false);
  });

  it("is false when the toggle is off, even with a number configured", () => {
    expect(shouldShowWhatsAppButton({ whatsappFloatingButtonEnabled: false, whatsappNumber: "501234567" })).toBe(false);
  });

  it("is false when the toggle is on but no number is configured", () => {
    expect(shouldShowWhatsAppButton({ whatsappFloatingButtonEnabled: true, whatsappNumber: null })).toBe(false);
  });

  it("is true only when both the toggle is on and a number is configured", () => {
    expect(shouldShowWhatsAppButton({ whatsappFloatingButtonEnabled: true, whatsappNumber: "501234567" })).toBe(true);
  });
});

describe("buildWhatsAppUrl", () => {
  it("builds a digits-only wa.me link from country code + number", () => {
    expect(buildWhatsAppUrl("+971", "501234567")).toBe("https://wa.me/971501234567");
  });

  it("strips non-digit characters from both parts", () => {
    expect(buildWhatsAppUrl("+971", "50-123-4567")).toBe("https://wa.me/971501234567");
  });

  it("returns null when there are no digits at all", () => {
    expect(buildWhatsAppUrl(null, null)).toBeNull();
  });

  it("returns null with a message but no digits, rather than a broken wa.me link", () => {
    expect(buildWhatsAppUrl(null, null, "Hi, I'm interested")).toBeNull();
  });

  it("appends an encoded ?text= param when a message is given", () => {
    expect(buildWhatsAppUrl("+971", "501234567", "Hi there")).toBe("https://wa.me/971501234567?text=Hi%20there");
  });
});
