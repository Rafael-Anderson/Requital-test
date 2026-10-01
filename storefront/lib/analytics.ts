// MKT-4: the storefront's analytics layer.
//
// ONE vocabulary, translated per provider. Call sites say `track("add_to_cart",
// {...})` and never name a provider; this file maps it onto GA4, Meta, TikTok,
// Snap and Google Ads' own event names and parameter shapes.
//
// CONSENT IS THE SWITCH. Until the visitor accepts the cookie banner
// (components/CookieConsentBanner.tsx -> lib/consent.ts) NOTHING here touches the
// network or the DOM: no provider script tag is injected, no global stub is
// installed, `track` is a no-op. A declined or unanswered banner means zero
// third-party scripts, for the lifetime of the page. The scripts load lazily, the
// moment consent is granted, and only for providers the merchant configured.
//
// Every id is re-validated (analytics-ids.ts) before it is placed in a URL.
//
// Only browser-side events live here. The server-side Meta Conversions API event
// for a purchase is sent by the backend and shares `purchaseEventId` with the
// browser's own purchase event so Meta deduplicates the pair.
import { loadScriptOnce } from "./load-script";
import { sanitizeAnalyticsConfig, type PublicAnalyticsConfig } from "./analytics-ids";

export type AnalyticsEventName =
  | "page_view"
  | "view_item"
  | "view_item_list"
  | "select_item"
  | "add_to_cart"
  | "remove_from_cart"
  | "begin_checkout"
  | "add_payment_info"
  | "purchase"
  | "search"
  | "sign_up";

export interface AnalyticsItem {
  id: string | number;
  name: string;
  price: number;
  quantity?: number;
  variant?: string;
  brand?: string;
}

export interface AnalyticsPayload {
  items?: AnalyticsItem[];
  value?: number;
  currency?: string;
  transactionId?: string;
  // Shared with the server's Conversions API event; see purchaseEventId.
  eventId?: string;
  query?: string;
  listName?: string;
  paymentType?: string;
  method?: string;
}

// Mirrored by hand in backend/src/shop-analytics/meta-capi.ts. Change both
// together: if they drift, Meta counts every purchase twice.
export function purchaseEventId(orderId: number | string): string {
  return `order_${orderId}`;
}

export type ProviderName = "ga4" | "googleAds" | "meta" | "tiktok" | "snap";

export interface ProviderCall {
  provider: ProviderName;
  // ga4/googleAds: gtag(...args). meta: fbq(...args). snap: snaptr(...args).
  // tiktok: ttq[args[0]](...args.slice(1)) (so ["track", name, params, opts] or ["page"]).
  args: unknown[];
}

const GA4_EVENTS: Partial<Record<AnalyticsEventName, string>> = {
  page_view: "page_view",
  view_item: "view_item",
  view_item_list: "view_item_list",
  select_item: "select_item",
  add_to_cart: "add_to_cart",
  remove_from_cart: "remove_from_cart",
  begin_checkout: "begin_checkout",
  add_payment_info: "add_payment_info",
  purchase: "purchase",
  search: "search",
  sign_up: "sign_up",
};

const META_EVENTS: Partial<Record<AnalyticsEventName, string>> = {
  page_view: "PageView",
  view_item: "ViewContent",
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
  add_payment_info: "AddPaymentInfo",
  purchase: "Purchase",
  search: "Search",
  sign_up: "CompleteRegistration",
};

// CompletePayment is TikTok's long-standing pixel name for a purchase.
const TIKTOK_EVENTS: Partial<Record<AnalyticsEventName, string>> = {
  view_item: "ViewContent",
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
  add_payment_info: "AddPaymentInfo",
  purchase: "CompletePayment",
  search: "Search",
  sign_up: "CompleteRegistration",
};

const SNAP_EVENTS: Partial<Record<AnalyticsEventName, string>> = {
  page_view: "PAGE_VIEW",
  view_item: "VIEW_CONTENT",
  add_to_cart: "ADD_CART",
  begin_checkout: "START_CHECKOUT",
  add_payment_info: "ADD_BILLING",
  purchase: "PURCHASE",
  search: "SEARCH",
  sign_up: "SIGN_UP",
};

function totalValue(p: AnalyticsPayload): number | undefined {
  if (p.value !== undefined) return p.value;
  if (!p.items?.length) return undefined;
  return p.items.reduce((sum, i) => sum + i.price * (i.quantity ?? 1), 0);
}

function numItems(p: AnalyticsPayload): number {
  return (p.items ?? []).reduce((n, i) => n + (i.quantity ?? 1), 0);
}

function strip<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
  return obj;
}

function ga4Params(p: AnalyticsPayload) {
  return strip({
    currency: p.currency,
    value: totalValue(p),
    transaction_id: p.transactionId,
    search_term: p.query,
    item_list_name: p.listName,
    payment_type: p.paymentType,
    method: p.method,
    items: p.items?.map((i) =>
      strip({
        item_id: String(i.id),
        item_name: i.name,
        price: i.price,
        quantity: i.quantity ?? 1,
        item_variant: i.variant,
        item_brand: i.brand,
      }),
    ),
  });
}

