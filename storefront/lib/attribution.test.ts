import { beforeEach, describe, expect, it } from "vitest";
import { buildOrderAttribution, captureAttribution, deriveTouch, mergeTouch, purgeClickIds } from "./attribution";
import { cookieConsentStorageKey } from "./consent";

const NOW = new Date("2026-10-01T10:00:00.000Z");

function visit(url: string, referrer = "", slug = "shop-a", at = NOW) {
  window.history.replaceState({}, "", url);
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
  captureAttribution(slug, at);
}
function setConsent(choice: "accepted" | "declined" | null, slug = "shop-a") {
  if (choice) localStorage.setItem(cookieConsentStorageKey(slug), choice);
}
const stored = (slug = "shop-a") => JSON.parse(localStorage.getItem(`requital_attr:${slug}`) ?? "{}");

beforeEach(() => {
  localStorage.clear();
  document.cookie.split(";").forEach((c) => (document.cookie = `${c.split("=")[0].trim()}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`));
});

describe("deriveTouch", () => {
  it("reads UTMs, lower-cases source/medium, and keeps only the path", () => {
    const { touch, direct } = deriveTouch(
      new URL("https://shop.requital.io/products/rose?utm_source=Google&utm_medium=CPC&utm_campaign=Spring&utm_term=roses&utm_content=ad1&x=secret"),
      "",
      NOW,
    );
    expect(direct).toBe(false);
    expect(touch).toMatchObject({ source: "google", medium: "cpc", campaign: "Spring", term: "roses", content: "ad1", landingPath: "/products/rose" });
    expect(JSON.stringify(touch)).not.toContain("secret");
  });

  it("infers a source from a click id when there are no UTMs", () => {
    expect(deriveTouch(new URL("https://s.io/?gclid=abc"), "", NOW).touch).toMatchObject({ source: "google", medium: "cpc", gclid: "abc" });
    expect(deriveTouch(new URL("https://s.io/?fbclid=abc"), "", NOW).touch).toMatchObject({ source: "facebook", medium: "social" });
    expect(deriveTouch(new URL("https://s.io/?ttclid=abc"), "", NOW).touch).toMatchObject({ source: "tiktok", medium: "social" });
  });

  it("an external referrer is a referral (origin+path only); no referrer is direct", () => {
    const ref = deriveTouch(new URL("https://s.io/"), "https://www.blog.example/post?id=1&tok=zz", NOW);
    expect(ref.direct).toBe(false);
    expect(ref.touch).toMatchObject({ source: "blog.example", medium: "referral", referrer: "https://www.blog.example/post" });
    const direct = deriveTouch(new URL("https://s.io/"), "", NOW);
    expect(direct.direct).toBe(true);
    expect(direct.touch).toMatchObject({ source: "(direct)", medium: "(none)" });
  });

  it("the shop's own host and payment pages are not traffic sources", () => {
    expect(deriveTouch(new URL("https://s.io/"), "https://s.io/cart", NOW).direct).toBe(true);
    expect(deriveTouch(new URL("https://s.io/"), "https://checkout.stripe.com/pay/x", NOW).direct).toBe(true);
  });
});

describe("first / last touch persistence", () => {
  it("first touch is kept; last touch follows each non-direct visit; a direct visit never overwrites a campaign", () => {
    visit("/shop-a?utm_source=news&utm_medium=email");
    visit("/shop-a?utm_source=ads&utm_medium=cpc&utm_campaign=c1", "", "shop-a", new Date("2026-10-02T10:00:00Z"));
    visit("/shop-a", "", "shop-a", new Date("2026-10-03T10:00:00Z"));
    const s = stored();
    expect(s.first.source).toBe("news");
    expect(s.last.source).toBe("ads");
    expect(s.last.campaign).toBe("c1");
  });

  it("is namespaced per shop", () => {
    visit("/shop-a?utm_source=x", "", "shop-a");
    expect(stored("shop-b")).toEqual({});
  });

  it("drops a touch older than 90 days", () => {
    visit("/shop-a?utm_source=old");
    setConsent("declined");
    const later = new Date(NOW.getTime() + 91 * 86400000);
    Date.now = () => later.getTime();
    try {
      expect(buildOrderAttribution("shop-a").firstTouch).toBeUndefined();
    } finally {
      Date.now = () => new Date().getTime();
    }
  });
});

describe("consent gates everything that identifies the visitor to an ad platform", () => {
  beforeEach(() => {
    visit("/shop-a?utm_source=fb&utm_medium=paid&gclid=GCL-AAA&fbclid=FBC-BBB&ttclid=TTC-CCC");
    document.cookie = "_fbp=fb.1.1.2";
  });

  it("accepted: click ids, fbp, fbc (built from fbclid) and the user agent are sent", () => {
    setConsent("accepted");
    const a = buildOrderAttribution("shop-a");
    expect(a.consent).toEqual({ marketing: true });
    expect(a.firstTouch).toMatchObject({ gclid: "GCL-AAA", fbclid: "FBC-BBB", ttclid: "TTC-CCC" });
    expect(a.fbp).toBe("fb.1.1.2");
    expect(a.fbc).toBe(`fb.1.${NOW.getTime()}.FBC-BBB`);
    expect(a.clientUserAgent).toBeTruthy();
  });

  it.each([["declined" as const], [null]])("%s: none of them leave the browser, UTMs still do", (choice) => {
    setConsent(choice);
    const a = buildOrderAttribution("shop-a");
    expect(a.consent).toEqual({ marketing: choice === "declined" ? false : null });
    const text = JSON.stringify(a);
    expect(text).not.toMatch(/GCL-AAA|FBC-BBB|TTC-CCC|fb\.1\.|Mozilla|jsdom/);
    expect(a.fbp).toBeUndefined();
    expect(a.fbc).toBeUndefined();
    expect(a.clientUserAgent).toBeUndefined();
    expect(a.firstTouch).toMatchObject({ source: "fb", medium: "paid" });
  });

  it("purgeClickIds (run when the banner is declined) removes them from storage too", () => {
    purgeClickIds("shop-a");
    expect(JSON.stringify(stored())).not.toMatch(/GCL-AAA|FBC-BBB|TTC-CCC/);
    expect(stored().first.source).toBe("fb");
  });
});

describe("mergeTouch", () => {
  it("first touch is never replaced", () => {
    const first = { source: "a", capturedAt: NOW.toISOString() };
    const merged = mergeTouch({ first }, { touch: { source: "b", capturedAt: NOW.toISOString() }, direct: false });
    expect(merged.first).toBe(first);
    expect(merged.last?.source).toBe("b");
  });
});
