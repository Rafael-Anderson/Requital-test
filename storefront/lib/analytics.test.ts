import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stand-in for the real script loader: records the request and appends a real
// <script src> to the document, exactly as the real one does, so "no script tag"
// assertions are made against the DOM and not against the mock's own bookkeeping.
const loaded: string[] = [];
vi.mock("./load-script", () => ({
  loadScriptOnce: (src: string) => {
    loaded.push(src);
    const el = document.createElement("script");
    el.src = src;
    document.head.appendChild(el);
    return Promise.resolve();
  },
}));

import {
  buildProviderCalls,
  initAnalytics,
  isAnalyticsActive,
  purchaseEventId,
  resetAnalyticsForTests,
  setAnalyticsConsent,
  track,
} from "./analytics";

const ALL = {
  ga4MeasurementId: "G-ABCD1234",
  metaPixelId: "123456789012345",
  tiktokPixelId: "CABCDEFGHIJKLMNOPQRS",
  snapPixelId: "1b2c3d4e-0000-4000-8000-123456789abc",
  googleAdsConversionId: "AW-123456789",
  googleAdsConversionLabel: "AbC_dEf-123",
};

const scriptSrcs = () => Array.from(document.querySelectorAll("script[src]")).map((s) => s.getAttribute("src"));

beforeEach(() => {
  loaded.length = 0;
  document.head.innerHTML = "";
  resetAnalyticsForTests();
  for (const k of ["dataLayer", "gtag", "fbq", "_fbq", "ttq", "snaptr", "TiktokAnalyticsObject"]) {
    delete (window as unknown as Record<string, unknown>)[k];
  }
});
afterEach(() => vi.restoreAllMocks());

describe("consent is the switch: nothing is loaded without it", () => {
  it("initialising the config alone adds no script tag and installs no global", () => {
    initAnalytics(ALL, "AED");
    expect(scriptSrcs()).toEqual([]);
    expect(loaded).toEqual([]);
    expect(isAnalyticsActive()).toBe(false);
    const w = window as unknown as Record<string, unknown>;
    for (const k of ["dataLayer", "gtag", "fbq", "ttq", "snaptr"]) expect(w[k]).toBeUndefined();
  });

  it("consent=false (declined / unanswered) loads nothing and track() is a no-op", () => {
    initAnalytics(ALL, "AED");
    setAnalyticsConsent(false);
    track("purchase", { value: 10, transactionId: "1", items: [{ id: 1, name: "x", price: 10 }] });
    expect(scriptSrcs()).toEqual([]);
    expect(isAnalyticsActive()).toBe(false);
    expect((window as unknown as Record<string, unknown>).dataLayer).toBeUndefined();
  });

  it("consent=true loads exactly the configured providers, lazily", () => {
    initAnalytics(ALL, "AED");
    setAnalyticsConsent(true);
    const srcs = scriptSrcs();
    expect(srcs).toHaveLength(4);
    expect(srcs).toContain("https://www.googletagmanager.com/gtag/js?id=G-ABCD1234");
    expect(srcs).toContain("https://connect.facebook.net/en_US/fbevents.js");
    expect(srcs.some((s) => s?.startsWith("https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=CABCDEFGHIJKLMNOPQRS"))).toBe(true);
    expect(srcs).toContain("https://sc-static.net/scevent.min.js");
    expect(isAnalyticsActive()).toBe(true);
  });

  it("a provider the merchant did not configure is never loaded", () => {
    initAnalytics({ metaPixelId: "123456789012345" }, "AED");
    setAnalyticsConsent(true);
    expect(scriptSrcs()).toEqual(["https://connect.facebook.net/en_US/fbevents.js"]);
  });

  it("with no ids configured, consent loads nothing at all", () => {
    initAnalytics(null, "AED");
    setAnalyticsConsent(true);
    expect(scriptSrcs()).toEqual([]);
    expect(isAnalyticsActive()).toBe(false);
  });

  it("revoking consent stops reporting", () => {
    initAnalytics({ metaPixelId: "123456789012345" }, "AED");
    setAnalyticsConsent(true);
    const fbq = vi.fn();
    (window as unknown as { fbq: unknown }).fbq = fbq;
    setAnalyticsConsent(false);
    track("add_to_cart", { items: [{ id: 1, name: "x", price: 1 }] });
    expect(fbq).not.toHaveBeenCalled();
  });
});

