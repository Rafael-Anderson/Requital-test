import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CountryBanner from "./CountryBanner";
import { useAuth } from "@/lib/auth-context";
import { getShop } from "@/lib/api";
import type { AuthUser, Shop } from "@/lib/types";

vi.mock("@/lib/auth-context", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/api", () => ({ getShop: vi.fn() }));

const asUser = (role: string) => vi.mocked(useAuth).mockReturnValue({ user: { role } as AuthUser } as ReturnType<typeof useAuth>);
const shopWith = (country: string | null) => vi.mocked(getShop).mockResolvedValue({ country } as Shop);

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CountryBanner", () => {
  it("asks an admin of a shop with no country to set one", async () => {
    asUser("admin");
    shopWith(null);
    render(<CountryBanner />);
    expect(await screen.findByText(/Set your shop.s country/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set country" })).toHaveAttribute("href", "/settings/business/information");
  });

  it("stays away once the country is set", async () => {
    asUser("admin");
    shopWith("United Arab Emirates");
    render(<CountryBanner />);
    await waitFor(() => expect(getShop).toHaveBeenCalled());
    expect(screen.queryByText(/Set your shop.s country/)).not.toBeInTheDocument();
  });

  it("never shows to, or even fetches for, someone who cannot change shop settings", () => {
    asUser("viewer");
    shopWith(null);
    render(<CountryBanner />);
    expect(getShop).not.toHaveBeenCalled();
    expect(screen.queryByText(/Set your shop.s country/)).not.toBeInTheDocument();
  });

  it("can be dismissed for the session", async () => {
    asUser("admin");
    shopWith(null);
    render(<CountryBanner />);
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Set your shop.s country/)).not.toBeInTheDocument();
    expect(sessionStorage.getItem("requital_country_banner_dismissed")).toBe("1");
  });

  it("shows nothing if the shop cannot be read, rather than a wrong nag", async () => {
    asUser("admin");
    vi.mocked(getShop).mockRejectedValue(new Error("boom"));
    render(<CountryBanner />);
    await waitFor(() => expect(getShop).toHaveBeenCalled());
    expect(screen.queryByText(/Set your shop.s country/)).not.toBeInTheDocument();
  });
});
