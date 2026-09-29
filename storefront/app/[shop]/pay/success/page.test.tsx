import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import PaySuccessPage from "./page";

afterEach(cleanup);

let searchParams = new URLSearchParams("token=tok-123");
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
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
  alreadyPaid: true,
  expired: false,
  expiresAt: "2030-01-01T00:00:00.000Z",
};

describe("PaySuccessPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams("token=tok-123");
    vi.mocked(getPaymentLinkSummary).mockResolvedValue({ ...summary });
  });

  it("confirms a paid order without minting anything", async () => {
    render(<PaySuccessPage />);
    await waitFor(() => {
      expect(screen.getByText(/Payment received/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Order #12/)).toBeInTheDocument();
    expect(startPaymentLinkCheckout).not.toHaveBeenCalled();
  });

  // A gateway redirects the customer here BEFORE its webhook lands, so the
  // order is normally still unpaid on first render. That is not an error state:
  // the webhook (or the reconciliation sweep) is what marks it paid, never this
  // page.
  it("reports a pending confirmation rather than a failure", async () => {
    vi.mocked(getPaymentLinkSummary).mockResolvedValue({
      ...summary,
      alreadyPaid: false,
    });
    render(<PaySuccessPage />);
    await waitFor(() => {
      expect(screen.getByText(/being confirmed/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Payment received/i)).not.toBeInTheDocument();
  });

  it("does not call the API without a token", async () => {
    searchParams = new URLSearchParams("");
    render(<PaySuccessPage />);
    await waitFor(() => {
      expect(screen.getByText(/missing its token/i)).toBeInTheDocument();
    });
    expect(getPaymentLinkSummary).not.toHaveBeenCalled();
  });
});
