"use client";

import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Toggle from "@/components/ui/Toggle";
import SchemePicker from "../SchemePicker";
import type { DrawerSettings as DrawerSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// Cart drawer / mobile menu drawer chrome — schemeId governs their
// background/text, same reference pattern as Badges.
export default function DrawersSettings({ editor }: { editor: ThemeEditorState }) {
  const drawers = editor.config!.globalSettings.drawers;
  const schemes = editor.config!.globalSettings.colorSchemes;
  function update(patch: Partial<DrawerSettingsType>) {
    editor.updateGlobalSettingsCategory("drawers", patch);
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Color scheme</span>
        <SchemePicker
          schemes={schemes}
          value={drawers.schemeId}
          onChange={(id) => update({ schemeId: id })}
          onAddScheme={editor.addColorScheme}
          onEditScheme={() => {
            editor.setEditorMode("theme_settings");
            editor.setThemeSettingsCategory("Colors");
          }}
        />
      </div>
      <SegmentedToggle<DrawerSettingsType["bordersStyle"]>
        value={drawers.bordersStyle}
        options={[
          { value: "none", label: "No borders" },
          { value: "solid", label: "Solid borders" },
        ]}
        onChange={(v) => update({ bordersStyle: v })}
      />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Drop shadow</span>
        <Toggle checked={drawers.dropShadow} onChange={(v) => update({ dropShadow: v })} />
      </div>
    </div>
  );
}
