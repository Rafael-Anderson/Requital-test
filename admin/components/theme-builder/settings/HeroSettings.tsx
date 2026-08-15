"use client";

import Select from "@/components/ui/Select";
import NineZoneGridPicker from "./shared/NineZoneGridPicker";
import TypographyControls, { type TypographyValue } from "./shared/TypographyControls";
import SpacingControls, { type SpacingValue } from "./shared/SpacingControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import LegacyHeroSettings from "../LegacyHeroSettings";
import type { ScrollAnimation, SectionVisibility } from "@/lib/types";

const HEIGHTS = ["small", "medium", "large", "full"] as const;

// Heading/subheading/CTA text now live on this section's own heading/
// subheading/cta blocks (select them in the tree to edit) — this panel is
// section-level layout only.
export default function HeroSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-4">
      <NineZoneGridPicker
        value={(settings.contentPosition as string) ?? "center-center"}
        onChange={(v) => onUpdate("contentPosition", v)}
      />

      <Select
        label="Height"
        value={(settings.height as string) ?? "medium"}
        onChange={(e) => onUpdate("height", e.target.value)}
      >
        {HEIGHTS.map((h) => (
          <option key={h} value={h}>
            {h[0].toUpperCase() + h.slice(1)}
          </option>
        ))}
      </Select>

      <hr className="border-black/10 dark:border-white/10" />

      <TypographyControls
        value={settings.typography as TypographyValue}
        onChange={(v) => onUpdate("typography", v)}
      />
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

      <LegacyHeroSettings />
    </div>
  );
}
