import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmptyCartState, { pickSuggestedCollections } from "./EmptyCartState";
import type { Collection, Product } from "@/lib/types";

let basePath = "/test-shop";
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "test-shop", shopBasePath: basePath, shop: { buttonRadius: "rounded", buttonFill: "solid" } }),
}));
const listCollections = vi.fn();
const listProducts = vi.fn();
vi.mock("@/lib/api", () => ({
  listCollections: (...a: unknown[]) => listCollections(...a),
  listProducts: (...a: unknown[]) => listProducts(...a),
}));
vi.mock("@/components/ProductCard", () => ({
  default: ({ product }: { product: Product }) => <div data-testid="product-card">{product.name}</div>,
}));

const col = (id: number, over: Partial<Collection> = {}): Collection => ({
  id, name: `C${id}`, slug: `c${id}`, displayOrder: id, image: null, isFeatured: false, parentCollectionId: null, description: null, ...over,
});
const prod = (id: number) => ({ id, name: `P${id}` }) as unknown as Product;

beforeEach(() => {
  basePath = "/test-shop";
  listCollections.mockResolvedValue([col(1), col(2, { isFeatured: true })]);
  listProducts.mockResolvedValue([prod(1), prod(2), prod(3), prod(4), prod(5), prod(6)]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EmptyCartState (page)", () => {
  it("renders the heading, supporting copy and a Continue shopping CTA built from shopBasePath", () => {
    render(<EmptyCartState />);
    expect(screen.getByRole("heading", { level: 1, name: "Your cart is empty" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue shopping" })).toHaveAttribute("href", "/test-shop");
  });

  it("falls back to / when the shop is served from its own host (empty shopBasePath)", () => {
    basePath = "";
    render(<EmptyCartState />);
    expect(screen.getByRole("link", { name: "Continue shopping" })).toHaveAttribute("href", "/");
  });

  it("uses the shop's own button styles, not a hardcoded colour", () => {
    render(<EmptyCartState />);
    expect(screen.getByRole("link", { name: "Continue shopping" }).className).toMatch(/bg-button text-button-foreground/);
  });

  it("shows a footprint-reserving skeleton first, then featured collections first and at most four products", async () => {
    render(<EmptyCartState />);
    expect(screen.getByTestId("empty-cart-skeleton")).toBeInTheDocument();
    expect(await screen.findAllByTestId("product-card")).toHaveLength(4);
    expect(screen.queryByTestId("empty-cart-skeleton")).not.toBeInTheDocument();
    const links = screen.getByRole("navigation", { name: "Shop by collection" }).querySelectorAll("a");
    expect(links[0]).toHaveTextContent("C2"); // the featured one leads
    expect(links[0]).toHaveAttribute("href", "/test-shop/collections/c2");
  });

  it("renders just the message, without error, when the shop has no collections or products", async () => {
    listCollections.mockResolvedValue([]);
    listProducts.mockResolvedValue([]);
    render(<EmptyCartState />);
    await waitFor(() => expect(screen.queryByTestId("empty-cart-skeleton")).not.toBeInTheDocument());
    expect(screen.queryByTestId("product-card")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue shopping" })).toBeInTheDocument();
  });

  it("treats a failed fetch as 'nothing to suggest'", async () => {
    listCollections.mockRejectedValue(new Error("boom"));
    listProducts.mockRejectedValue(new Error("boom"));
    render(<EmptyCartState />);
    await waitFor(() => expect(screen.queryByTestId("empty-cart-skeleton")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Your cart is empty" })).toBeInTheDocument();
  });

  it("has no em dash in its copy", () => {
    const { container } = render(<EmptyCartState />);
    expect(container.textContent).not.toContain("—");
  });
});

describe("EmptyCartState (drawer, compact)", () => {
  it("fetches and renders no suggestions, and the CTA closes the drawer", async () => {
    const onContinue = vi.fn();
    render(<EmptyCartState variant="drawer" onContinue={onContinue} />);
    expect(screen.getByRole("heading", { level: 3, name: "Your cart is empty" })).toBeInTheDocument();
    expect(screen.queryByTestId("empty-cart-skeleton")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue shopping" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(listProducts).not.toHaveBeenCalled();
    expect(listCollections).not.toHaveBeenCalled();
  });
});

describe("pickSuggestedCollections", () => {
  it("keeps only top-level collections, featured first, capped at six", () => {
    const all = [col(1, { parentCollectionId: 9 }), ...[2, 3, 4, 5, 6, 7, 8].map((i) => col(i, { isFeatured: i === 8 }))];
    const picked = pickSuggestedCollections(all);
    expect(picked.map((c) => c.id)).toEqual([8, 2, 3, 4, 5, 6]);
  });
});
