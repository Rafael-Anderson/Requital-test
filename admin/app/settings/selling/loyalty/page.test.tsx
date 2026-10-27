import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoyaltySettingsPage from "./page";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({ getLoyaltyProgram: vi.fn(), saveLoyaltyProgram: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
import { getLoyaltyProgram, saveLoyaltyProgram } from "@/lib/api";

const program = {
  enabled: false,
  earnRate: "0",
  earnBase: "net_paid" as const,
  redeemEnabled: false,
  redeemPointsPerUnit: "0",
  redeemMinPoints: 1,
  redeemStepPoints: 1,
  redeemMaxPoints: null,
};
const view = { available: true as const, currency: "AED", phoneVerificationOn: false, program };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLoyaltyProgram).mockResolvedValue(view);
  vi.mocked(saveLoyaltyProgram).mockResolvedValue(view);
});

describe("Loyalty settings", () => {
  it("says so when the platform has not granted loyalty, and offers no form", async () => {
    vi.mocked(getLoyaltyProgram).mockResolvedValue({ available: false });
    render(<LoyaltySettingsPage />);
    expect(await screen.findByText(/not enabled for your shop/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
  });

  it("saves the typed rate and sends no rate when left blank (never a baked-in default)", async () => {
    render(<LoyaltySettingsPage />);
    const rate = await screen.findByLabelText("Points per 1 AED spent");
    expect((rate as HTMLInputElement).value).toBe("");
    await userEvent.type(rate, "2.5");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(saveLoyaltyProgram).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveLoyaltyProgram).mock.calls[0][0]).toMatchObject({
      enabled: false,
      earnRate: "2.5",
      redeemEnabled: false,
      redeemMaxPoints: null,
    });
  });

  it("ends in an error with Try again when the load fails", async () => {
    vi.mocked(getLoyaltyProgram).mockRejectedValueOnce(new Error("boom"));
    render(<LoyaltySettingsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /try again/i }));
    expect(await screen.findByLabelText("Points per 1 AED spent")).toBeInTheDocument();
  });
});
