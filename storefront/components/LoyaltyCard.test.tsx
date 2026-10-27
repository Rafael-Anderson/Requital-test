import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import LoyaltyCard from "./LoyaltyCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("@/lib/shop-context", () => ({ useShop: () => ({ shopSlug: "s" }) }));
vi.mock("@/lib/api", () => ({ getMyLoyalty: vi.fn() }));
import { getMyLoyalty } from "@/lib/api";

describe("LoyaltyCard", () => {
  it("renders nothing when the shop has loyalty off", async () => {
    vi.mocked(getMyLoyalty).mockResolvedValue({ enabled: false });
    const { container } = render(<LoyaltyCard />);
    await waitFor(() => expect(getMyLoyalty).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the request fails", async () => {
    vi.mocked(getMyLoyalty).mockRejectedValue(new Error("x"));
    const { container } = render(<LoyaltyCard />);
    await waitFor(() => expect(getMyLoyalty).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the balance and recent entries", async () => {
    vi.mocked(getMyLoyalty).mockResolvedValue({
      enabled: true,
      balance: 1250,
      entries: [{ id: 1, type: "earn", points: 125, orderNumber: 9, createdAt: "2026-10-01T00:00:00Z" }],
    });
    render(<LoyaltyCard />);
    expect(await screen.findByText("1,250")).toBeInTheDocument();
    expect(screen.getByText(/Earned on an order \(order #9\)/)).toBeInTheDocument();
    expect(screen.getByText("+125")).toBeInTheDocument();
  });
});
