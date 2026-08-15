"use client";

import { THEME_LAYOUT_CATEGORY_LABELS } from "@/lib/theme-layout-categories";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// Layout mode's left column — same selectable-list treatment as
// SectionTree/ThemeSettingsList, so all three modes share one selection
// language: click a row on the left, its form shows on the right.
export default function LayoutList({ editor }: { editor: ThemeEditorState }) {
  const { layoutCategory, setLayoutCategory } = editor;
  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      {THEME_LAYOUT_CATEGORY_LABELS.map((label) => (
        <button
          key={label}
          type="button"
          onClick={() => setLayoutCategory(label)}
          className={`rounded-lg border px-2 py-2 text-left text-sm font-medium ${
            layoutCategory === label
              ? "border-accent bg-accent/5"
              : "border-transparent hover:bg-black/5 dark:hover:bg-white/10"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
