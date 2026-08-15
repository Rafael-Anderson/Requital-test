"use client";

import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Slider from "@/components/ui/Slider";
import type { VariantPickerSettings as VariantPickerSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

export default function VariantPickersSettings({ editor }: { editor: ThemeEditorState }) {
  const variantPickers = editor.config!.globalSettings.variantPickers;
  function update(patch: Partial<VariantPickerSettingsType>) {
    editor.updateGlobalSettingsCategory("variantPickers", patch);
  }

  return (
    <div className="space-y-4">
      <Slider label="Border thickness" min={0} max={6} suffix="px" value={variantPickers.borderThickness} onChange={(v) => update({ borderThickness: v })} />
      <Slider label="Corner radius" min={0} max={40} suffix="px" value={variantPickers.cornerRadius} onChange={(v) => update({ cornerRadius: v })} />
      <SegmentedToggle<VariantPickerSettingsType["width"]>
        value={variantPickers.width}
        options={[
          { value: "fit", label: "Fit content" },
          { value: "fill", label: "Fill width" },
        ]}
        onChange={(v) => update({ width: v })}
      />
    </div>
  );
}
