import type { ColorScheme } from "./theme-config-types";

// Pure — used by every section/badge/drawer/popover component that has a
// `schemeId` reference, to resolve it against the theme's colorSchemes
// list. Returns null (not a fallback scheme) when the id is unset or
// doesn't match any known scheme, so callers can decide their own fallback
// behavior (e.g. a section with no schemeId falls back to its own custom
// background settings instead of a scheme at all).
export function resolveScheme(
  schemeId: string | undefined,
  schemes: ColorScheme[],
): ColorScheme | null {
  if (!schemeId) return null;
  return schemes.find((s) => s.id === schemeId) ?? null;
}
