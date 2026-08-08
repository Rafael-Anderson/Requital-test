import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import InventoryTabs from "./InventoryTabs";

let pathname = "/inventory";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

describe("InventoryTabs", () => {
  it("renders all four tabs with the correct hrefs, Ingredients as the root tab", () => {
    render(<InventoryTabs />);
    expect(screen.getByText("Ingredients").closest("a")).toHaveAttribute("href", "/inventory");
    expect(screen.getByText("Categories").closest("a")).toHaveAttribute("href", "/inventory/categories");
    expect(screen.getByText("Scan to Stock").closest("a")).toHaveAttribute("href", "/inventory/scan");
    expect(screen.getByText("Movement History").closest("a")).toHaveAttribute("href", "/inventory/movements");
    expect(screen.queryByText("Products")).not.toBeInTheDocument();
  });

  it("highlights the tab matching the current path", () => {
    pathname = "/inventory/movements";
    render(<InventoryTabs />);
    expect(screen.getByText("Movement History").closest("a")).toHaveClass("border-accent");
    expect(screen.getByText("Ingredients").closest("a")).not.toHaveClass("border-accent");
  });
});
