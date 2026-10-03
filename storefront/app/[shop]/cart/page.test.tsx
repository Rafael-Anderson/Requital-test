import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CartPage from "./page";

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "s", shopBasePath: "/s", shop: { currency: "AED", buttonRadius: "rounded", buttonFill: "solid" } }),
}));
vi.mock("@/lib/cart", () => ({ useCart: () => ({ items: [], subtotal: 0 }) }));
vi.mock("@/lib/api", () => ({ listCollections: () => Promise.resolve([]), listProducts: () => Promise.resolve([]) }));

afterEach(cleanup);

// The shop chrome (announcement bar, header, menu, footer) comes from
// app/[shop]/ShopLayoutClient, not from this page: this pins that the empty cart
// is the shared state, not bare text.
describe("CartPage with an empty cart", () => {
  it("renders the shared empty state with a CTA back to the shop", () => {
    render(<CartPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Your cart is empty" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue shopping" })).toHaveAttribute("href", "/s");
  });
});
