import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement, useEffect } from "react";
import { FlyToCartProvider, useFlyToCart } from "./fly-to-cart";

// jsdom has no Element.animate — stub it so the clone lifecycle is testable.
type FakeAnim = { onfinish: (() => void) | null };
let lastAnim: FakeAnim | null = null;
let animCalls: unknown[][] = [];

let themeConfig: unknown = null;
let reduced = false;
vi.mock("@/lib/shop-context", () => ({ useShop: () => ({ themeConfig }) }));
vi.mock("@/lib/use-reduced-motion", () => ({ useReducedMotion: () => reduced }));

beforeEach(() => {
  animCalls = [];
  lastAnim = null;
  // jsdom doesn't define Element.animate at all — assign, don't spyOn.
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = (...args: unknown[]) => {
    animCalls.push(args);
    lastAnim = { onfinish: null };
    return lastAnim as unknown as Animation;
  };
  // stable, non-zero rects
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 10, y: 20, left: 10, top: 20, width: 100, height: 100, right: 110, bottom: 120, toJSON: () => ({}),
  } as DOMRect);
  // offsetParent is null in jsdom by default; make the target look "visible"
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return document.body; } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  document.querySelectorAll("[data-fly-to-cart-clone]").forEach((el) => el.remove());
  document.querySelectorAll("[data-fly-to-cart-target]").forEach((el) => el.remove());
  themeConfig = null;
  reduced = false;
});

function cfg(animations: Record<string, unknown>) {
  return { globalSettings: { animations } };
}

function Harness({ calls }: { calls: number }) {
  const { flyToCart } = useFlyToCart();
  useEffect(() => {
    const src = document.createElement("img");
    (src as HTMLImageElement).src = "http://x/p.jpg";
    // jsdom leaves currentSrc empty; force it
    Object.defineProperty(src, "currentSrc", { configurable: true, get: () => "http://x/p.jpg" });
    document.body.appendChild(src);
    for (let i = 0; i < calls; i++) flyToCart(src);
  }, [flyToCart, calls]);
  return null;
}

function renderWith(animations: Record<string, unknown>, calls = 1) {
  document.body.insertAdjacentHTML("beforeend", '<button data-fly-to-cart-target></button>');
  return render(
    createElement(FlyToCartProvider, null, createElement(Harness, { calls })),
  );
}

const clones = () => document.querySelectorAll("[data-fly-to-cart-clone]");

describe("FlyToCartProvider (§8.13.C item 16)", () => {
  it("no-op: absent addToCartStyle ⇒ no clone, no animate()", () => {
    themeConfig = cfg({ addToCart: true });
    renderWith({ addToCart: true });
    expect(clones().length).toBe(0);
    expect(animCalls.length).toBe(0);
  });

  it("no-op: addToCart false even with addToCartStyle 'fly' ⇒ nothing (master switch)", () => {
    themeConfig = cfg({ addToCart: false, addToCartStyle: "fly" });
    renderWith({ addToCart: false, addToCartStyle: "fly" });
    expect(clones().length).toBe(0);
  });

  it("no-op: reduced motion ⇒ nothing", () => {
    reduced = true;
    themeConfig = cfg({ addToCart: true, addToCartStyle: "fly" });
    renderWith({ addToCart: true, addToCartStyle: "fly" });
    expect(clones().length).toBe(0);
  });

  it("enabled ⇒ appends an <img data-fly-to-cart-clone> and calls animate() with 3 keyframes", () => {
    themeConfig = cfg({ addToCart: true, addToCartStyle: "fly" });
    renderWith({ addToCart: true, addToCartStyle: "fly" });
    expect(clones().length).toBe(1);
    expect((clones()[0] as HTMLImageElement).tagName).toBe("IMG");
    expect(animCalls.length).toBe(1);
    expect(animCalls[0][0]).toHaveLength(3); // keyframes array
  });

  it("clone is removed when the animation's onfinish fires", () => {
    themeConfig = cfg({ addToCart: true, addToCartStyle: "fly" });
    renderWith({ addToCart: true, addToCartStyle: "fly" });
    expect(clones().length).toBe(1);
    lastAnim!.onfinish!();
    expect(clones().length).toBe(0);
  });

  it("caps concurrent clones at 5 — a 6th call in the same window is a visual no-op", () => {
    themeConfig = cfg({ addToCart: true, addToCartStyle: "fly" });
    renderWith({ addToCart: true, addToCartStyle: "fly" }, 8);
    expect(clones().length).toBe(5);
    expect(animCalls.length).toBe(5);
  });

  it("unmount removes any in-flight clones (SPA-leak guard)", () => {
    themeConfig = cfg({ addToCart: true, addToCartStyle: "fly" });
    const { unmount } = renderWith({ addToCart: true, addToCartStyle: "fly" });
    expect(clones().length).toBe(1);
    unmount();
    expect(clones().length).toBe(0);
  });
});
