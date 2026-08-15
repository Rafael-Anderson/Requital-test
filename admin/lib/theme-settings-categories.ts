// The 18 Theme Settings categories, in the confirmed spec order — the
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
] as const;
