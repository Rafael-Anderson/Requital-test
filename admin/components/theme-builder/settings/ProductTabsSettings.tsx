"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import Combobox from "@/components/ui/Combobox";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import { listCollections } from "@/lib/api";
import SpacingControls, { type SpacingValue } from "./shared/SpacingControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import type { Collection, ScrollAnimation, SectionVisibility } from "@/lib/types";

// Tabbed Products section (theme-builder-expansion Phase 2). Each tab is
// { id, label, collectionId } — a pill toggle on the storefront that swaps
// the product grid below it client-side (no page load). Tabs bind to
// collections only in v1 (decision TBE2). Shared card settings (columns /
// product count) live alongside the tabs array on section.settings, same as
// Product Grid.
interface ProductTab {
  id: string;
  label: string;
  collectionId: number;
}

const DEFAULT_PRODUCT_LIMIT = 8;

function readTabs(settings: Record<string, unknown>): ProductTab[] {
  return Array.isArray(settings.tabs) ? (settings.tabs as ProductTab[]) : [];
}

// Module scope (not inside the component) so react-hooks/purity doesn't flag
// Date.now/Math.random — same shape and rationale as useThemeEditor.ts's
// own generateId().
function newTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ProductTabsSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  const [collections, setCollections] = useState<Collection[]>([]);

  useEffect(() => {
    listCollections().then(setCollections).catch(() => setCollections([]));
  }, []);

  const tabs = readTabs(settings);
  const byId = new Map(collections.map((c) => [String(c.id), c]));

  function commit(next: ProductTab[]) {
    onUpdate("tabs", next);
  }

  function addTab() {
    commit([...tabs, { id: newTabId(), label: "", collectionId: 0 }]);
  }

  function updateTab(index: number, patch: Partial<ProductTab>) {
    commit(tabs.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function removeTab(index: number) {
    commit(tabs.filter((_, i) => i !== index));
  }

  function moveTab(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= tabs.length) return;
    const next = [...tabs];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Tabs</span>
        {tabs.length > 0 && (
          <ul className="mb-2 space-y-2">
            {tabs.map((tab, i) => (
              <li key={tab.id} className="rounded-lg border border-black/10 p-2 dark:border-white/10">
                <div className="flex items-center gap-1">
                  <input
                    aria-label="Tab label"
                    placeholder="Best Selling"
                    value={tab.label}
                    onChange={(e) => updateTab(i, { label: e.target.value })}
                    className="flex-1 h-9 rounded-[10px] border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/20 dark:border-white/15 dark:bg-zinc-900"
                  />
                  <button
                    type="button"
                    onClick={() => moveTab(i, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                    className="p-1 text-zinc-400 hover:text-zinc-800 disabled:opacity-30 dark:hover:text-zinc-200"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveTab(i, 1)}
                    disabled={i === tabs.length - 1}
                    aria-label="Move down"
                    className="p-1 text-zinc-400 hover:text-zinc-800 disabled:opacity-30 dark:hover:text-zinc-200"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTab(i)}
                    aria-label="Remove tab"
                    className="p-1 text-zinc-400 hover:text-red-600"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                <div className="mt-1.5">
                  <Combobox
                    value={tab.collectionId ? String(tab.collectionId) : ""}
                    onChange={(v) => updateTab(i, { collectionId: v ? Number(v) : 0 })}
                    options={collections.map((c) => ({ value: String(c.id), label: c.name }))}
                    placeholder="Pick a collection…"
                    searchPlaceholder="Search collections…"
                  />
                  {tab.collectionId > 0 && !byId.has(String(tab.collectionId)) && (
                    <p className="mt-1 text-xs text-amber-600">This collection no longer exists.</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button type="button" variant="secondary" onClick={addTab}>
          <Plus className="size-4 inline -mt-0.5 mr-1" />
          Add tab
        </Button>
        {tabs.length === 0 && (
          <p className="mt-2 text-xs text-zinc-500">Add at least one tab with a label and a collection for this section to render.</p>
        )}
      </div>

      <Input
        label="Number of products per tab"
        type="number"
        min={1}
        max={50}
        value={(settings.productLimit as number) ?? DEFAULT_PRODUCT_LIMIT}
        onChange={(e) => onUpdate("productLimit", Math.max(1, Math.min(50, Number(e.target.value) || DEFAULT_PRODUCT_LIMIT)))}
      />
      <Select
        label="Columns"
        value={String((settings.columns as number) ?? 4)}
        onChange={(e) => onUpdate("columns", Number(e.target.value))}
      >
        <option value="2">2</option>
        <option value="3">3</option>
        <option value="4">4</option>
        <option value="5">5</option>
        <option value="6">6</option>
      </Select>

      <hr className="border-black/10 dark:border-white/10" />

      <SpacingControls value={settings.spacing as SpacingValue} onChange={(v) => onUpdate("spacing", v)} />
      <BackgroundControls value={settings.background as BackgroundValue} onChange={(v) => onUpdate("background", v)} />
      <ScrollAnimationControl
        value={settings.scrollAnimation as ScrollAnimation}
        onChange={(v) => onUpdate("scrollAnimation", v)}
        stagger={(settings.motion as { stagger?: boolean } | undefined)?.stagger}
        onStaggerChange={(v) => onUpdate("motion", { ...(settings.motion as object), stagger: v })}
      />
      <VisibilityControl value={settings.visibility as SectionVisibility} onChange={(v) => onUpdate("visibility", v)} />
    </div>
  );
}
