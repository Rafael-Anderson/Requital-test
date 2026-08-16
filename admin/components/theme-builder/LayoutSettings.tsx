"use client";

import PresetPicker from "@/components/PresetPicker";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import MenuBuilder from "@/components/MenuBuilder";
import {
  HomepageLayoutThumbnail,
  TopBarLayoutThumbnail,
  PdpLayoutThumbnail,
  CartLayoutThumbnail,
  CheckoutLayoutThumbnail,
  FooterLayoutThumbnail,
  DensityThumbnail,
  IconStyleThumbnail,
  ButtonStyleThumbnail,
} from "@/components/PresetThumbnails";
import {
  HOMEPAGE_LAYOUT_OPTIONS,
  HOME_TAB_MODE_OPTIONS,
  TOP_BAR_LAYOUT_OPTIONS,
  PDP_LAYOUT_OPTIONS,
  CART_LAYOUT_OPTIONS,
  CHECKOUT_LAYOUT_OPTIONS,
  FOOTER_LAYOUT_OPTIONS,
  HEADER_DENSITY_OPTIONS,
  FOOTER_DENSITY_OPTIONS,
  ICON_STYLE_OPTIONS,
  BUTTON_RADIUS_OPTIONS,
  BUTTON_FILL_OPTIONS,
} from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// Layout mode's 13 category components — a straight port of the old Theme
// Customizer's Advanced tab (app/theme/edit/advanced/page.tsx), each now
// its own single-field category matching Theme Settings mode's "pick one
// on the left, its control shows on the right" convention instead of one
// long scrolling page. Every one of these auto-saves immediately on
// selection (no separate Save button), same as a Toggle or Theme Settings'
// own category fields — there's exactly one control per category here.
// All backed by the legacy `themesettings` row, via the SAME shared
// editor.legacyTheme/editor.updateLegacyTheme instance every other panel in
// the builder already gets from useThemeEditor — not the new builder's own
// theme.config, and (as of 2026-08-16) no longer each component's own
// independent useLegacyTheme() call either. That per-component-independent
// fetch was exactly why none of these 13 categories ever reached the
// preview iframe: 13 separate hook instances meant no single piece of
// state PreviewFrame.tsx could watch and postMessage on change. See that
// file's own legacyTheme debounced-effect for the other half of this fix.

type LayoutSettingProps = { editor: ThemeEditorState };

export function HomeTabSetting({ editor }: LayoutSettingProps) {
  const { legacyTheme, updateLegacyTheme } = editor;
  if (!legacyTheme) return null;
  return <SegmentedToggle value={legacyTheme.homeTabMode} options={HOME_TAB_MODE_OPTIONS} onChange={(v) => void updateLegacyTheme({ homeTabMode: v })} />;
}

// Self-contained via its own API calls (own menu-item CRUD, not the
// legacy `themesettings` row) — takes the same { editor } prop as every
// other Layout category component for a uniform call site in
// SettingsPanel.tsx, but doesn't use it.
export function MenuSetting(_props: LayoutSettingProps) {
  return <MenuBuilder />;
}

export function HomepageLayoutSetting({ editor }: LayoutSettingProps) {
  const { legacyTheme, updateLegacyTheme } = editor;
  if (!legacyTheme) return null;
  return (
    <PresetPicker
      singleColumn
      options={HOMEPAGE_LAYOUT_OPTIONS}
      value={legacyTheme.homepageLayout}
      onChange={(key) => void updateLegacyTheme({ homepageLayout: key })}
      renderThumbnail={(key) => <HomepageLayoutThumbnail layout={key} />}
    />
  );
}

export function TopBarLayoutSetting({ editor }: LayoutSettingProps) {
  const { legacyTheme, updateLegacyTheme } = editor;
  if (!legacyTheme) return null;
  return (
    <PresetPicker
      singleColumn
      options={TOP_BAR_LAYOUT_OPTIONS}
      value={legacyTheme.topBarLayout}
      onChange={(key) => void updateLegacyTheme({ topBarLayout: key })}
      renderThumbnail={(key) => <TopBarLayoutThumbnail layout={key} />}
    />
  );
}

