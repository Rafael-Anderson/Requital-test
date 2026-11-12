import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  LAYOUT_ENTRIES,
  applicableLayoutEntries,
  buildSearchIndex,
  isLayoutEntryApplicable,
  resolveLayoutEntry,
  searchSettings,
  type BuilderContext,
} from "./theme-builder-registry";
import { THEME_LAYOUT_CATEGORY_LABELS } from "./theme-layout-categories";
import { THEME_SETTINGS_CATEGORY_LABELS } from "./theme-settings-categories";
import type { ThemeSectionType } from "./types";

const sections = (...t: ThemeSectionType[]): BuilderContext["sectionTypesPresent"] => new Set(t);
const SECTIONS: BuilderContext = { sectionsMode: true, sectionTypesPresent: sections("hero", "announcement_bar", "featured_collections") };
const LAYOUT: BuilderContext = { sectionsMode: false, sectionTypesPresent: sections("hero") };

describe("layout entry registry", () => {
  it("covers exactly the Layout list, in order", () => {
    expect(LAYOUT_ENTRIES.map((e) => e.id)).toEqual([...THEME_LAYOUT_CATEGORY_LABELS]);
    for (const e of LAYOUT_ENTRIES) expect(e.evidence.length).toBeGreaterThan(20);
  });

  it("Sections mode lists only the entries that still do something", () => {
    expect(applicableLayoutEntries(SECTIONS).map((e) => e.id)).toEqual([
      "Home tab",
      "Menu",
      "Product page layout",
      "Cart layout",
      "Checkout layout",
      "Icon style",
      "Button shape",
      "Button fill",
    ]);
  });

  it("Layout mode lists all 13", () => {
    expect(applicableLayoutEntries(LAYOUT)).toHaveLength(13);
  });

  it("a saved or deep-linked entry that is hidden falls back to the first applicable one", () => {
    expect(resolveLayoutEntry("Top bar layout", SECTIONS)).toBe("Home tab");
    expect(resolveLayoutEntry("Footer size", SECTIONS)).toBe("Home tab");
    expect(resolveLayoutEntry(null, SECTIONS)).toBe("Home tab");
    expect(resolveLayoutEntry("not a real entry", SECTIONS)).toBe("Home tab");
    expect(resolveLayoutEntry("Cart layout", SECTIONS)).toBe("Cart layout");
    expect(resolveLayoutEntry("Top bar layout", LAYOUT)).toBe("Top bar layout");
    expect(isLayoutEntryApplicable("Header size", SECTIONS)).toBe(false);
  });
});

// The predicates are an audit, so the audit is checked against the storefront source it cites:
// each entry that is dead in Sections mode is read only AFTER the themed early return, and each
// entry that stays live is read on a path the themed storefront actually renders.
describe("layout predicates match the storefront code", () => {
  const sf = (f: string) => fs.readFileSync(path.join(__dirname, "../../storefront", f), "utf8");
  const before = (src: string, marker: string, field: string) => {
    const m = src.indexOf(marker);
    const f = src.indexOf(field);
    expect(m, `${marker} present`).toBeGreaterThan(-1);
    expect(f, `${field} present`).toBeGreaterThan(-1);
    return m < f;
  };

  it("Top bar layout and Header size: TopBar returns ThemeDrivenHeader before reading them; ThemeDrivenHeader never reads them", () => {
    const top = sf("components/TopBar.tsx");
    expect(before(top, "if (themeConfig?.header)", "props.shop?.topBarLayout")).toBe(true);
    // headerDensity is only read by TopBar's own padding helper, which the themed header never calls.
    expect(top.match(/shop\?\.headerDensity/g)).toHaveLength(1);
    const themed = sf("components/theme-sections/ThemeDrivenHeader.tsx");
    expect(themed).not.toMatch(/topBarLayout|headerDensity|headerPadding/);
  });

  it("Footer layout and Footer size: Footer returns ThemeDrivenFooter before reading them; ThemeDrivenFooter never reads them", () => {
    const footer = sf("components/Footer.tsx");
    expect(before(footer, "if (themeConfig?.footer)", "shop.footerLayout")).toBe(true);
    expect(before(footer, "if (themeConfig?.footer)", "shop.footerDensity")).toBe(true);
    expect(sf("components/theme-sections/ThemeDrivenFooter.tsx")).not.toMatch(/footerLayout|footerDensity/);
  });

  it("Homepage layout and the Home tab toggle: the home page returns the Sections body before reading them", () => {
    const page = sf("app/[shop]/page.tsx");
    expect(before(page, "if (themeConfig) {", "homeTabMode === ")).toBe(true);
    expect(before(page, "if (themeConfig) {", "<HomepageTop")).toBe(true);
  });

  it("the entries that stay live are read on the themed path", () => {
    expect(sf("components/theme-sections/ThemeDrivenHeader.tsx")).toMatch(/shop\?\.iconStyle/);
    expect(sf("components/theme-sections/ThemeDrivenHeader.tsx")).toMatch(/shop\?\.cartLayout/);
    expect(sf("components/theme-sections/HeroSection.tsx")).toMatch(/shop\?\.buttonFill/);
    expect(sf("app/[shop]/products/[slug]/ProductDetailClient.tsx")).toMatch(/shop\?\.pdpLayout/);
    expect(sf("app/[shop]/checkout/page.tsx")).toMatch(/checkoutLayout/);
    expect(sf("lib/shop-context.tsx")).toMatch(/--theme-btn-primary-radius/);
  });
});

