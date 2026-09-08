import type { CSSProperties } from "react";
import { resolveScheme } from "./theme-color-scheme";
import type { BadgeSettings, ColorScheme } from "./theme-config-types";

// Pure resolver for product-card badges from globalSettings.badges. Returns
// null when badges settings are absent (an un-themed shop, i.e. no published
// theme.config) so the caller renders exactly what it did before. Directly
// unit-tested, no DOM access.

export type ProductBadgeKind = "sale" | "sold_out" | "new";

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

// The secondary (small, subordinate) badge sits in the corner diagonally
// below/above the primary — same horizontal side, opposite vertical edge —
// so the two never overlap AND neither lands on the top-left WishlistButton
// unless the merchant deliberately puts the primary at bottom-left. See
// resolveCardBadges.
const MIRROR_POSITION: Record<string, string> = {
  top_right: "bottom_right",
  top_left: "bottom_left",
  bottom_right: "top_right",
  bottom_left: "top_left",
};

export interface ResolvedProductBadge {
  label: string;
  className: string;
  style: CSSProperties;
}

interface BadgeOpts {
  // The computed discount percentage, substituted into a `{percent}`
  // placeholder in badges.saleLabel. Only meaningful for kind "sale".
  discountPercent?: number | null;
  // Render a small, plain, subordinate chip (ignores badges.style, mirrors
  // the position, smaller text) — used for the NEW badge when a discount
  // badge is already the primary.
  secondary?: boolean;
}

export function resolveProductBadge(
  kind: ProductBadgeKind,
  badges: BadgeSettings | undefined,
  schemes: ColorScheme[] | undefined,
  opts: BadgeOpts = {},
): ResolvedProductBadge | null {
  if (!badges) return null;

  const schemeId =
    kind === "sale"
      ? badges.saleSchemeId
      : kind === "new"
        ? (badges.newSchemeId ?? badges.saleSchemeId)
        : badges.soldOutSchemeId;
  const scheme = resolveScheme(schemeId, schemes ?? []);

  let label: string;
  if (kind === "sold_out") {
    label = "Sold out";
  } else if (kind === "new") {
    label = badges.newLabel || "NEW";
  } else {
    const template = badges.saleLabel || "-{percent}%";
    // A template wanting a percent it doesn't have falls back to "Sale"
    // (byte-identical to the pre-#6 label). A placeholder-free template
    // like "SALE" is used verbatim.
    label = !template.includes("{percent}")
      ? template
      : opts.discountPercent != null
        ? template.replace(/\{percent\}/g, String(opts.discountPercent))
        : "Sale";
  }
  if (badges.case === "uppercase") label = label.toUpperCase();

  const position = opts.secondary
    ? (MIRROR_POSITION[badges.position] ?? "top_left")
    : badges.position;
  // A secondary badge is always a small plain chip; the ribbon geometry
  // only ever applies to the primary.
  const shape = opts.secondary ? "rectangle" : (badges.style ?? "rectangle");
  const positionClass = POSITION_CLASS[position] ?? POSITION_CLASS.top_right;

  const style: CSSProperties = {
    // A badge is an attention element — the scheme's button/label pair
    // (its CTA colours) reads better for that than its plain
    // background/text. Falls back to a neutral dark chip when the id
    // doesn't resolve.
    background: scheme?.button ?? "#18181b",
    color: scheme?.buttonLabel ?? "#ffffff",
    fontFamily:
      badges.font === "accent"
        ? "var(--theme-accent-font, inherit)"
        : "var(--theme-body-font, inherit)",
  };

  if (shape === "ribbon") {
    // Stakeholder #6 — the ribbon is a solid colour block (default red),
    // NOT scheme-derived; badges.ribbonColor overrides.
    style.background = badges.ribbonColor || "#dc2626";
    style.color = "#ffffff";
  } else if (shape === "rectangle") {
    // Secondary chips use a tight fixed radius; primary rectangles respect
    // the merchant's cornerRadius (byte-identical to before).
    style.borderRadius = opts.secondary
      ? "4px"
      : `${typeof badges.cornerRadius === "number" ? badges.cornerRadius : 4}px`;
  } else if (shape === "pill") {
    style.borderRadius = "9999px";
  }

  // Token order for rectangle/pill is kept byte-identical to the pre-§8.13
  // hardcoded string: `absolute <pos> px-2 py-0.5 text-xs font-medium`.
  const parts: string[] = ["absolute"];
  if (shape === "ribbon") {
    parts.push(
      "theme-badge-ribbon",
      RIBBON_CORNER[badges.position] ?? RIBBON_CORNER.top_right,
      "text-xs",
      "font-medium",
    );
  } else if (opts.secondary) {
    parts.push(positionClass, "px-1.5", "py-0.5", "text-[10px]", "font-semibold", "leading-none");
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

  return { label, className: parts.join(" "), style };
}

export interface CardBadgeInput {
  soldOut: boolean;
  isNew: boolean;
  onSale: boolean;
  // Rounded discount percentage for a `{percent}` placeholder; null when
  // not computable (e.g. an auto-discount with no clean origin price).
  discountPercent: number | null;
}

// Resolves the primary/secondary badge pair for one product card, with a
// deliberate hierarchy: sold-out wins outright; otherwise a discount is the
// dominant (primary) badge and NEW steps down to a small secondary chip in
// the opposite corner; NEW alone gets the full primary treatment. Returns
// {null, null} for an un-themed shop, where the caller keeps its legacy
// "Out of stock" pill.
export function resolveCardBadges(
  input: CardBadgeInput,
  badges: BadgeSettings | undefined,
  schemes: ColorScheme[] | undefined,
): { primary: ResolvedProductBadge | null; secondary: ResolvedProductBadge | null } {
  if (!badges) return { primary: null, secondary: null };
  if (input.soldOut) {
    return { primary: resolveProductBadge("sold_out", badges, schemes), secondary: null };
  }
  const sale = input.onSale
    ? resolveProductBadge("sale", badges, schemes, { discountPercent: input.discountPercent })
    : null;
  const isNew = input.isNew ? resolveProductBadge("new", badges, schemes) : null;
  if (sale && isNew) {
    return {
      primary: sale,
      secondary: resolveProductBadge("new", badges, schemes, { secondary: true }),
    };
  }
  return { primary: sale ?? isNew, secondary: null };
}
