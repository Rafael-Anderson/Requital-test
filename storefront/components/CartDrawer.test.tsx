import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import CartDrawer from "./CartDrawer";

vi.stubGlobal("matchMedia", vi.fn().mockImplementation((q: string) => ({
  matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
})));

let themeConfig: unknown = null;
let items: unknown[] = [];
const subtotal = 120.5;
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shop: { currency: "AED" }, shopBasePath: "", themeConfig }),
}));
vi.mock("@/lib/cart", () => ({
  useCart: () => ({ items, subtotal, setQuantity: vi.fn(), removeItem: vi.fn() }),
}));
vi.mock("@/lib/cart-drawer", () => ({ useCartDrawer: () => ({ open: true, closeDrawer: vi.fn() }) }));

afterEach(() => {
  cleanup();
  themeConfig = null;
  items = [];
});

function panel(container: HTMLElement) {
  return container.querySelector('[role="dialog"]') as HTMLElement;
}

describe("CartDrawer drawers.animation (§8.13.C item 13)", () => {
  it("no-op: unset ⇒ today's transition-transform + translate-x classes", () => {
    themeConfig = { globalSettings: {} };
    const { container } = render(<CartDrawer />);
    const p = panel(container);
    expect(p.className).toContain("transition-transform");
    expect(p.className).toContain("translate-x-0"); // open
    expect(p.className).not.toContain("opacity-");
    expect(p.className).not.toContain("scale-");
  });

  it("'scale' ⇒ origin-right + scale/opacity classes, no translate", () => {
    themeConfig = { globalSettings: { drawers: { animation: "scale" } } };
    const { container } = render(<CartDrawer />);
    const p = panel(container);
    expect(p.className).toContain("origin-right");
    expect(p.className).toContain("scale-100");
    expect(p.className).toContain("opacity-100");
    expect(p.className).not.toContain("translate-x");
  });

  it("'slide-fade' ⇒ translate + opacity", () => {
    themeConfig = { globalSettings: { drawers: { animation: "slide-fade" } } };
    const { container } = render(<CartDrawer />);
    const p = panel(container);
    expect(p.className).toContain("translate-x-0");
    expect(p.className).toContain("opacity-100");
  });
});

describe("CartDrawer cart.subtotalAnimation (§8.13.C item 13)", () => {
  it("no-op: unset ⇒ plain subtotal span, no flash class", () => {
    themeConfig = { globalSettings: {} };
    items = [{ productId: 1, variantId: null, name: "x", price: "10", quantity: 1, maxStock: null, thumbnail: "" }];
    const { getByText } = render(<CartDrawer />);
    const span = getByText(/120\.50/);
    expect(span.className).not.toContain("theme-cart-subtotal-flash");
  });

  it("'flash' ⇒ the subtotal span carries theme-cart-subtotal-flash", () => {
    themeConfig = { globalSettings: { cart: { subtotalAnimation: "flash" } } };
    items = [{ productId: 1, variantId: null, name: "x", price: "10", quantity: 1, maxStock: null, thumbnail: "" }];
    const { getByText } = render(<CartDrawer />);
    expect(getByText(/120\.50/).className).toContain("theme-cart-subtotal-flash");
  });
});

describe("CartDrawer drawers chrome (§8.18 follow-up)", () => {
  it("no-op: unset drawers ⇒ bg-drawer + shadow-2xl, no panel border", () => {
    themeConfig = { globalSettings: {} };
    const { container } = render(<CartDrawer />);
    const p = panel(container);
    expect(p.className).toContain("bg-drawer");
    expect(p.className).toContain("text-drawer-fg");
    expect(p.className).toContain("shadow-2xl");
    expect(p.className).not.toMatch(/\bborder\b/);
  });

  it("bordersStyle 'solid' ⇒ a drawer-scheme border; dropShadow false ⇒ no shadow", () => {
    themeConfig = { globalSettings: { drawers: { bordersStyle: "solid", dropShadow: false } } };
    const { container } = render(<CartDrawer />);
    const p = panel(container);
    expect(p.className).toContain("border border-drawer-border");
    expect(p.className).not.toContain("shadow-2xl");
  });
});
