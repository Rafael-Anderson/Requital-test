"use client";

import SegmentedToggle from "@/components/ui/SegmentedToggle";
import type { IconSettings as IconSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

export default function IconsSettings({ editor }: { editor: ThemeEditorState }) {
  const icons = editor.config!.globalSettings.icons;
  return (
    <div className="space-y-4">
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
      <div>
        <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Corners</span>
        <SegmentedToggle<"rounded" | "sharp">
          value={icons.corners ?? "rounded"}
          options={[
            { value: "rounded", label: "Rounded" },
            { value: "sharp", label: "Sharp" },
          ]}
          onChange={(v) => editor.updateGlobalSettingsCategory("icons", { corners: v === "rounded" ? undefined : v })}
        />
        <p className="mt-1.5 text-xs text-zinc-500">Applies to the header and search icons.</p>
      </div>
    </div>
  );
}
