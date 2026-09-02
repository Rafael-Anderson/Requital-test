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

  describe("floatingElements override (Phase 6)", () => {
    it("an explicit override wins over the legacy toggle, both directions", () => {
      // legacy off, override on ⇒ show
      expect(shouldShowWhatsAppButton({ whatsappFloatingButtonEnabled: false, whatsappNumber: "5012" }, true)).toBe(true);
      // legacy on, override off ⇒ hide
      expect(shouldShowWhatsAppButton({ whatsappFloatingButtonEnabled: true, whatsappNumber: "5012" }, false)).toBe(false);
    });

    it("undefined override falls back to the legacy toggle", () => {
      expect(shouldShowWhatsAppButton({ whatsappFloatingButtonEnabled: true, whatsappNumber: "5012" }, undefined)).toBe(true);
      expect(shouldShowWhatsAppButton({ whatsappFloatingButtonEnabled: false, whatsappNumber: "5012" }, undefined)).toBe(false);
    });

    it("still needs a number regardless of the override", () => {
      expect(shouldShowWhatsAppButton({ whatsappFloatingButtonEnabled: true, whatsappNumber: null }, true)).toBe(false);
    });
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
