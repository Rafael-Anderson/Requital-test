import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BillingSubscription, BillingUsage } from "@/lib/types";
import PlanBillingPage from "./page";

afterEach(cleanup);

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, getBillingSubscription: vi.fn(), getBillingUsage: vi.fn() };
});
import { getBillingSubscription, getBillingUsage } from "@/lib/api";

const LEGACY: BillingSubscription = {
  hasSubscription: true,
  status: "active",
  source: "legacy",
  plan: { code: "legacy_free", name: "Legacy (free)", kind: "legacy", orderSoftCeiling: null },
  currency: null,
  billingInterval: null,
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  features: [
    { key: "slider", description: "Slider on-demand courier dispatch", entitled: true },
    { key: "customer_survey", description: "Post-delivery customer survey email", entitled: false },
  ],
};
const USAGE: BillingUsage = { periodKey: "2026-10", used: 42, ceiling: null, percent: null, level: 0 };

beforeEach(() => {
  vi.mocked(getBillingSubscription).mockReset();
  vi.mocked(getBillingUsage).mockReset();
});

describe("Plan & Billing page", () => {
  it("shows the plan, a disabled Change plan button and what the plan includes", async () => {
    vi.mocked(getBillingSubscription).mockResolvedValue(LEGACY);
    vi.mocked(getBillingUsage).mockResolvedValue(USAGE);
    render(<PlanBillingPage />);
    expect(await screen.findByText("Legacy (free)")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Change plan" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Plan changes are not available yet.")).toBeTruthy();
    expect(screen.getByText("Free, kept from before plans existed")).toBeTruthy();
    expect(screen.getByText("Included")).toBeTruthy();
    expect(screen.getByText("Not included")).toBeTruthy();
    expect(await screen.findByText("42")).toBeTruthy();
    expect(screen.getByText("Your plan has no monthly order limit.")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows a meter and the never-blocked message at the ceiling", async () => {
    vi.mocked(getBillingSubscription).mockResolvedValue(LEGACY);
    vi.mocked(getBillingUsage).mockResolvedValue({ periodKey: "2026-10", used: 310, ceiling: 300, percent: 103, level: 100 });
    render(<PlanBillingPage />);
    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByText(/nothing is blocked/)).toBeTruthy();
  });

  it("says so for a shop with no subscription row", async () => {
    vi.mocked(getBillingSubscription).mockResolvedValue({ ...LEGACY, hasSubscription: false, status: null, source: null, plan: null });
    vi.mocked(getBillingUsage).mockResolvedValue(USAGE);
    render(<PlanBillingPage />);
    expect(await screen.findByText("No plan is recorded for this shop")).toBeTruthy();
    expect(screen.getByText("Every feature is available to your shop.")).toBeTruthy();
  });

  it("a failed usage request does not hide the plan, and retry recovers", async () => {
    vi.mocked(getBillingSubscription).mockResolvedValue(LEGACY);
    vi.mocked(getBillingUsage).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(USAGE);
    render(<PlanBillingPage />);
    expect(await screen.findByText("Legacy (free)")).toBeTruthy();
    expect(await screen.findByText(/Could not load your order usage/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("42")).toBeTruthy());
  });

  it("a failed plan request ends in an error with Try again, not a skeleton", async () => {
    vi.mocked(getBillingSubscription).mockRejectedValue(new Error("down"));
    vi.mocked(getBillingUsage).mockResolvedValue(USAGE);
    render(<PlanBillingPage />);
    expect(await screen.findByText(/Could not load your plan/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
