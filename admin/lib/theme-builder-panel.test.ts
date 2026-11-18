import { describe, expect, it } from "vitest";
import {
  PANEL_PLACEMENTS,
  entriesForTab,
  entryKey,
  queryToView,
  tabForEntry,
  viewForSearchTarget,
  viewToQuery,
  type PanelEntry,
} from "./theme-builder-panel";
import { LAYOUT_ENTRIES, LAYOUT_ENTRY_IDS, buildSearchIndex, type BuilderContext } from "./theme-builder-registry";
import { THEME_SETTINGS_CATEGORY_LABELS } from "./theme-settings-categories";
import type { ThemeConfig } from "./types";

const CHROME = { announcement: "__announcement__", header: "__header__", footer: "__footer__" };
const CHROME_IDS = Object.values(CHROME);
const SECTIONS_MODE: BuilderContext = { sectionsMode: true, sectionTypesPresent: new Set(["hero"]) };
const LAYOUT_MODE: BuilderContext = { sectionsMode: false, sectionTypesPresent: new Set(["hero"]) };

function config(): ThemeConfig {
  return {
    header: { settings: {}, blocks: [{ id: "blk-logo", type: "logo", visible: true, order: 0, settings: {} }] },
    footer: { settings: {}, blocks: [] },
    sections: [
      { id: "sec-b", type: "product_grid", visible: true, order: 1, settings: {}, blocks: [] },
      {
        id: "sec-a",
        type: "hero",
        visible: true,
        order: 0,
        settings: {},
        blocks: [{ id: "blk-h", type: "heading", visible: true, order: 0, settings: {} }],
      },
    ],
    globalSettings: {} as ThemeConfig["globalSettings"],
  };
}

const allEntries: PanelEntry[] = [
  ...THEME_SETTINGS_CATEGORY_LABELS.map((category): PanelEntry => ({ kind: "theme", category })),
  ...LAYOUT_ENTRY_IDS.map((id): PanelEntry => ({ kind: "layout", id })),
];

describe("tab mapping", () => {
  it("places every registry entry (24 Theme settings categories + 12 Layout entries) in exactly one tab", () => {
    for (const entry of allEntries) {
      const matches = PANEL_PLACEMENTS.filter((p) => entryKey(p.entry) === entryKey(entry));
      expect(matches, entryKey(entry)).toHaveLength(1);
    }
    expect(PANEL_PLACEMENTS).toHaveLength(allEntries.length);
  });

  it("in either storefront mode, every entry is listed in exactly one tab or hidden, and hidden = the registry says it does not apply", () => {
    for (const ctx of [SECTIONS_MODE, LAYOUT_MODE]) {
      const listed = [...entriesForTab("design", ctx), ...entriesForTab("settings", ctx)].flatMap((g) => g.entries.map(entryKey));
      expect(new Set(listed).size).toBe(listed.length);
      for (const entry of allEntries) {
        const layout = entry.kind === "layout" ? LAYOUT_ENTRIES.find((e) => e.id === entry.id) : null;
        const applies = layout ? layout.applies(ctx) : true;
        expect(listed.includes(entryKey(entry)), entryKey(entry)).toBe(applies);
      }
    }
  });

  it("Design holds the visual settings and Settings holds navigation, Home tab and the rest", () => {
    expect(tabForEntry({ kind: "theme", category: "Colors" })).toBe("design");
    expect(tabForEntry({ kind: "theme", category: "Typography" })).toBe("design");
    expect(tabForEntry({ kind: "layout", id: "Button shape" })).toBe("design");
    expect(tabForEntry({ kind: "layout", id: "Button fill" })).toBe("design");
    expect(tabForEntry({ kind: "layout", id: "Icon style" })).toBe("design");
    expect(tabForEntry({ kind: "layout", id: "Cart layout" })).toBe("design");
    expect(tabForEntry({ kind: "layout", id: "Menu" })).toBe("settings");
    expect(tabForEntry({ kind: "layout", id: "Home tab" })).toBe("settings");
  });

  it("hides the legacy-chrome Layout entries from a Sections-mode storefront", () => {
    const design = entriesForTab("design", SECTIONS_MODE).flatMap((g) => g.entries.map(entryKey));
    for (const dead of ["Homepage layout", "Top bar layout", "Header size", "Footer layout", "Footer size"]) {
      expect(design).not.toContain(`layout:${dead}`);
    }
    expect(entriesForTab("design", LAYOUT_MODE).flatMap((g) => g.entries.map(entryKey))).toContain("layout:Homepage layout");
  });
});

