import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PayPage from "./page";

afterEach(cleanup);

let searchParams = new URLSearchParams("token=tok-123");
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({
    shopSlug: "test-shop",
    shopBasePath: "/test-shop",
    shop: { currency: "AED", displayName: "Test Shop" },
  }),
}));

vi.mock("@/lib/api", () => ({
  getPaymentLinkSummary: vi.fn(),
  startPaymentLinkCheckout: vi.fn(),
}));

import { getPaymentLinkSummary, startPaymentLinkCheckout } from "@/lib/api";

const summary = {
  shopOrderNumber: 12,
  total: "199.00",
  currency: "AED",
  shopName: "Test Shop",
  alreadyPaid: false,
  expired: false,
  expiresAt: "2030-01-01T00:00:00.000Z",
};

describe("PayPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams("token=tok-123");
    vi.mocked(getPaymentLinkSummary).mockResolvedValue({ ...summary });
  });

  // The whole reason the read-only summary endpoint exists: GET /pay/:token
  // mints a real gateway checkout session and writes paymentSessionId, so a
  // page that called it just to render an amount would create a live session on
  // every mount and every refresh.
  it("reads the summary on mount and never mints a session", async () => {
    render(<PayPage />);
    await waitFor(() => {
      expect(screen.getByText(/Order #12/)).toBeInTheDocument();
    });
    expect(getPaymentLinkSummary).toHaveBeenCalledWith("tok-123");
    expect(startPaymentLinkCheckout).not.toHaveBeenCalled();
  });

  it("mints the session only from the Pay now action", async () => {
    const user = userEvent.setup();
    vi.mocked(startPaymentLinkCheckout).mockResolvedValue({
      alreadyPaid: false,
      checkoutUrl: "https://gateway.example/checkout/abc",
    });
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        set href(value: string) {
          assign(value);
        },
      },
    });

    render(<PayPage />);
    await waitFor(() => expect(screen.getByText("Pay now")).toBeInTheDocument());
    await user.click(screen.getByText("Pay now"));

    await waitFor(() => {
      expect(startPaymentLinkCheckout).toHaveBeenCalledWith("tok-123");
    });
    expect(assign).toHaveBeenCalledWith("https://gateway.example/checkout/abc");
  });

  it("offers no payment action for an already-paid order", async () => {
    vi.mocked(getPaymentLinkSummary).mockResolvedValue({
      ...summary,
      alreadyPaid: true,
    });
    render(<PayPage />);
    await waitFor(() => {
      expect(
        screen.getByText(/already been paid/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Pay now")).not.toBeInTheDocument();
  });

  it("offers no payment action for an expired link", async () => {
    vi.mocked(getPaymentLinkSummary).mockResolvedValue({
      ...summary,
      expired: true,
    });
    render(<PayPage />);
    await waitFor(() => {
      expect(screen.getByText(/expired/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("Pay now")).not.toBeInTheDocument();
  });

  it("does not call the API at all without a token", async () => {
    searchParams = new URLSearchParams("");
    render(<PayPage />);
    await waitFor(() => {
      expect(screen.getByText(/missing its token/i)).toBeInTheDocument();
    });
    expect(getPaymentLinkSummary).not.toHaveBeenCalled();
    expect(startPaymentLinkCheckout).not.toHaveBeenCalled();
  });
});
