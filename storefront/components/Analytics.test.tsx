import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const shopState = {
  shop: {
    currency: "AED",
    analytics: {
      ga4MeasurementId: "G-ABCD1234",
      metaPixelId: "123456789012345",
      tiktokPixelId: "CABCDEFGHIJKLMNOPQRS",
      snapPixelId: "1b2c3d4e-0000-4000-8000-123456789abc",
    },
  } as unknown,
  previewMode: false,
};
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ ...shopState, shopSlug: "test-shop", shopBasePath: "" }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/test-shop" }));

// Appends a real <script src>, like the real loader, so the DOM is what is asserted.
vi.mock("@/lib/load-script", () => ({
  loadScriptOnce: (src: string) => {
    const el = document.createElement("script");
    el.src = src;
    document.head.appendChild(el);
    return Promise.resolve();
  },
}));

import Analytics from "./Analytics";
import CookieConsentBanner from "./CookieConsentBanner";
import { cookieConsentStorageKey } from "@/lib/consent";
import { resetAnalyticsForTests } from "@/lib/analytics";

const providerScripts = () =>
  Array.from(document.querySelectorAll("script[src]")).map((s) => s.getAttribute("src") ?? "");
const providerGlobals = () =>
  ["dataLayer", "gtag", "fbq", "ttq", "snaptr"].filter((k) => (window as unknown as Record<string, unknown>)[k] !== undefined);

function App() {
  return (
    <>
      <CookieConsentBanner />
      <Analytics />
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = "";
  resetAnalyticsForTests();
  shopState.previewMode = false;
  for (const k of ["dataLayer", "gtag", "fbq", "_fbq", "ttq", "snaptr", "TiktokAnalyticsObject"]) {
    delete (window as unknown as Record<string, unknown>)[k];
  }
});
afterEach(cleanup);

describe("no provider script renders without consent", () => {
  it("first visit (banner showing, no answer): zero provider scripts and zero globals", async () => {
    render(<App />);
    expect(await screen.findByText("Accept all")).toBeInTheDocument();
    expect(providerScripts()).toEqual([]);
    expect(providerGlobals()).toEqual([]);
  });

  it("after 'Decline non-essential': still zero, and stays zero on a later visit", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(await screen.findByText("Decline non-essential"));
    expect(localStorage.getItem(cookieConsentStorageKey("test-shop"))).toBe("declined");
    expect(providerScripts()).toEqual([]);
    expect(providerGlobals()).toEqual([]);
    unmount();

    resetAnalyticsForTests();
    render(<App />);
    await act(async () => {});
    expect(providerScripts()).toEqual([]);
    expect(providerGlobals()).toEqual([]);
  });

  it("a visitor with a stored 'declined' never loads anything even with every id configured", async () => {
    localStorage.setItem(cookieConsentStorageKey("test-shop"), "declined");
    render(<Analytics />);
    await act(async () => {});
    expect(providerScripts()).toEqual([]);
  });

  it("the theme builder preview never loads providers, even with consent", async () => {
    localStorage.setItem(cookieConsentStorageKey("test-shop"), "accepted");
    shopState.previewMode = true;
    render(<Analytics />);
    await act(async () => {});
    expect(providerScripts()).toEqual([]);
  });
});

describe("with consent", () => {
  it("'Accept all' loads the configured providers, and only then", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(providerScripts()).toEqual([]);
    await user.click(await screen.findByText("Accept all"));
    const srcs = providerScripts();
    expect(srcs.some((s) => s.includes("googletagmanager.com/gtag/js?id=G-ABCD1234"))).toBe(true);
    expect(srcs.some((s) => s.includes("connect.facebook.net/en_US/fbevents.js"))).toBe(true);
    expect(srcs.some((s) => s.includes("analytics.tiktok.com"))).toBe(true);
    expect(srcs.some((s) => s.includes("sc-static.net"))).toBe(true);
  });

  it("a returning visitor who already accepted loads them without being asked again", async () => {
    localStorage.setItem(cookieConsentStorageKey("test-shop"), "accepted");
    render(<App />);
    await act(async () => {});
    expect(providerScripts().length).toBe(4);
    expect(screen.queryByText("Accept all")).not.toBeInTheDocument();
  });

  it("a shop with no analytics configured loads nothing even after accepting", async () => {
    shopState.shop = { currency: "AED", analytics: null };
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText("Accept all"));
    expect(providerScripts()).toEqual([]);
    shopState.shop = {
      currency: "AED",
      analytics: {
        ga4MeasurementId: "G-ABCD1234",
        metaPixelId: "123456789012345",
        tiktokPixelId: "CABCDEFGHIJKLMNOPQRS",
        snapPixelId: "1b2c3d4e-0000-4000-8000-123456789abc",
      },
    };
  });
});
