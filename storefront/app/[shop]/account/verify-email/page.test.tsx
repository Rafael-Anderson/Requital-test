import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VerifyEmailPage from "./page";

afterEach(cleanup);

const search = vi.hoisted(() => ({ token: "abc123" as string | null }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "token" ? search.token : null) }),
}));
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "test-shop", shopBasePath: "/test-shop" }),
}));
vi.mock("@/lib/api", () => ({ verifyCustomerEmail: vi.fn() }));
import { verifyCustomerEmail } from "@/lib/api";

describe("verify-email page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.token = "abc123";
  });

  it("does nothing on load (a mail scanner opening the link cannot verify); the button verifies", async () => {
    const user = userEvent.setup();
    vi.mocked(verifyCustomerEmail).mockResolvedValue({ success: true });
    render(<VerifyEmailPage />);
    expect(verifyCustomerEmail).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Verify email" }));
    expect(verifyCustomerEmail).toHaveBeenCalledWith("test-shop", "abc123");
    expect(await screen.findByText(/is verified/)).toBeInTheDocument();
  });

  it("shows the server's message when the link is bad and allows no retry without a token", async () => {
    const user = userEvent.setup();
    vi.mocked(verifyCustomerEmail).mockRejectedValue(new Error("This verification link is invalid or has expired"));
    render(<VerifyEmailPage />);
    await user.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument();
    cleanup();
    search.token = null;
    render(<VerifyEmailPage />);
    expect(screen.getByText(/missing its token/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify email" })).not.toBeInTheDocument();
  });
});