export function HeaderSizeSetting({ editor }: LayoutSettingProps) {
  const { legacyTheme, updateLegacyTheme } = editor;
  if (!legacyTheme) return null;
  return (
    <PresetPicker
      singleColumn
      options={HEADER_DENSITY_OPTIONS}
      value={legacyTheme.headerDensity}
      onChange={(key) => void updateLegacyTheme({ headerDensity: key })}
      renderThumbnail={(key) => <DensityThumbnail density={key} />}
    />
  );
}

export function FooterLayoutSetting({ editor }: LayoutSettingProps) {
  const { legacyTheme, updateLegacyTheme } = editor;
  if (!legacyTheme) return null;
  return (
    <PresetPicker
      singleColumn
      options={FOOTER_LAYOUT_OPTIONS}
      value={legacyTheme.footerLayout}
      onChange={(key) => void updateLegacyTheme({ footerLayout: key })}
      renderThumbnail={(key) => <FooterLayoutThumbnail layout={key} />}
    />
  );
}

export function FooterSizeSetting({ editor }: LayoutSettingProps) {
  const { legacyTheme, updateLegacyTheme } = editor;
  if (!legacyTheme) return null;
  return (
    <PresetPicker
      singleColumn
      options={FOOTER_DENSITY_OPTIONS}
      value={legacyTheme.footerDensity}
      onChange={(key) => void updateLegacyTheme({ footerDensity: key })}
      renderThumbnail={(key) => <DensityThumbnail density={key} />}
    />
  );
}

export function ProductPageLayoutSetting({ editor }: LayoutSettingProps) {
  const { legacyTheme, updateLegacyTheme } = editor;
  if (!legacyTheme) return null;
  return (
    <PresetPicker
      singleColumn
      options={PDP_LAYOUT_OPTIONS}
      value={legacyTheme.pdpLayout}
      onChange={(key) => void updateLegacyTheme({ pdpLayout: key })}
      renderThumbnail={(key) => <PdpLayoutThumbnail layout={key} />}
    />
  );
}

export function CartLayoutSetting({ editor }: LayoutSettingProps) {
  const { legacyTheme, updateLegacyTheme } = editor;
  if (!legacyTheme) return null;
  return (
    <PresetPicker
      singleColumn
      options={CART_LAYOUT_OPTIONS}
      value={legacyTheme.cartLayout}
      onChange={(key) => void updateLegacyTheme({ cartLayout: key })}
      renderThumbnail={(key) => <CartLayoutThumbnail layout={key} />}
    />
  );
}

export function CheckoutLayoutSetting({ editor }: LayoutSettingProps) {
  const { legacyTheme, updateLegacyTheme } = editor;
  if (!legacyTheme) return null;
  return (
    <PresetPicker
      singleColumn
      options={CHECKOUT_LAYOUT_OPTIONS}
      value={legacyTheme.checkoutLayout}
      onChange={(key) => void updateLegacyTheme({ checkoutLayout: key })}
      renderThumbnail={(key) => <CheckoutLayoutThumbnail layout={key} />}
    />
  );
}

export function IconStyleSetting({ editor }: LayoutSettingProps) {
  const { legacyTheme, updateLegacyTheme } = editor;
  if (!legacyTheme) return null;
  return (
    <PresetPicker
      singleColumn
      options={ICON_STYLE_OPTIONS}
      value={legacyTheme.iconStyle}
      onChange={(key) => void updateLegacyTheme({ iconStyle: key })}
      renderThumbnail={(key) => <IconStyleThumbnail style={key} />}
    />
  );
}

export function ButtonShapeSetting({ editor }: LayoutSettingProps) {
  const { legacyTheme, updateLegacyTheme } = editor;
  if (!legacyTheme) return null;
  return (
    <PresetPicker
      singleColumn
      options={BUTTON_RADIUS_OPTIONS}
      value={legacyTheme.buttonRadius}
      onChange={(key) => void updateLegacyTheme({ buttonRadius: key })}
      renderThumbnail={(key) => <ButtonStyleThumbnail radius={key} fill="solid" />}
    />
  );
}

export function ButtonFillSetting({ editor }: LayoutSettingProps) {
  const { legacyTheme, updateLegacyTheme } = editor;
  if (!legacyTheme) return null;
  return (
    <PresetPicker
      singleColumn
      options={BUTTON_FILL_OPTIONS}
      value={legacyTheme.buttonFill}
      onChange={(key) => void updateLegacyTheme({ buttonFill: key })}
      renderThumbnail={(key) => <ButtonStyleThumbnail radius="rounded" fill={key} />}
    />
  );
}
