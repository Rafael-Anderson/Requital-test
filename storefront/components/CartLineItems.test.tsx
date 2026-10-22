import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CartItem } from "@/lib/cart";

afterEach(cleanup);

let mockItems: CartItem[] = [];
vi.mock("@/lib/cart", async (orig) => ({
  ...(await orig<typeof import("@/lib/cart")>()),
  useCart: () => ({ items: mockItems, setQuantity: vi.fn(), removeItem: vi.fn() }),
}));
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shop: { currency: "AED" }, themeConfig: null }),
}));

import CartLineItems from "./CartLineItems";

const mk = (id: number, quantity: number, over: Partial<CartItem> = {}): CartItem => ({
  productId: id,
  name: `Item ${id}`,
  price: 10,
  thumbnail: "x.jpg",
  maxStock: null,
  quantity,
  ...over,
});

describe("CartLineItems order limits", () => {
  it("says Maximum 999 per order and disables + at the line cap", () => {
    mockItems = [mk(1, 999)];
    render(<CartLineItems />);
    expect(screen.getByText("Maximum 999 per order")).toBeTruthy();
    expect((screen.getByLabelText("Increase quantity of Item 1") as HTMLButtonElement).disabled).toBe(true);
  });

  it("names the cart-wide limit on the line that hits it", () => {
    mockItems = [mk(1, 700), mk(2, 300)];
    render(<CartLineItems />);
    // a full cart: every line is at its ceiling
    expect(screen.getAllByText("Maximum 1000 items per order")).toHaveLength(2);
    expect((screen.getByLabelText("Increase quantity of Item 2") as HTMLButtonElement).disabled).toBe(true);
  });

  it("only the line that can still grow keeps its + when the cart has room", () => {
    mockItems = [mk(1, 600), mk(2, 100)];
    render(<CartLineItems />);
    expect(screen.queryByText(/Maximum/)).toBeNull();
    expect((screen.getByLabelText("Increase quantity of Item 2") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows nothing and leaves + enabled well under every limit", () => {
    mockItems = [mk(1, 2)];
    render(<CartLineItems />);
    expect(screen.queryByText(/Maximum/)).toBeNull();
    expect((screen.getByLabelText("Increase quantity of Item 1") as HTMLButtonElement).disabled).toBe(false);
  });
});
