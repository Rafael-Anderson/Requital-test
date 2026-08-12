"use client";

import Toggle from "@/components/ui/Toggle";
import TypographyControls, { type TypographyValue } from "./shared/TypographyControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ElementDragZone from "../ElementDragZone";
import { DEFAULT_HEADER_ELEMENTS, HEADER_ZONES } from "@/lib/default-theme-elements";
import type { ThemeElement } from "@/lib/types";

// Header is global chrome (pinned to every page, not part of the
// reorderable sections list) — see the plan's scope decision. It gets a
// settings panel here but no scroll-animation control (it never scrolls
// into view; it's always present).
export default function HeaderSettings({
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
  const activeElements = elements && elements.length > 0 ? elements : DEFAULT_HEADER_ELEMENTS;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Sticky header</span>
        <Toggle checked={!!settings.sticky} onChange={(v) => onUpdate("sticky", v)} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Transparent over hero</span>
        <Toggle
          checked={!!settings.transparentOnHero}
          onChange={(v) => onUpdate("transparentOnHero", v)}
        />
      </div>

      {onUpdateElements && (
        <div>
          <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Element layout
          </span>
          <ElementDragZone elements={activeElements} zones={HEADER_ZONES} onChange={onUpdateElements} />
        </div>
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
    </div>
  );
}
