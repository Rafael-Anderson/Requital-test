"use client";

import type { ComponentType } from "react";
import ElementSettingsPanel from "./ElementSettingsPanel";
import LogoSettings from "./theme-settings/LogoSettings";
import ColorsSettings from "./theme-settings/ColorsSettings";
import TypographySettings from "./theme-settings/TypographySettings";
import PageLayoutSettings from "./theme-settings/PageLayoutSettings";
import AnimationsSettings from "./theme-settings/AnimationsSettings";
import BadgesSettings from "./theme-settings/BadgesSettings";
import ButtonsSettings from "./theme-settings/ButtonsSettings";
import CartSettings from "./theme-settings/CartSettings";
import DrawersSettings from "./theme-settings/DrawersSettings";
import IconsSettings from "./theme-settings/IconsSettings";
import InputFieldsSettings from "./theme-settings/InputFieldsSettings";
import PopoversSettings from "./theme-settings/PopoversSettings";
import PricesSettings from "./theme-settings/PricesSettings";
import ProductCardsSettings from "./theme-settings/ProductCardsSettings";
import SearchSettings from "./theme-settings/SearchSettings";
import SwatchesSettings from "./theme-settings/SwatchesSettings";
import VariantPickersSettings from "./theme-settings/VariantPickersSettings";
import CustomCssSettings from "./theme-settings/CustomCssSettings";
import HeaderSettings from "./settings/HeaderSettings";
import FooterSettings from "./settings/FooterSettings";
import HeroSettings from "./settings/HeroSettings";
import FeaturedCollectionsSettings from "./settings/FeaturedCollectionsSettings";
import ProductGridSettings from "./settings/ProductGridSettings";
import TestimonialsSettings from "./settings/TestimonialsSettings";
import RichTextSettings from "./settings/RichTextSettings";
import ImageTextSettings from "./settings/ImageTextSettings";
import NewsletterSettings from "./settings/NewsletterSettings";
import AnnouncementBarSettings from "./settings/AnnouncementBarSettings";
import {
  HomeTabSetting,
  MenuSetting,
  HomepageLayoutSetting,
  TopBarLayoutSetting,
  HeaderSizeSetting,
  FooterLayoutSetting,
  FooterSizeSetting,
  ProductPageLayoutSetting,
  CartLayoutSetting,
  CheckoutLayoutSetting,
  IconStyleSetting,
  ButtonShapeSetting,
  ButtonFillSetting,
} from "./LayoutSettings";
import { SECTION_TYPE_LABELS, type ThemeSectionType } from "@/lib/types";
import { THEME_SETTINGS_CATEGORY_LABELS } from "@/lib/theme-settings-categories";
import { THEME_LAYOUT_CATEGORY_LABELS } from "@/lib/theme-layout-categories";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

type SectionSettingsProps = {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
};

const SECTION_SETTINGS_COMPONENTS: Record<ThemeSectionType, ComponentType<SectionSettingsProps>> = {
  announcement_bar: AnnouncementBarSettings,
  hero: HeroSettings,
  featured_collections: FeaturedCollectionsSettings,
  product_grid: ProductGridSettings,
  testimonials: TestimonialsSettings,
  rich_text: RichTextSettings,
  image_text: ImageTextSettings,
  newsletter: NewsletterSettings,
};

// The 18 Theme Settings categories, in the confirmed spec order — keyed by
// the same labels ThemeSettingsList.tsx renders as the left column, so
// clicking one there shows its form here, exactly like selecting a section
// or block does in Sections mode. Each category's label is also what
// SchemePicker's "Edit scheme" jump link (in Badges/Drawers/Popovers)
// targets via setThemeSettingsCategory("Colors").
const THEME_SETTINGS_COMPONENTS: Record<
  (typeof THEME_SETTINGS_CATEGORY_LABELS)[number],
  ComponentType<{ editor: ThemeEditorState }>
> = {
  "Logo and favicon": LogoSettings,
  Colors: ColorsSettings,
  Typography: TypographySettings,
  "Page layout": PageLayoutSettings,
  Animations: AnimationsSettings,
  Badges: BadgesSettings,
  Buttons: ButtonsSettings,
  Cart: CartSettings,
  Drawers: DrawersSettings,
  Icons: IconsSettings,
  "Input fields": InputFieldsSettings,
  "Popovers and modals": PopoversSettings,
  Prices: PricesSettings,
  "Product cards": ProductCardsSettings,
  Search: SearchSettings,
  Swatches: SwatchesSettings,
  "Variant pickers": VariantPickersSettings,
  "Custom CSS": CustomCssSettings,
};

