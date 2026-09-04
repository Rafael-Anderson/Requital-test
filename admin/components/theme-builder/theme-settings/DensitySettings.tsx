"use client";

import SegmentedToggle from "@/components/ui/SegmentedToggle";
import type { DensityPreset, DensitySettings as DensitySettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// Phase B2 (design-token foundation) — one density lever.
// `preset` unset ("Default") is the true no-op: nothing is written and every
// section keeps its exact current vertical padding, grid gap and heading gap.
// Picking a preset drives `--section-py` / `--grid-gap` / `--section-heading-gap`,
// which the `.theme-section-py` / `.theme-grid-gap` / `.theme-heading-gap` classes
// on the homepage sections follow. `cozy` reproduces today's values but the only
// guaranteed no-op is "Default".
const PRESET_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Default" },
  { value: "compact", label: "Compact" },
  { value: "cozy", label: "Cozy" },
  { value: "comfortable", label: "Comfortable" },
  { value: "spacious", label: "Spacious" },
];

export default function DensitySettings({ editor }: { editor: ThemeEditorState }) {
  const density: DensitySettingsType = editor.config!.globalSettings.density ?? {};
  function update(patch: Partial<DensitySettingsType>) {
    editor.updateGlobalSettingsCategory("density", patch);
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Section spacing</span>
        <SegmentedToggle<string>
          value={density.preset ?? ""}
          options={PRESET_OPTIONS}
          onChange={(v) => update({ preset: (v || undefined) as DensityPreset | undefined })}
        />
      </div>
      <p className="text-xs text-zinc-400">
        Controls the vertical padding, product grid gap and heading spacing of the homepage sections.
        &quot;Default&quot; leaves every value unchanged.
      </p>
    </div>
  );
}
