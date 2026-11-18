"use client";

import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import ElementSettingsPanel from "./ElementSettingsPanel";
import LogoSettings from "./theme-settings/LogoSettings";
import ColorsSettings from "./theme-settings/ColorsSettings";
import TypographySettings from "./theme-settings/TypographySettings";
import PageLayoutSettings from "./theme-settings/PageLayoutSettings";
import RadiusSettings from "./theme-settings/RadiusSettings";
import DensitySettings from "./theme-settings/DensitySettings";
import AnimationsSettings from "./theme-settings/AnimationsSettings";
import MotionSettings from "./theme-settings/MotionSettings";
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
import CollectionPageSettings from "./theme-settings/CollectionPageSettings";
import ProductPageSettings from "./theme-settings/ProductPageSettings";
import FloatingElementsSettings from "./theme-settings/FloatingElementsSettings";
import AnnouncementBarChromeSettings from "./settings/AnnouncementBarChromeSettings";
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
import BrandsSettings from "./settings/BrandsSettings";
import ProductTabsSettings from "./settings/ProductTabsSettings";
import TrustBarSettings from "./settings/TrustBarSettings";
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
  IconStyleSetting,
  ButtonShapeSetting,
  ButtonFillSetting,
} from "./LayoutSettings";
import { type AnnouncementBarConfig, type ThemeSectionType } from "@/lib/types";
import type { LayoutEntryId } from "@/lib/theme-builder-registry";
import type { PanelEntry } from "@/lib/theme-builder-panel";
import { schemeColorPresets } from "@/lib/scheme-color-presets";
import { THEME_SETTINGS_CATEGORY_LABELS } from "@/lib/theme-settings-categories";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

type SectionSettingsProps = {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
  // Optional, passed to every section settings component generically; none
  // read it today (HeroSettings used to, for the now-deleted "Classic
  // homepage banner" sub-panel). Kept as a ready hook for a section settings
  // form that needs cross-editor state.
  editor?: ThemeEditorState;
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
  brands: BrandsSettings,
  product_tabs: ProductTabsSettings,
  trust_bar: TrustBarSettings,
};

// The 18 Theme Settings categories, in the confirmed spec order — keyed by
// the same labels the Design / Settings tabs list (lib/theme-builder-panel.ts), so
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
  Radius: RadiusSettings,
  Density: DensitySettings,
  Animations: AnimationsSettings,
  Motion: MotionSettings,
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
  "Collection page": CollectionPageSettings,
  "Product page": ProductPageSettings,
  "Floating elements": FloatingElementsSettings,
};

// Layout mode's 13 categories — a straight port of the old Theme
// Customizer's Advanced tab into the same left-list/right-detail pattern,
// each backed by the legacy `themesettings` row (useLegacyTheme), not
// theme.config. Menu/Home tab don't take an editor prop (self-contained via
// their own API calls), so this map is prop-less rather than reusing
// THEME_SETTINGS_COMPONENTS' `{ editor }` shape.
const LAYOUT_COMPONENTS: Record<LayoutEntryId, ComponentType<{ editor: ThemeEditorState }>> = {
  "Home tab": HomeTabSetting,
  Menu: MenuSetting,
  "Homepage layout": HomepageLayoutSetting,
  "Top bar layout": TopBarLayoutSetting,
  "Header size": HeaderSizeSetting,
  "Footer layout": FooterLayoutSetting,
  "Footer size": FooterSizeSetting,
  "Product page layout": ProductPageLayoutSetting,
  "Cart layout": CartLayoutSetting,
  "Icon style": IconStyleSetting,
  "Button shape": ButtonShapeSetting,
  "Button fill": ButtonFillSetting,
};

