"use client";

import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import TypographyControls, { type TypographyValue } from "./shared/TypographyControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import type { ScrollAnimation, SectionVisibility } from "@/lib/types";

export default function AnnouncementBarSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-4">
      <Input
        label="Text"
        value={(settings.text as string) ?? ""}
        onChange={(e) => onUpdate("text", e.target.value)}
      />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Scrolling</span>
        <Toggle checked={!!settings.scrolling} onChange={(v) => onUpdate("scrolling", v)} />
      </div>

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
    </div>
  );
}
