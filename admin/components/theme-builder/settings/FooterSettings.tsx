"use client";

import Toggle from "@/components/ui/Toggle";
import Select from "@/components/ui/Select";
import PresetPicker from "@/components/PresetPicker";
import { FooterPresetThumbnail } from "@/components/PresetThumbnails";
import TypographyControls, { type TypographyValue } from "./shared/TypographyControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import LegacyFooterSettings from "../LegacyFooterSettings";
import { FOOTER_PRESETS } from "@/lib/header-footer-presets";

// Footer is global chrome (pinned to every page), same reasoning as
// HeaderSettings — no scroll-animation control here either. Copyright text
// and its columns/social links now live on this section's blocks (expand
// the Footer node in the tree to edit them).
export default function FooterSettings({
  settings,
  onUpdate,
  onApplyPreset,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
  onApplyPreset: (key: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* C1 — same one-time-apply PresetPicker convention as HeaderSettings
          and the Home tab's HOMEPAGE_PRESETS. */}
      <div>
        <span className="mb-2 block text-sm font-medium">Layout preset</span>
        <PresetPicker
          singleColumn
          options={FOOTER_PRESETS.map((p) => ({ key: p.key, label: p.label }))}
          value=""
          onChange={(key) => onApplyPreset(key)}
          renderThumbnail={(key) => <FooterPresetThumbnail preset={key} />}
        />
      </div>

      <hr className="border-black/10 dark:border-white/10" />

      <Select
        label="Columns"
        value={settings.columns !== undefined ? String(settings.columns) : ""}
        onChange={(e) => onUpdate("columns", e.target.value ? Number(e.target.value) : undefined)}
      >
        <option value="">Auto (flex-wrap)</option>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Show payment icons</span>
        <Toggle checked={!!settings.showPaymentIcons} onChange={(v) => onUpdate("showPaymentIcons", v)} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Wave edge</span>
        <Toggle checked={!!settings.waveEdge} onChange={(v) => onUpdate("waveEdge", v)} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Separate bottom bar</span>
        <Toggle checked={!!settings.bottomBarSeparate} onChange={(v) => onUpdate("bottomBarSeparate", v)} />
      </div>

      <hr className="border-black/10 dark:border-white/10" />

      <TypographyControls
        value={settings.typography as TypographyValue}
        onChange={(v) => onUpdate("typography", v)}
      />
      <BackgroundControls
        value={settings.background as BackgroundValue}
        onChange={(v) => onUpdate("background", v)}
      />

      <LegacyFooterSettings />
    </div>
  );
}
