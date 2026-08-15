"use client";

import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Toggle from "@/components/ui/Toggle";
import Slider from "@/components/ui/Slider";
import SchemePicker from "../SchemePicker";
import type { PopoverSettings as PopoverSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// Search popover, quick-view, and other modal/popover chrome.
export default function PopoversSettings({ editor }: { editor: ThemeEditorState }) {
  const popovers = editor.config!.globalSettings.popovers;
  const schemes = editor.config!.globalSettings.colorSchemes;
  function update(patch: Partial<PopoverSettingsType>) {
    editor.updateGlobalSettingsCategory("popovers", patch);
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Color scheme</span>
        <SchemePicker
          schemes={schemes}
          value={popovers.schemeId}
          onChange={(id) => update({ schemeId: id })}
          onAddScheme={editor.addColorScheme}
          onEditScheme={() => {
            editor.setEditorMode("theme_settings");
            editor.setThemeSettingsCategory("Colors");
          }}
        />
      </div>
      <Slider label="Corner radius" min={0} max={40} suffix="px" value={popovers.cornerRadius} onChange={(v) => update({ cornerRadius: v })} />
      <SegmentedToggle<PopoverSettingsType["borders"]>
        value={popovers.borders}
        options={[
          { value: "none", label: "No borders" },
          { value: "solid", label: "Solid borders" },
        ]}
        onChange={(v) => update({ borders: v })}
      />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Drop shadow</span>
        <Toggle checked={popovers.dropShadow} onChange={(v) => update({ dropShadow: v })} />
      </div>
    </div>
  );
}
