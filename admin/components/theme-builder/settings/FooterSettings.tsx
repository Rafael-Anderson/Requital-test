"use client";

import Input from "@/components/ui/Input";
import TypographyControls, { type TypographyValue } from "./shared/TypographyControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";

// Footer is global chrome (pinned to every page), same reasoning as
// HeaderSettings — no scroll-animation control here either.
export default function FooterSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-4">
      <Input
        label="Copyright text"
        value={(settings.copyrightText as string) ?? ""}
        onChange={(e) => onUpdate("copyrightText", e.target.value)}
      />

      <hr className="border-black/10 dark:border-white/10" />

      <TypographyControls
        value={settings.typography as TypographyValue}
        onChange={(v) => onUpdate("typography", v)}
      />
      <BackgroundControls
        value={settings.background as BackgroundValue}
        onChange={(v) => onUpdate("background", v)}
      />
    </div>
  );
}
