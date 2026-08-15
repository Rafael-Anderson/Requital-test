"use client";

import TypographyControls, { type TypographyValue } from "./shared/TypographyControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";

// Footer is global chrome (pinned to every page), same reasoning as
// HeaderSettings — no scroll-animation control here either. Copyright text
// and its columns/social links now live on this section's blocks (expand
// the Footer node in the tree to edit them).
export default function FooterSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-4">
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
