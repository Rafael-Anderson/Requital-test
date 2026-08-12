"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getThemeBuilder, publishTheme, updateThemeDraft } from "@/lib/api";
import type {
  GlobalThemeSettings,
  Theme,
  ThemeConfig,
  ThemeElement,
  ThemeSection,
  ThemeSectionType,
} from "@/lib/types";
import { useToast } from "@/components/ui/Toast";

export type DevicePreview = "desktop" | "tablet" | "mobile";

const AUTOSAVE_INTERVAL_MS = 30_000;

function generateSectionId(type: ThemeSectionType): string {
  return `sec-${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// A brand-new section's starting settings — every section always gets
// scrollAnimation/visibility (the shared controls), plus a sensible
// section-specific starting point so it isn't blank on add.
function defaultSettingsForType(type: ThemeSectionType): Record<string, unknown> {
  const shared = { scrollAnimation: "none" as const, visibility: "both" as const };
  switch (type) {
    case "hero":
      return {
        ...shared,
        heading: "New heading",
        subheading: "",
        ctaLabel: "Shop now",
        contentPosition: "center-center",
        height: "medium",
      };
    case "product_grid":
      return { ...shared, columns: 3, showRating: false, showPrice: true, cardStyle: "minimal" };
    case "announcement_bar":
      return { ...shared, text: "" };
    default:
      return shared;
  }
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
  const [loading, setLoading] = useState(true);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [device, setDevice] = useState<DevicePreview>("desktop");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

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
      setSelectedSectionId(null);
      setSelectedElementId(null);
    } catch {
      toast("Failed to load theme", "error");
    } finally {
      setLoading(false);
    }
  }, [themeId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

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

  function updateGlobalSetting<K extends keyof GlobalThemeSettings>(
    key: K,
    value: GlobalThemeSettings[K],
  ) {
    updateConfig((prev) => ({
      ...prev,
      globalSettings: { ...prev.globalSettings, [key]: value },
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

  // Whole-array replace, not a single-element update like
  // updateElementPosition below — ElementDragZone's consumers (HeaderSettings/
  // FooterSettings/HeroSettings) always compute the full next elements array
  // themselves (starting from a hardcoded default set when the theme has
  // none yet), which naturally handles "seed real elements on the first
  // drag" without a separate seeding action.
  function updateHeaderElements(elements: ThemeElement[]) {
    updateConfig((prev) => ({ ...prev, header: { ...prev.header, elements } }));
  }

  function updateFooterElements(elements: ThemeElement[]) {
    updateConfig((prev) => ({ ...prev, footer: { ...prev.footer, elements } }));
  }

  function updateSectionElements(sectionId: string, elements: ThemeElement[]) {
    updateConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, elements } : s)),
    }));
  }

  function addSection(type: ThemeSectionType) {
    const newSection: ThemeSection = {
      id: generateSectionId(type),
      type,
      visible: true,
      order: configRef.current?.sections.length ?? 0,
      settings: defaultSettingsForType(type),
    };
    updateConfig((prev) => ({ ...prev, sections: [...prev.sections, newSection] }));
    setSelectedSectionId(newSection.id);
    setSelectedElementId(null);
  }

  function removeSection(id: string) {
    updateConfig((prev) => ({
      ...prev,
      sections: prev.sections.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })),
    }));
    if (selectedSectionId === id) {
      setSelectedSectionId(null);
      setSelectedElementId(null);
    }
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
    updateConfig((prev) => {
      const byId = new Map(prev.sections.map((s) => [s.id, s]));
      const reordered = orderedIds
        .map((id) => byId.get(id))
        .filter((s): s is ThemeSection => s !== undefined)
        .map((s, i) => ({ ...s, order: i }));
      return { ...prev, sections: reordered };
    });
  }

  function updateSectionSetting(id: string, key: string, value: unknown) {
    updateConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === id ? { ...s, settings: { ...s.settings, [key]: value } } : s,
      ),
    }));
  }

  // Phase 6 (per-element freeform drag-and-drop) call sites — defined now
  // since the hook's action surface shouldn't change shape once panel
  // components are built against it in Phase 2.
  function updateElementPosition(
    sectionId: string,
    elementId: string,
    position: ThemeElement["position"],
  ) {
    updateConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              elements: (s.elements ?? []).map((el) =>
                el.id === elementId ? { ...el, position } : el,
              ),
            }
          : s,
      ),
    }));
  }

  function updateElementSetting(sectionId: string, elementId: string, key: string, value: unknown) {
    updateConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              elements: (s.elements ?? []).map((el) =>
                el.id === elementId ? { ...el, settings: { ...el.settings, [key]: value } } : el,
              ),
            }
          : s,
      ),
    }));
  }

  async function publish() {
    setPublishing(true);
    try {
      if (dirtyRef.current) {
        await save();
      }
      const updated = await publishTheme(themeId);
      setTheme(updated);
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

  return {
    router,
    theme,
    config,
    loading,
    selectedSectionId,
    setSelectedSectionId,
    selectedElementId,
    setSelectedElementId,
    device,
    setDevice,
    dirty,
    saving,
    publishing,
    save,
    publish,
    discard,
    updateGlobalSetting,
    updateHeaderSetting,
    updateFooterSetting,
    updateHeaderElements,
    updateFooterElements,
    updateSectionElements,
    addSection,
    removeSection,
    toggleSectionVisibility,
    reorderSections,
    updateSectionSetting,
    updateElementPosition,
    updateElementSetting,
  };
}

export type ThemeEditorState = ReturnType<typeof useThemeEditor>;
