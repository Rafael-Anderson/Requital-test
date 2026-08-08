import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProductsTabs from "./ProductsTabs";

let pathname = "/products";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

describe("ProductsTabs", () => {
  it("renders all four tabs with the correct hrefs", () => {
    render(<ProductsTabs />);
    expect(screen.getByText("Products").closest("a")).toHaveAttribute("href", "/products");
    expect(screen.getByText("Categories").closest("a")).toHaveAttribute("href", "/products/categories");
    expect(screen.getByText("Discounts").closest("a")).toHaveAttribute("href", "/products/discounts");
    expect(screen.getByText("Gift Cards").closest("a")).toHaveAttribute("href", "/products/gift-cards");
  });

  it("highlights the tab matching the current path", () => {
    pathname = "/products/discounts";
    render(<ProductsTabs />);
    expect(screen.getByText("Discounts").closest("a")).toHaveClass("border-accent");
    expect(screen.getByText("Products").closest("a")).not.toHaveClass("border-accent");
  });
});
