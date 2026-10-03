import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CookieConsentBanner, { cookieConsentStorageKey, COOKIE_BANNER_HEIGHT_VAR } from "./CookieConsentBanner";

afterEach(cleanup);

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "test-shop", shopBasePath: "" }),
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

  it("declining discards the ad click ids captured on arrival; accepting keeps them", async () => {
    const seed = () =>
      localStorage.setItem(
        "requital_attr:test-shop",
        JSON.stringify({ first: { source: "google", gclid: "GCL-AAA", capturedAt: new Date().toISOString() } }),
      );
    const user = userEvent.setup();

    seed();
    const { unmount } = render(<CookieConsentBanner />);
    await user.click(await screen.findByText("Decline non-essential"));
    const afterDecline = localStorage.getItem("requital_attr:test-shop") ?? "";
    expect(afterDecline).not.toContain("GCL-AAA");
    expect(afterDecline).toContain("google");
    unmount();

    localStorage.clear();
    seed();
    render(<CookieConsentBanner />);
    await user.click(await screen.findByText("Accept all"));
    expect(localStorage.getItem("requital_attr:test-shop")).toContain("GCL-AAA");
  });
});

describe("CookieConsentBanner presentation", () => {
  const readVar = () => document.documentElement.style.getPropertyValue(COOKIE_BANNER_HEIGHT_VAR);
  let height = 97.4;
  let observer: { cb: () => void } | null = null;

  beforeEach(() => {
    localStorage.clear();
    observer = null;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ height, width: 390, top: 0, left: 0, right: 390, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          observer = { cb };
        }
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty(COOKIE_BANNER_HEIGHT_VAR);
  });

  it("gives both buttons a 44px minimum height", async () => {
    render(<CookieConsentBanner />);
    for (const name of ["Accept all", "Decline non-essential"]) {
      expect((await screen.findByRole("button", { name })).className).toContain("min-h-11");
    }
  });

  it("is a full-width sheet on phones and a capped, centred, rounded card from sm", async () => {
    const { container } = render(<CookieConsentBanner />);
    await screen.findByText("Accept all");
    const box = container.querySelector("[data-cookie-banner]") as HTMLElement;
    expect(box.className).toMatch(/\bfixed\b.*\binset-x-0\b.*\bbottom-0\b/);
    const card = box.firstElementChild as HTMLElement;
    expect(card.className).toContain("sm:max-w-[720px]");
    expect(card.className).toContain("sm:rounded-2xl");
    expect(card.className).toContain("env(safe-area-inset-bottom)");
  });

  it("publishes its height on :root while showing, follows resizes, and removes it on a choice", async () => {
    const user = userEvent.setup();
    render(<CookieConsentBanner />);
    await screen.findByText("Accept all");
    expect(readVar()).toBe("98px");
    height = 130;
    observer!.cb();
    expect(readVar()).toBe("130px");
    await user.click(screen.getByText("Accept all"));
    expect(readVar()).toBe("");
  });

  it("removes the variable when the banner unmounts", async () => {
    const { unmount } = render(<CookieConsentBanner />);
    await screen.findByText("Accept all");
    expect(readVar()).not.toBe("");
    unmount();
    expect(readVar()).toBe("");
  });

  it("never sets the variable when a choice is already stored", () => {
    localStorage.setItem(cookieConsentStorageKey("test-shop"), "declined");
    render(<CookieConsentBanner />);
    expect(readVar()).toBe("");
    expect(document.querySelector("[data-cookie-banner]")).toBeNull();
  });
});
