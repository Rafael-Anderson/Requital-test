"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL, getStaffCsrfToken, getTheme, getThemeBuilder, publishTheme, updateTheme, updateThemeDraft } from "@/lib/api";
import {
  findNodeInTree,
  insertNodeInTree,
  reorderById,
  removeNodeFromTree,
  reorderSiblingsInTree,
  updateNodeInTree,
} from "@/lib/theme-tree";
import type {
  ColorScheme,
  GlobalThemeSettings,
  Theme,
  ThemeBlock,
  ThemeConfig,
  ThemeSection,
  ThemeSectionType,
  ThemeSettings,
} from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { HEADER_PRESETS, FOOTER_PRESETS } from "@/lib/header-footer-presets";

export type DevicePreview = "desktop" | "tablet" | "mobile";
export type EditorMode = "sections" | "theme_settings" | "layout";

// Sentinel ids for the two fixed global-chrome rows — Header/Footer aren't
// members of ThemeConfig.sections[] (see the plan's scope decision), so
// they can't collide with a real section's `sec-...` id.
export const HEADER_CHROME_ID = "__header__";
export const FOOTER_CHROME_ID = "__footer__";

const AUTOSAVE_INTERVAL_MS = 30_000;

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// A brand-new section's starting settings — shared controls only now;
// content (heading/text/etc.) lives on that section's default blocks
// instead (see defaultBlocksForType below), matching the backend's own
// DEFAULT_THEME_CONFIG shape.
function defaultSettingsForType(type: ThemeSectionType): Record<string, unknown> {
  const shared = { scrollAnimation: "none" as const, visibility: "both" as const };
  switch (type) {
    case "hero":
      return { ...shared, contentPosition: "center-center", height: "medium" };
    case "product_grid":
      return { ...shared, columns: 3, cardStyle: "minimal" };
    case "product_tabs":
      return { ...shared, tabs: [], columns: 4, productLimit: 8 };
    case "trust_bar":
      return shared;
    case "brands":
      return { ...shared, heading: "", logosPerRow: 5, brandIds: [], linkBrands: false };
    default:
      return shared;
  }
}

function newBlock(type: string, order: number, settings: Record<string, unknown> = {}): ThemeBlock {
  return { id: generateId("blk"), type, visible: true, order, settings };
}

// A brand-new section's starting block tree — mirrors backend
// constants.ts's DEFAULT_THEME_CONFIG per section type, so a freshly-added
// section isn't a blank canvas.
function defaultBlocksForType(type: ThemeSectionType): ThemeBlock[] {
  switch (type) {
    case "hero":
      return [
        newBlock("heading", 0, { text: "New heading" }),
        newBlock("subheading", 1, { text: "" }),
        newBlock("cta", 2, { label: "Shop now" }),
      ];
    case "announcement_bar":
      return [newBlock("announcement", 0, { text: "" })];
    case "featured_collections":
      return [
        {
          ...newBlock("collection_header", 0),
          blocks: [newBlock("collection_title", 0), newBlock("view_all_button", 1, { label: "View all" })],
        },
      ];
    case "product_grid":
      return [
        {
          ...newBlock("product_card", 0),
          blocks: [newBlock("product_media", 0), newBlock("product_title", 1), newBlock("product_price", 2)],
        },
      ];
    case "rich_text":
      return [newBlock("text", 0, { text: "" })];
    case "image_text":
      return [newBlock("image", 0), newBlock("text", 1, { text: "" })];
    case "newsletter":
      return [newBlock("heading", 0, { text: "Join our mailing list" }), newBlock("text", 1, { text: "" }), newBlock("email_form", 2, { buttonLabel: "Subscribe" })];
    case "testimonials":
      return [];
    case "brands":
      return [];
    case "product_tabs":
      return [];
    case "trust_bar":
      return [
        newBlock("trust_item", 0, { text: "Same-day delivery", icon: "truck" }),
        newBlock("trust_item", 1, { text: "100% fresh guarantee", icon: "shield" }),
      ];
  }
}

// Home tab "Templates" mode's quick-start presets (theme builder Home tab
// rework) — a one-click starting point for a merchant moving from the
// legacy Home tab onto the Sections builder, not a rendering mode of its
// own. Each preset is just an ordered list of section types; the actual
// section content comes from the same defaultSettingsForType/
// defaultBlocksForType every "+ Add section" click already uses.
export interface HomepagePreset {
  key: string;
  label: string;
  sectionTypes: ThemeSectionType[];
}

