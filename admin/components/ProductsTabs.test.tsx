import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProductsTabs from "./ProductsTabs";

let pathname = "/products";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

describe("ProductsTabs", () => {
  it("renders every tab with the correct href", () => {
    render(<ProductsTabs />);
    expect(screen.getByText("Products").closest("a")).toHaveAttribute("href", "/products");
    expect(screen.getByText("Collections").closest("a")).toHaveAttribute("href", "/products/categories");
    expect(screen.getByText("Templates").closest("a")).toHaveAttribute("href", "/products/templates");
    expect(screen.getByText("Discounts").closest("a")).toHaveAttribute("href", "/products/discounts");
    expect(screen.getByText("Gift Cards").closest("a")).toHaveAttribute("href", "/products/gift-cards");
    expect(screen.getByText("Brands").closest("a")).toHaveAttribute("href", "/products/brands");
  });

  it("highlights the tab matching the current path", () => {
    pathname = "/products/discounts";
    render(<ProductsTabs />);
    expect(screen.getByText("Discounts").closest("a")).toHaveClass("text-accent-text");
    expect(screen.getByText("Products").closest("a")).not.toHaveClass("text-accent-text");
  });
});