describe("settings search index", () => {
  const labels = (ctx: BuilderContext) => buildSearchIndex(ctx).map((e) => `${e.group}/${e.label}`);

  it("never lists a Layout entry that does not apply (rule 7)", () => {
    const layoutGroup = buildSearchIndex(SECTIONS).filter((e) => e.group === "Layout").map((e) => e.label);
    expect(layoutGroup).not.toContain("Top bar layout");
    expect(layoutGroup).not.toContain("Footer layout");
    expect(layoutGroup).toContain("Cart layout");
    expect(buildSearchIndex(LAYOUT).filter((e) => e.group === "Layout")).toHaveLength(13);
  });

  it("includes section-level settings only for section types the theme has", () => {
    expect(labels(SECTIONS)).toContain("Hero/Content position");
    expect(labels({ sectionsMode: true, sectionTypesPresent: sections("announcement_bar") })).not.toContain("Hero/Content position");
  });

  it("the persistent bar and the homepage strip are two differently named groups", () => {
    const groups = new Set(
      buildSearchIndex({ sectionsMode: true, sectionTypesPresent: new Set(["announcement_bar", "hero"]) }).map((e) => e.group),
    );
    expect(groups.has("Announcement bar")).toBe(true);
    expect(groups.has("Announcement strip")).toBe(true);
    // each group name leads to exactly one kind of panel
    const kinds = new Map<string, Set<string>>();
    for (const e of buildSearchIndex({ sectionsMode: true, sectionTypesPresent: new Set(["announcement_bar", "hero"]) })) {
      const kind = e.target.mode === "sections" ? e.target.kind : e.target.mode;
      kinds.set(e.group, (kinds.get(e.group) ?? new Set()).add(kind));
    }
    for (const [group, set] of kinds) expect(set.size, `group ${group}`).toBe(1);
  });

  it("covers every Theme settings category and the Announcement bar fields", () => {
    const l = labels(SECTIONS);
    for (const c of THEME_SETTINGS_CATEGORY_LABELS) expect(l).toContain(`Theme settings: ${c}/${c}`);
    expect(l).toContain("Announcement bar/Speed");
    expect(l).toContain("Announcement bar/Announcement bar");
  });

  it("searching 'speed' finds Announcement bar > Speed, grouped under its area", () => {
    const groups = searchSettings(buildSearchIndex(SECTIONS), "speed");
    const bar = groups.find((g) => g.group === "Announcement bar");
    expect(bar?.entries.map((e) => e.label)).toContain("Speed");
    expect(bar?.entries.find((e) => e.label === "Speed")?.target).toEqual({ mode: "sections", kind: "announcement" });
  });

  it("searching 'content position' finds the Hero setting with a target section type", () => {
    const groups = searchSettings(buildSearchIndex(SECTIONS), "content position");
    const hero = groups.find((g) => g.group === "Hero");
    expect(hero?.entries[0].label).toBe("Content position");
    expect(hero?.entries[0].target).toEqual({ mode: "sections", kind: "section", sectionType: "hero" });
  });

  it("matches keywords and descriptions, ignores case, and an empty or unmatched query gives no groups", () => {
    expect(searchSettings(buildSearchIndex(SECTIONS), "MARQUEE").some((g) => g.group === "Announcement bar")).toBe(true);
    expect(searchSettings(buildSearchIndex(SECTIONS), "tab icon").some((g) => g.entries.some((e) => e.label === "Favicon"))).toBe(true);
    expect(searchSettings(buildSearchIndex(SECTIONS), "   ")).toEqual([]);
    expect(searchSettings(buildSearchIndex(SECTIONS), "zzzzqqq")).toEqual([]);
  });
});