describe("drill-in router", () => {
  const q = (s: string) => new URLSearchParams(s);

  it("a section deep link opens that section", () => {
    expect(queryToView(q("panel=sections&node=sec-b"), config(), SECTIONS_MODE, CHROME_IDS)).toEqual({ tab: "sections", nodeId: "sec-b" });
  });

  it("block and chrome deep links open them", () => {
    expect(queryToView(q("panel=sections&node=blk-h"), config(), SECTIONS_MODE, CHROME_IDS)).toEqual({ tab: "sections", nodeId: "blk-h" });
    expect(queryToView(q("panel=sections&node=blk-logo"), config(), SECTIONS_MODE, CHROME_IDS)).toEqual({ tab: "sections", nodeId: "blk-logo" });
    expect(queryToView(q("panel=sections&node=__announcement__"), config(), SECTIONS_MODE, CHROME_IDS)).toEqual({
      tab: "sections",
      nodeId: "__announcement__",
    });
  });

  it("an unknown node falls back to the tree", () => {
    expect(queryToView(q("panel=sections&node=sec-gone"), config(), SECTIONS_MODE, CHROME_IDS)).toEqual({ tab: "sections", nodeId: null });
  });

  it("a Design / Settings deep link opens the entry in its own tab, whichever tab the link named", () => {
    expect(queryToView(q("panel=design&open=theme:Colors"), config(), SECTIONS_MODE, CHROME_IDS)).toEqual({
      tab: "design",
      entry: { kind: "theme", category: "Colors" },
    });
    expect(queryToView(q("panel=design&open=layout:Menu"), config(), SECTIONS_MODE, CHROME_IDS)).toEqual({
      tab: "settings",
      entry: { kind: "layout", id: "Menu" },
    });
  });

  it("an entry that does not apply to the shop falls back to its tab's list, never a dead pane", () => {
    expect(queryToView(q("panel=design&open=layout:Homepage layout"), config(), SECTIONS_MODE, CHROME_IDS)).toEqual({
      tab: "design",
      entry: null,
    });
    expect(queryToView(q("panel=design&open=theme:Nope"), config(), SECTIONS_MODE, CHROME_IDS)).toEqual({ tab: "design", entry: null });
  });

  it("viewToQuery and queryToView round-trip", () => {
    for (const view of [
      { tab: "sections", nodeId: "sec-a" },
      { tab: "sections", nodeId: null },
      { tab: "design", entry: { kind: "theme", category: "Typography" } },
      { tab: "settings", entry: { kind: "layout", id: "Home tab" } },
      { tab: "settings", entry: null },
    ] as const) {
      expect(queryToView(new URLSearchParams(viewToQuery(view)), config(), SECTIONS_MODE, CHROME_IDS)).toEqual(view);
    }
  });

  it("every search result lands on a real drill-in (a section result opens the first section of that type)", () => {
    const cfg = config();
    for (const entry of buildSearchIndex(SECTIONS_MODE)) {
      const view = viewForSearchTarget(entry.target, cfg, SECTIONS_MODE, CHROME);
      if (view.tab === "sections") expect(view.nodeId, entry.id).not.toBeNull();
      else expect(view.entry, entry.id).not.toBeNull();
    }
    expect(viewForSearchTarget({ mode: "sections", kind: "section", sectionType: "hero" }, cfg, SECTIONS_MODE, CHROME)).toEqual({
      tab: "sections",
      nodeId: "sec-a",
    });
    expect(viewForSearchTarget({ mode: "theme_settings", category: "Product page" }, cfg, SECTIONS_MODE, CHROME)).toEqual({
      tab: "settings",
      entry: { kind: "theme", category: "Product page" },
    });
  });
});
