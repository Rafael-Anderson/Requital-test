import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import OrdersTabs from "./OrdersTabs";
import type { UserRole } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/orders",
}));

let role: UserRole | null = "admin";
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: role ? { role } : null }),
}));

// Mirrors backend/src/draft-orders/draft-orders.controller.ts (admin,
// order_manager) and abandoned-carts.controller.ts (admin only) — a tab
// must never appear for a role that would 403 hitting the endpoint.
describe("OrdersTabs — role-gated Draft Orders / Abandoned Carts tabs", () => {
  it("admin sees all four tabs", () => {
    role = "admin";
    render(<OrdersTabs />);
    expect(screen.getByText("Live Orders")).toBeInTheDocument();
    expect(screen.getByText("Order History")).toBeInTheDocument();
    expect(screen.getByText("Draft Orders")).toBeInTheDocument();
    expect(screen.getByText("Abandoned Carts")).toBeInTheDocument();
  });

  it("order_manager sees Draft Orders but not Abandoned Carts", () => {
    role = "order_manager";
    render(<OrdersTabs />);
    expect(screen.getByText("Draft Orders")).toBeInTheDocument();
    expect(screen.queryByText("Abandoned Carts")).not.toBeInTheDocument();
  });

  it("branch sees neither Draft Orders nor Abandoned Carts", () => {
    role = "branch";
    render(<OrdersTabs />);
    expect(screen.getByText("Live Orders")).toBeInTheDocument();
    expect(screen.queryByText("Draft Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Abandoned Carts")).not.toBeInTheDocument();
  });

  it("viewer sees neither Draft Orders nor Abandoned Carts", () => {
    role = "viewer";
    render(<OrdersTabs />);
    expect(screen.queryByText("Draft Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Abandoned Carts")).not.toBeInTheDocument();
  });

  it("no user (not yet loaded) sees only the unconditional tabs", () => {
    role = null;
    render(<OrdersTabs />);
    expect(screen.getByText("Live Orders")).toBeInTheDocument();
    expect(screen.queryByText("Draft Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Abandoned Carts")).not.toBeInTheDocument();
  });
});
