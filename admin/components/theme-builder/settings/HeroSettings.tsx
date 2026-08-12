"use client";

import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import NineZoneGridPicker from "./shared/NineZoneGridPicker";
import TypographyControls, { type TypographyValue } from "./shared/TypographyControls";
import SpacingControls, { type SpacingValue } from "./shared/SpacingControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import ElementDragZone from "../ElementDragZone";
import { DEFAULT_HERO_ELEMENTS, HERO_ZONES } from "@/lib/default-theme-elements";
import type { ScrollAnimation, SectionVisibility, ThemeElement } from "@/lib/types";

const HEIGHTS = ["small", "medium", "large", "full"] as const;

export default function HeroSettings({
  settings,
  onUpdate,
  elements,
  onUpdateElements,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
  elements?: ThemeElement[];
  onUpdateElements?: (elements: ThemeElement[]) => void;
}) {
  const activeElements = elements && elements.length > 0 ? elements : DEFAULT_HERO_ELEMENTS;
  return (
    <div className="space-y-4">
      <Input
        label="Heading"
        value={(settings.heading as string) ?? ""}
        onChange={(e) => onUpdate("heading", e.target.value)}
      />
      <Input
        label="Subheading"
        value={(settings.subheading as string) ?? ""}
        onChange={(e) => onUpdate("subheading", e.target.value)}
      />
      <Input
        label="CTA button label"
        value={(settings.ctaLabel as string) ?? ""}
        onChange={(e) => onUpdate("ctaLabel", e.target.value)}
      />
      <NineZoneGridPicker
        value={(settings.contentPosition as string) ?? "center-center"}
        onChange={(v) => onUpdate("contentPosition", v)}
      />

      {onUpdateElements && (
        <div>
          <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Element layout
          </span>
          <ElementDragZone elements={activeElements} zones={HERO_ZONES} onChange={onUpdateElements} />
        </div>
      )}

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
    </div>
  );
}