function metaParams(p: AnalyticsPayload) {
  return strip({
    content_type: p.items?.length ? "product" : undefined,
    content_ids: p.items?.map((i) => String(i.id)),
    content_name: p.items?.length === 1 ? p.items[0].name : undefined,
    contents: p.items?.map((i) => ({ id: String(i.id), quantity: i.quantity ?? 1, item_price: i.price })),
    num_items: p.items?.length ? numItems(p) : undefined,
    value: totalValue(p),
    currency: p.currency,
    search_string: p.query,
  });
}

function tiktokParams(p: AnalyticsPayload) {
  return strip({
    content_type: p.items?.length ? "product" : undefined,
    contents: p.items?.map((i) => ({
      content_id: String(i.id),
      content_name: i.name,
      quantity: i.quantity ?? 1,
      price: i.price,
    })),
    value: totalValue(p),
    currency: p.currency,
    query: p.query,
  });
}

function snapParams(p: AnalyticsPayload) {
  return strip({
    item_ids: p.items?.map((i) => String(i.id)),
    number_items: p.items?.length ? numItems(p) : undefined,
    price: totalValue(p),
    currency: p.currency,
    transaction_id: p.transactionId,
    search_string: p.query,
  });
}

// Pure: which provider calls one vocabulary event becomes, given the configured
// ids. Events a provider has no equivalent for (e.g. view_item_list on Meta) are
// simply not sent there. Exported for tests.
export function buildProviderCalls(
  event: AnalyticsEventName,
  payload: AnalyticsPayload,
  config: PublicAnalyticsConfig,
): ProviderCall[] {
  const calls: ProviderCall[] = [];

  const ga4Name = GA4_EVENTS[event];
  if (config.ga4MeasurementId && ga4Name) {
    calls.push({
      provider: "ga4",
      args: ["event", ga4Name, { ...ga4Params(payload), send_to: config.ga4MeasurementId }],
    });
  }

  if (event === "purchase" && config.googleAdsConversionId && config.googleAdsConversionLabel) {
    calls.push({
      provider: "googleAds",
      args: [
        "event",
        "conversion",
        strip({
          send_to: `${config.googleAdsConversionId}/${config.googleAdsConversionLabel}`,
          value: totalValue(payload),
          currency: payload.currency,
          transaction_id: payload.transactionId,
        }),
      ],
    });
  }

  const metaName = META_EVENTS[event];
  if (config.metaPixelId && metaName) {
    const args: unknown[] = ["track", metaName];
    if (event !== "page_view") args.push(metaParams(payload));
    // eventID is what Meta deduplicates the browser and server purchase on.
    if (event !== "page_view" && payload.eventId) args.push({ eventID: payload.eventId });
    calls.push({ provider: "meta", args });
  }

  if (config.tiktokPixelId) {
    if (event === "page_view") {
      calls.push({ provider: "tiktok", args: ["page"] });
    } else if (TIKTOK_EVENTS[event]) {
      const args: unknown[] = ["track", TIKTOK_EVENTS[event], tiktokParams(payload)];
      if (payload.eventId) args.push({ event_id: payload.eventId });
      calls.push({ provider: "tiktok", args });
    }
  }

  const snapName = SNAP_EVENTS[event];
  if (config.snapPixelId && snapName) {
    calls.push({ provider: "snap", args: ["track", snapName, snapParams(payload)] });
  }

  return calls;
}

// ------------------------------------------------------------------- runtime

interface AnalyticsWindow {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  fbq?: ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue: unknown[][] };
  _fbq?: unknown;
  ttq?: Record<string, unknown> & unknown[];
  TiktokAnalyticsObject?: string;
  snaptr?: ((...args: unknown[]) => void) & { handleRequest?: (...a: unknown[]) => void; queue: unknown[] };
}

const w = (): AnalyticsWindow => window as unknown as AnalyticsWindow;

interface RuntimeState {
  config: PublicAnalyticsConfig;
  currency?: string;
  // True once the visitor has accepted AND the provider stubs are installed.
  active: boolean;
}

const state: RuntimeState = { config: {}, active: false };

// Registers the shop's configured ids. Loads nothing: loading is gated on consent
// below. Call again (shop change) to reset.
export function initAnalytics(rawConfig: unknown, currency?: string): void {
  state.config = sanitizeAnalyticsConfig(rawConfig);
  state.currency = currency;
  state.active = false;
}

export function hasConfiguredProviders(): boolean {
  return Object.keys(state.config).length > 0;
}

export function isAnalyticsActive(): boolean {
  return state.active;
}

