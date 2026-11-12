"use client";

import { applicableLayoutEntries, resolveLayoutEntry } from "@/lib/theme-builder-registry";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// Layout mode's left column: only the entries that do something on this shop's storefront (see
// lib/theme-builder-registry.ts). An entry that does nothing in the shop's current mode is not
// rendered at all, so there is no dead click. The highlighted row is the one the right pane shows:
// a saved or deep-linked entry that no longer applies falls back to the first applicable one.
export default function LayoutList({ editor }: { editor: ThemeEditorState }) {
  const { layoutCategory, setLayoutCategory, builderContext } = editor;
  const entries = applicableLayoutEntries(builderContext);
  const active = resolveLayoutEntry(layoutCategory, builderContext);
  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      {entries.map(({ id }) => (
        <button
          key={id}
          type="button"
          onClick={() => setLayoutCategory(id)}
          aria-current={active === id ? "true" : undefined}
          className={`rounded-lg border px-2 py-2 text-start text-sm font-medium ${
            active === id ? "border-accent bg-accent/5" : "border-transparent hover:bg-black/5 dark:hover:bg-white/10"
          }`}
        >
          {id}
        </button>
      ))}
    </div>
  );
}
