"use client";

import Toggle from "@/components/ui/Toggle";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Slider from "@/components/ui/Slider";
import type { CartSettings as CartSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

export default function CartSettings({ editor }: { editor: ThemeEditorState }) {
  const cart = editor.config!.globalSettings.cart;
  function update(patch: Partial<CartSettingsType>) {
    editor.updateGlobalSettingsCategory("cart", patch);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Allow order note</span>
        <Toggle checked={cart.allowNote} onChange={(v) => update({ allowNote: v })} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Allow discount codes</span>
        <Toggle checked={cart.allowDiscounts} onChange={(v) => update({ allowDiscounts: v })} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Show installments</span>
        <Toggle checked={cart.installments} onChange={(v) => update({ installments: v })} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Accelerated checkout buttons</span>
        <Toggle checked={cart.acceleratedCheckout} onChange={(v) => update({ acceleratedCheckout: v })} />
      </div>
      <Input label="Empty cart link" placeholder="/collections/all" value={cart.emptyCartLink ?? ""} onChange={(e) => update({ emptyCartLink: e.target.value })} />

      <hr className="border-black/10 dark:border-white/10" />

      <SegmentedToggle<CartSettingsType["mediaBorderStyle"]>
        value={cart.mediaBorderStyle}
        options={[
          { value: "none", label: "No border" },
          { value: "solid", label: "Solid border" },
        ]}
        onChange={(v) => update({ mediaBorderStyle: v })}
      />
      <Slider label="Media corner radius" min={0} max={40} suffix="px" value={cart.mediaCornerRadius} onChange={(v) => update({ mediaCornerRadius: v })} />

      <hr className="border-black/10 dark:border-white/10" />

      {/* §8.13.C item 13 — cart-drawer motion. Off / "None" ⇒ today's instant render. */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Animate newly added items</span>
        <Toggle checked={cart.itemAnimation === true} onChange={(v) => update({ itemAnimation: v || undefined })} />
      </div>
      <Select
        label="Subtotal change animation"
        value={cart.subtotalAnimation ?? "none"}
        onChange={(e) =>
          update({ subtotalAnimation: e.target.value === "none" ? undefined : (e.target.value as CartSettingsType["subtotalAnimation"]) })
        }
      >
        <option value="none">None</option>
        <option value="flash">Flash on change</option>
        <option value="count">Count up/down</option>
      </Select>
    </div>
  );
}
