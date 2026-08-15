"use client";

import Toggle from "@/components/ui/Toggle";
import ColorPicker from "@/components/ui/ColorPicker";
import type { ProductCardSettings as ProductCardSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

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
          <span className="text-sm font-medium">Show second image on hover</span>
          <Toggle checked={productCards.showSecondImageOnHover} onChange={(v) => update({ showSecondImageOnHover: v })} />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm font-medium">Show media carousel</span>
          <Toggle checked={productCards.showCarousel} onChange={(v) => update({ showCarousel: v })} />
        </div>
      </div>
    </div>
  );
}