describe("ids are validated before they reach a URL", () => {
  it("drops malformed ids from the API payload (nothing is injected)", () => {
    initAnalytics(
      {
        ga4MeasurementId: '"><script>alert(1)</script>',
        metaPixelId: "1;alert(1)",
        tiktokPixelId: "has space",
        snapPixelId: "nope",
        googleAdsConversionId: "AW-<x>",
      },
      "AED",
    );
    setAnalyticsConsent(true);
    expect(scriptSrcs()).toEqual([]);
    expect(isAnalyticsActive()).toBe(false);
  });
});

describe("after consent, track() reaches the provider globals", () => {
  it("queues through the stubs before the real script arrives", () => {
    initAnalytics(ALL, "AED");
    setAnalyticsConsent(true);
    const w = window as unknown as { dataLayer: unknown[]; fbq: { queue: unknown[][] }; snaptr: { queue: unknown[] } };
    track("add_to_cart", { items: [{ id: 7, name: "Rose", price: 50, quantity: 2 }] });
    // gtag pushes `arguments` objects, so find the event by its first args.
    const ga = w.dataLayer.map((a) => Array.from(a as ArrayLike<unknown>)).find((a) => a[0] === "event" && a[1] === "add_to_cart");
    expect(ga).toBeTruthy();
    expect(w.fbq.queue.some((a) => a[0] === "track" && a[1] === "AddToCart")).toBe(true);
    expect(w.snaptr.queue.length).toBeGreaterThan(0);
  });

  it("a throwing provider never breaks the caller", () => {
    initAnalytics({ metaPixelId: "123456789012345" }, "AED");
    setAnalyticsConsent(true);
    (window as unknown as { fbq: unknown }).fbq = () => {
      throw new Error("provider blew up");
    };
    expect(() => track("search", { query: "rose" })).not.toThrow();
  });
});