// Scrolls to and briefly highlights the field a global search result pointed at. The result
// carries the field's label; the panel's direct field children (each settings component renders a
// flat list of fields under one root) are matched on their text, so no per-field wiring is needed.
// Runs after the panel for the new selection has rendered. A missing label just leaves the panel
// at its top.
const HIGHLIGHT_CLASS = "theme-search-highlight";
function useScrollToSetting(containerRef: React.RefObject<HTMLDivElement | null>, editor: ThemeEditorState, contentKey: unknown) {
  const { scrollRequest, setScrollRequest } = editor;
  useEffect(() => {
    if (!scrollRequest) return;
    const root = containerRef.current;
    if (!root) return;
    const label = scrollRequest.label?.trim().toLowerCase();
    const fieldContainer = root.children.length === 1 ? root.children[0] : root;
    let target: HTMLElement | null = null;
    if (label) {
      for (const child of Array.from(fieldContainer.children)) {
        const el = child as HTMLElement;
        if ((el.textContent ?? "").toLowerCase().includes(label)) {
          target = el;
          break;
        }
      }
    }
    setScrollRequest(null);
    if (!target) return;
    target.scrollIntoView?.({ block: "center", behavior: "smooth" });
    target.classList.add(HIGHLIGHT_CLASS);
    const t = setTimeout(() => target?.classList.remove(HIGHLIGHT_CLASS), 1800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest, contentKey]);
}

// Wraps every drill-in body, so a search result can scroll to its field.
function FilterableSettingsBody({
  editor,
  contentKey,
  children,
}: {
  editor: ThemeEditorState;
  contentKey: unknown;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useScrollToSetting(bodyRef, editor, contentKey);
  return <div ref={bodyRef}>{children}</div>;
}

/** The body of a Design / Settings drill-in: that entry's existing settings form, unchanged. */
export function EntrySettingsBody({ editor, entry }: { editor: ThemeEditorState; entry: PanelEntry }) {
  if (entry.kind === "theme") {
    const Component = THEME_SETTINGS_COMPONENTS[entry.category];
    return (
      <FilterableSettingsBody editor={editor} contentKey={`theme:${entry.category}`}>
        <Component editor={editor} />
      </FilterableSettingsBody>
    );
  }
  const Component = LAYOUT_COMPONENTS[entry.id];
  return (
    <FilterableSettingsBody editor={editor} contentKey={`layout:${entry.id}`}>
      <Component editor={editor} />
    </FilterableSettingsBody>
  );
}

/**
 * The body of a Sections drill-in for the selected node: the announcement bar, Header or Footer
 * chrome, a section (its own settings form), or a block (ElementSettingsPanel). Null when nothing
 * resolvable is selected.
 */
export function NodeSettingsBody({ editor }: { editor: ThemeEditorState }) {
  const { config, selection } = editor;
  if (!config || !selection) return null;

  if (selection.kind === "announcement") {
    return (
      <FilterableSettingsBody editor={editor} contentKey="announcement">
        <AnnouncementBarChromeSettings
          value={config.header.settings.announcementBar as AnnouncementBarConfig | undefined}
          onChange={editor.updateAnnouncementBar}
          colorPresets={schemeColorPresets(config.globalSettings.colorSchemes)}
          position={config.header.settings.announcementPosition as string | undefined}
          onPositionChange={(v) => editor.updateHeaderSetting("announcementPosition", v)}
        />
      </FilterableSettingsBody>
    );
  }

  if (selection.kind === "header") {
    return (
      <FilterableSettingsBody editor={editor} contentKey="header">
        <HeaderSettings
          settings={config.header.settings}
          blocks={config.header.blocks}
          onUpdate={editor.updateHeaderSetting}
          onApplyPreset={editor.applyHeaderPreset}
          colorPresets={schemeColorPresets(config.globalSettings.colorSchemes)}
        />
      </FilterableSettingsBody>
    );
  }

  if (selection.kind === "footer") {
    return (
      <FilterableSettingsBody editor={editor} contentKey="footer">
        <FooterSettings settings={config.footer.settings} onUpdate={editor.updateFooterSetting} onApplyPreset={editor.applyFooterPreset} />
      </FilterableSettingsBody>
    );
  }

  if (selection.kind === "section") {
    const { section } = selection;
    const SettingsComponent = SECTION_SETTINGS_COMPONENTS[section.type];
    return (
      <FilterableSettingsBody editor={editor} contentKey={`section:${section.id}`}>
        <SettingsComponent settings={section.settings} onUpdate={(key, value) => editor.updateSectionSetting(section.id, key, value)} editor={editor} />
      </FilterableSettingsBody>
    );
  }

  const { block, container } = selection;
  return (
    <FilterableSettingsBody editor={editor} contentKey={`block:${block.id}`}>
      <ElementSettingsPanel
        block={block}
        container={container}
        colorPresets={schemeColorPresets(config.globalSettings.colorSchemes)}
        onUpdate={(key, value) => editor.updateBlockSetting(container, block.id, key, value)}
        onToggleVisibility={() => editor.toggleBlockVisibility(container, block.id)}
      />
    </FilterableSettingsBody>
  );
}
