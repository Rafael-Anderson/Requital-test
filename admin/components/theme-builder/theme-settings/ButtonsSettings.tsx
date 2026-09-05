"use client";

import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Slider from "@/components/ui/Slider";
import Select from "@/components/ui/Select";
import Toggle from "@/components/ui/Toggle";
import type { ButtonSettings as ButtonSettingsType, ButtonStyleSettings } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

function ButtonStyleFields({
  label,
  value,
  onChange,
  showEffects,
}: {
  label: string;
  value: ButtonStyleSettings;
  onChange: (patch: Partial<ButtonStyleSettings>) => void;
  // §8.7 item 1 — hoverEffect/pressEffect only make sense to expose where a
  // real render path exists (Hero CTA, Newsletter submit) — today that's
  // Primary only; Secondary renders nowhere yet (see the plan doc's §9.3
  // dead-control table), so surfacing these controls there would just be a
  // new unused setting, not a fix.
  showEffects?: boolean;
}) {
  return (
    <details className="rounded-lg border border-black/10 p-3 dark:border-white/10" open>
      <summary className="cursor-pointer text-sm font-medium">{label}</summary>
      <div className="mt-3 space-y-3">
        <Slider label="Border thickness" min={0} max={6} suffix="px" value={value.borderThickness} onChange={(v) => onChange({ borderThickness: v })} />
        <Slider label="Corner radius" min={0} max={40} suffix="px" value={value.cornerRadius} onChange={(v) => onChange({ cornerRadius: v })} />
        <SegmentedToggle<ButtonStyleSettings["font"]>
          value={value.font}
          options={[
            { value: "body", label: "Body font" },
            { value: "accent", label: "Accent font" },
          ]}
          onChange={(v) => onChange({ font: v })}
        />
        <SegmentedToggle<ButtonStyleSettings["case"]>
          value={value.case}
          options={[
            { value: "default", label: "Default" },
            { value: "uppercase", label: "Uppercase" },
          ]}
          onChange={(v) => onChange({ case: v })}
        />
        {showEffects && (
          <>
            <Select
              label="Hover effect"
              value={value.hoverEffect ?? "none"}
              onChange={(e) => onChange({ hoverEffect: e.target.value as ButtonStyleSettings["hoverEffect"] })}
            >
              <option value="none">None</option>
              <option value="sweep">Sweep</option>
              <option value="shine">Shine</option>
              <option value="border-fill">Border fill</option>
              <option value="icon-nudge">Icon nudge</option>
            </Select>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Press effect</span>
              <Toggle checked={!!value.pressEffect} onChange={(v) => onChange({ pressEffect: v })} />
            </div>
          </>
        )}
      </div>
    </details>
  );
}

export default function ButtonsSettings({ editor }: { editor: ThemeEditorState }) {
  const buttons = editor.config!.globalSettings.buttons;
  function update(patch: Partial<ButtonSettingsType>) {
    editor.updateGlobalSettingsCategory("buttons", patch);
  }

  return (
    <div className="space-y-4">
      <ButtonStyleFields
        label="Primary button"
        value={buttons.primary}
        onChange={(patch) => update({ primary: { ...buttons.primary, ...patch } })}
        showEffects
      />
      <ButtonStyleFields label="Secondary button" value={buttons.secondary} onChange={(patch) => update({ secondary: { ...buttons.secondary, ...patch } })} />
      <Slider label="Pill button corner radius" min={0} max={9999} suffix="px" value={buttons.pillCornerRadius} onChange={(v) => update({ pillCornerRadius: v })} />
    </div>
  );
}
