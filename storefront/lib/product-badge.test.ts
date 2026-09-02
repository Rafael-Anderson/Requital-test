import { describe, expect, it } from "vitest";
import { resolveProductBadge } from "./product-badge";
import type { BadgeSettings, ColorScheme } from "./theme-config-types";

const SCHEMES: ColorScheme[] = [
  { id: "s1", name: "Light", background: "#ffffff", text: "#18181b", button: "#069494", buttonLabel: "#ffffff", secondaryButtonLabel: "#069494" },
  { id: "s2", name: "Dark", background: "#18181b", text: "#ffffff", button: "#dc2626", buttonLabel: "#000000", secondaryButtonLabel: "#dc2626" },
];

const BADGES: BadgeSettings = {
  position: "top_left",
  cornerRadius: 6,
  saleSchemeId: "s2",
  soldOutSchemeId: "s1",
  font: "body",
  case: "uppercase",
};

describe("resolveProductBadge", () => {
  it("returns null when badges settings are absent (un-themed shop, no behaviour change)", () => {
    expect(resolveProductBadge("sale", undefined, SCHEMES)).toBeNull();
  });

  it("resolves a Sale badge from saleSchemeId's button/label colours", () => {
    const b = resolveProductBadge("sale", BADGES, SCHEMES);
    expect(b).not.toBeNull();
    expect(b!.label).toBe("SALE");
    expect(b!.positionClass).toBe("top-2 left-2");
    expect(b!.style.background).toBe("#dc2626");
    expect(b!.style.color).toBe("#000000");
    expect(b!.style.borderRadius).toBe("6px");
  });

  it("resolves a Sold out badge from soldOutSchemeId, honouring the case setting", () => {
    const b = resolveProductBadge("sold_out", { ...BADGES, case: "default" }, SCHEMES);
    expect(b!.label).toBe("Sold out");
    expect(b!.style.background).toBe("#069494");
  });

  it("falls back to a neutral chip when the scheme id does not resolve", () => {
    const b = resolveProductBadge("sale", { ...BADGES, saleSchemeId: "nope" }, SCHEMES);
    expect(b!.style.background).toBe("#18181b");
    expect(b!.style.color).toBe("#ffffff");
  });

  it("defaults to top_right for an unknown position value", () => {
    const b = resolveProductBadge("sale", { ...BADGES, position: "middle" as BadgeSettings["position"] }, SCHEMES);
    expect(b!.positionClass).toBe("top-2 right-2");
  });
});
