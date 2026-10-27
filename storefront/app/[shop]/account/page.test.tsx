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
const authState = vi.hoisted(() => ({ emailVerified: false }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    customer: {
      id: 1,
      name: "Jane Shopper",
      phone: "0501234567",
      email: "jane@example.com",
      emailVerified: authState.emailVerified,
    },
    loading: false,
    logout,
    refreshProfile: vi.fn(),
  }),
}));

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "test-shop", shopBasePath: "/test-shop", shop: { currency: "AED" } }),
}));

vi.mock("@/lib/api", () => ({
  exportMyData: vi.fn(),
  updateMyProfile: vi.fn(),
  requestEmailVerification: vi.fn(),
  requestMyAccountDeletion: vi.fn(),
  confirmMyAccountDeletion: vi.fn(),
  getMyConsent: vi.fn().mockResolvedValue({ wording: { version: "v", channels: { email: "", whatsapp: "", sms: "" } }, channels: [] }),
  setMyConsent: vi.fn(),
  getMyLoyalty: vi.fn().mockResolvedValue({ enabled: false }),
}));

import {
  confirmMyAccountDeletion,
  exportMyData,
  requestEmailVerification,
  requestMyAccountDeletion,
  updateMyProfile,
} from "@/lib/api";

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
    await waitFor(() => expect(push).toHaveBeenCalledWith("/test-shop"));
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

describe("AccountDashboardPage — email verification (W1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.emailVerified = false;
  });

  it("an unverified email says so and can request the verification link", async () => {
    const user = userEvent.setup();
    vi.mocked(requestEmailVerification).mockResolvedValue({ success: true });
    render(<AccountDashboardPage />);
    expect(screen.getByText(/not verified/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send verification link" }));
    expect(requestEmailVerification).toHaveBeenCalledWith("test-shop");
    expect(await screen.findByText(/Check your inbox/)).toBeInTheDocument();
  });

  it("a verified email shows no verify button", () => {
    authState.emailVerified = true;
    render(<AccountDashboardPage />);
    expect(screen.getByText(/Email verified/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send verification link" })).not.toBeInTheDocument();
  });

  it("changing a verified email asks for the current password and sends it; changing an unverified one does not", async () => {
    const user = userEvent.setup();
    vi.mocked(updateMyProfile).mockResolvedValue({} as never);
    authState.emailVerified = true;
    const { unmount } = render(<AccountDashboardPage />);
    await user.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(screen.queryByText("Current password")).not.toBeInTheDocument();
    const email = screen.getByDisplayValue("jane@example.com");
    await user.clear(email);
    await user.type(email, "new@example.com");
    const pw = screen.getByLabelText("Current password");
    await user.type(pw, "my-secret-pass");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateMyProfile).toHaveBeenCalledWith(
      "test-shop",
      expect.objectContaining({ email: "new@example.com", currentPassword: "my-secret-pass" }),
    );
    unmount();

    vi.clearAllMocks();
    authState.emailVerified = false;
    render(<AccountDashboardPage />);
    await user.click(screen.getByRole("button", { name: "Edit profile" }));
    const email2 = screen.getByDisplayValue("jane@example.com");
    await user.clear(email2);
    await user.type(email2, "other@example.com");
    expect(screen.queryByText("Current password")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateMyProfile).toHaveBeenCalledWith(
      "test-shop",
      expect.not.objectContaining({ currentPassword: expect.anything() }),
    );
  });
});