function installGtag(id: string, adsId?: string): void {
  const win = w();
  win.dataLayer = win.dataLayer ?? [];
  if (!win.gtag) {
    win.gtag = function gtag() {
      // gtag.js only recognises the real `arguments` object, not an array.
      // eslint-disable-next-line prefer-rest-params
      (win.dataLayer as unknown[]).push(arguments);
    };
  }
  win.gtag("js", new Date());
  // Page views are sent by <Analytics/> on every route change (an SPA never
  // reloads), so the automatic one is off.
  win.gtag("config", id, { send_page_view: false });
  if (adsId && adsId !== id) win.gtag("config", adsId);
  void loadScriptOnce(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`).catch(() => {});
}

function installMeta(pixelId: string): void {
  const win = w();
  if (!win.fbq) {
    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    } as NonNullable<AnalyticsWindow["fbq"]> & { push?: unknown; loaded?: boolean; version?: string };
    fbq.queue = [];
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    win.fbq = fbq;
    win._fbq = fbq;
  }
  win.fbq("init", pixelId);
  void loadScriptOnce("https://connect.facebook.net/en_US/fbevents.js").catch(() => {});
}

const TTQ_METHODS = [
  "page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group",
  "enableCookie", "disableCookie",
];

function installTikTok(pixelId: string): void {
  const win = w();
  win.TiktokAnalyticsObject = "ttq";
  const ttq = (win.ttq = win.ttq ?? ([] as unknown as NonNullable<AnalyticsWindow["ttq"]>)) as Record<string, unknown> & unknown[];
  const setAndDefer = (target: Record<string, unknown> & unknown[], method: string) => {
    target[method] = (...args: unknown[]) => {
      target.push([method, ...args]);
    };
  };
  ttq.methods = TTQ_METHODS;
  for (const m of TTQ_METHODS) setAndDefer(ttq, m);
  const src = "https://analytics.tiktok.com/i18n/pixel/events.js";
  const instance = [] as unknown[] & { _u?: string };
  instance._u = src;
  ttq._i = { [pixelId]: instance };
  ttq._t = { [pixelId]: Date.now() };
  ttq._o = { [pixelId]: {} };
  void loadScriptOnce(`${src}?sdkid=${encodeURIComponent(pixelId)}&lib=ttq`).catch(() => {});
}

function installSnap(pixelId: string): void {
  const win = w();
  if (!win.snaptr) {
    const snaptr = function (...args: unknown[]) {
      if (snaptr.handleRequest) snaptr.handleRequest(...args);
      else snaptr.queue.push(args);
    } as NonNullable<AnalyticsWindow["snaptr"]>;
    snaptr.queue = [];
    win.snaptr = snaptr;
  }
  win.snaptr("init", pixelId);
  void loadScriptOnce("https://sc-static.net/scevent.min.js").catch(() => {});
}

// Called by <Analytics/> with the banner's current answer. The ONLY place a
// provider script is ever added to the page, and it returns immediately unless
// `granted` is true and there is something configured.
export function setAnalyticsConsent(granted: boolean): void {
  if (typeof window === "undefined") return;
  if (!granted) {
    // Declined / not answered. Scripts that were never loaded stay unloaded; a
    // page that already loaded them (accepted, then changed their mind) cannot
    // unload them, so `active` goes false and track() stops reporting.
    state.active = false;
    return;
  }
  if (state.active || !hasConfiguredProviders()) return;
  const c = state.config;
  const gtagId = c.ga4MeasurementId ?? c.googleAdsConversionId;
  if (gtagId) installGtag(gtagId, c.googleAdsConversionId);
  if (c.metaPixelId) installMeta(c.metaPixelId);
  if (c.tiktokPixelId) installTikTok(c.tiktokPixelId);
  if (c.snapPixelId) installSnap(c.snapPixelId);
  state.active = true;
}

function dispatch(call: ProviderCall): void {
  const win = w();
  switch (call.provider) {
    case "ga4":
    case "googleAds":
      win.gtag?.(...call.args);
      break;
    case "meta":
      win.fbq?.(...call.args);
      break;
    case "snap":
      win.snaptr?.(...call.args);
      break;
    case "tiktok": {
      const [method, ...rest] = call.args as [string, ...unknown[]];
      const fn = win.ttq?.[method];
      if (typeof fn === "function") (fn as (...a: unknown[]) => void)(...rest);
      break;
    }
  }
}

// Report one event. A no-op unless the visitor consented and a provider is
// configured, so it is always safe to call (and cheap) from any component.
export function track(event: AnalyticsEventName, payload: AnalyticsPayload = {}): void {
  if (typeof window === "undefined" || !state.active) return;
  const full: AnalyticsPayload = { ...payload, currency: payload.currency ?? state.currency };
  for (const call of buildProviderCalls(event, full, state.config)) {
    try {
      dispatch(call);
    } catch {
      // A provider script failing must never break the storefront.
    }
  }
}

// Test seam: forget everything (the singleton outlives a test otherwise).
export function resetAnalyticsForTests(): void {
  state.config = {};
  state.currency = undefined;
  state.active = false;
}
