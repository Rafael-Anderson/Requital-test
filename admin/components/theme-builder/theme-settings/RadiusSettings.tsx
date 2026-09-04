"use client";

import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Toggle from "@/components/ui/Toggle";
import type { RadiusPreset, RadiusSettings as RadiusSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// Phase B1 (design-token foundation) — one radius language.
// - `preset` unset ("Default") is the true no-op: nothing is written and every
//   card / image radius keeps its exact current value. Picking a preset drives
//   `--radius-sm/-md/-lg`, which the `.theme-round-*` classes on product cards
//   / testimonial cards / etc. follow.
// - `applyToButtons` (default off) is an EXPLICIT opt-in — buttons, form
//   inputs and the section image containers keep following
//   `buttons.primary.cornerRadius` unless the merchant turns this on (no
//   "seed default == untouched" guess).
const PRESET_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Default" },
  { value: "sharp", label: "Sharp" },
  { value: "subtle", label: "Subtle" },
  { value: "rounded", label: "Rounded" },
  { value: "soft", label: "Soft" },
  { value: "pill", label: "Pill" },
];

export default function RadiusSettings({ editor }: { editor: ThemeEditorState }) {
  const radius: RadiusSettingsType = editor.config!.globalSettings.radius ?? {};
  function update(patch: Partial<RadiusSettingsType>) {
    editor.updateGlobalSettingsCategory("radius", patch);
  }

  const active = !!radius.preset;

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Corner radius</span>
        <SegmentedToggle<string>
          value={radius.preset ?? ""}
          options={PRESET_OPTIONS}
          onChange={(v) => update({ preset: (v || undefined) as RadiusPreset | undefined })}
        />
      </div>
      <p className="text-xs text-zinc-400">
        &quot;Default&quot; leaves every corner radius at its current value.
      </p>

      <div className={`flex items-center justify-between ${active ? "" : "pointer-events-none opacity-50"}`}>
        <span className="text-sm font-medium">Also apply to buttons and form inputs</span>
        <Toggle checked={radius.applyToButtons === true} onChange={(v) => update({ applyToButtons: v })} />
      </div>
      <p className="text-xs text-zinc-400">
        Off: buttons and inputs keep their own corner radius (Buttons settings). On: they follow the scale above.
      </p>
    </div>
  );
}
