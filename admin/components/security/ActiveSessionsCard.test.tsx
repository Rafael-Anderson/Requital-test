import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
vi.mock("@/lib/api", () => ({
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
}));
import { listSessions, revokeOtherSessions, revokeSession } from "@/lib/api";
import ActiveSessionsCard, { describeDevice } from "./ActiveSessionsCard";

const sessions = [
  { id: "a", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120 Safari/537", ip: "1.1.1.1", startedAt: "2026-10-01T10:00:00Z", lastActiveAt: "2026-10-02T10:00:00Z", current: true },
  { id: "b", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604", ip: null, startedAt: "2026-09-01T10:00:00Z", lastActiveAt: "2026-09-02T10:00:00Z", current: false },
];

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listSessions).mockResolvedValue(sessions);
  vi.mocked(revokeSession).mockResolvedValue({ success: true });
  vi.mocked(revokeOtherSessions).mockResolvedValue({ success: true, revoked: 1 });
});

describe("describeDevice", () => {
  it("names browser and OS, and degrades to Unknown device", () => {
    expect(describeDevice(sessions[0].userAgent)).toBe("Chrome on macOS");
    expect(describeDevice(sessions[1].userAgent)).toBe("Safari on iOS");
    expect(describeDevice(null)).toBe("Unknown device");
  });
});

describe("ActiveSessionsCard", () => {
  it("marks this device, offers sign out only for the others", async () => {
    render(<ActiveSessionsCard />);
    expect(await screen.findByText("This device")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Sign out (?!of)/ })).toHaveLength(1);
  });

  it("signs out one device and reloads", async () => {
    render(<ActiveSessionsCard />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign out Safari on iOS" }));
    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith("b"));
    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it("signs out all other devices", async () => {
    render(<ActiveSessionsCard />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign out of all other devices" }));
    await waitFor(() => expect(revokeOtherSessions).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith("Signed out of 1 other device");
  });
});
