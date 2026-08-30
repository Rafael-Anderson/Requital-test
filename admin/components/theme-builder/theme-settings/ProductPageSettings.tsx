"use client";

import Toggle from "@/components/ui/Toggle";
import ColorPicker from "@/components/ui/ColorPicker";
import type { ProductPageSettings as ProductPageSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// Governs the PDP's stock/delivery/pickup status line
// ("● In stock   Delivery available   Pickup available") — same reasoning as
// CollectionPageSettings above it in the category list: the product page
// isn't composed of theme sections, so this is its own small global
// category. Each indicator's underlying value is always real data (product
// stock, outlet delivery/pickup capability) — these toggles only control
// whether a true indicator is shown, and what color it renders in; there is
// no merchant-editable text here.
export default function ProductPageSettings({ editor }: { editor: ThemeEditorState }) {
  const settings = editor.config!.globalSettings.productPage;
  function update(patch: Partial<ProductPageSettingsType>) {
    editor.updateGlobalSettingsCategory("productPage", patch);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Show stock status</span>
        <Toggle checked={settings.showStockIndicator} onChange={(v) => update({ showStockIndicator: v })} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Show delivery availability</span>
        <Toggle checked={settings.showDeliveryIndicator} onChange={(v) => update({ showDeliveryIndicator: v })} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Show pickup availability</span>
        <Toggle checked={settings.showPickupIndicator} onChange={(v) => update({ showPickupIndicator: v })} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">
          Show &quot;Buy Now Pay Later&quot; card
          <span className="block text-xs font-normal text-zinc-500">
            Tabby / Tamara installment promo, shown only when a provider is enabled and configured.
          </span>
        </span>
        <Toggle checked={settings.showBnplWidget} onChange={(v) => update({ showBnplWidget: v })} />
      </div>

      <hr className="border-black/10 dark:border-white/10" />

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">In stock color</span>
        <ColorPicker value={settings.inStockColor} onChange={(hex) => update({ inStockColor: hex })} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Low stock color</span>
        <ColorPicker value={settings.lowStockColor} onChange={(hex) => update({ lowStockColor: hex })} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Out of stock color</span>
        <ColorPicker value={settings.outOfStockColor} onChange={(hex) => update({ outOfStockColor: hex })} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Delivery / pickup text color</span>
        <ColorPicker value={settings.fulfillmentTextColor} onChange={(hex) => update({ fulfillmentTextColor: hex })} />
      </div>
    </div>
  );
}
