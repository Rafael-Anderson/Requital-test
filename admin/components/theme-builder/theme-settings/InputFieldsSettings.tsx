"use client";

import Select from "@/components/ui/Select";
import Slider from "@/components/ui/Slider";
import type { InputFieldSettings as InputFieldSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

const TEXT_PRESETS = ["paragraph", "h1", "h2", "h3", "h4", "h5", "h6"];

export default function InputFieldsSettings({ editor }: { editor: ThemeEditorState }) {
  const inputFields = editor.config!.globalSettings.inputFields;
  function update(patch: Partial<InputFieldSettingsType>) {
    editor.updateGlobalSettingsCategory("inputFields", patch);
  }

  return (
    <div className="space-y-4">
      <Slider label="Border thickness" min={0} max={6} suffix="px" value={inputFields.borderThickness} onChange={(v) => update({ borderThickness: v })} />
      <Slider label="Corner radius" min={0} max={40} suffix="px" value={inputFields.cornerRadius} onChange={(v) => update({ cornerRadius: v })} />
      <Select label="Text preset" value={inputFields.textPreset} onChange={(e) => update({ textPreset: e.target.value })}>
        {TEXT_PRESETS.map((p) => (
          <option key={p} value={p}>
            {p === "paragraph" ? "Paragraph" : p.toUpperCase()}
          </option>
        ))}
      </Select>
    </div>
  );
}
