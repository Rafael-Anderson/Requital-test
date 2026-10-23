import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PendingChannelVerifications from "./PendingChannelVerifications";
import * as api from "@/lib/platform-api";

vi.mock("@/lib/platform-api", () => ({ listPendingChannelVerifications: vi.fn() }));
const list = vi.mocked(api.listPendingChannelVerifications);

const row = (over: Partial<api.PendingChannelVerification> = {}): api.PendingChannelVerification => ({
  id: 1,
  shopId: 8,
  shopName: "Rose Co",
  shopSubdomain: "rose",
  outletId: 2,
  outletName: "Marina",
  provider: "deliveroo",
  providerDisplayName: "Deliveroo",
  externalLocationId: "LOC-9",
  externalBrandId: null,
  externalSiteId: null,
  enabled: false,
  locationVerifiedAt: null,
  locationVerifiedBy: null,
  verificationRequestedAt: "2026-10-22T08:00:00.000Z",
  ...over,
});

describe("PendingChannelVerifications", () => {
  beforeEach(() => list.mockReset());
  afterEach(cleanup);

  it("lists waiting requests across shops, linking to the shop page", async () => {
    list.mockResolvedValue([row(), row({ id: 2, shopId: 9, shopName: "Tulip Co" })]);
    render(<PendingChannelVerifications />);
    const link = await screen.findByRole("link", { name: "Rose Co" });
    expect(link.getAttribute("href")).toBe("/platform/shops/8");
    expect(screen.getByRole("link", { name: "Tulip Co" })).toBeTruthy();
  });

  it("says so when nothing is waiting", async () => {
    list.mockResolvedValue([]);
    render(<PendingChannelVerifications />);
    expect(await screen.findByText("No requests waiting.")).toBeTruthy();
  });

  it("ends in LoadFailed with Try again, and recovers", async () => {
    list.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce([]);
    render(<PendingChannelVerifications />);
    expect(await screen.findByText(/Could not load verification requests/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No requests waiting.")).toBeTruthy();
  });
});
