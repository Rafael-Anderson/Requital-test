"use client";

import SegmentedToggle from "@/components/ui/SegmentedToggle";
import type { IconSettings as IconSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

export default function IconsSettings({ editor }: { editor: ThemeEditorState }) {
  const icons = editor.config!.globalSettings.icons;
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Stroke width</span>
      <SegmentedToggle<IconSettingsType["stroke"]>
        value={icons.stroke}
        options={[
          { value: "thin", label: "Thin" },
          { value: "default", label: "Default" },
          { value: "heavy", label: "Heavy" },
        ]}
        onChange={(v) => editor.updateGlobalSettingsCategory("icons", { stroke: v })}
      />
    </div>
  );
}
