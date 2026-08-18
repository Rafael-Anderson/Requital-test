"use client";

import Toggle from "@/components/ui/Toggle";
import Select from "@/components/ui/Select";
import type { AnimationSettings as AnimationSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

const HOVER_EFFECTS: { value: AnimationSettingsType["cardHoverEffect"]; label: string }[] = [
  { value: "zoom", label: "Image zoom" },
  { value: "rise", label: "Card rise" },
  { value: "swap", label: "Image swap (second photo)" },
  { value: "none", label: "None" },
];

export default function AnimationsSettings({ editor }: { editor: ThemeEditorState }) {
  const animations = editor.config!.globalSettings.animations;
  function update(patch: Partial<AnimationSettingsType>) {
    editor.updateGlobalSettingsCategory("animations", patch);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Page transition</span>
        <Toggle checked={animations.pageTransition} onChange={(v) => update({ pageTransition: v })} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Product card transition</span>
        <Toggle checked={animations.productCardTransition} onChange={(v) => update({ productCardTransition: v })} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Add to cart animation</span>
        <Toggle checked={animations.addToCart} onChange={(v) => update({ addToCart: v })} />
      </div>
      <Select label="Card hover effect" value={animations.cardHoverEffect} onChange={(e) => update({ cardHoverEffect: e.target.value as AnimationSettingsType["cardHoverEffect"] })}>
        {HOVER_EFFECTS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