export const HOMEPAGE_PRESETS: HomepagePreset[] = [
  { key: "default", label: "Default", sectionTypes: ["hero", "product_grid", "newsletter"] },
  { key: "minimal", label: "Minimal", sectionTypes: ["hero", "featured_collections"] },
  { key: "featured", label: "Featured", sectionTypes: ["announcement_bar", "hero", "product_grid"] },
];

// Which block container a block-mutating action targets — a section's own
// type travels with it since the "+ Add block" catalog (BLOCK_TYPES) is
// keyed by section type, not just "this is a section".
export type BlockContainerRef =
  | { kind: "header" }
  | { kind: "footer" }
  | { kind: "section"; sectionId: string; sectionType: ThemeSectionType };

export type Selection =
  | { kind: "header" }
  | { kind: "footer" }
  | { kind: "section"; section: ThemeSection }
  | { kind: "block"; container: BlockContainerRef; block: ThemeBlock };

function getContainerBlocks(config: ThemeConfig, ref: BlockContainerRef): ThemeBlock[] {
  if (ref.kind === "header") return config.header.blocks;
  if (ref.kind === "footer") return config.footer.blocks;
  return config.sections.find((s) => s.id === ref.sectionId)?.blocks ?? [];
}

function setContainerBlocks(config: ThemeConfig, ref: BlockContainerRef, blocks: ThemeBlock[]): ThemeConfig {
  if (ref.kind === "header") return { ...config, header: { ...config.header, blocks } };
  if (ref.kind === "footer") return { ...config, footer: { ...config.footer, blocks } };
  return {
    ...config,
    sections: config.sections.map((s) => (s.id === ref.sectionId ? { ...s, blocks } : s)),
  };
}

function resolveSelection(config: ThemeConfig, selectedId: string | null): Selection | null {
  if (!selectedId) return null;
  if (selectedId === HEADER_CHROME_ID) return { kind: "header" };
  if (selectedId === FOOTER_CHROME_ID) return { kind: "footer" };

  const section = config.sections.find((s) => s.id === selectedId);
  if (section) return { kind: "section", section };

  const headerBlock = findNodeInTree(config.header.blocks, selectedId);
  if (headerBlock) return { kind: "block", container: { kind: "header" }, block: headerBlock };

  const footerBlock = findNodeInTree(config.footer.blocks, selectedId);
  if (footerBlock) return { kind: "block", container: { kind: "footer" }, block: footerBlock };

  for (const s of config.sections) {
    const block = findNodeInTree(s.blocks, selectedId);
    if (block) return { kind: "block", container: { kind: "section", sectionId: s.id, sectionType: s.type }, block };
  }
  return null;
}

