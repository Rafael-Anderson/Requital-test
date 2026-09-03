"use client";

import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import EmptyState from "@/components/ui/EmptyState";
import ElementSettingsPanel from "./ElementSettingsPanel";
import LogoSettings from "./theme-settings/LogoSettings";
import ColorsSettings from "./theme-settings/ColorsSettings";
import TypographySettings from "./theme-settings/TypographySettings";
import PageLayoutSettings from "./theme-settings/PageLayoutSettings";
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

// Purely client-side DOM filtering (storefront-v2 Phase 4A) — no data
// changes, no per-field wiring across the ~30 differently-authored
// settings components this panel dispatches to. Every one of them already
// follows the same flat convention (a `space-y-4` root whose direct
// children are each one field/divider/sub-group — confirmed by reading
// ProductCardsSettings/CollectionPageSettings/AnimationsSettings/
// HeaderSettings/etc.), so filtering by each direct child's own
// textContent against the query is a real generalization, not a hack tied
// to one form's markup. A divider (<hr>, no text of its own) always hides
// while a query is active — a lone floating rule with nothing left under it
// reads as more broken than briefly hidden. A header nested together with
// its own fields in one wrapper div (e.g. Product Cards' "Media" group)
// naturally stays visible whenever any of its children's label text
// matches, since textContent concatenates the whole subtree — no separate
// header/divider-matching logic needed for that shape.
function useSettingsSearchFilter(containerRef: React.RefObject<HTMLDivElement | null>, query: string, contentKey: unknown) {
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    // Every settings component in this family renders its fields as the
    // direct children of its own single root wrapper div (`space-y-4`),
    // which is itself the one child of the ref'd container here — so the
    // real field list to filter is one level down, not root.children
    // itself (that's just [Component's root div]).
    const fieldContainer = root.children.length === 1 ? root.children[0] : root;
    const q = query.trim().toLowerCase();
    for (const child of Array.from(fieldContainer.children)) {
      const el = child as HTMLElement;
      if (!q) {
        el.style.display = "";
        continue;
      }
      if (el.tagName === "HR") {
        el.style.display = "none";
        continue;
      }
      const text = (el.textContent ?? "").toLowerCase();
      el.style.display = text.includes(q) ? "" : "none";
    }
    // contentKey (whichever category/section/block is currently rendered)
    // forces a re-filter when the panel's content swaps out but the query
    // string itself hasn't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, contentKey]);
}

// Wraps every SettingsPanel branch's body in one shared filtered container —
// the search input itself lives in PreviewFrame.tsx's toolbar now, next to
// the Preview page selector; editor.settingsSearchQuery is the shared state
// connecting that input to this filter.
function FilterableSettingsBody({
  editor,
  contentKey,
  heading,
  children,
}: {
  editor: ThemeEditorState;
  contentKey: unknown;
  heading: ReactNode;
  children: ReactNode;
}) {
  const { settingsSearchQuery: query, setSettingsSearchQuery: setQuery } = editor;
  const bodyRef = useRef<HTMLDivElement>(null);
  useSettingsSearchFilter(bodyRef, query, contentKey);
  // Reset the search whenever the merchant selects something new — a stale
  // query silently hiding fields on a freshly-opened form would be
  // confusing, not convenient.
  useEffect(() => {
    setQuery("");
    // Resets on contentKey change only — setQuery is a stable setState
    // setter and doesn't need to be in the deps array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);
  return (
    <div className="p-4">
      {heading}
      <div ref={bodyRef}>{children}</div>
    </div>
  );
}

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
      return (
        <div className="flex h-full items-center justify-center">
          <EmptyState title="No category selected" description="Select a category on the left to edit it." />
        </div>
      );
    }
    const Component = THEME_SETTINGS_COMPONENTS[category as (typeof THEME_SETTINGS_CATEGORY_LABELS)[number]];
    return (
      <FilterableSettingsBody editor={editor} contentKey={`theme:${category}`} heading={<h2 className="mb-4 text-sm font-semibold">{category}</h2>}>
        <Component editor={editor} />
      </FilterableSettingsBody>
    );
  }

  if (editor.editorMode === "layout") {
    const category = editor.layoutCategory;
    if (!category) {
      return (
        <div className="flex h-full items-center justify-center">
          <EmptyState title="No category selected" description="Select a category on the left to edit it." />
        </div>
      );
    }
    const Component = LAYOUT_COMPONENTS[category as (typeof THEME_LAYOUT_CATEGORY_LABELS)[number]];
    return (
      <FilterableSettingsBody editor={editor} contentKey={`layout:${category}`} heading={<h2 className="mb-4 text-sm font-semibold">{category}</h2>}>
        <Component editor={editor} />
      </FilterableSettingsBody>
    );
  }

  if (!selection) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState title="No selection" description="Select a section or block on the left to edit it." />
      </div>
    );
  }

  if (selection.kind === "header") {
    return (
      <FilterableSettingsBody editor={editor} contentKey="header" heading={<h2 className="mb-4 text-sm font-semibold">Header</h2>}>
        <HeaderSettings settings={config.header.settings} blocks={config.header.blocks} onUpdate={editor.updateHeaderSetting} />
      </FilterableSettingsBody>
    );
  }

  if (selection.kind === "footer") {
    return (
      <FilterableSettingsBody editor={editor} contentKey="footer" heading={<h2 className="mb-4 text-sm font-semibold">Footer</h2>}>
        <FooterSettings settings={config.footer.settings} onUpdate={editor.updateFooterSetting} />
      </FilterableSettingsBody>
    );
  }

  if (selection.kind === "section") {
    const { section } = selection;
    const SettingsComponent = SECTION_SETTINGS_COMPONENTS[section.type];
    return (
      <FilterableSettingsBody editor={editor} contentKey={`section:${section.id}`} heading={<h2 className="mb-4 text-sm font-semibold">{SECTION_TYPE_LABELS[section.type]}</h2>}>
        <SettingsComponent settings={section.settings} onUpdate={(key, value) => editor.updateSectionSetting(section.id, key, value)} editor={editor} />
      </FilterableSettingsBody>
    );
  }

  const { block, container } = selection;
  return (
    <FilterableSettingsBody
      editor={editor}
      contentKey={`block:${block.id}`}
      heading={
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Block settings</h2>
        </div>
      }
    >
      <ElementSettingsPanel
        block={block}
        container={container}
        onUpdate={(key, value) => editor.updateBlockSetting(container, block.id, key, value)}
        onToggleVisibility={() => editor.toggleBlockVisibility(container, block.id)}
      />
    </FilterableSettingsBody>
  );
}
