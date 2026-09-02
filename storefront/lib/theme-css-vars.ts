// Pure CSS-var resolution for per-shop theming — no DOM access, no React —
// so it can run both client-side (ShopProvider's applyTheme, see
// shop-context.tsx) AND server-side (app/[shop]/layout.tsx emits these as a
// pre-paint <style> so the first render, including StorefrontLoadingSkeleton,
// already uses the shop's real colors instead of flashing the light default).
// Moved out of shop-context.tsx purely so a Server Component can import it
// without pulling in that "use client" module.
//
// No OS prefers-color-scheme handling here (there was, briefly — removed, see
// the storefront dark-mode-mismatch bug report). --background is just another
// entry in WIRED_THEME_COLOR_FIELDS now (Page Background Color, defaulting to
// white), always resolved from the merchant's own setting, never a visitor's
// OS preference the shop never opted into.
import { getReadableTextColor } from "./color-contrast";
import { parseJsonField } from "./notification-text";
import { WIRED_THEME_COLOR_FIELDS } from "./theme-colors";
import type { Shop } from "./types";

const DEFAULT_ACCENT = "#069494";
const DEFAULT_ACCENT_HOVER = "#057a7a";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function darken(hex: string, amount = 0.15): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const channel = (shift: number) => {
    const value = Math.round(((num >> shift) & 255) * (1 - amount));
    return Math.max(0, value).toString(16).padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

export function resolveThemeCssVars(shop: Shop | null): Record<string, string> {
  const accent = shop?.brandColor && HEX_COLOR.test(shop.brandColor) ? shop.brandColor : DEFAULT_ACCENT;
  const accentHover =
    shop?.secondaryColor && HEX_COLOR.test(shop.secondaryColor) ? shop.secondaryColor : darken(accent) || DEFAULT_ACCENT_HOVER;

  const vars: Record<string, string> = {
    "--color-accent": accent,
    "--color-accent-hover": accentHover,
    "--color-accent-foreground": getReadableTextColor(accent),
    "--font-sans": `var(--font-${shop?.fontFamily ?? "inter"})`,
  };

  // Granular Appearance Color overrides — only the fields with a real
  // storefront element to apply to (see theme-colors.ts). themesettings.colors
  // was LONGTEXT, not real JSON, until
  // 20260816140000_fix_contact_numbers_colors_columns — see that
  // migration's comment (same bug class as notificationText, PR #44).
  const colors = parseJsonField<Record<string, string>>(shop?.colors, {});
  for (const field of WIRED_THEME_COLOR_FIELDS) {
    const override = colors[field.key];
    // "currentColor" (mouseOverColor's default) is a valid CSS color keyword
    // but not a hex — pass a non-hex default straight through rather than
    // running it past the HEX_COLOR guard, which only exists to reject
    // garbage merchant input.
    vars[field.cssVar] = override && HEX_COLOR.test(override) ? override : field.default;
  }

  // Add to Cart Text is the one exception among the wired fields: an
  // explicit override is honored (handled by the loop above), but an unset
  // value falls back to the same auto-contrast guard as --color-accent-
  // foreground (never a hardcoded white) rather than its own static default.
  const addToCartButton =
    colors.addToCartButtonColor && HEX_COLOR.test(colors.addToCartButtonColor) ? colors.addToCartButtonColor : "#069494";
  if (!(colors.addToCartTextColor && HEX_COLOR.test(colors.addToCartTextColor))) {
    vars["--color-add-to-cart-text"] = getReadableTextColor(addToCartButton);
  }

  // Derived (not a saved field of its own), same pattern as
  // --color-accent-foreground — auto-contrast text for bg-button, so a
  // merchant picking a near-white Button Color can't ship unreadable text.
  const buttonColor = colors.buttonColor && HEX_COLOR.test(colors.buttonColor) ? colors.buttonColor : "#069494";
  vars["--color-button-foreground"] = getReadableTextColor(buttonColor);

  return vars;
}
