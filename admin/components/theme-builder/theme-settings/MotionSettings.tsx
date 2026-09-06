"use client";

import Select from "@/components/ui/Select";
import Slider from "@/components/ui/Slider";
import Toggle from "@/components/ui/Toggle";
import type { MotionSettings as MotionSettingsType } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// Phase A (motion foundation). Drives globalSettings.motion — one lever for how
// lively the storefront feels. Only the three controls that actually do
// something in Phase A are exposed: intensity (the --motion-* token table),
// speed (a duration multiplier), and easing. The other MotionSettings fields
// (scrollMotion / hoverMotion / smoothScroll / …) are typed for a stable shape
// but have NO storefront consumer yet, so they get no control here — a visible
// toggle that does nothing is exactly what we're avoiding.
//
// "Default" (intensity unset) is the true no-op: nothing is written and every
// storefront animation keeps its exact current timing. "Standard" is a
// deliberate near-today baseline, NOT byte-identical to Default.
const INTENSITY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Default (no motion overrides)" },
  { value: "none", label: "None — motion off" },
  { value: "subtle", label: "Subtle" },
  { value: "standard", label: "Standard" },
  { value: "expressive", label: "Expressive" },
];

const EASING_OPTIONS: { value: NonNullable<MotionSettingsType["easing"]>; label: string }[] = [
  { value: "standard", label: "Standard (per intensity)" },
  { value: "gentle", label: "Gentle" },
  { value: "snappy", label: "Snappy" },
  { value: "overshoot", label: "Overshoot" },
  { value: "linear", label: "Linear" },
];

export default function MotionSettings({ editor }: { editor: ThemeEditorState }) {
  const motion: MotionSettingsType = editor.config!.globalSettings.motion ?? {};
  function update(patch: Partial<MotionSettingsType>) {
    editor.updateGlobalSettingsCategory("motion", patch);
  }

  const active = !!motion.intensity;

  return (
    <div className="space-y-4">
      <Select
        label="Motion intensity"
        value={motion.intensity ?? ""}
        onChange={(e) =>
          update({ intensity: (e.target.value || undefined) as MotionSettingsType["intensity"] })
        }
      >
        {INTENSITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <p className="text-xs text-zinc-400">
        &quot;Default&quot; leaves every animation at its current timing. &quot;Standard&quot; is a
        near-identical baseline you can then adjust.
      </p>

      <div className={active ? "" : "pointer-events-none opacity-50"}>
        <Slider
          label="Speed"
          value={motion.speed ?? 1}
          min={0.5}
          max={2}
          step={0.1}
          suffix="×"
          onChange={(v) => update({ speed: v })}
        />
      </div>

      <div className={active ? "" : "pointer-events-none opacity-50"}>
        <Select
          label="Easing"
          value={motion.easing ?? "standard"}
          onChange={(e) => update({ easing: e.target.value as MotionSettingsType["easing"] })}
        >
          {EASING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {/* §8.13.C item 8 — independent of the intensity token system, so not
          gated on `active`. */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">
          Smooth scrolling
          <span className="block text-xs font-normal text-zinc-400">
            Animates in-page anchor jumps. Ignored under reduced motion.
          </span>
        </span>
        <Toggle checked={motion.smoothScroll === true} onChange={(v) => update({ smoothScroll: v || undefined })} />
      </div>

      {/* §8.13.C item 14 — also independent of intensity. */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">
          Scroll progress bar
          <span className="block text-xs font-normal text-zinc-400">
            A thin bar at the top of the page that fills as the visitor scrolls.
          </span>
        </span>
        <Toggle checked={motion.scrollProgressBar === true} onChange={(v) => update({ scrollProgressBar: v || undefined })} />
      </div>

      {/* §8.13.C item 15 — capped at 5 elements, force-off on mobile /
          reduced-motion, and off entirely when intensity is "None". */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">
          Decorative parallax
          <span className="block text-xs font-normal text-zinc-400">
            A few soft shapes drifting behind the page on scroll. Desktop only; off under reduced motion.
          </span>
        </span>
        <Toggle checked={motion.decorativeParallax === true} onChange={(v) => update({ decorativeParallax: v || undefined })} />
      </div>
    </div>
  );
}
