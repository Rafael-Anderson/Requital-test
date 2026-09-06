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

// §8.13.C item 1 — ribbon is the odd one out: a rotated corner banner, not a
// chip. It ignores POSITION_CLASS's inset offsets and pins to the corner via
// its own per-corner variant class (rotate sign + top/bottom edge).
const RIBBON_CORNER: Record<string, string> = {
  top_right: "theme-badge-ribbon--tr",
  top_left: "theme-badge-ribbon--tl",
  bottom_right: "theme-badge-ribbon--br",
  bottom_left: "theme-badge-ribbon--bl",
};

export interface ResolvedProductBadge {
  label: string;
  className: string;
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
  const positionClass = POSITION_CLASS[badges.position] ?? POSITION_CLASS.top_right;
  const shape = badges.style ?? "rectangle";

  const style: CSSProperties = {
    // A badge is an attention element — the scheme's button/label pair
    // (its CTA colours) reads better for that than its plain
    // background/text. Falls back to a neutral dark chip when the id
    // doesn't resolve.
    background: scheme?.button ?? "#18181b",
    color: scheme?.buttonLabel ?? "#ffffff",
    fontFamily: badges.font === "accent" ? "var(--theme-accent-font, inherit)" : "var(--theme-body-font, inherit)",
  };

  // rectangle/pill set border-radius inline; circle/tag/ribbon geometry is
  // owned entirely by the .theme-badge-* class (border-radius from the class
  // or none), so no inline borderRadius for those.
  if (shape === "rectangle") {
    style.borderRadius = `${typeof badges.cornerRadius === "number" ? badges.cornerRadius : 4}px`;
  } else if (shape === "pill") {
    style.borderRadius = "9999px";
  }

  // Token order for rectangle/pill is kept byte-identical to the pre-§8.13
  // hardcoded string: `absolute <pos> px-2 py-0.5 text-xs font-medium`.
  const parts: string[] = ["absolute"];
  if (shape === "ribbon") {
    parts.push("theme-badge-ribbon", RIBBON_CORNER[badges.position] ?? RIBBON_CORNER.top_right, "text-xs", "font-medium");
  } else {
    parts.push(positionClass);
    if (shape === "circle") parts.push("theme-badge-circle");
    else if (shape === "tag") parts.push("theme-badge-tag");
    else parts.push("px-2", "py-0.5"); // rectangle / pill keep the original padding
    parts.push("text-xs", "font-medium");
  }
  // Not on ribbon — its static rotate() transform and the pop keyframe's
  // scale() transform would fight (no template combines the two anyway).
  if (badges.entranceAnimation === true && shape !== "ribbon") parts.push("theme-badge-pop");

  return { label: badges.case === "uppercase" ? label.toUpperCase() : label, className: parts.join(" "), style };
}