// Layout mode's 13 categories — a straight port of the old Theme
// Customizer's Advanced tab into the same left-list/right-detail pattern,
// each backed by the legacy `themesettings` row (useLegacyTheme), not
// theme.config. Menu/Home tab don't take an editor prop (self-contained via
// their own API calls), so this map is prop-less rather than reusing
// THEME_SETTINGS_COMPONENTS' `{ editor }` shape.
const LAYOUT_COMPONENTS: Record<(typeof THEME_LAYOUT_CATEGORY_LABELS)[number], ComponentType<{ editor: ThemeEditorState }>> = {
  "Home tab": HomeTabSetting,
  Menu: MenuSetting,
  "Homepage layout": HomepageLayoutSetting,
  "Top bar layout": TopBarLayoutSetting,
  "Header size": HeaderSizeSetting,
  "Footer layout": FooterLayoutSetting,
  "Footer size": FooterSizeSetting,
  "Product page layout": ProductPageLayoutSetting,
  "Cart layout": CartLayoutSetting,
  "Checkout layout": CheckoutLayoutSetting,
  "Icon style": IconStyleSetting,
  "Button shape": ButtonShapeSetting,
  "Button fill": ButtonFillSetting,
};

// Dispatches on editorMode first (sections / theme settings / layout), then
// — in sections mode — on the selected tree node: Header/Footer chrome, a
// section (shared controls + that type's own settings, content fields now
// live on blocks), a block (BlockSettingsForm's per-type dispatch), or
// nothing selected (a hint to pick something in the tree). In theme
// settings/layout mode, the selected category (ThemeSettingsList.tsx/
// LayoutList.tsx's left column) dispatches the same way a tree selection
// does.
export default function SettingsPanel({ editor }: { editor: ThemeEditorState }) {
  const { config, selection } = editor;
  if (!config) return null;

  if (editor.editorMode === "theme_settings") {
    const category = editor.themeSettingsCategory;
    if (!category) {
      return <p className="p-4 text-sm text-zinc-500">Select a category on the left to edit it.</p>;
    }
    const Component = THEME_SETTINGS_COMPONENTS[category as (typeof THEME_SETTINGS_CATEGORY_LABELS)[number]];
    return (
      <div className="p-4">
        <h2 className="mb-4 text-sm font-semibold">{category}</h2>
        <Component editor={editor} />
      </div>
    );
  }

  if (editor.editorMode === "layout") {
    const category = editor.layoutCategory;
    if (!category) {
      return <p className="p-4 text-sm text-zinc-500">Select a category on the left to edit it.</p>;
    }
    const Component = LAYOUT_COMPONENTS[category as (typeof THEME_LAYOUT_CATEGORY_LABELS)[number]];
    return (
      <div className="p-4">
        <h2 className="mb-4 text-sm font-semibold">{category}</h2>
        <Component editor={editor} />
      </div>
    );
  }

  if (!selection) {
    return <p className="p-4 text-sm text-zinc-500">Select a section or block on the left to edit it.</p>;
  }

  if (selection.kind === "header") {
    return (
      <div className="p-4">
        <h2 className="mb-4 text-sm font-semibold">Header</h2>
        <HeaderSettings settings={config.header.settings} onUpdate={editor.updateHeaderSetting} />
      </div>
    );
  }

  if (selection.kind === "footer") {
    return (
      <div className="p-4">
        <h2 className="mb-4 text-sm font-semibold">Footer</h2>
        <FooterSettings settings={config.footer.settings} onUpdate={editor.updateFooterSetting} />
      </div>
    );
  }

  if (selection.kind === "section") {
    const { section } = selection;
    const SettingsComponent = SECTION_SETTINGS_COMPONENTS[section.type];
    return (
      <div className="p-4">
        <h2 className="mb-4 text-sm font-semibold">{SECTION_TYPE_LABELS[section.type]}</h2>
        <SettingsComponent settings={section.settings} onUpdate={(key, value) => editor.updateSectionSetting(section.id, key, value)} />
      </div>
    );
  }

  const { block, container } = selection;
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Block settings</h2>
      </div>
      <ElementSettingsPanel
        block={block}
        onUpdate={(key, value) => editor.updateBlockSetting(container, block.id, key, value)}
        onToggleVisibility={() => editor.toggleBlockVisibility(container, block.id)}
      />
    </div>
  );
}
