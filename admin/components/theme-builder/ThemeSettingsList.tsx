"use client";

import { THEME_SETTINGS_CATEGORY_LABELS } from "@/lib/theme-settings-categories";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// Theme settings mode's left column — a plain selectable list, same
// selected/hover treatment as SectionTree's rows, so switching between
// Sections and Theme settings mode doesn't change how selection itself
// works. Clicking a category shows its form in the right panel
// (SettingsPanel.tsx), exactly like clicking a section or block does in
// Sections mode — deliberately not an inline-expanding accordion.
export default function ThemeSettingsList({ editor }: { editor: ThemeEditorState }) {
  const { themeSettingsCategory, setThemeSettingsCategory } = editor;
  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      {THEME_SETTINGS_CATEGORY_LABELS.map((label) => (
        <button
          key={label}
          type="button"
          onClick={() => setThemeSettingsCategory(label)}
          className={`rounded-lg border px-2 py-2 text-left text-sm font-medium ${
            themeSettingsCategory === label
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
