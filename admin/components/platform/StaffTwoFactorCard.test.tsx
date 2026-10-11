import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StaffTwoFactorCard from "./StaffTwoFactorCard";
import * as api from "@/lib/platform-api";

const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
vi.mock("@/lib/platform-api", () => ({
  listPlatformShopUsers: vi.fn(),
  resetShopUserTwoFactor: vi.fn(),
}));

const list = vi.mocked(api.listPlatformShopUsers);
const reset = vi.mocked(api.resetShopUserTwoFactor);

const users: api.PlatformShopUsers = {
  shopRequires2fa: true,
  users: [
    { id: 7, name: "Layla", email: "layla@x.test", role: "admin", outletId: null, outletName: null, mfaEnrolled: true, mustEnrol2fa: false, lastSignInAt: null },
    { id: 8, name: "Omar", email: "omar@x.test", role: "branch", outletId: 1, outletName: "Main", mfaEnrolled: false, mustEnrol2fa: true, lastSignInAt: null },
  ],
};

describe("StaffTwoFactorCard", () => {
  beforeEach(() => {
    list.mockReset();
    reset.mockReset();
    toast.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists the staff and shows who must set up again", async () => {
    list.mockResolvedValue(users);
    render(<StaffTwoFactorCard shopId={3} />);
    expect((await screen.findAllByText("Layla")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Must set up again").length).toBeGreaterThan(0);
    expect(list).toHaveBeenCalledWith(3);
  });

  it("resets only after the confirm, then toasts and reloads", async () => {
    list.mockResolvedValue(users);
    reset.mockResolvedValue({ success: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<StaffTwoFactorCard shopId={3} />);
    await screen.findAllByText("Layla");
    const [btn] = screen.getAllByRole("button", { name: "Reset two-factor for Layla" });
    await userEvent.click(btn);
    expect(reset).not.toHaveBeenCalled();
    await userEvent.click(btn);
    await waitFor(() => expect(reset).toHaveBeenCalledWith(3, 7));
    expect(confirm.mock.calls[1][0]).toMatch(/out of band/);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Layla/)));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("shows an error toast when the reset fails", async () => {
    list.mockResolvedValue(users);
    reset.mockRejectedValue(new Error("nope"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<StaffTwoFactorCard shopId={3} />);
    await screen.findAllByText("Layla");
    await userEvent.click(screen.getAllByRole("button", { name: "Reset two-factor for Omar" })[0]);
    await waitFor(() => expect(toast).toHaveBeenCalledWith("nope", "error"));
  });

  it("ends in LoadFailed with Try again when the list fails, and recovers", async () => {
    list.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(users);
    render(<StaffTwoFactorCard shopId={3} />);
    expect(await screen.findByText(/Could not load staff/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findAllByText("Omar")).length).toBeGreaterThan(0);
  });
});