describe("a page whose URL carries a bearer token", () => {
  const T = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
  type W = { dataLayer: unknown[]; fbq?: { queue: unknown[][]; disablePushState?: boolean }; snaptr?: { queue: unknown[] }; ttq?: unknown[] };
  const win = () => window as unknown as W;
  const ga = () => (win().dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));
  const everythingSent = () => JSON.stringify([ga(), win().fbq?.queue ?? [], win().snaptr?.queue ?? [], win().ttq ?? []]);

  afterEach(() => window.history.replaceState(null, "", "/"));

  // Consent on a page that is ALREADY at `path` (a hard load); nothing is cleared.
  function hardLoadAt(path: string) {
    window.history.replaceState(null, "", path);
    initAnalytics(ALL, "AED");
    setAnalyticsConsent(true);
  }

  it("a hard load of /orders/<token> sends the token to nothing, config calls included", () => {
    hardLoadAt(`/rose/orders/${T}`);
    expect(everythingSent()).not.toContain(T);
    // Both gtag targets are told not to send their own page view.
    const configs = ga().filter((a) => a[0] === "config");
    expect(configs.length).toBeGreaterThanOrEqual(2);
    for (const c of configs) expect(c[2]).toMatchObject({ send_page_view: false });
    // Meta / TikTok / Snap are not even loaded while the page carries a token.
    expect(scriptSrcs().some((x) => /fbevents|tiktok|scevent/.test(x ?? ""))).toBe(false);
    expect(win().fbq).toBeUndefined();
    expect(win().ttq).toBeUndefined();
    expect(win().snaptr).toBeUndefined();
  });

  it("they install on the first report from a clean page, and gtag is unpinned with the real URL", () => {
    hardLoadAt(`/rose/orders/${T}`);
    window.history.replaceState(null, "", "/rose/products/red-roses");
    track("page_view");
    expect(win().fbq).toBeDefined();
    expect(scriptSrcs().some((x) => /fbevents/.test(x ?? ""))).toBe(true);
    const configs = ga().filter((a) => a[0] === "config");
    const last = configs[configs.length - 1][2] as { page_location: string };
    expect(last.page_location).toContain("/rose/products/red-roses");
  });

  it("Meta's own pushState PageView is switched off (set before the script loads)", () => {
    hardLoadAt("/rose/checkout");
    expect(win().fbq?.disablePushState).toBe(true);
  });

  it("a consented page_view on /orders/<token> sends the token to no provider call", () => {
    hardLoadAt("/rose/checkout");
    window.history.replaceState(null, "", `/rose/orders/${T}`);
    track("page_view");
    expect(everythingSent()).not.toContain(T);
    // Already-installed Meta, TikTok and Snap cannot override the URL they read,
    // so they are skipped for this call (nothing past the install-time queue).
    expect(JSON.stringify(win().fbq?.queue)).not.toContain("PageView");
    // GA4 still gets the page view, with the URL it is told to use.
    const pv = ga().find((a) => a[0] === "event" && a[1] === "page_view");
    expect(pv?.[2]).toMatchObject({ page_location: expect.stringContaining("/rose/orders/[redacted]") as string });
  });

  it("the purchase event on that page is also redacted for GA4 and skipped elsewhere", () => {
    hardLoadAt("/rose/checkout");
    window.history.replaceState(null, "", `/rose/orders/${T}`);
    track("purchase", { value: 10, transactionId: "1", eventId: "order_1", items: [{ id: 1, name: "x", price: 10 }] });
    expect(everythingSent()).not.toContain(T);
    expect(ga().some((a) => a[1] === "purchase")).toBe(true);
    expect(JSON.stringify(win().fbq?.queue)).not.toContain("Purchase");
  });

  it("query tokens (track, survey, pay, cart recovery) are treated the same", () => {
    for (const path of [`/orders/track?token=${T}`, `/survey?token=${T}`, `/pay?token=${T}`, `/cart/recover?token=${T}`]) {
      resetAnalyticsForTests();
      for (const k of ["dataLayer", "fbq", "_fbq", "ttq", "snaptr", "gtag"]) delete (window as unknown as Record<string, unknown>)[k];
      hardLoadAt(path);
      track("page_view");
      expect(everythingSent()).not.toContain(T);
      expect(win().fbq).toBeUndefined();
    }
  });

  it("an ordinary page is unchanged: every provider is called and nothing is overridden", () => {
    hardLoadAt("/rose/products/red-roses");
    track("page_view");
    expect(win().fbq?.queue.length).toBeGreaterThan(0);
    const pv = ga().find((a) => a[0] === "event" && a[1] === "page_view");
    expect(pv?.[2]).not.toHaveProperty("page_location");
    expect(ga().filter((a) => a[0] === "config").every((c) => !(c[2] as object).hasOwnProperty("page_location"))).toBe(true);
  });
});

