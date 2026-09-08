import { describe, expect, it } from "vitest";
import { resolveCardBadges, resolveProductBadge } from "./product-badge";
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
    expect(b!.style.background).toBe("#dc2626");
    expect(b!.style.color).toBe("#000000");
    expect(b!.style.borderRadius).toBe("6px");
  });

  it("no-op: an unset style produces the exact pre-§8.13 className string + cornerRadius", () => {
    const b = resolveProductBadge("sale", BADGES, SCHEMES);
    expect(b!.className).toBe("absolute top-2 left-2 px-2 py-0.5 text-xs font-medium");
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

  it("defaults to top_right in the className for an unknown position value", () => {
    const b = resolveProductBadge("sale", { ...BADGES, position: "middle" as BadgeSettings["position"] }, SCHEMES);
    expect(b!.className).toContain("top-2 right-2");
  });
});

describe("resolveProductBadge — style shape variants (§8.13.C item 1)", () => {
  it("'rectangle' is identical to unset (respects cornerRadius, original padding, no shape class)", () => {
    const unset = resolveProductBadge("sale", BADGES, SCHEMES);
    const rect = resolveProductBadge("sale", { ...BADGES, style: "rectangle" }, SCHEMES);
    expect(rect!.className).toBe(unset!.className);
    expect(rect!.style.borderRadius).toBe(unset!.style.borderRadius);
  });

  it("'pill' sets a 9999px radius inline, keeps the chip padding, adds no class", () => {
    const b = resolveProductBadge("sale", { ...BADGES, style: "pill" }, SCHEMES);
    expect(b!.style.borderRadius).toBe("9999px");
    expect(b!.className).toContain("px-2 py-0.5");
    expect(b!.className).not.toMatch(/theme-badge-/);
  });

  it("'circle' adds theme-badge-circle, drops the chip padding, sets no inline radius", () => {
    const b = resolveProductBadge("sale", { ...BADGES, style: "circle" }, SCHEMES);
    expect(b!.className).toContain("theme-badge-circle");
    expect(b!.className).not.toContain("px-2");
    expect(b!.style.borderRadius).toBeUndefined();
  });

  it("'tag' adds theme-badge-tag, drops the chip padding, sets no inline radius", () => {
    const b = resolveProductBadge("sale", { ...BADGES, style: "tag" }, SCHEMES);
    expect(b!.className).toContain("theme-badge-tag");
    expect(b!.className).not.toContain("px-2");
    expect(b!.style.borderRadius).toBeUndefined();
  });

  it("'ribbon' drops the position inset and adds the per-corner variant class", () => {
    const tr = resolveProductBadge("sale", { ...BADGES, position: "top_right", style: "ribbon" }, SCHEMES);
    expect(tr!.className).toContain("theme-badge-ribbon theme-badge-ribbon--tr");
    expect(tr!.className).not.toContain("top-2");
    const bl = resolveProductBadge("sale", { ...BADGES, position: "bottom_left", style: "ribbon" }, SCHEMES);
    expect(bl!.className).toContain("theme-badge-ribbon--bl");
  });
});

describe("resolveProductBadge — entranceAnimation (§8.13.C item 5)", () => {
  it("appends theme-badge-pop when entranceAnimation is true", () => {
    const b = resolveProductBadge("sale", { ...BADGES, entranceAnimation: true }, SCHEMES);
    expect(b!.className).toContain("theme-badge-pop");
  });

  it("does not append theme-badge-pop when unset (no-op)", () => {
    const b = resolveProductBadge("sale", BADGES, SCHEMES);
    expect(b!.className).not.toContain("theme-badge-pop");
  });

  it("skips theme-badge-pop on ribbon (its rotate() would fight the pop's scale())", () => {
    const b = resolveProductBadge("sale", { ...BADGES, style: "ribbon", entranceAnimation: true }, SCHEMES);
    expect(b!.className).not.toContain("theme-badge-pop");
  });
});

describe("resolveProductBadge — NEW + discount labels (stakeholder #6)", () => {
  it("NEW badge: default label, falls back to saleSchemeId when newSchemeId is unset", () => {
    const b = resolveProductBadge("new", BADGES, SCHEMES);
    expect(b!.label).toBe("NEW");
    expect(b!.style.background).toBe("#dc2626"); // s2.button (BADGES.saleSchemeId)
  });

  it("NEW badge: merchant newLabel + its own newSchemeId win", () => {
    const b = resolveProductBadge("new", { ...BADGES, newLabel: "Just in", newSchemeId: "s1", case: "default" }, SCHEMES);
    expect(b!.label).toBe("Just in");
    expect(b!.style.background).toBe("#069494"); // s1.button
  });

  it("discount badge: substitutes the computed percent into the default template", () => {
    const b = resolveProductBadge("sale", { ...BADGES, case: "default" }, SCHEMES, { discountPercent: 20 });
    expect(b!.label).toBe("-20%");
  });

  it("discount badge: a placeholder-free saleLabel is used verbatim", () => {
    const b = resolveProductBadge("sale", { ...BADGES, saleLabel: "Deal", case: "default" }, SCHEMES, { discountPercent: 20 });
    expect(b!.label).toBe("Deal");
  });

  it("discount badge: template wanting a percent it lacks falls back to 'Sale'", () => {
    const b = resolveProductBadge("sale", { ...BADGES, case: "default" }, SCHEMES);
    expect(b!.label).toBe("Sale");
  });

  it("ribbon: solid red by default, ribbonColor overrides, scheme is ignored", () => {
    const red = resolveProductBadge("sale", { ...BADGES, style: "ribbon" }, SCHEMES, { discountPercent: 30 });
    expect(red!.style.background).toBe("#dc2626");
    expect(red!.style.color).toBe("#ffffff");
    const custom = resolveProductBadge("sale", { ...BADGES, style: "ribbon", ribbonColor: "#0a0a0a" }, SCHEMES);
    expect(custom!.style.background).toBe("#0a0a0a");
  });
});

describe("resolveCardBadges (stakeholder #6)", () => {
  const base = { soldOut: false, isNew: false, onSale: false, discountPercent: null };

  it("returns {null, null} for an un-themed shop", () => {
    expect(resolveCardBadges({ ...base, isNew: true }, undefined, SCHEMES)).toEqual({ primary: null, secondary: null });
  });

  it("sold out wins outright — no secondary even if new + on sale", () => {
    const r = resolveCardBadges({ soldOut: true, isNew: true, onSale: true, discountPercent: 20 }, BADGES, SCHEMES);
    expect(r.primary!.label).toBe("SOLD OUT");
    expect(r.secondary).toBeNull();
  });

  it("discount is primary, NEW steps down to a small secondary chip diagonally opposite", () => {
    const r = resolveCardBadges({ ...base, isNew: true, onSale: true, discountPercent: 25 }, { ...BADGES, case: "default", position: "top_left" }, SCHEMES);
    expect(r.primary!.label).toBe("-25%");
    expect(r.secondary!.label).toBe("NEW");
    expect(r.secondary!.className).toContain("text-[10px]");
    expect(r.secondary!.className).toContain("bottom-2 left-2"); // vertical-flipped from top_left
  });

  it("NEW alone gets the full primary treatment, no secondary", () => {
    const r = resolveCardBadges({ ...base, isNew: true }, BADGES, SCHEMES);
    expect(r.primary!.label).toBe("NEW");
    expect(r.secondary).toBeNull();
  });

  it("nothing applies ⇒ {null, null}", () => {
    expect(resolveCardBadges(base, BADGES, SCHEMES)).toEqual({ primary: null, secondary: null });
  });
});
