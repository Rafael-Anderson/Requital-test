"use client";

import Select from "@/components/ui/Select";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import BannerImageGallery from "@/components/BannerImageGallery";
import NineZoneGridPicker from "./shared/NineZoneGridPicker";
import TypographyControls, { type TypographyValue } from "./shared/TypographyControls";
import SpacingControls, { type SpacingValue } from "./shared/SpacingControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import type { BannerImage, ScrollAnimation, SectionVisibility } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

const HEIGHTS = ["small", "medium", "large", "full"] as const;
const MIN_SLIDE_DURATION = 2;
const DEFAULT_SLIDE_DURATION = 5;

// Heading/subheading/CTA text live on this section's own heading/subheading/
// cta blocks (select them in the tree to edit). The banner text + image
// slideshow below used to live in a separate, dead "Classic homepage banner"
// sub-panel (LegacyHeroSettings, deleted) — they're native Hero section
// settings now, the one place to configure the homepage banner in the
// Sections builder. The storefront HeroSection renders bannerImages as an
// auto-rotating backdrop behind the block content.
export default function HeroSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
  editor?: ThemeEditorState;
}) {
  const bannerImages = Array.isArray(settings.bannerImages) ? (settings.bannerImages as BannerImage[]) : [];
  const slideDuration =
    typeof settings.slideDuration === "number" && settings.slideDuration >= MIN_SLIDE_DURATION
      ? settings.slideDuration
      : DEFAULT_SLIDE_DURATION;

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

      <Select
        label="Layout"
        value={(settings.heroLayout as string) ?? "full_bleed"}
        onChange={(e) => onUpdate("heroLayout", e.target.value)}
      >
        <option value="full_bleed">Full bleed (edge to edge)</option>
        <option value="inset">Inset (margins + rounded)</option>
      </Select>
      {settings.heroLayout === "inset" && (
        <Input
          label="Corner radius (px)"
          type="number"
          min={0}
          max={64}
          value={(settings.cornerRadius as number) ?? 16}
          onChange={(e) => onUpdate("cornerRadius", Math.max(0, Math.min(64, Number(e.target.value) || 0)))}
        />
      )}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Show slideshow dots</span>
        <Toggle checked={(settings.showSlideIndicators as boolean) ?? false} onChange={(v) => onUpdate("showSlideIndicators", v)} />
      </div>

      <hr className="border-black/10 dark:border-white/10" />

      <Input
        label="Hero banner text"
        value={(settings.heroText as string) ?? ""}
        onChange={(e) => onUpdate("heroText", e.target.value)}
        placeholder="Fresh flowers, delivered same-day"
      />
      <BannerImageGallery images={bannerImages} onChange={(v) => onUpdate("bannerImages", v)} />
      <Input
        label="Slide duration (seconds)"
        type="number"
        min={MIN_SLIDE_DURATION}
        value={slideDuration}
        onChange={(e) => {
          const n = Math.max(MIN_SLIDE_DURATION, Math.round(Number(e.target.value) || DEFAULT_SLIDE_DURATION));
          onUpdate("slideDuration", n);
        }}
      />
      <ScrollAnimationControl
        label="Slide transition"
        value={(settings.slideTransition as ScrollAnimation) ?? "fade-in"}
        onChange={(v) => onUpdate("slideTransition", v)}
      />

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
