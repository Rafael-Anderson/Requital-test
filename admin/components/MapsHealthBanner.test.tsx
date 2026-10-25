import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MapsHealthBanner from "./MapsHealthBanner";
import { useAuth } from "@/lib/auth-context";
import { getMapsHealth, resolveMapsHealth } from "@/lib/api";
import { loadGoogleMaps, resetMapsFailureForTests } from "@/lib/google-maps-loader";
import type { AuthUser } from "@/lib/types";

vi.mock("@/lib/auth-context", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/api", () => ({ getMapsHealth: vi.fn(), resolveMapsHealth: vi.fn() }));

const asUser = (role: string) =>
  vi.mocked(useAuth).mockReturnValue({ user: { role } as AuthUser } as ReturnType<typeof useAuth>);
const reported = (errors: { code: string; host: string }[]) =>
  vi.mocked(getMapsHealth).mockResolvedValue({
    errors: errors.map((e) => ({ ...e, hitCount: 1, lastSeenAt: new Date().toISOString() })),
  });
const nativeConsoleError = console.error;

beforeEach(() => {
  sessionStorage.clear();
  resetMapsFailureForTests();
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  delete (window as unknown as { google?: unknown }).google;
  console.error = vi.fn();
});
afterEach(() => {
  cleanup();
  console.error = nativeConsoleError;
  vi.clearAllMocks();
});

describe("MapsHealthBanner", () => {
  it("tells an admin Maps is broken, with the code reported from a shopper's browser", async () => {
    asUser("admin");
    reported([{ code: "RefererNotAllowedMapError", host: "shop.example.com" }]);
    render(<MapsHealthBanner />);
    const banner = await screen.findByTestId("maps-health-banner");
    expect(banner).toHaveTextContent(
      "Google Maps is not working for your store (RefererNotAllowedMapError). Contact Requital support.",
    );
    expect(banner).toHaveTextContent("Reported by visitors on shop.example.com.");
    expect(banner.textContent).not.toContain("—");
  });

  it("Mark resolved tells the server and hides the visitor report", async () => {
    asUser("admin");
    reported([{ code: "InvalidKeyMapError", host: "x.example.com" }]);
    vi.mocked(resolveMapsHealth).mockResolvedValue({ resolved: true });
    render(<MapsHealthBanner />);
    await screen.findByTestId("maps-health-banner");
    vi.mocked(getMapsHealth).mockResolvedValue({ errors: [] });
    await userEvent.click(screen.getByRole("button", { name: "Mark resolved" }));
    expect(resolveMapsHealth).toHaveBeenCalledWith("InvalidKeyMapError", "x.example.com");
    await waitFor(() => expect(screen.queryByTestId("maps-health-banner")).not.toBeInTheDocument());
  });

  it("this browser's own failure says nothing about visitors and has no resolve button", async () => {
    asUser("admin");
    reported([]);
    render(<MapsHealthBanner />);
    await waitFor(() => expect(getMapsHealth).toHaveBeenCalled());
    void loadGoogleMaps();
    act(() => {
      console.error("Google Maps JavaScript API error: InvalidKeyMapError\nu");
    });
    const banner = await screen.findByTestId("maps-health-banner");
    expect(banner).not.toHaveTextContent("visitors");
    expect(screen.queryByRole("button", { name: "Mark resolved" })).not.toBeInTheDocument();
  });

  it("also reacts to this browser's own Maps failure", async () => {
    asUser("admin");
    reported([]);
    render(<MapsHealthBanner />);
    await waitFor(() => expect(getMapsHealth).toHaveBeenCalled());
    expect(screen.queryByTestId("maps-health-banner")).not.toBeInTheDocument();
    void loadGoogleMaps();
    act(() => {
      console.error("Google Maps JavaScript API error: BillingNotEnabledMapError\nhttps://x");
    });
    expect(await screen.findByTestId("maps-health-banner")).toHaveTextContent("(BillingNotEnabledMapError)");
  });

  it("stays away when nothing is wrong, and when the read fails", async () => {
    asUser("admin");
    reported([]);
    const { unmount } = render(<MapsHealthBanner />);
    await waitFor(() => expect(getMapsHealth).toHaveBeenCalled());
    expect(screen.queryByTestId("maps-health-banner")).not.toBeInTheDocument();
    unmount();
    vi.mocked(getMapsHealth).mockRejectedValue(new Error("boom"));
    render(<MapsHealthBanner />);
    await waitFor(() => expect(getMapsHealth).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("maps-health-banner")).not.toBeInTheDocument();
  });

  it("never shows to, or even fetches for, anyone but an admin", async () => {
    asUser("viewer");
    reported([{ code: "InvalidKeyMapError", host: "x.example.com" }]);
    render(<MapsHealthBanner />);
    void loadGoogleMaps();
    act(() => {
      console.error("Google Maps JavaScript API error: InvalidKeyMapError\nu");
    });
    expect(getMapsHealth).not.toHaveBeenCalled();
    expect(screen.queryByTestId("maps-health-banner")).not.toBeInTheDocument();
  });

  it("can be dismissed for the session", async () => {
    asUser("admin");
    reported([{ code: "InvalidKeyMapError", host: "x.example.com" }]);
    const { unmount } = render(<MapsHealthBanner />);
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("maps-health-banner")).not.toBeInTheDocument();
    unmount();
    render(<MapsHealthBanner />);
    await waitFor(() => expect(getMapsHealth).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("maps-health-banner")).not.toBeInTheDocument();
  });
});
