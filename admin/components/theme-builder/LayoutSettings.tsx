"use client";

import { useLegacyTheme } from "@/lib/useLegacyTheme";
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

// Layout mode's 13 category components — a straight port of the old Theme
// Customizer's Advanced tab (app/theme/edit/advanced/page.tsx), each now
// its own single-field category matching Theme Settings mode's "pick one
// on the left, its control shows on the right" convention instead of one
// long scrolling page. Every one of these auto-saves immediately on
// selection (no separate Save button), same as a Toggle or Theme Settings'
// own category fields — there's exactly one control per category here.
// All backed by the legacy `themesettings` row (useLegacyTheme), not the
// new builder's own theme.config.

export function HomeTabSetting() {
  const { theme, save } = useLegacyTheme();
  if (!theme) return null;
  return <SegmentedToggle value={theme.homeTabMode} options={HOME_TAB_MODE_OPTIONS} onChange={(v) => void save({ homeTabMode: v })} />;
}

export function MenuSetting() {
  return <MenuBuilder />;
}

export function HomepageLayoutSetting() {
  const { theme, save } = useLegacyTheme();
  if (!theme) return null;
  return (
    <PresetPicker
      singleColumn
      options={HOMEPAGE_LAYOUT_OPTIONS}
      value={theme.homepageLayout}
      onChange={(key) => void save({ homepageLayout: key })}
      renderThumbnail={(key) => <HomepageLayoutThumbnail layout={key} />}
    />
  );
}

export function TopBarLayoutSetting() {
  const { theme, save } = useLegacyTheme();
  if (!theme) return null;
  return (
    <PresetPicker
      singleColumn
      options={TOP_BAR_LAYOUT_OPTIONS}
      value={theme.topBarLayout}
      onChange={(key) => void save({ topBarLayout: key })}
      renderThumbnail={(key) => <TopBarLayoutThumbnail layout={key} />}
    />
  );
}

export function HeaderSizeSetting() {
  const { theme, save } = useLegacyTheme();
  if (!theme) return null;
  return (
    <PresetPicker
      singleColumn
      options={HEADER_DENSITY_OPTIONS}
      value={theme.headerDensity}
      onChange={(key) => void save({ headerDensity: key })}
      renderThumbnail={(key) => <DensityThumbnail density={key} />}
    />
  );
}

export function FooterLayoutSetting() {
  const { theme, save } = useLegacyTheme();
  if (!theme) return null;
  return (
    <PresetPicker
      singleColumn
      options={FOOTER_LAYOUT_OPTIONS}
      value={theme.footerLayout}
      onChange={(key) => void save({ footerLayout: key })}
      renderThumbnail={(key) => <FooterLayoutThumbnail layout={key} />}
    />
  );
}

export function FooterSizeSetting() {
  const { theme, save } = useLegacyTheme();
  if (!theme) return null;
  return (
    <PresetPicker
      singleColumn
      options={FOOTER_DENSITY_OPTIONS}
      value={theme.footerDensity}
      onChange={(key) => void save({ footerDensity: key })}
      renderThumbnail={(key) => <DensityThumbnail density={key} />}
    />
  );
}

export function ProductPageLayoutSetting() {
  const { theme, save } = useLegacyTheme();
  if (!theme) return null;
  return (
    <PresetPicker
      singleColumn
      options={PDP_LAYOUT_OPTIONS}
      value={theme.pdpLayout}
      onChange={(key) => void save({ pdpLayout: key })}
      renderThumbnail={(key) => <PdpLayoutThumbnail layout={key} />}
    />
  );
}

export function CartLayoutSetting() {
  const { theme, save } = useLegacyTheme();
  if (!theme) return null;
  return (
    <PresetPicker
      singleColumn
      options={CART_LAYOUT_OPTIONS}
      value={theme.cartLayout}
      onChange={(key) => void save({ cartLayout: key })}
      renderThumbnail={(key) => <CartLayoutThumbnail layout={key} />}
    />
  );
}

export function CheckoutLayoutSetting() {
  const { theme, save } = useLegacyTheme();
  if (!theme) return null;
  return (
    <PresetPicker
      singleColumn
      options={CHECKOUT_LAYOUT_OPTIONS}
      value={theme.checkoutLayout}
      onChange={(key) => void save({ checkoutLayout: key })}
      renderThumbnail={(key) => <CheckoutLayoutThumbnail layout={key} />}
    />
  );
}

export function IconStyleSetting() {
  const { theme, save } = useLegacyTheme();
  if (!theme) return null;
  return (
    <PresetPicker
      singleColumn
      options={ICON_STYLE_OPTIONS}
      value={theme.iconStyle}
      onChange={(key) => void save({ iconStyle: key })}
      renderThumbnail={(key) => <IconStyleThumbnail style={key} />}
    />
  );
}

export function ButtonShapeSetting() {
  const { theme, save } = useLegacyTheme();
  if (!theme) return null;
  return (
    <PresetPicker
      singleColumn
      options={BUTTON_RADIUS_OPTIONS}
      value={theme.buttonRadius}
      onChange={(key) => void save({ buttonRadius: key })}
      renderThumbnail={(key) => <ButtonStyleThumbnail radius={key} fill="solid" />}
    />
  );
}

export function ButtonFillSetting() {
  const { theme, save } = useLegacyTheme();
  if (!theme) return null;
  return (
    <PresetPicker
      singleColumn
      options={BUTTON_FILL_OPTIONS}
      value={theme.buttonFill}
      onChange={(key) => void save({ buttonFill: key })}
      renderThumbnail={(key) => <ButtonStyleThumbnail radius="rounded" fill={key} />}
    />
  );
}
