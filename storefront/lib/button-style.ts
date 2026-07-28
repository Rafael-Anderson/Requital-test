import type { ButtonFill, ButtonRadius, Shop } from "./types";

// One global choice per shop (not per-button) — every class fragment below
// is a complete literal string in this file's source, which Tailwind v4's
// build-time scanner needs to see verbatim; building a class name at
// runtime via `` `border-${x}` `` would silently never compile, since the
// scanner can't execute code, only pattern-match file text.
const RADIUS_CLASS: Record<ButtonRadius, string> = {
  sharp: "rounded-none",
  rounded: "rounded-lg",
  pill: "rounded-full",
};

type ButtonKind = "button" | "add-to-cart";

const FILL_CLASS: Record<ButtonKind, Record<ButtonFill, string>> = {
  button: {
    solid: "bg-button text-button-foreground border-2 border-transparent hover:opacity-90",
    outline: "bg-transparent text-button border-2 border-button hover:bg-button/10",
  },
  "add-to-cart": {
    solid: "bg-add-to-cart-button text-add-to-cart-text border-2 border-transparent hover:opacity-90",
    outline: "bg-transparent text-add-to-cart-button border-2 border-add-to-cart-button hover:bg-add-to-cart-button/10",
  },
};

// kind: which CSS-var pair drives the color (Button Color vs Add to Cart
// Button Color — two distinct, independently merchant-set Appearance Color
// fields). radius/fill both come from the shop's single global choice
// either way — see the Theme Customizer v2 brief's "one global choice per
// shop, not per-button configuration."
export function storeButtonClassName(shop: Shop | null, kind: ButtonKind = "button"): string {
  const radius = RADIUS_CLASS[shop?.buttonRadius ?? "rounded"];
  const fill = FILL_CLASS[kind][shop?.buttonFill ?? "solid"];
  return `${radius} ${fill} transition-colors cursor-pointer disabled:opacity-50`;
}
