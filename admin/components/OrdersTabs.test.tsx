import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import OrdersTabs from "./OrdersTabs";
import { resetChannelAvailabilityCache } from "@/lib/useChannelAvailability";
import type { UserRole } from "@/lib/types";

const channels = vi.hoisted(() => ({ getChannelAvailability: vi.fn() }));
vi.mock("@/lib/api", () => channels);

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
  it("admin sees all six tabs", () => {
    role = "admin";
    render(<OrdersTabs />);
    expect(screen.getByText("Live Orders")).toBeInTheDocument();
    expect(screen.getByText("Order History")).toBeInTheDocument();
    expect(screen.getByText("Draft Orders")).toBeInTheDocument();
    expect(screen.getByText("Abandoned Carts")).toBeInTheDocument();
    expect(screen.getByText("Branch Status")).toBeInTheDocument();
    expect(screen.getByText("External Delivery")).toBeInTheDocument();
  });

  it("order_manager sees Draft Orders but not Abandoned Carts", () => {
    role = "order_manager";
    render(<OrdersTabs />);
    expect(screen.getByText("Draft Orders")).toBeInTheDocument();
    expect(screen.queryByText("Abandoned Carts")).not.toBeInTheDocument();
  });

  it("branch sees neither Draft Orders nor Abandoned Carts, but does see Branch Status and External Delivery", () => {
    role = "branch";
    render(<OrdersTabs />);
    expect(screen.getByText("Live Orders")).toBeInTheDocument();
    expect(screen.queryByText("Draft Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Abandoned Carts")).not.toBeInTheDocument();
    expect(screen.getByText("Branch Status")).toBeInTheDocument();
    expect(screen.getByText("External Delivery")).toBeInTheDocument();
  });

  it("viewer sees neither Draft Orders nor Abandoned Carts, but does see Branch Status and External Delivery", () => {
    role = "viewer";
    render(<OrdersTabs />);
    expect(screen.queryByText("Draft Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Abandoned Carts")).not.toBeInTheDocument();
    expect(screen.getByText("Branch Status")).toBeInTheDocument();
    expect(screen.getByText("External Delivery")).toBeInTheDocument();
  });

  it("no user (not yet loaded) sees only the unconditional tabs", () => {
    role = null;
    render(<OrdersTabs />);
    expect(screen.getByText("Live Orders")).toBeInTheDocument();
    expect(screen.getByText("Branch Status")).toBeInTheDocument();
    expect(screen.getByText("External Delivery")).toBeInTheDocument();
    expect(screen.queryByText("Draft Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Abandoned Carts")).not.toBeInTheDocument();
  });
});

describe("OrdersTabs: the Marketplace tab", () => {
  beforeEach(() => {
    resetChannelAvailabilityCache();
    channels.getChannelAvailability.mockReset();
  });

  it("is absent for a shop with neither the feature nor a connection", async () => {
    role = "admin";
    channels.getChannelAvailability.mockResolvedValue({ enabled: false, hasConnections: false });
    render(<OrdersTabs />);
    await waitFor(() => expect(channels.getChannelAvailability).toHaveBeenCalled());
    expect(screen.queryByText("Marketplace")).not.toBeInTheDocument();
  });

  it.each([
    ["flag on", { enabled: true, hasConnections: false }],
    ["an existing connection with the flag off", { enabled: false, hasConnections: true }],
  ])("is present for %s", async (_n, a) => {
    role = "order_manager";
    channels.getChannelAvailability.mockResolvedValue(a);
    render(<OrdersTabs />);
    expect(await screen.findByText("Marketplace")).toHaveAttribute("href", "/orders/marketplace");
  });

  it("is never requested, nor shown, for a viewer (the desk is not theirs)", async () => {
    role = "viewer";
    channels.getChannelAvailability.mockResolvedValue({ enabled: true, hasConnections: true });
    render(<OrdersTabs />);
    expect(screen.getByText("Live Orders")).toBeInTheDocument();
    expect(channels.getChannelAvailability).not.toHaveBeenCalled();
    expect(screen.queryByText("Marketplace")).not.toBeInTheDocument();
  });

  it("an unreadable answer shows no tab and breaks nothing", async () => {
    role = "admin";
    channels.getChannelAvailability.mockRejectedValue(new Error("boom"));
    render(<OrdersTabs />);
    await waitFor(() => expect(channels.getChannelAvailability).toHaveBeenCalled());
    expect(screen.getByText("Live Orders")).toBeInTheDocument();
    expect(screen.queryByText("Marketplace")).not.toBeInTheDocument();
  });
});
