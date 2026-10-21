import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CartLineItems from "./CartLineItems";

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shop: { currency: "KWD" }, themeConfig: null }),
}));
vi.mock("@/lib/cart", () => ({
  useCart: () => ({
    items: [
      { productId: 1, name: "Rose box", price: 10.5, quantity: 2, thumbnail: "", maxStock: 2 },
      { productId: 2, name: "Tulips", price: 4, quantity: 1, thumbnail: "", maxStock: null },
    ],
    setQuantity: vi.fn(),
    removeItem: vi.fn(),
  }),
}));
vi.mock("@/components/CurrencySymbol", () => ({ default: () => null }));

afterEach(cleanup);

describe("CartLineItems", () => {
  it("prints prices with the order currency's decimals", () => {
    render(<CartLineItems />);
    expect(screen.getByText(/10\.500/)).toBeTruthy();
    expect(screen.getByText(/4\.000/)).toBeTruthy();
  });

  it("names every control by its item", () => {
    render(<CartLineItems />);
    expect(screen.getByRole("button", { name: "Decrease quantity of Rose box" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Increase quantity of Tulips" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Tulips from cart" })).toBeTruthy();
  });

  it("says why the plus button is disabled", () => {
    render(<CartLineItems />);
    expect((screen.getByRole("button", { name: "Increase quantity of Rose box" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Only 2 available")).toBeTruthy();
  });
});
