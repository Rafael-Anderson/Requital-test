import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
let drawerOpen = true;
const closeDrawer = vi.fn();
vi.mock("@/lib/cart-drawer", () => ({ useCartDrawer: () => ({ open: drawerOpen, closeDrawer }) }));

afterEach(() => {
  cleanup();
  themeConfig = null;
  items = [];
  drawerOpen = true;
  closeDrawer.mockClear();
});

// The drawer is portalled to <body>, so look there rather than in the render container.
function panel(_container?: HTMLElement) {
  return document.querySelector('[role="dialog"]') as HTMLElement;
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

describe("CartDrawer empty state", () => {
  it("renders the compact shared empty state (no suggestions) when the cart is empty", () => {
    const { container, getByRole } = render(<CartDrawer />);
    expect(getByRole("heading", { name: "Your cart is empty" })).toBeInTheDocument();
    expect(container.querySelector('[data-testid="empty-cart-skeleton"]')).toBeNull();
    expect(getByRole("button", { name: "Continue shopping" })).toBeInTheDocument();
  });
});

describe("CartDrawer keyboard and focus (N4)", () => {
  it("is portalled to <body>, above the z-40 cookie banner (inside <header> its z-50 only counted within the header)", () => {
    const { container } = render(<CartDrawer />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.closest("header")).toBeNull();
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("moves focus to the Close button on open, and Escape asks the context to close", () => {
    render(<CartDrawer />);
    return waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close cart" }))).then(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(closeDrawer).toHaveBeenCalled();
    });
  });

  it("is inert and not a dialog while closed", () => {
    drawerOpen = false;
    render(<CartDrawer />);
    const panel = document.querySelector('[aria-label="Cart"]') as HTMLElement;
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(panel.getAttribute("role")).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("locks page scroll while open", () => {
    document.body.style.overflow = "";
    const { unmount } = render(<CartDrawer />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
