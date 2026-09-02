// The 18 Theme Settings categories (+ "Collection page", storefront-v2
// Phase 2C/2D — governs the standalone collection detail page, which isn't
// composed of theme sections so it needs its own global category), in the
// confirmed spec order — the
// single source of truth for both the left-column category list
// (components/theme-builder/ThemeSettingsList.tsx) and the right panel's
// label-to-form dispatch (components/theme-builder/SettingsPanel.tsx), so
// the two can never drift out of order with each other.
export const THEME_SETTINGS_CATEGORY_LABELS = [
  "Logo and favicon",
  "Colors",
  "Typography",
  "Page layout",
  "Animations",
  "Badges",
  "Buttons",
  "Cart",
  "Drawers",
  "Icons",
  "Input fields",
  "Popovers and modals",
  "Prices",
  "Product cards",
  "Search",
  "Swatches",
  "Variant pickers",
  "Custom CSS",
  "Collection page",
  "Product page",
  "Floating elements",
] as const;
