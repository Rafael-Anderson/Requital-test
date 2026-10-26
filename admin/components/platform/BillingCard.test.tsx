import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import BillingCard from "./BillingCard";

afterEach(cleanup);

vi.mock("@/lib/platform-api", () => ({ getShopBilling: vi.fn() }));
import { getShopBilling } from "@/lib/platform-api";

const base = {
  usage: { periodKey: "2026-10", used: 5, ceiling: null, percent: null, level: 0 },
  suspension: { suspendedAt: null, reason: null },
  events: [],
};

describe("platform BillingCard", () => {
  it("flags a shop with no subscription row", async () => {
    vi.mocked(getShopBilling).mockResolvedValue({
      ...base,
      subscription: {
        hasSubscription: false, status: null, source: null, plan: null, currency: null,
        billingInterval: null, trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
      },
    });
    render(<BillingCard shopId={1} />);
    expect(await screen.findByText(/no subscription row/)).toBeTruthy();
  });

  it("shows the suspension reason and the backfill event", async () => {
    vi.mocked(getShopBilling).mockResolvedValue({
      ...base,
      subscription: {
        hasSubscription: true, status: "active", source: "legacy",
        plan: { code: "legacy_free", name: "Legacy (free)", kind: "legacy", orderSoftCeiling: null },
        currency: null, billingInterval: null, trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
      },
      suspension: { suspendedAt: "2026-10-01T00:00:00Z", reason: "platform" },
      events: [{ id: 1, fromStatus: null, toStatus: "active", fromPlanCode: null, toPlanCode: "legacy_free", reason: "backfill_legacy", actorType: "system", createdAt: "2026-10-01T00:00:00Z" }],
    });
    render(<BillingCard shopId={1} />);
    expect(await screen.findByText(/platform since/)).toBeTruthy();
    expect(screen.getByText(/backfill_legacy: none to active/)).toBeTruthy();
  });

  it("ends in an error with Try again when the request fails", async () => {
    vi.mocked(getShopBilling).mockRejectedValue(new Error("x"));
    render(<BillingCard shopId={1} />);
    expect(await screen.findByText(/Could not load billing/)).toBeTruthy();
  });
});
