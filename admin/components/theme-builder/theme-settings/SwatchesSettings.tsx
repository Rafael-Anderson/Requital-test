"use client";

import Toggle from "@/components/ui/Toggle";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Slider from "@/components/ui/Slider";
import type { SwatchSettings as SwatchSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

export default function SwatchesSettings({ editor }: { editor: ThemeEditorState }) {
  const swatches = editor.config!.globalSettings.swatches;
  function update(patch: Partial<SwatchSettingsType>) {
    editor.updateGlobalSettingsCategory("swatches", patch);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Use variant images</span>
        <Toggle checked={swatches.variantImages} onChange={(v) => update({ variantImages: v })} />
      </div>
      <Slider label="Width" min={12} max={48} suffix="px" value={swatches.width} onChange={(v) => update({ width: v })} />
      <Slider label="Height" min={12} max={48} suffix="px" value={swatches.height} onChange={(v) => update({ height: v })} />
      <Slider label="Corner radius" min={0} max={9999} suffix="px" value={swatches.cornerRadius} onChange={(v) => update({ cornerRadius: v })} />

      <hr className="border-black/10 dark:border-white/10" />

      <SegmentedToggle<SwatchSettingsType["borders"]>
        value={swatches.borders}
        options={[
          { value: "none", label: "No border" },
          { value: "solid", label: "Solid border" },
        ]}
        onChange={(v) => update({ borders: v })}
      />
      <Slider label="Border thickness" min={0} max={6} suffix="px" value={swatches.borderThickness} onChange={(v) => update({ borderThickness: v })} />
      <Slider label="Border opacity" min={0} max={100} suffix="%" value={swatches.borderOpacity} onChange={(v) => update({ borderOpacity: v })} />
    </div>
  );
}
