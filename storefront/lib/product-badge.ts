import type { CSSProperties } from "react";
import { resolveScheme } from "./theme-color-scheme";
import type { BadgeSettings, ColorScheme } from "./theme-config-types";

// Pure resolver for a product-card badge (Sale / Sold out) from
// globalSettings.badges against the theme's color schemes. Returns null when
// badges settings are absent (an un-themed shop, i.e. no published
// theme.config) so the caller renders exactly what it did before — no
// fallback branching beyond the null check. globalSettings.badges previously
// had NO storefront consumer at all (see storefront/CLAUDE.md's dead-setting
// list); this is the wiring. Directly unit-tested, no DOM access, same
// convention as theme-element-style.ts's resolvers.

export type ProductBadgeKind = "sale" | "sold_out";

// Maps BadgeSettings.position onto absolute-position utility classes. The
// card's media wrapper is `relative`, so these place the badge in a corner
// of the image.
const POSITION_CLASS: Record<string, string> = {
  top_right: "top-2 right-2",
  top_left: "top-2 left-2",
  bottom_right: "bottom-2 right-2",
  bottom_left: "bottom-2 left-2",
};

export interface ResolvedProductBadge {
  label: string;
  positionClass: string;
  style: CSSProperties;
}

export function resolveProductBadge(
  kind: ProductBadgeKind,
  badges: BadgeSettings | undefined,
  schemes: ColorScheme[] | undefined,
): ResolvedProductBadge | null {
  if (!badges) return null;
  const schemeId = kind === "sale" ? badges.saleSchemeId : badges.soldOutSchemeId;
  const scheme = resolveScheme(schemeId, schemes ?? []);
  const label = kind === "sale" ? "Sale" : "Sold out";
  return {
    label: badges.case === "uppercase" ? label.toUpperCase() : label,
    positionClass: POSITION_CLASS[badges.position] ?? POSITION_CLASS.top_right,
    style: {
      // A badge is an attention element — the scheme's button/label pair
      // (its CTA colours) reads better for that than its plain
      // background/text. Falls back to a neutral dark chip when the id
      // doesn't resolve.
      background: scheme?.button ?? "#18181b",
      color: scheme?.buttonLabel ?? "#ffffff",
      borderRadius: `${typeof badges.cornerRadius === "number" ? badges.cornerRadius : 4}px`,
      fontFamily: badges.font === "accent" ? "var(--theme-accent-font, inherit)" : "var(--theme-body-font, inherit)",
    },
  };
}
