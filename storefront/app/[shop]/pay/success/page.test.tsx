import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaySuccessPage from "./page";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("token=tok-123"),
}));
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "test-shop", shopBasePath: "/test-shop", shop: { currency: "AED" } }),
}));
vi.mock("@/components/StorefrontPageShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/api", () => ({ getPaymentLinkSummary: vi.fn() }));

import { getPaymentLinkSummary } from "@/lib/api";

const summary = { shopOrderNumber: 12, total: "10.500", currency: "KWD", shopName: "Test Shop", alreadyPaid: false, expired: false, expiresAt: null };

describe("PaySuccessPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("explains the pending state without an em dash and links back to the shop", async () => {
    vi.mocked(getPaymentLinkSummary).mockResolvedValue({ ...summary });
    render(<PaySuccessPage />);
    const note = await screen.findByText(/Your payment is being confirmed/);
    expect(note.textContent).not.toContain("—");
    expect(screen.getByRole("link", { name: "Continue shopping" }).getAttribute("href")).toBe("/test-shop");
  });

  it("offers Try again when the order cannot be loaded", async () => {
    const user = userEvent.setup();
    vi.mocked(getPaymentLinkSummary).mockRejectedValueOnce(new Error("Network down")).mockResolvedValueOnce({ ...summary, alreadyPaid: true });
    render(<PaySuccessPage />);
    expect(await screen.findByText("Network down")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Payment received. The shop has been notified.")).toBeTruthy();
  });
});
