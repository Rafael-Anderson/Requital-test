"use client";

import Select from "@/components/ui/Select";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Slider from "@/components/ui/Slider";
import SchemePicker from "../SchemePicker";
import type { BadgeSettings as BadgeSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

const POSITIONS: BadgeSettingsType["position"][] = ["top_left", "top_right", "bottom_left", "bottom_right"];
const POSITION_LABELS: Record<BadgeSettingsType["position"], string> = {
  top_left: "Top left",
  top_right: "Top right",
  bottom_left: "Bottom left",
  bottom_right: "Bottom right",
};

export default function BadgesSettings({ editor }: { editor: ThemeEditorState }) {
  const badges = editor.config!.globalSettings.badges;
  const schemes = editor.config!.globalSettings.colorSchemes;
  function update(patch: Partial<BadgeSettingsType>) {
    editor.updateGlobalSettingsCategory("badges", patch);
  }
  function editScheme() {
    editor.setEditorMode("theme_settings");
    editor.setThemeSettingsCategory("Colors");
  }

  return (
    <div className="space-y-4">
      <Select label="Position" value={badges.position} onChange={(e) => update({ position: e.target.value as BadgeSettingsType["position"] })}>
        {POSITIONS.map((p) => (
          <option key={p} value={p}>
            {POSITION_LABELS[p]}
          </option>
        ))}
      </Select>
      <Slider label="Corner radius" min={0} max={24} suffix="px" value={badges.cornerRadius} onChange={(v) => update({ cornerRadius: v })} />

      <div>
        <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Sale badge scheme</span>
        <SchemePicker schemes={schemes} value={badges.saleSchemeId} onChange={(id) => update({ saleSchemeId: id })} onAddScheme={editor.addColorScheme} onEditScheme={editScheme} />
      </div>
      <div>
        <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Sold out badge scheme</span>
        <SchemePicker schemes={schemes} value={badges.soldOutSchemeId} onChange={(id) => update({ soldOutSchemeId: id })} onAddScheme={editor.addColorScheme} onEditScheme={editScheme} />
      </div>

      <SegmentedToggle<BadgeSettingsType["font"]>
        value={badges.font}
        options={[
          { value: "body", label: "Body font" },
          { value: "accent", label: "Accent font" },
        ]}
        onChange={(v) => update({ font: v })}
      />
      <SegmentedToggle<BadgeSettingsType["case"]>
        value={badges.case}
        options={[
          { value: "default", label: "Default" },
          { value: "uppercase", label: "Uppercase" },
        ]}
        onChange={(v) => update({ case: v })}
      />
    </div>
  );
}