// Follows the useProductForm.ts pattern (admin/lib/useProductForm.ts): one
// hook owns every piece of editor state, returned as a single flat object,
// prop-drilled one level into panel components — no React Context, matching
// this app's established convention that Context is reserved for
// cross-cutting app-shell concerns (auth, outlet filter, toast), not
// page-local editor state.
export function useThemeEditor(themeId: number) {
  const router = useRouter();
  const toast = useToast();

  const [theme, setTheme] = useState<Theme | null>(null);
  const [config, setConfig] = useState<ThemeConfig | null>(null);
  // Layout mode's 13 categories (Home tab, Menu, Homepage layout, ..., Icon
  // style, Button shape, Button fill) are backed by the separate legacy
  // `themesettings` row, not theme.config — this used to be fetched
  // independently by each of the 13 LayoutSettings.tsx components (each its
  // own useLegacyTheme() instance), which is exactly why none of them ever
  // reached the preview iframe: there was no single, shared piece of state
  // for a postMessage effect to watch in the first place. Lifted here so
  // every Layout category reads/writes through one shared instance, and
  // PreviewFrame.tsx can watch it the same way it already watches `config`.
  const [legacyTheme, setLegacyTheme] = useState<ThemeSettings | null>(null);
  const [legacyThemeSaving, setLegacyThemeSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editorMode, setEditorMode] = useState<EditorMode>("sections");
  // Which of the 18 Theme Settings categories is selected — lives here
  // (not local component state) so a "Edit scheme" jump link anywhere in
  // the tree can switch both editorMode and the selected category
  // together, the same way selecting a section/block does.
  const [themeSettingsCategory, setThemeSettingsCategory] = useState<string | null>(null);
  // Same idea as themeSettingsCategory, for Layout mode's own category list.
  const [layoutCategory, setLayoutCategory] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // True for the duration of any section/block drag (both SectionTree.tsx's
  // own DndContext and every nested TreeNode.tsx one report through this
  // shared flag) — PreviewFrame.tsx uses it to disable pointer-events on
  // the iframe while dragging. Without that, a drag whose pointer path
  // crosses into the iframe's rect loses every further pointermove/
  // pointerup (confirmed empirically: an iframe is a separate browsing
  // context that owns pointer events physically over it, and @dnd-kit's
  // PointerSensor never calls setPointerCapture to survive that), leaving
  // the sensor stuck mid-drag with no pointerup ever observed — not
  // recoverable by the next drag attempt either, since dnd-kit's internal
  // state was never cleanly ended.
  const [isDragging, setIsDragging] = useState(false);
  const [device, setDevice] = useState<DevicePreview>("desktop");
  // Bug 3 fix: which storefront page the preview iframe's src points at —
  // "" for the homepage, or a real "/collections/:slug" / "/products/:slug"
  // path (see PageSwitcher in PreviewFrame.tsx). Driving this via a real
  // src change (an actual navigation, exactly the same as a merchant
  // clicking a link inside the preview) is what makes shop-context.tsx's
  // sessionStorage-backed preview-mode fix apply here too — no special
  // casing needed between "the page switcher navigated" and "an in-preview
  // link navigated".
  const [previewPath, setPreviewPath] = useState("");
  // Settings-panel search query — lives here rather than local state inside
  // SettingsPanel.tsx because the input itself renders in PreviewFrame.tsx's
  // toolbar (next to the Preview page selector) while the filtering it
  // drives happens in SettingsPanel.tsx, two siblings under this same
  // shared editor object.
  const [settingsSearchQuery, setSettingsSearchQuery] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // Bumped only on a successful publish — PreviewFrame includes this in the
  // iframe's `key`, forcing a full remount (not just a postMessage config
  // update) so the preview re-fetches the newly published config straight
  // from the backend instead of continuing to show draft state relayed over
  // postMessage. A plain postMessage update can't be trusted to prove "this
  // is really what's live now" the way a fresh network fetch can.
  const [publishVersion, setPublishVersion] = useState(0);

  // Autosave/save-on-unmount read the latest config/dirty state without
  // needing to be in those effects' own dependency arrays (which would
  // otherwise tear down and rebuild the interval/cleanup on every keystroke).
  const configRef = useRef<ThemeConfig | null>(null);
  const dirtyRef = useRef(false);
  // One-shot per mount: seeds the Hero section's bannerImages/heroText from
  // the legacy themesettings row the first time the builder opens (see the
  // seed effect below).
  const heroBackfillDoneRef = useRef(false);
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // Undo/redo history (storefront-v2 Phase 4C) — a plain snapshot stack,
  // capped at 20 entries, separate from configRef/dirtyRef above (those
  // exist so autosave reads the *latest* value without re-subscribing;
  // this exists so undo/redo can jump to an *earlier* one). historyStack
  // holds the config as it existed *after* each updateConfig call (index 0
  // is the freshly-loaded config, before any edits); historyIndex is
  // "where we currently are" in that stack, moved by undo/redo without
  // going through updateConfig itself (an undo is navigation, not a new
  // edit — it must not push a fresh history entry on top of itself).
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Mirrors historyStackRef.current.length as real state — canRedo needs
  // the stack's length to compute, and reading a ref's .current during
  // render (rather than in an effect/handler) is a real bug, not just a
  // lint nit: nothing re-renders this component when a ref changes on its
  // own, so a render-time read can go stale.
  const [historyLength, setHistoryLength] = useState(0);
  const historyStackRef = useRef<ThemeConfig[]>([]);
  const historyIndexRef = useRef(-1);
  const MAX_HISTORY = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await getThemeBuilder(themeId);
      setTheme(t);
      setConfig(t.config);
      setDirty(false);
      setSelectedId(null);
      heroBackfillDoneRef.current = false;
      historyStackRef.current = [t.config];
      historyIndexRef.current = 0;
      setHistoryIndex(0);
      setHistoryLength(1);
    } catch {
      toast("Failed to load theme", "error");
    } finally {
      setLoading(false);
    }
  }, [themeId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    getTheme()
      .then(setLegacyTheme)
      .catch(() => {});
  }, []);

  // One-shot backfill: the "Classic homepage banner" fields (heroText +
  // slideshow images) used to live in a dead sub-panel that wrote the legacy
  // `themesettings` row directly; they're native Hero section settings now.
  // The first time the builder opens for a shop that has legacy banner data
  // but a Hero section with no bannerImages key yet, seed it across so
  // nothing is lost. Marks the draft dirty — the existing autosave/publish
  // persists it into theme.config. Never overwrites an explicit [] (a
  // merchant who cleared the list), and never runs twice per mount.
  useEffect(() => {
    if (heroBackfillDoneRef.current || !config || !legacyTheme) return;
    const hero = config.sections.find((s) => s.type === "hero");
    if (!hero) return;
    heroBackfillDoneRef.current = true;
    if (hero.settings.bannerImages !== undefined) return;
    const legacyImages = legacyTheme.images ?? [];
    const legacyHeroText = legacyTheme.heroText ?? "";
    if (legacyImages.length === 0 && !legacyHeroText) return;
    updateSectionSetting(hero.id, "bannerImages", legacyImages);
    if (legacyHeroText) updateSectionSetting(hero.id, "heroText", legacyHeroText);
    // updateSectionSetting is a stable local fn; config/legacyTheme are the
    // real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, legacyTheme]);

  const updateLegacyTheme = useCallback(
    async (patch: Partial<Omit<ThemeSettings, "shopId" | "updatedAt">>) => {
      setLegacyThemeSaving(true);
      try {
        const updated = await updateTheme(patch);
        setLegacyTheme(updated);
        return true;
      } catch {
        return false;
      } finally {
        setLegacyThemeSaving(false);
      }
    },
    [],
  );

  const save = useCallback(async () => {
    if (!dirtyRef.current || !configRef.current) return;
    setSaving(true);
    try {
      const updated = await updateThemeDraft(themeId, { config: configRef.current });
      setTheme(updated);
      setDirty(false);
    } catch {
      toast("Failed to save theme", "error");
    } finally {
      setSaving(false);
    }
  }, [themeId, toast]);

  // Autosave every 30s while dirty — same setInterval+cleanup idiom
  // SlideshowHero.tsx's carousel already uses on the storefront.
  useEffect(() => {
    const interval = setInterval(() => {
      void save();
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [save]);

  // Save on panel close / navigating away from the builder.
  useEffect(() => {
    return () => {
      if (dirtyRef.current && configRef.current) {
        updateThemeDraft(themeId, { config: configRef.current }).catch(() => {});
      }
    };
    // themeId only — configRef/dirtyRef are refs, reading them at cleanup
    // time (not render time) is exactly what they're for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId]);

  // Bug 1 root cause (found by tracing, not guessed — see PR description
  // for the console-log/reload repro): a drag reorder (or any other edit)
  // was NEVER actually being lost mid-session — @dnd-kit's own state was
  // correct, updateConfig ran, the tree re-rendered in the new order and
  // stayed there. The loss only showed up on an actual page reload/tab
  // close taken before the 30s autosave interval elapsed, because the
  // "save on panel close" effect above only runs its cleanup for a real
  // React unmount (an in-app navigation) — a hard browser reload/close
  // tears down the JS context before React ever gets to run that cleanup,
  // so the fire-and-forget updateThemeDraft() call there never even starts.
  // beforeunload/pagehide are the two events that DO reliably fire before
  // that teardown; fetch's `keepalive` flag (unlike a plain fetch, which
  // Chrome cancels once the document starts unloading) is what lets the
  // request actually complete after the handler returns — sendBeacon can't
  // be used instead since it has no way to carry a JSON PATCH body or the
  // CSRF header this endpoint requires.
  // ponytail: keepalive requests are capped at ~64KiB by Chromium; a theme
  // config with an unusually large block tree/custom CSS could exceed that
  // and silently fail to save on hard-reload (the 30s interval/explicit
  // Publish still cover it). Revisit if that's ever reported for real.
  //
  // Session-cookie migration (security audit finding #1), phase 2 — this
  // actually simplifies: no more manual token read/Authorization header,
  // just credentials: "include" (the cookie rides automatically) plus the
  // same CSRF header every other state-changing call attaches.
  useEffect(() => {
    function flushOnUnload() {
      if (!dirtyRef.current || !configRef.current) return;
      fetch(`${API_URL}/themes/${themeId}`, {
        method: "PATCH",
        keepalive: true,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": getStaffCsrfToken() ?? "",
        },
        body: JSON.stringify({ config: configRef.current }),
      }).catch(() => {});
    }
    window.addEventListener("beforeunload", flushOnUnload);
    window.addEventListener("pagehide", flushOnUnload);
    return () => {
      window.removeEventListener("beforeunload", flushOnUnload);
      window.removeEventListener("pagehide", flushOnUnload);
    };
  }, [themeId]);

  // Reads/writes configRef.current directly (rather than the usual
  // setState(prev => ...) functional form) so the ref is guaranteed
  // up to date the instant this returns — the section/block reorder
  // actions below call save() right after updateConfig and need
  // configRef.current (which save() reads) to already reflect the
  // reorder, not whatever it'll become after the next render's
  // ref-sync effect runs.
  function updateConfig(updater: (prev: ThemeConfig) => ThemeConfig) {
    const prev = configRef.current;
    if (!prev) return;
    const next = updater(prev);
    configRef.current = next;
    dirtyRef.current = true;
    setConfig(next);
    const truncated = historyStackRef.current.slice(0, historyIndexRef.current + 1);
    truncated.push(next);
    const capped = truncated.length > MAX_HISTORY ? truncated.slice(truncated.length - MAX_HISTORY) : truncated;
    historyStackRef.current = capped;
    historyIndexRef.current = capped.length - 1;
    setHistoryIndex(historyIndexRef.current);
    setHistoryLength(capped.length);
    setDirty(true);
  }

  function undo() {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    setHistoryIndex(historyIndexRef.current);
    setConfig(historyStackRef.current[historyIndexRef.current]);
    setSelectedId(null);
    setDirty(true);
  }

  function redo() {
    if (historyIndexRef.current >= historyStackRef.current.length - 1) return;
    historyIndexRef.current += 1;
    setHistoryIndex(historyIndexRef.current);
    setConfig(historyStackRef.current[historyIndexRef.current]);
    setSelectedId(null);
    setDirty(true);
  }

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyLength - 1;

  // Ctrl+Z / Cmd+Z undo, Ctrl+Shift+Z / Ctrl+Y / Cmd+Shift+Z redo. Skipped
  // while focus is inside a text field/contenteditable — hijacking the
  // browser's own native per-field undo mid-keystroke would look like
  // random data loss to a merchant who was just trying to undo a typo, not
  // navigate theme-config history.
  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (key === "z") {
        e.preventDefault();
        undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  function selectNode(id: string | null) {
    setSelectedId(id);
  }

  function updateGlobalSettingsCategory<K extends keyof GlobalThemeSettings>(
    category: K,
    patch: Partial<GlobalThemeSettings[K]>,
  ) {
    updateConfig((prev) => ({
      ...prev,
      globalSettings: {
        ...prev.globalSettings,
        [category]: { ...prev.globalSettings[category], ...patch },
      },
    }));
  }

  function addColorScheme() {
    const scheme: ColorScheme = {
      id: generateId("scheme"),
      name: "New scheme",
      background: "#ffffff",
      text: "#18181b",
      button: "#069494",
      buttonLabel: "#ffffff",
      secondaryButtonLabel: "#069494",
    };
    updateConfig((prev) => ({
      ...prev,
      globalSettings: { ...prev.globalSettings, colorSchemes: [...prev.globalSettings.colorSchemes, scheme] },
    }));
    return scheme.id;
  }

  function updateColorScheme(id: string, patch: Partial<ColorScheme>) {
    updateConfig((prev) => ({
      ...prev,
      globalSettings: {
        ...prev.globalSettings,
        colorSchemes: prev.globalSettings.colorSchemes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      },
    }));
  }

  function removeColorScheme(id: string) {
    updateConfig((prev) => ({
      ...prev,
      globalSettings: {
        ...prev.globalSettings,
        colorSchemes: prev.globalSettings.colorSchemes.filter((s) => s.id !== id),
      },
    }));
  }

  function updateHeaderSetting(key: string, value: unknown) {
    updateConfig((prev) => ({
      ...prev,
      header: { ...prev.header, settings: { ...prev.header.settings, [key]: value } },
    }));
  }

  function updateFooterSetting(key: string, value: unknown) {
    updateConfig((prev) => ({
      ...prev,
      footer: { ...prev.footer, settings: { ...prev.footer.settings, [key]: value } },
    }));
  }

  function addSection(type: ThemeSectionType) {
    const newSection: ThemeSection = {
      id: generateId("sec"),
      type,
      visible: true,
      order: configRef.current?.sections.length ?? 0,
      settings: defaultSettingsForType(type),
      blocks: defaultBlocksForType(type),
    };
    updateConfig((prev) => ({ ...prev, sections: [...prev.sections, newSection] }));
    setSelectedId(newSection.id);
  }

  // Replaces the whole sections list with a preset's arrangement — a
  // deliberate, occasional action (not a per-keystroke edit), same
  // immediate-persist reasoning as reorderSections/reorderBlocks below.
  function applyHomepagePreset(presetKey: string) {
    const preset = HOMEPAGE_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    const newSections: ThemeSection[] = preset.sectionTypes.map((type, order) => ({
      id: generateId("sec"),
      type,
      visible: true,
      order,
      settings: defaultSettingsForType(type),
      blocks: defaultBlocksForType(type),
    }));
    updateConfig((prev) => ({ ...prev, sections: newSections }));
    setSelectedId(null);
    void save();
    toast(`"${preset.label}" applied — check the Sections tab`, "success");
  }

  // C1 — header/footer layout presets. Same one-time apply-then-diverge
  // shape as applyHomepagePreset above: replaces the whole header/footer
  // config wholesale (never merges with what's there), no preset identity
  // retained afterward.
  function applyHeaderPreset(presetKey: string) {
    const preset = HEADER_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    updateConfig((prev) => ({ ...prev, header: preset.build() }));
    void save();
    toast(`"${preset.label}" header applied`, "success");
  }

  function applyFooterPreset(presetKey: string) {
    const preset = FOOTER_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    updateConfig((prev) => ({ ...prev, footer: preset.build() }));
    void save();
    toast(`"${preset.label}" footer applied`, "success");
  }

  function removeSection(id: string) {
    updateConfig((prev) => ({
      ...prev,
      sections: prev.sections.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })),
    }));
    if (selectedId === id) setSelectedId(null);
  }

  function toggleSectionVisibility(id: string) {
    updateConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)),
    }));
  }

  // orderedIds is the full section id list in its new order (what
  // @dnd-kit/sortable's onDragEnd hands back after reordering the array).
  // Persists immediately (not just marked dirty for the 30s autosave/
  // beforeunload flush) — a reorder is a discrete, deliberate action a
  // merchant expects to stick right away, not something that should still
  // be sitting unsaved if they close the tab a few seconds later.
  //
  // Returns the updated config synchronously (updateConfig already writes
  // configRef.current before returning, per that function's own comment) so
  // a caller driving the in-preview section drag (PreviewFrame.tsx's
  // message handler) can post it straight to the iframe the instant the
  // drop lands, instead of waiting on the debounced theme-config-update
  // effect — a reorder is a single discrete commit, not a value the
  // merchant is still actively adjusting, so there's nothing to debounce.
  function reorderSections(orderedIds: string[]): ThemeConfig | null {
    updateConfig((prev) => ({ ...prev, sections: reorderById(prev.sections, orderedIds) }));
    void save();
    return configRef.current;
  }

  function updateSectionSetting(id: string, key: string, value: unknown) {
    updateConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === id ? { ...s, settings: { ...s.settings, [key]: value } } : s,
      ),
    }));
  }

  // --- Generic block tree actions — replace Phase 6's flat updateElement*
  // functions. Every one goes through theme-tree.ts's recursive primitives
  // so arbitrary nesting (section -> block -> sub-block) works uniformly. ---

  function updateBlockSetting(container: BlockContainerRef, blockId: string, key: string, value: unknown) {
    updateConfig((prev) =>
      setContainerBlocks(
        prev,
        container,
        updateNodeInTree(getContainerBlocks(prev, container), blockId, (b) => ({
          ...b,
          settings: { ...b.settings, [key]: value },
        })),
      ),
    );
  }

  function toggleBlockVisibility(container: BlockContainerRef, blockId: string) {
    updateConfig((prev) =>
      setContainerBlocks(
        prev,
        container,
        updateNodeInTree(getContainerBlocks(prev, container), blockId, (b) => ({ ...b, visible: !b.visible })),
      ),
    );
  }

  function addBlock(container: BlockContainerRef, parentBlockId: string | null, type: string) {
    // node (and its id) is created once, outside the updater — matching
    // addSection's pattern above. Creating it *inside* updateConfig's
    // functional updater (as this used to) generates a fresh id every time
    // React invokes that updater, which Strict Mode's dev-mode double-
    // invocation (for purity-checking) does twice per call — leaving
    // selectedId pointing at a discarded id from the first pass rather than
    // the block actually inserted into state, so a freshly-added block
    // silently failed to auto-select. setSelectedId is a plain top-level
    // call here too, never nested inside another setState's updater.
    const currentBlocks = configRef.current ? getContainerBlocks(configRef.current, container) : [];
    const siblings = parentBlockId ? findNodeInTree(currentBlocks, parentBlockId)?.blocks ?? [] : currentBlocks;
    const node = newBlock(type, siblings.length);
    updateConfig((prev) =>
      setContainerBlocks(prev, container, insertNodeInTree(getContainerBlocks(prev, container), parentBlockId, node)),
    );
    setSelectedId(node.id);
  }

  function removeBlock(container: BlockContainerRef, blockId: string) {
    updateConfig((prev) =>
      setContainerBlocks(prev, container, removeNodeFromTree(getContainerBlocks(prev, container), blockId)),
    );
    if (selectedId === blockId) setSelectedId(null);
  }

  // Same immediate-persist reasoning as reorderSections above — this is
  // also the landing spot for the in-preview drag (PreviewFrame.tsx's
  // "element-moved" postMessage handler calls this too), so both drag
  // surfaces get the same drop-time save through this one function. Also
  // returns the updated config synchronously for the same reason
  // reorderSections does — see that function's own comment.
  function reorderBlocks(container: BlockContainerRef, parentBlockId: string | null, orderedIds: string[]): ThemeConfig | null {
    updateConfig((prev) =>
      setContainerBlocks(
        prev,
        container,
        reorderSiblingsInTree(getContainerBlocks(prev, container), parentBlockId, orderedIds),
      ),
    );
    void save();
    return configRef.current;
  }

  async function publish() {
    setPublishing(true);
    try {
      if (dirtyRef.current) {
        await save();
      }
      const updated = await publishTheme(themeId);
      setTheme(updated);
      setPublishVersion((v) => v + 1);
      toast("Theme published", "success");
    } catch {
      toast("Failed to publish theme", "error");
    } finally {
      setPublishing(false);
    }
  }

  async function discard() {
    await load();
    toast("Changes discarded", "success");
  }

  const selection = config ? resolveSelection(config, selectedId) : null;

  return {
    router,
    theme,
    config,
    legacyTheme,
    legacyThemeSaving,
    updateLegacyTheme,
    loading,
    editorMode,
    setEditorMode,
    themeSettingsCategory,
    setThemeSettingsCategory,
    layoutCategory,
    setLayoutCategory,
    selectedId,
    selectNode,
    selection,
    isDragging,
    setIsDragging,
    device,
    setDevice,
    previewPath,
    setPreviewPath,
    settingsSearchQuery,
    setSettingsSearchQuery,
    dirty,
    saving,
    publishing,
    publishVersion,
    save,
    publish,
    discard,
    updateGlobalSettingsCategory,
    addColorScheme,
    updateColorScheme,
    removeColorScheme,
    updateHeaderSetting,
    updateFooterSetting,
    applyHeaderPreset,
    applyFooterPreset,
    addSection,
    applyHomepagePreset,
    removeSection,
    toggleSectionVisibility,
    reorderSections,
    updateSectionSetting,
    updateBlockSetting,
    toggleBlockVisibility,
    addBlock,
    removeBlock,
    reorderBlocks,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}

export type ThemeEditorState = ReturnType<typeof useThemeEditor>;
