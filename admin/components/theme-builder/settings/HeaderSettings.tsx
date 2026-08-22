"use client";

import Toggle from "@/components/ui/Toggle";
import Select from "@/components/ui/Select";
import ColorPicker from "@/components/ui/ColorPicker";
import TypographyControls, { type TypographyValue } from "./shared/TypographyControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import LegacyHeaderSettings from "../LegacyHeaderSettings";

// Header is global chrome (pinned to every page, not part of the
// reorderable sections list) — see the plan's scope decision. It gets a
// settings panel here but no scroll-animation control (it never scrolls
// into view; it's always present). Its logo/menu/search/cart/account
// blocks are edited by expanding the Header node in the tree, not here.
export default function HeaderSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Sticky header</span>
        <Toggle checked={!!settings.sticky} onChange={(v) => onUpdate("sticky", v)} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Transparent over hero</span>
        <Toggle
          checked={!!settings.transparentOnHero}
          onChange={(v) => onUpdate("transparentOnHero", v)}
        />
      </div>

      <Select
        label="Menu animation"
        value={(settings.menuAnimation as string) ?? "fade"}
        onChange={(e) => onUpdate("menuAnimation", e.target.value)}
      >
        <option value="fade">Fade</option>
        <option value="slide">Slide down</option>
        <option value="none">None</option>
      </Select>

      <hr className="border-black/10 dark:border-white/10" />

      <TypographyControls
        value={settings.typography as TypographyValue}
        onChange={(v) => onUpdate("typography", v)}
      />
      <BackgroundControls
        value={settings.background as BackgroundValue}
        onChange={(v) => onUpdate("background", v)}
      />

      <hr className="border-black/10 dark:border-white/10" />

      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Menu bar background</span>
          <ColorPicker
            value={(settings.menuBarBackground as string) ?? "#ffffff"}
            onChange={(hex) => onUpdate("menuBarBackground", hex)}
          />
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          The navigation row beneath the header. Falls back to the header background above if not set.
        </p>
      </div>

      <LegacyHeaderSettings />
    </div>
  );
}
