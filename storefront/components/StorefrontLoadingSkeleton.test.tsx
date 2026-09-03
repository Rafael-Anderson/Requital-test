import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import StorefrontLoadingSkeleton from "./StorefrontLoadingSkeleton";

describe("StorefrontLoadingSkeleton", () => {
  it("renders a fully neutral skeleton — no images, no text, just pulse blocks", () => {
    const { container } = render(<StorefrontLoadingSkeleton />);
    // Nothing identifiable about the merchant: no logo <img>, no shop
    // name/slug text — only grey placeholder blocks until the real theme
    // loads.
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.textContent?.trim()).toBe("");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("does not depend on ShopProvider (safe to render before the shop resolves)", () => {
    // Would throw "useShop must be used within ShopProvider" if it still
    // called the hook.
    expect(() => render(<StorefrontLoadingSkeleton />)).not.toThrow();
  });
});
