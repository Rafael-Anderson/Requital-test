import type { SectionEntrance, SectionSettings } from "./theme-config-types";

// Phase A (motion foundation) — resolves a section's entrance/stagger/replay
// behaviour from its settings. Merges the legacy `settings.scrollAnimation`
// with the new `settings.motion` object; the new object wins when both are set.
// Both absent ⇒ { entrance: 'none', stagger: false, animateOnce: true,
// trigger: 'scroll' } — the exact pre-Phase-A behaviour of ScrollAnimatedWrapper.
// An unrecognised entrance value degrades to 'none' (a no-op).

export interface ResolvedSectionMotion {
  entrance: SectionEntrance;
  // per-child stagger — TYPE + CSS plumbing only in Phase A; no section wires
  // the `--i` child indices and no admin control exposes it yet (Amendment 1,
  // option b). B/D/E wire it into the list sections and add the control.
  stagger: boolean;
  animateOnce: boolean;
  trigger: "scroll" | "load";
}

const KNOWN_ENTRANCES: readonly SectionEntrance[] = [
  "none",
  "fade-in",
  "slide-up",
  "slide-left",
  "slide-right",
  "scale-in",
  "blur-in",
  "mask-reveal",
];

export function resolveSectionMotion(settings: SectionSettings | undefined): ResolvedSectionMotion {
  const m = settings?.motion;
  const rawEntrance = m?.entrance ?? settings?.scrollAnimation ?? "none";
  const entrance = (KNOWN_ENTRANCES as readonly string[]).includes(rawEntrance)
    ? (rawEntrance as SectionEntrance)
    : "none";
  return {
    entrance,
    stagger: m?.stagger === true,
    animateOnce: m?.animateOnce !== false,
    trigger: m?.trigger === "load" ? "load" : "scroll",
  };
}
