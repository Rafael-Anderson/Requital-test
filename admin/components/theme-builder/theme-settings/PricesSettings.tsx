"use client";

import Toggle from "@/components/ui/Toggle";
import ColorPicker from "@/components/ui/ColorPicker";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import type { PriceSettings as PriceSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

const CONTEXTS: { key: keyof PriceSettingsType["currencyCode"]; label: string }[] = [
  { key: "productPages", label: "Product pages" },
  { key: "productCards", label: "Product cards" },
  { key: "cartItems", label: "Cart items" },
  { key: "cartTotal", label: "Cart total" },
];

// Whether the currency code (e.g. "AED") shows alongside a price, per
// context — Shopify's real per-surface toggles, not one global on/off.
export default function PricesSettings({ editor }: { editor: ThemeEditorState }) {
  const prices = editor.config!.globalSettings.prices;
  const currencyCode = prices.currencyCode;
  function updateCurrency(key: keyof PriceSettingsType["currencyCode"], value: boolean) {
    editor.updateGlobalSettingsCategory("prices", { currencyCode: { ...currencyCode, [key]: value } });
  }
  function update(patch: Partial<PriceSettingsType>) {
    editor.updateGlobalSettingsCategory("prices", patch);
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">Show currency code (e.g. AED) alongside the price:</p>
      {CONTEXTS.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between">
          <span className="text-sm font-medium">{label}</span>
          <Toggle checked={currencyCode[key]} onChange={(v) => updateCurrency(key, v)} />
        </div>
      ))}

      <hr className="border-black/10 dark:border-white/10" />

      {/* Phase B1 — the discounted (sale) price on product cards. */}
      <div>
        <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Sale price style</span>
        <SegmentedToggle<NonNullable<PriceSettingsType["salePriceStyle"]>>
          value={prices.salePriceStyle ?? "color"}
          options={[
            { value: "color", label: "Coloured" },
            { value: "strikethrough-only", label: "Strikethrough only" },
          ]}
          onChange={(v) => update({ salePriceStyle: v })}
        />
      </div>
      {prices.salePriceStyle !== "strikethrough-only" && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">Sale price colour</span>
          <ColorPicker value={prices.salePriceColor ?? "#dc2626"} onChange={(hex) => update({ salePriceColor: hex })} />
        </div>
      )}
    </div>
  );
}
