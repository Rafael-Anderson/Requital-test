"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getTheme, getThemeBuilder, publishTheme, updateTheme, updateThemeDraft } from "@/lib/api";
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
  }
}

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
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await getThemeBuilder(themeId);
      setTheme(t);
      setConfig(t.config);
      setDirty(false);
      setSelectedId(null);
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

  function updateConfig(updater: (prev: ThemeConfig) => ThemeConfig) {
    setConfig((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
  }

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
  function reorderSections(orderedIds: string[]) {
    updateConfig((prev) => ({ ...prev, sections: reorderById(prev.sections, orderedIds) }));
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

  function reorderBlocks(container: BlockContainerRef, parentBlockId: string | null, orderedIds: string[]) {
    updateConfig((prev) =>
      setContainerBlocks(
        prev,
        container,
        reorderSiblingsInTree(getContainerBlocks(prev, container), parentBlockId, orderedIds),
      ),
    );
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
    addSection,
    removeSection,
    toggleSectionVisibility,
    reorderSections,
    updateSectionSetting,
    updateBlockSetting,
    toggleBlockVisibility,
    addBlock,
    removeBlock,
    reorderBlocks,
  };
}

export type ThemeEditorState = ReturnType<typeof useThemeEditor>;
