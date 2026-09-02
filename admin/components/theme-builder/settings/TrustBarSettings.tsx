"use client";

import SpacingControls, { type SpacingValue } from "./shared/SpacingControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import type { ScrollAnimation, SectionVisibility } from "@/lib/types";

// Trust / social-proof strip (theme-builder-expansion Phase 6). Content —
// an optional intro heading, repeatable "Trust item" rows, and one optional
// "Rating badge" — is edited by expanding this section in the tree
// (BLOCK_TYPES.trust_bar). This panel is section-level styling only.
export default function TrustBarSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Add Trust item / Rating badge blocks to this section in the tree on the left.
      </p>
      <SpacingControls value={settings.spacing as SpacingValue} onChange={(v) => onUpdate("spacing", v)} />
      <BackgroundControls value={settings.background as BackgroundValue} onChange={(v) => onUpdate("background", v)} />
      <ScrollAnimationControl value={settings.scrollAnimation as ScrollAnimation} onChange={(v) => onUpdate("scrollAnimation", v)} />
      <VisibilityControl value={settings.visibility as SectionVisibility} onChange={(v) => onUpdate("visibility", v)} />
    </div>
  );
}
