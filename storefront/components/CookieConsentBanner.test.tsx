import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CookieConsentBanner, { cookieConsentStorageKey } from "./CookieConsentBanner";

afterEach(cleanup);

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "test-shop" }),
}));

describe("CookieConsentBanner", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the banner on first visit (no stored choice yet)", async () => {
    render(<CookieConsentBanner />);
    expect(await screen.findByText("Accept all")).toBeInTheDocument();
    expect(screen.getByText("Decline non-essential")).toBeInTheDocument();
  });

  it("hides after 'Accept all' is clicked and persists the choice", async () => {
    const user = userEvent.setup();
    render(<CookieConsentBanner />);

    await user.click(await screen.findByText("Accept all"));

    expect(screen.queryByText("Accept all")).not.toBeInTheDocument();
    expect(localStorage.getItem(cookieConsentStorageKey("test-shop"))).toBe("accepted");
  });

  it("hides after 'Decline non-essential' is clicked and persists the choice", async () => {
    const user = userEvent.setup();
    render(<CookieConsentBanner />);

    await user.click(await screen.findByText("Decline non-essential"));

    expect(screen.queryByText("Decline non-essential")).not.toBeInTheDocument();
    expect(localStorage.getItem(cookieConsentStorageKey("test-shop"))).toBe("declined");
  });

  it("stays hidden on a later mount once a choice was already stored", () => {
    localStorage.setItem(cookieConsentStorageKey("test-shop"), "accepted");
    render(<CookieConsentBanner />);

    expect(screen.queryByText("Accept all")).not.toBeInTheDocument();
  });
});
