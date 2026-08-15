"use client";

import Select from "@/components/ui/Select";
import SpacingControls, { type SpacingValue } from "./shared/SpacingControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import type { ScrollAnimation, SectionVisibility } from "@/lib/types";

const CARD_STYLES = ["minimal", "bordered", "shadowed"] as const;

// Whether media/title/price show on each card is now controlled per
// sub-block (expand the section's Product card node in the tree) —
// "Show rating" was dropped entirely rather than migrated: it never did
// anything (Product has no rating field anywhere in this codebase).
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
