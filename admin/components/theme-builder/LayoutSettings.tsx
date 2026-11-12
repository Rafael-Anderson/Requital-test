"use client";

import PresetPicker from "@/components/PresetPicker";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Toggle from "@/components/ui/Toggle";
import MenuBuilder from "@/components/MenuBuilder";
import {
  HomepageLayoutThumbnail,
  HomepagePresetThumbnail,
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
import { HOMEPAGE_PRESETS, type ThemeEditorState } from "@/lib/useThemeEditor";

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

// SegmentedToggle is string-valued only — columns are converted to/from a
// number at the call site below rather than widening a shared component's
// generic constraint for one caller.
const COLLECTIONS_GRID_COLUMN_OPTIONS = [
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
];
const COLLECTIONS_GRID_GAP_OPTIONS = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
];
const COLLECTIONS_GRID_ASPECT_RATIO_OPTIONS = [
  { value: "square", label: "Square" },
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

export function HomeTabSetting({ editor }: LayoutSettingProps) {
  const { legacyTheme, updateLegacyTheme, applyHomepagePreset, builderContext } = editor;
  if (!legacyTheme) return null;
  // In Sections mode only the preset picker does anything: it rewrites theme.config.sections. The
  // Templates / Collections toggle and the collections grid are read only by the legacy homepage,
  // so they are not shown there (lib/theme-builder-registry.ts, "Home tab").
  const presets = (
    <div>
      <p className="mb-2 text-xs text-zinc-500">
        Start from a preset section arrangement; edit it further in the Sections tab afterward.
      </p>
      <PresetPicker
        singleColumn
        options={HOMEPAGE_PRESETS.map((p) => ({ key: p.key, label: p.label }))}
        value=""
        onChange={(key) => applyHomepagePreset(key)}
        renderThumbnail={(key) => <HomepagePresetThumbnail preset={key as (typeof HOMEPAGE_PRESETS)[number]["key"]} />}
      />
    </div>
  );
  if (builderContext.sectionsMode) return <div className="space-y-4">{presets}</div>;
  return (
    <div className="space-y-4">
      <SegmentedToggle value={legacyTheme.homeTabMode} options={HOME_TAB_MODE_OPTIONS} onChange={(v) => void updateLegacyTheme({ homeTabMode: v })} />

      {legacyTheme.homeTabMode === "templates" ? (
        presets
      ) : (
        <div className="space-y-4">
          <div>
            <span className="mb-1.5 block text-xs font-medium text-zinc-500">Columns</span>
            <SegmentedToggle
              value={String(legacyTheme.collectionsGridColumns)}
              options={COLLECTIONS_GRID_COLUMN_OPTIONS}
              onChange={(v) => void updateLegacyTheme({ collectionsGridColumns: Number(v) })}
            />
          </div>
          <div>
            <span className="mb-1.5 block text-xs font-medium text-zinc-500">Gap</span>
            <SegmentedToggle
              value={legacyTheme.collectionsGridGap}
              options={COLLECTIONS_GRID_GAP_OPTIONS}
              onChange={(v) => void updateLegacyTheme({ collectionsGridGap: v })}
            />
          </div>
          <div>
            <span className="mb-1.5 block text-xs font-medium text-zinc-500">Image aspect ratio</span>
            <SegmentedToggle
              value={legacyTheme.collectionsGridImageAspectRatio}
              options={COLLECTIONS_GRID_ASPECT_RATIO_OPTIONS}
              onChange={(v) => void updateLegacyTheme({ collectionsGridImageAspectRatio: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Show collection title</span>
            <Toggle
              checked={legacyTheme.collectionsGridShowTitle}
              onChange={(v) => void updateLegacyTheme({ collectionsGridShowTitle: v })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Self-contained via its own API calls (own menu-item CRUD, not the
// legacy `themesettings` row) — takes the same { editor } prop as every
// other Layout category component for a uniform call site in
// SettingsPanel.tsx, but does not use it. Applies in both modes (see the registry):
// the menu-item CRUD it drives (backend menu/ module) powers MenuBar.tsx on
// the storefront regardless of which homepage system is active — it's a
// genuinely separate, still-live feature, not a dead legacy control.
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
