import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountDashboardPage from "./page";

afterEach(cleanup);

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const logout = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    customer: { id: 1, name: "Jane Shopper", phone: "0501234567", email: "jane@example.com" },
    loading: false,
    logout,
    refreshProfile: vi.fn(),
  }),
}));

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "test-shop", shop: { currency: "AED" } }),
}));

vi.mock("@/lib/api", () => ({
  exportMyData: vi.fn(),
  updateMyProfile: vi.fn(),
  requestMyAccountDeletion: vi.fn(),
  confirmMyAccountDeletion: vi.fn(),
}));

import { confirmMyAccountDeletion, exportMyData, requestMyAccountDeletion } from "@/lib/api";

describe("AccountDashboardPage — Privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom doesn't implement these — handleDownloadData/DeleteAccountModal
    // both build a Blob URL for the download, which would otherwise throw.
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("renders the Privacy section with download and delete actions", () => {
    render(<AccountDashboardPage />);
    expect(screen.getByText("Privacy")).toBeInTheDocument();
    expect(screen.getByText("Download my data")).toBeInTheDocument();
    expect(screen.getByText("Delete my account")).toBeInTheDocument();
  });

  it("Download my data calls the export endpoint for this shop", async () => {
    const user = userEvent.setup();
    vi.mocked(exportMyData).mockResolvedValue({ profile: {} });
    render(<AccountDashboardPage />);

    await user.click(screen.getByText("Download my data"));

    await waitFor(() => expect(exportMyData).toHaveBeenCalledWith("test-shop"));
  });

  it("Delete my account opens a confirmation modal with the explicit undo warning", async () => {
    const user = userEvent.setup();
    render(<AccountDashboardPage />);

    await user.click(screen.getByText("Delete my account"));

    expect(screen.getByText("Delete your account?")).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it("confirming deletion runs both backend steps, then logs out and redirects to the storefront home", async () => {
    const user = userEvent.setup();
    vi.mocked(requestMyAccountDeletion).mockResolvedValue({
      alreadyDeleted: false,
      confirmationToken: "tok123",
      expiresInMinutes: 10,
    });
    vi.mocked(confirmMyAccountDeletion).mockResolvedValue({ success: true });
    render(<AccountDashboardPage />);

    await user.click(screen.getByText("Delete my account"));
    await user.click(screen.getByText("Yes, delete my account"));

    await waitFor(() => expect(requestMyAccountDeletion).toHaveBeenCalledWith("test-shop"));
    await waitFor(() => expect(confirmMyAccountDeletion).toHaveBeenCalledWith("test-shop", "tok123"));
    await waitFor(() => expect(logout).toHaveBeenCalled());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(screen.queryByText("Delete your account?")).not.toBeInTheDocument();
  });

  it("cancelling the modal makes neither deletion call", async () => {
    const user = userEvent.setup();
    render(<AccountDashboardPage />);

    await user.click(screen.getByText("Delete my account"));
    await user.click(screen.getByText("Cancel"));

    expect(screen.queryByText("Delete your account?")).not.toBeInTheDocument();
    expect(requestMyAccountDeletion).not.toHaveBeenCalled();
  });
});
