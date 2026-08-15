"use client";

import Toggle from "@/components/ui/Toggle";
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
  const currencyCode = editor.config!.globalSettings.prices.currencyCode;
  function update(key: keyof PriceSettingsType["currencyCode"], value: boolean) {
    editor.updateGlobalSettingsCategory("prices", { currencyCode: { ...currencyCode, [key]: value } });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">Show currency code (e.g. AED) alongside the price:</p>
      {CONTEXTS.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between">
          <span className="text-sm font-medium">{label}</span>
          <Toggle checked={currencyCode[key]} onChange={(v) => update(key, v)} />
        </div>
      ))}
    </div>
  );
}
