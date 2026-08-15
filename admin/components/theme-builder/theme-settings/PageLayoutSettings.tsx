"use client";

import SegmentedToggle from "@/components/ui/SegmentedToggle";
import type { PageLayoutSettings as PageLayoutSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

export default function PageLayoutSettings({ editor }: { editor: ThemeEditorState }) {
  const layout = editor.config!.globalSettings.pageLayout;
  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Page width</span>
        <SegmentedToggle<PageLayoutSettingsType["width"]>
          value={layout.width}
          options={[
            { value: "narrow", label: "Narrow" },
            { value: "normal", label: "Normal" },
            { value: "wide", label: "Wide" },
          ]}
          onChange={(v) => editor.updateGlobalSettingsCategory("pageLayout", { width: v })}
        />
      </div>
    </div>
  );
}
