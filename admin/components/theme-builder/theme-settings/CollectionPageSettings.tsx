"use client";

import Select from "@/components/ui/Select";
import Input from "@/components/ui/Input";
import ColorPicker from "@/components/ui/ColorPicker";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import RichTextBlockEditor from "../RichTextBlockEditor";
import type { CollectionPageSettings as CollectionPageSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

const FONT_PRESETS = ["system-ui", "serif", "monospace"] as const;

// Governs the standalone collection (taxonomy node) detail page,
// /[shop]/collections/[slug] — storefront-v2 Phase 2C/2D. Not part of the
// section-based homepage system (that page has no theme sections to attach
// per-instance settings to), so this lives as its own small global
// category instead, same tier as Search/Product cards.
export default function CollectionPageSettings({ editor }: { editor: ThemeEditorState }) {
  const settings = editor.config!.globalSettings.collectionPage;
  function update(patch: Partial<CollectionPageSettingsType>) {
    editor.updateGlobalSettingsCategory("collectionPage", patch);
  }
  const isPresetFont = (FONT_PRESETS as readonly string[]).includes(settings.fontFamily) || settings.fontFamily === "";

  return (
    <div className="space-y-4">
      <RichTextBlockEditor
        blockId="collection-page-text-above"
        label="Text above products"
        value={settings.textAboveProducts}
        onChange={(html) => update({ textAboveProducts: html })}
      />
      <RichTextBlockEditor
        blockId="collection-page-text-below"
        label="Text below products"
        value={settings.textBelowProducts}
        onChange={(html) => update({ textBelowProducts: html })}
      />

      <hr className="border-black/10 dark:border-white/10" />

      <Select
        label="Font family"
        value={isPresetFont ? settings.fontFamily || "system-ui" : "custom"}
        onChange={(e) => update({ fontFamily: e.target.value === "custom" ? settings.fontFamily || " " : e.target.value })}
      >
        {FONT_PRESETS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </Select>
      {!isPresetFont && (
        <Input
          label="Custom font family"
          value={settings.fontFamily}
          onChange={(e) => update({ fontFamily: e.target.value })}
          placeholder="e.g. 'Playfair Display', serif"
        />
      )}

      <Input
        label="Font size (px)"
        type="number"
        min={10}
        max={32}
        value={settings.fontSize}
        onChange={(e) => update({ fontSize: Math.max(10, Math.min(32, Number(e.target.value) || 15)) })}
      />

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Text color</span>
        <ColorPicker value={settings.textColor || "#1B1F1E"} onChange={(hex) => update({ textColor: hex })} />
      </div>

      <hr className="border-black/10 dark:border-white/10" />

      <div>
        <span className="mb-1.5 block text-sm font-medium">Load more style</span>
        <SegmentedToggle
          value={settings.loadMoreStyle}
          options={[
            { value: "infinite", label: "Infinite scroll" },
            { value: "pagination", label: "Pagination" },
          ]}
          onChange={(v) => update({ loadMoreStyle: v as CollectionPageSettingsType["loadMoreStyle"] })}
        />
      </div>

      {/* Bug 6 fix: "Products per row" used to be a live customer-facing
          2/3/4-column icon selector on the storefront collection page - a
          merchant layout decision that had no business being shopper-
          editable. Now set once here; every shopper sees this fixed value. */}
      <div>
        <span className="mb-1.5 block text-sm font-medium">Products per row</span>
        <SegmentedToggle
          value={String(settings.columns)}
          options={[
            { value: "2", label: "2" },
            { value: "3", label: "3" },
            { value: "4", label: "4" },
          ]}
          onChange={(v) => update({ columns: Number(v) as CollectionPageSettingsType["columns"] })}
        />
      </div>
    </div>
  );
}
