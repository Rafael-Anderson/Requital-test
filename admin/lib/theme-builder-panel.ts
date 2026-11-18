// The theme builder's single left panel: which tab each registry entry lives in, and the
// "drill-in router" that turns a deep link (URL query, search result, preview click) into the
// exact panel to show. Pure functions only, so the routing is unit-tested without React.
//
// The registry (lib/theme-builder-registry.ts) stays the ONE source of truth for WHETHER an entry
// applies; this file only decides WHERE an applicable entry appears. A Layout entry the registry
// hides for the shop's mode is never listed and a deep link to it falls back to its tab's list.

import { THEME_SETTINGS_CATEGORY_LABELS } from "@/lib/theme-settings-categories";
import {
  LAYOUT_ENTRY_IDS,
  isLayoutEntryApplicable,
  type BuilderContext,
  type LayoutEntryId,
  type SearchTarget,
} from "@/lib/theme-builder-registry";
import { findNodeInTree } from "@/lib/theme-tree";
import type { ThemeConfig } from "@/lib/types";

export type BuilderTab = "sections" | "design" | "settings";
export const BUILDER_TABS: { key: BuilderTab; label: string }[] = [
  { key: "sections", label: "Sections" },
  { key: "design", label: "Design" },
  { key: "settings", label: "Settings" },
];

export type ThemeCategory = (typeof THEME_SETTINGS_CATEGORY_LABELS)[number];

// An entry of the Design or Settings tab: one Theme settings category (theme.config.globalSettings)
// or one Layout entry (the legacy themesettings row / menu module).
export type PanelEntry = { kind: "theme"; category: ThemeCategory } | { kind: "layout"; id: LayoutEntryId };

export type PanelView =
  | { tab: "sections"; nodeId: string | null }
  | { tab: "design" | "settings"; entry: PanelEntry | null };

interface EntryPlacement {
  entry: PanelEntry;
  tab: "design" | "settings";
  group: string;
}

const theme = (category: ThemeCategory): PanelEntry => ({ kind: "theme", category });
const layout = (id: LayoutEntryId): PanelEntry => ({ kind: "layout", id });

// The tab mapping, in display order. Design = global visual settings (brand, sizes, buttons and
// icons, components, motion, page layouts); Settings = navigation, the homepage presets and the
// remaining behavioural entries. Every registry entry appears here exactly once
// (theme-builder-panel.test.ts enforces it).
export const PANEL_PLACEMENTS: readonly EntryPlacement[] = [
  { tab: "design", group: "Brand", entry: theme("Logo and favicon") },
  { tab: "design", group: "Brand", entry: theme("Colors") },
  { tab: "design", group: "Brand", entry: theme("Typography") },
  { tab: "design", group: "Layout and sizes", entry: theme("Page layout") },
  { tab: "design", group: "Layout and sizes", entry: theme("Density") },
  { tab: "design", group: "Layout and sizes", entry: theme("Radius") },
  { tab: "design", group: "Layout and sizes", entry: layout("Homepage layout") },
  { tab: "design", group: "Layout and sizes", entry: layout("Top bar layout") },
  { tab: "design", group: "Layout and sizes", entry: layout("Header size") },
  { tab: "design", group: "Layout and sizes", entry: layout("Footer layout") },
  { tab: "design", group: "Layout and sizes", entry: layout("Footer size") },
  { tab: "design", group: "Layout and sizes", entry: layout("Product page layout") },
  { tab: "design", group: "Layout and sizes", entry: layout("Cart layout") },
  { tab: "design", group: "Buttons and icons", entry: theme("Buttons") },
  { tab: "design", group: "Buttons and icons", entry: layout("Button shape") },
  { tab: "design", group: "Buttons and icons", entry: layout("Button fill") },
  { tab: "design", group: "Buttons and icons", entry: theme("Icons") },
  { tab: "design", group: "Buttons and icons", entry: layout("Icon style") },
  { tab: "design", group: "Components", entry: theme("Product cards") },
  { tab: "design", group: "Components", entry: theme("Badges") },
  { tab: "design", group: "Components", entry: theme("Prices") },
  { tab: "design", group: "Components", entry: theme("Swatches") },
  { tab: "design", group: "Components", entry: theme("Variant pickers") },
  { tab: "design", group: "Components", entry: theme("Input fields") },
  { tab: "design", group: "Components", entry: theme("Drawers") },
  { tab: "design", group: "Components", entry: theme("Popovers and modals") },
  { tab: "design", group: "Motion", entry: theme("Animations") },
  { tab: "design", group: "Motion", entry: theme("Motion") },
  { tab: "settings", group: "Navigation", entry: layout("Menu") },
  { tab: "settings", group: "Homepage", entry: layout("Home tab") },
  { tab: "settings", group: "Pages", entry: theme("Product page") },
  { tab: "settings", group: "Pages", entry: theme("Collection page") },
  { tab: "settings", group: "Pages", entry: theme("Cart") },
  { tab: "settings", group: "Pages", entry: theme("Search") },
  { tab: "settings", group: "Storefront extras", entry: theme("Floating elements") },
  { tab: "settings", group: "Advanced", entry: theme("Custom CSS") },
];

export function entryKey(entry: PanelEntry): string {
  return entry.kind === "theme" ? `theme:${entry.category}` : `layout:${entry.id}`;
}