describe("vocabulary -> provider event names", () => {
  const items = [{ id: 7, name: "Rose", price: 50, quantity: 2, variant: "Red", brand: "Acme" }];
  const base = { items, currency: "AED" };
  // Every provider's args put the event name second (["event"|"track", name, ...]).
  const names = (event: Parameters<typeof buildProviderCalls>[0]) =>
    Object.fromEntries(buildProviderCalls(event, base, ALL).map((c) => [c.provider, c.args[1]]));

  it.each([
    ["view_item", { ga4: "view_item", meta: "ViewContent", tiktok: "ViewContent", snap: "VIEW_CONTENT" }],
    ["add_to_cart", { ga4: "add_to_cart", meta: "AddToCart", tiktok: "AddToCart", snap: "ADD_CART" }],
    ["begin_checkout", { ga4: "begin_checkout", meta: "InitiateCheckout", tiktok: "InitiateCheckout", snap: "START_CHECKOUT" }],
    ["add_payment_info", { ga4: "add_payment_info", meta: "AddPaymentInfo", tiktok: "AddPaymentInfo", snap: "ADD_BILLING" }],
    ["search", { ga4: "search", meta: "Search", tiktok: "Search", snap: "SEARCH" }],
    ["sign_up", { ga4: "sign_up", meta: "CompleteRegistration", tiktok: "CompleteRegistration", snap: "SIGN_UP" }],
  ] as const)("%s", (event, expected) => {
    expect(names(event)).toMatchObject(expected);
  });

  it("view_item_list / select_item / remove_from_cart exist only where the provider has them (GA4)", () => {
    for (const e of ["view_item_list", "select_item", "remove_from_cart"] as const) {
      expect(buildProviderCalls(e, base, ALL).map((c) => c.provider)).toEqual(["ga4"]);
    }
  });

  it("purchase maps everywhere, and Google Ads gets a conversion with its label", () => {
    const calls = buildProviderCalls(
      "purchase",
      { ...base, value: 100, transactionId: "42", eventId: purchaseEventId(42) },
      ALL,
    );
    expect(calls.map((c) => c.provider).sort()).toEqual(["ga4", "googleAds", "meta", "snap", "tiktok"]);
    const ads = calls.find((c) => c.provider === "googleAds")!;
    expect(ads.args).toEqual([
      "event",
      "conversion",
      { send_to: "AW-123456789/AbC_dEf-123", value: 100, currency: "AED", transaction_id: "42" },
    ]);
    const meta = calls.find((c) => c.provider === "meta")!;
    // The browser and server events share this id so Meta deduplicates them.
    expect(meta.args).toEqual(["track", "Purchase", expect.objectContaining({ value: 100, currency: "AED" }), { eventID: "order_42" }]);
    const tt = calls.find((c) => c.provider === "tiktok")!;
    expect(tt.args[1]).toBe("CompletePayment");
    expect(tt.args[3]).toEqual({ event_id: "order_42" });
    const ga = calls.find((c) => c.provider === "ga4")!;
    expect((ga.args[2] as Record<string, unknown>).transaction_id).toBe("42");
    // Snap's browser dedupe id is the same order_<id> the server event carries.
    const snap = calls.find((c) => c.provider === "snap")!;
    expect(snap.args[2]).toEqual(expect.objectContaining({ client_dedup_id: "order_42", transaction_id: "42" }));
  });

  it("Snap gets no dedupe id when the caller supplies none", () => {
    const snap = buildProviderCalls("add_to_cart", base, ALL).find((c) => c.provider === "snap")!;
    expect(snap.args[2]).not.toHaveProperty("client_dedup_id");
  });

  it("no Google Ads conversion without a label", () => {
    const calls = buildProviderCalls("purchase", base, { googleAdsConversionId: "AW-123456789" });
    expect(calls).toEqual([]);
  });

  it("value defaults to the line total and a KWD amount keeps its precision", () => {
    const [ga] = buildProviderCalls(
      "add_to_cart",
      { currency: "KWD", items: [{ id: 1, name: "x", price: 10.505, quantity: 3 }] },
      { ga4MeasurementId: "G-ABCD1234" },
    );
    expect((ga.args[2] as Record<string, unknown>).value).toBeCloseTo(31.515, 6);
    expect((ga.args[2] as Record<string, unknown>).currency).toBe("KWD");
  });

  it("page_view is a plain PageView / page() with no params", () => {
    const calls = buildProviderCalls("page_view", {}, ALL);
    expect(calls.find((c) => c.provider === "meta")!.args).toEqual(["track", "PageView"]);
    expect(calls.find((c) => c.provider === "tiktok")!.args).toEqual(["page"]);
    expect(calls.find((c) => c.provider === "snap")!.args[1]).toBe("PAGE_VIEW");
  });
});
