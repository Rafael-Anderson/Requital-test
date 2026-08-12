"use client";

import Toggle from "@/components/ui/Toggle";
import Select from "@/components/ui/Select";
import SpacingControls, { type SpacingValue } from "./shared/SpacingControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import type { ScrollAnimation, SectionVisibility } from "@/lib/types";

const CARD_STYLES = ["minimal", "bordered", "shadowed"] as const;

export default function ProductGridSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-4">
      <Select
        label="Columns"
        value={String((settings.columns as number) ?? 3)}
        onChange={(e) => onUpdate("columns", Number(e.target.value))}
      >
        <option value="2">2</option>
        <option value="3">3</option>
        <option value="4">4</option>
      </Select>
      <Select
        label="Card style"
        value={(settings.cardStyle as string) ?? "minimal"}
        onChange={(e) => onUpdate("cardStyle", e.target.value)}
      >
        {CARD_STYLES.map((s) => (
          <option key={s} value={s}>
            {s[0].toUpperCase() + s.slice(1)}
          </option>
        ))}
      </Select>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Show rating</span>
        <Toggle
          checked={!!settings.showRating}
          onChange={(v) => onUpdate("showRating", v)}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Show price</span>
        <Toggle
          checked={settings.showPrice !== false}
          onChange={(v) => onUpdate("showPrice", v)}
        />
      </div>

      <hr className="border-black/10 dark:border-white/10" />

      <SpacingControls
        value={settings.spacing as SpacingValue}
        onChange={(v) => onUpdate("spacing", v)}
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
    </div>
  );
}
