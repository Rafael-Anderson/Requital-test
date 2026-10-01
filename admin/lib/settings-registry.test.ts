import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { SETTINGS_GROUPS, SETTINGS_INDEX, searchSettings } from "./settings-registry";

const APP = path.resolve(__dirname, "../app");

function pageFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) pageFiles(full, out);
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

const allPages = SETTINGS_GROUPS.flatMap((g) => g.pages);

describe("settings registry integrity", () => {
  it("every registered href is a real page", () => {
    for (const p of allPages) {
      expect(existsSync(path.join(APP, p.href, "page.tsx")), p.href).toBe(true);
    }
  });

  it("registers each href once", () => {
    const hrefs = allPages.map((p) => p.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  // Drift guard: a new page under app/settings that is not in the registry
  // would be unreachable from the sidebar, the landing page and search. The
  // exceptions are routes that are deliberately not destinations.
  it("every page under app/settings is registered or a known redirect/pointer/detail route", () => {
    const registered = new Set(allPages.map((p) => p.href));
    const notDestinations = new Set([
      "/settings", // the landing page itself
      "/settings/business", // redirects to Business Information
      "/settings/jobs", // pointer to Diagnostics
      "/settings/business/payments", // pointer to Integrations
      "/settings/business/delivery-providers", // pointer to Integrations
      "/settings/outlets/[outletId]/edit", // detail page of Outlets
    ]);
    const found = pageFiles(path.join(APP, "settings")).map((f) =>
      path.dirname(path.relative(APP, f)).split(path.sep).join("/").replace(/^/, "/"),
    );
    const unregistered = found.filter((h) => !registered.has(h) && !notDestinations.has(h));
    expect(unregistered).toEqual([]);
  });

  it("only links into settings, integrations and the theme app", () => {
    for (const p of allPages) expect(p.href).toMatch(/^\/(settings|integrations|theme)(\/|$)/);
  });
});

describe("searchSettings", () => {
  const top = (q: string) => searchSettings(q)[0];

  it("finds the tax rate on Money & Tax, not on an outlet", () => {
    expect(top("tax rate")).toMatchObject({ label: "Tax rate", href: "/settings/selling/money-tax" });
    const vat = searchSettings("vat").map((h) => h.label);
    expect(vat).toEqual(expect.arrayContaining(["Tax rate", "Tax type", "TRN"]));
  });

  it("finds each moved fulfilment setting on its new page", () => {
    expect(top("delivery hours")?.href).toBe("/settings/fulfilment/delivery");
    expect(top("pickup hours")?.href).toBe("/settings/fulfilment/pickup");
    expect(searchSettings("same-day cutoff").map((h) => h.href)).toContain("/settings/fulfilment/delivery");
    expect(searchSettings("cash on pickup").map((h) => h.href)).toContain("/settings/fulfilment/pickup");
  });

  it("finds the three display settings and the diagnostics tools", () => {
    expect(top("image zoom")?.href).toBe("/settings/storefront/display");
    expect(top("collection menu")?.href).toBe("/settings/storefront/display");
    expect(top("orientation")?.href).toBe("/settings/storefront/display");
    expect(top("failed jobs")?.href).toBe("/settings/diagnostics");
    expect(top("webhook")?.href).toBe("/settings/diagnostics");
  });

  it("is case-insensitive and requires every word to match", () => {
    expect(top("TAX RATE")?.href).toBe("/settings/selling/money-tax");
    expect(searchSettings("tax rate zzzz")).toEqual([]);
  });

  it("returns nothing for an empty or blank query", () => {
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
  });

  it("ranks a label match above a match found only through keywords", () => {
    // "vat" is only a keyword on "Tax rate"; "TRN" mentions vat in keywords too,
    // but a row whose own label contains the term must come first.
    const hits = searchSettings("delivery");
    const firstKeywordOnly = hits.findIndex((h) => !h.label.toLowerCase().includes("delivery"));
    const lastLabelMatch = hits.map((h) => h.label.toLowerCase().includes("delivery")).lastIndexOf(true);
    expect(firstKeywordOnly === -1 || lastLabelMatch < firstKeywordOnly).toBe(true);
  });

  it("reports where a result lives and whether it leaves Settings", () => {
    expect(top("tax type")).toMatchObject({ location: "Selling > Money & Tax", external: false });
    expect(top("card processor")).toMatchObject({ href: "/integrations/payments", external: true });
  });

  it("does not index the dead settings", () => {
    const labels = SETTINGS_INDEX.map((r) => r.label.toLowerCase());
    for (const dead of ["pre-order", "birthday", "asap", "delivery calendar", "customer confirmation"]) {
      expect(labels.some((l) => l.includes(dead)), dead).toBe(false);
    }
  });
});
