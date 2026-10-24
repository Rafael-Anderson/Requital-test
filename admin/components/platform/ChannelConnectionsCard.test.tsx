import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChannelConnectionsCard from "./ChannelConnectionsCard";
import * as api from "@/lib/platform-api";

const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
vi.mock("@/lib/platform-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform-api")>();
  return {
    ...actual,
    listPlatformChannelConnections: vi.fn(),
    verifyChannelLocation: vi.fn(),
    unverifyChannelLocation: vi.fn(),
  };
});

const list = vi.mocked(api.listPlatformChannelConnections);
const verify = vi.mocked(api.verifyChannelLocation);
const unverify = vi.mocked(api.unverifyChannelLocation);

const conn = (over: Partial<api.PlatformChannelConnection> = {}): api.PlatformChannelConnection => ({
  id: 11,
  shopId: 3,
  outletId: 5,
  outletName: "Marina",
  provider: "deliveroo",
  providerDisplayName: "Deliveroo",
  externalLocationId: "LOC-1",
  externalBrandId: "BRAND-1",
  externalSiteId: null,
  enabled: false,
  locationVerifiedAt: null,
  locationVerifiedBy: null,
  verificationRequestedAt: "2026-10-20T09:00:00.000Z",
  ...over,
});

describe("ChannelConnectionsCard", () => {
  beforeEach(() => {
    list.mockReset();
    verify.mockReset();
    unverify.mockReset();
    toast.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows outlet, provider and the ids read-only, and the request date", async () => {
    list.mockResolvedValue([conn()]);
    render(<ChannelConnectionsCard shopId={3} />);
    expect(await screen.findByText("Deliveroo at Marina")).toBeTruthy();
    expect(screen.getByText("LOC-1")).toBeTruthy();
    expect(screen.getByText("BRAND-1")).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByText(/The merchant asked for verification on/)).toBeTruthy();
    // ids are text, not inputs: staff cannot edit what they are confirming
    expect(screen.queryByDisplayValue("LOC-1")).toBeNull();
    expect(list).toHaveBeenCalledWith(3);
  });

  it("verify needs the tick and then restates ALL THREE ids exactly as shown", async () => {
    list.mockResolvedValue([conn()]);
    verify.mockResolvedValue(conn({ locationVerifiedAt: "2026-10-23T10:00:00.000Z", locationVerifiedBy: 9 }));
    render(<ChannelConnectionsCard shopId={3} />);
    const btn = await screen.findByRole("button", { name: "Verify location" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(btn);
    expect(verify).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText("I confirmed these ids with the marketplace"));
    await userEvent.click(btn);
    await waitFor(() =>
      expect(verify).toHaveBeenCalledWith(3, 11, { externalLocationId: "LOC-1", externalBrandId: "BRAND-1", externalSiteId: null }),
    );
    expect(await screen.findByText("Verified")).toBeTruthy();
    expect(toast).toHaveBeenCalledWith("Location verified");
  });

  it("a 409 says the ids changed, verifies nothing, and Reload fetches the new ids", async () => {
    list.mockResolvedValueOnce([conn()]).mockResolvedValueOnce([conn({ externalLocationId: "LOC-2" })]);
    verify.mockRejectedValue(new api.PlatformApiError("no", 409));
    render(<ChannelConnectionsCard shopId={3} />);
    await userEvent.click(await screen.findByLabelText("I confirmed these ids with the marketplace"));
    await userEvent.click(screen.getByRole("button", { name: "Verify location" }));
    expect(await screen.findByText(/The ids changed since you loaded this page/)).toBeTruthy();
    expect(screen.queryByText("Verified")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(await screen.findByText("LOC-2")).toBeTruthy();
    // the tick is cleared: the new ids must be looked at again
    expect((screen.getByLabelText("I confirmed these ids with the marketplace") as HTMLInputElement).checked).toBe(false);
  });

  it("removing a verification asks first, warns that the connection is turned off, and only then calls", async () => {
    list.mockResolvedValue([conn({ enabled: true, locationVerifiedAt: "2026-10-22T10:00:00.000Z", locationVerifiedBy: 9 })]);
    unverify.mockResolvedValue(conn());
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<ChannelConnectionsCard shopId={3} />);
    const btn = await screen.findByRole("button", { name: "Remove verification" });
    await userEvent.click(btn);
    expect(unverify).not.toHaveBeenCalled();
    await userEvent.click(btn);
    await waitFor(() => expect(unverify).toHaveBeenCalledWith(3, 11));
    expect(confirm.mock.calls[1][0]).toMatch(/TURNS THE CONNECTION OFF/);
    expect(await screen.findByText("Not verified")).toBeTruthy();
  });

  it("a connection with no location id cannot be verified", async () => {
    list.mockResolvedValue([conn({ externalLocationId: null })]);
    render(<ChannelConnectionsCard shopId={3} />);
    expect(await screen.findByText(/has not entered a location id/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Verify location" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("ends in LoadFailed with Try again when the list fails, and recovers", async () => {
    list.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce([conn()]);
    render(<ChannelConnectionsCard shopId={3} />);
    expect(await screen.findByText(/Could not load marketplace connections/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Deliveroo at Marina")).toBeTruthy();
  });
});
