import { describe, expect, it } from "vitest";
import { storeButtonClassName } from "./button-style";
import type { Shop } from "./types";

function shop(overrides: Partial<Shop>): Shop {
  return { buttonRadius: "rounded", buttonFill: "solid", ...overrides } as Shop;
}

describe("storeButtonClassName", () => {
  it("defaults to rounded + solid for a null shop", () => {
    const cls = storeButtonClassName(null);
    expect(cls).toContain("rounded-lg");
    expect(cls).toContain("bg-button");
    expect(cls).toContain("text-button-foreground");
  });

  it("maps each radius option to a distinct, real Tailwind class", () => {
    expect(storeButtonClassName(shop({ buttonRadius: "sharp" }))).toContain("rounded-none");
    expect(storeButtonClassName(shop({ buttonRadius: "rounded" }))).toContain("rounded-lg");
    expect(storeButtonClassName(shop({ buttonRadius: "pill" }))).toContain("rounded-full");
  });

  it("outline fill swaps to a transparent background with a colored border, not just a different text color", () => {
    const cls = storeButtonClassName(shop({ buttonFill: "outline" }));
    expect(cls).toContain("bg-transparent");
    expect(cls).toContain("border-button");
    expect(cls).not.toContain("bg-button ");
  });

  it("solid fill uses the filled background, not a border-only treatment", () => {
    const cls = storeButtonClassName(shop({ buttonFill: "solid" }));
    expect(cls).toContain("bg-button");
    expect(cls).not.toContain("bg-transparent");
  });

  it("the add-to-cart kind uses the Add to Cart color pair, not the general Button color", () => {
    const cls = storeButtonClassName(shop({}), "add-to-cart");
    expect(cls).toContain("add-to-cart-button");
    expect(cls).not.toContain("bg-button ");
  });

  it("add-to-cart outline still swaps to transparent + bordered, independent of kind", () => {
    const cls = storeButtonClassName(shop({ buttonFill: "outline" }), "add-to-cart");
    expect(cls).toContain("bg-transparent");
    expect(cls).toContain("border-add-to-cart-button");
  });
});
