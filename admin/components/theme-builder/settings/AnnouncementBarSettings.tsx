"use client";

import Toggle from "@/components/ui/Toggle";
import Select from "@/components/ui/Select";
import TypographyControls, { type TypographyValue } from "./shared/TypographyControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import LegacyAnnouncementSettings from "../LegacyAnnouncementSettings";
import type { ScrollAnimation, SectionVisibility } from "@/lib/types";

const SPEED_OPTIONS = [
  { value: "fast", label: "Fast (2s)" },
  { value: "medium", label: "Medium (4s)" },
  { value: "slow", label: "Slow (6s)" },
];

// Announcement text now lives on this section's own (repeatable)
// announcement blocks — select one in the tree to edit it, or add more via
// "+ Add block". With "Scrolling" off, multiple messages rotate one at a
// time with a crossfade at the interval chosen below; with "Scrolling" on,
// every message is joined into one continuously-scrolling marquee line
// instead (Speed doesn't apply to that mode).
export default function AnnouncementBarSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Scrolling</span>
        <Toggle checked={!!settings.scrolling} onChange={(v) => onUpdate("scrolling", v)} />
      </div>

      {!settings.scrolling && (
        <Select
          label="Rotation speed"
          value={(settings.speed as string) ?? "medium"}
          onChange={(e) => onUpdate("speed", e.target.value)}
        >
          {SPEED_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      )}

      <hr className="border-black/10 dark:border-white/10" />

      <TypographyControls
        value={settings.typography as TypographyValue}
        onChange={(v) => onUpdate("typography", v)}
      />
      <BackgroundControls
        value={settings.background as BackgroundValue}
        onChange={(v) => onUpdate("background", v)}
      />
      <ScrollAnimationControl
        value={settings.scrollAnimation as ScrollAnimation}
        onChange={(v) => onUpdate("scrollAnimation", v)}
      />
      <VisibilityControl
        value={settings.visibility as SectionVisibility}
        onChange={(v) => onUpdate("visibility", v)}
      />

      <LegacyAnnouncementSettings />
    </div>
  );
}
