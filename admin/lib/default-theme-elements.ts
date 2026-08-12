import type { ThemeElement } from "@/lib/types";

// Seeds for a theme that hasn't had its elements dragged yet — mirror the
// fixed layout storefront/components/theme-sections/ThemeDrivenHeader.tsx
// and HeroSection.tsx already render when `elements` is empty/undefined, so
// dragging one element for the first time doesn't visually jump anything
// else. Zone labels differ per section (Header: horizontal Left/Center/
// Right; Hero: vertical Top/Middle/Bottom, matching how its heading/
// subheading/CTA actually stack) — see ElementDragZone's `zones` prop.
export const DEFAULT_HEADER_ELEMENTS: ThemeElement[] = [
  { id: "logo", type: "logo", position: { zone: "left" }, settings: {} },
  { id: "search", type: "search", position: { zone: "right" }, settings: {} },
  { id: "cart", type: "cart", position: { zone: "right" }, settings: {} },
  { id: "account", type: "account", position: { zone: "right" }, settings: {} },
];

export const HEADER_ZONES = [
  { key: "left", label: "Left" },
  { key: "center", label: "Center" },
  { key: "right", label: "Right" },
];

export const DEFAULT_HERO_ELEMENTS: ThemeElement[] = [
  { id: "heading", type: "heading", position: { zone: "top" }, settings: {} },
  { id: "subheading", type: "subheading", position: { zone: "middle" }, settings: {} },
  { id: "cta", type: "cta", position: { zone: "bottom" }, settings: {} },
];

export const HERO_ZONES = [
  { key: "top", label: "Top" },
  { key: "middle", label: "Middle" },
  { key: "bottom", label: "Bottom" },
];

export const ELEMENT_LABELS: Record<string, string> = {
  logo: "Logo",
  search: "Search",
  cart: "Cart",
  account: "Account",
  heading: "Heading",
  subheading: "Subheading",
  cta: "CTA button",
};
