"use client";

import Toggle from "@/components/ui/Toggle";
import Select from "@/components/ui/Select";
import ColorPicker from "@/components/ui/ColorPicker";
import type { ProductCardSettings as ProductCardSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// The hover *effect* itself (zoom/rise/swap/none) is the pre-existing
// Animations > "Card hover effect" setting, not here — see
// AnimationsSettings.tsx. showCarousel/productName* apply globally (every
// product card storefront-wide — homepage Product Grid sections AND the
// standalone collection page, which has no theme section of its own to
// carry a per-instance setting) rather than living on ProductGridSettings.tsx
// as originally sketched — see this file's own storefront consumers
// (ProductGridSection.tsx, ProductCard.tsx).
export default function ProductCardsSettings({ editor }: { editor: ThemeEditorState }) {
  const productCards = editor.config!.globalSettings.productCards;
  function update(patch: Partial<ProductCardSettingsType>) {
    editor.updateGlobalSettingsCategory("productCards", patch);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Quick add</span>
        <Toggle checked={productCards.quickAdd} onChange={(v) => update({ quickAdd: v })} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Mobile quick add</span>
        <Toggle checked={productCards.mobileQuickAdd} onChange={(v) => update({ mobileQuickAdd: v })} />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-600 dark:text-zinc-400">Quick add background</span>
        <ColorPicker value={productCards.quickAddBackground} onChange={(hex) => update({ quickAddBackground: hex })} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-600 dark:text-zinc-400">Quick add text</span>
        <ColorPicker value={productCards.quickAddText} onChange={(hex) => update({ quickAddText: hex })} />
      </div>

      <hr className="border-black/10 dark:border-white/10" />

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Media</p>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Cycle through images on hover</span>
          <Toggle checked={productCards.showCarousel} onChange={(v) => update({ showCarousel: v })} />
        </div>
      </div>

      <hr className="border-black/10 dark:border-white/10" />

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Show product descriptions</span>
        <Toggle checked={productCards.showProductDescriptions} onChange={(v) => update({ showProductDescriptions: v })} />
      </div>

      <hr className="border-black/10 dark:border-white/10" />

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Product name</p>
        <div className="space-y-3">
          <Select
            label="Font size"
            value={String(productCards.productNameFontSize)}
            onChange={(e) => update({ productNameFontSize: Number(e.target.value) })}
          >
            <option value="12">12px</option>
            <option value="14">14px</option>
            <option value="16">16px</option>
            <option value="18">18px</option>
          </Select>
          <Select
            label="Font weight"
            value={productCards.productNameFontWeight}
            onChange={(e) => update({ productNameFontWeight: e.target.value as ProductCardSettingsType["productNameFontWeight"] })}
          >
            <option value="regular">Regular</option>
            <option value="medium">Medium</option>
            <option value="bold">Bold</option>
          </Select>
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">Text color</span>
            <ColorPicker value={productCards.productNameColor} onChange={(hex) => update({ productNameColor: hex })} />
          </div>
        </div>
      </div>
    </div>
  );
}