export function entryLabel(entry: PanelEntry): string {
  return entry.kind === "theme" ? entry.category : entry.id;
}

export function sameEntry(a: PanelEntry | null, b: PanelEntry | null): boolean {
  return !!a && !!b && entryKey(a) === entryKey(b);
}

const PLACEMENT_BY_KEY = new Map(PANEL_PLACEMENTS.map((p) => [entryKey(p.entry), p]));

export function tabForEntry(entry: PanelEntry): "design" | "settings" {
  return PLACEMENT_BY_KEY.get(entryKey(entry))?.tab ?? "settings";
}

export function isEntryApplicable(entry: PanelEntry, ctx: BuilderContext): boolean {
  // Theme settings categories have no mode predicate: every one of them writes theme.config.
  if (entry.kind === "theme") return (THEME_SETTINGS_CATEGORY_LABELS as readonly string[]).includes(entry.category);
  return isLayoutEntryApplicable(entry.id, ctx);
}

export interface EntryGroup {
  group: string;
  entries: PanelEntry[];
}

/** The applicable entries of one tab, grouped, in display order. Hidden entries are not listed. */
export function entriesForTab(tab: "design" | "settings", ctx: BuilderContext): EntryGroup[] {
  const groups: EntryGroup[] = [];
  for (const p of PANEL_PLACEMENTS) {
    if (p.tab !== tab || !isEntryApplicable(p.entry, ctx)) continue;
    const last = groups[groups.length - 1];
    if (last && last.group === p.group) last.entries.push(p.entry);
    else groups.push({ group: p.group, entries: [p.entry] });
  }
  return groups;
}

export function parseEntryKey(key: string | null | undefined): PanelEntry | null {
  if (!key) return null;
  const sep = key.indexOf(":");
  if (sep < 0) return null;
  const kind = key.slice(0, sep);
  const name = key.slice(sep + 1);
  if (kind === "theme" && (THEME_SETTINGS_CATEGORY_LABELS as readonly string[]).includes(name)) {
    return { kind: "theme", category: name as ThemeCategory };
  }
  if (kind === "layout" && (LAYOUT_ENTRY_IDS as readonly string[]).includes(name)) {
    return { kind: "layout", id: name as LayoutEntryId };
  }
  return null;
}

/** Does a node id (section, block, or one of the chrome sentinels) exist in this config? */
export function nodeExists(config: ThemeConfig, id: string, chromeIds: readonly string[]): boolean {
  if (chromeIds.includes(id)) return true;
  if (config.sections.some((s) => s.id === id)) return true;
  if (findNodeInTree(config.header.blocks, id) || findNodeInTree(config.footer.blocks, id)) return true;
  return config.sections.some((s) => !!findNodeInTree(s.blocks, id));
}

// --- URL <-> view ------------------------------------------------------------------------------
// ?panel=sections&node=<id> | ?panel=design&open=theme:Colors | ?panel=settings&open=layout:Menu

export function viewToQuery(view: PanelView): Record<string, string> {
  if (view.tab === "sections") return view.nodeId ? { panel: "sections", node: view.nodeId } : { panel: "sections" };
  return view.entry ? { panel: view.tab, open: entryKey(view.entry) } : { panel: view.tab };
}

/**
 * A deep link -> the panel to show. Anything stale or not applicable falls back to the nearest
 * real list (never a dead pane): an unknown node -> the Sections tree, an entry that does not
 * apply -> its tab's list, an entry asked for under the wrong tab -> its own tab.
 */
export function queryToView(
  params: URLSearchParams,
  config: ThemeConfig,
  ctx: BuilderContext,
  chromeIds: readonly string[],
): PanelView {
  const panel = params.get("panel");
  if (panel === "design" || panel === "settings") {
    const entry = parseEntryKey(params.get("open"));
    if (!entry) return { tab: panel, entry: null };
    if (!isEntryApplicable(entry, ctx)) return { tab: tabForEntry(entry), entry: null };
    return { tab: tabForEntry(entry), entry };
  }
  const node = params.get("node");
  return { tab: "sections", nodeId: node && nodeExists(config, node, chromeIds) ? node : null };
}

export interface ChromeIds {
  announcement: string;
  header: string;
  footer: string;
}

/** Where a global search result (or any other "take me to this setting") lands. */
export function viewForSearchTarget(target: SearchTarget, config: ThemeConfig, ctx: BuilderContext, chrome: ChromeIds): PanelView {
  if (target.mode === "theme_settings") {
    const entry = parseEntryKey(`theme:${target.category}`);
    return entry ? { tab: tabForEntry(entry), entry } : { tab: "design", entry: null };
  }
  if (target.mode === "layout") {
    const entry: PanelEntry = { kind: "layout", id: target.category };
    return isEntryApplicable(entry, ctx) ? { tab: tabForEntry(entry), entry } : { tab: tabForEntry(entry), entry: null };
  }
  if (target.kind === "announcement") return { tab: "sections", nodeId: chrome.announcement };
  if (target.kind === "header") return { tab: "sections", nodeId: chrome.header };
  if (target.kind === "footer") return { tab: "sections", nodeId: chrome.footer };
  const section = [...config.sections].sort((a, b) => a.order - b.order).find((s) => s.type === target.sectionType);
  return { tab: "sections", nodeId: section?.id ?? null };
}
