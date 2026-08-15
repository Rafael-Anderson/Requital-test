"use client";

import type { ComponentType } from "react";
import Accordion from "@/components/ui/Accordion";
import AppEmbedsPanel from "./AppEmbedsPanel";
import BlockSettingsForm from "./BlockSettingsForm";
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
import { SECTION_TYPE_LABELS, type ThemeSectionType } from "@/lib/types";
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

// The 18 Theme Settings categories, in the confirmed spec order. Each
// category's key is also what SchemePicker's "Edit scheme" jump link (in
// Badges/Drawers/Popovers) targets via setThemeSettingsCategory("Colors").
const THEME_SETTINGS_CATEGORIES: { label: string; Component: ComponentType<{ editor: ThemeEditorState }> }[] = [
  { label: "Logo and favicon", Component: LogoSettings },
  { label: "Colors", Component: ColorsSettings },
  { label: "Typography", Component: TypographySettings },
  { label: "Page layout", Component: PageLayoutSettings },
  { label: "Animations", Component: AnimationsSettings },
  { label: "Badges", Component: BadgesSettings },
  { label: "Buttons", Component: ButtonsSettings },
  { label: "Cart", Component: CartSettings },
  { label: "Drawers", Component: DrawersSettings },
  { label: "Icons", Component: IconsSettings },
  { label: "Input fields", Component: InputFieldsSettings },
  { label: "Popovers and modals", Component: PopoversSettings },
  { label: "Prices", Component: PricesSettings },
  { label: "Product cards", Component: ProductCardsSettings },
  { label: "Search", Component: SearchSettings },
  { label: "Swatches", Component: SwatchesSettings },
  { label: "Variant pickers", Component: VariantPickersSettings },
  { label: "Custom CSS", Component: CustomCssSettings },
];

function ThemeSettingsAccordion({ editor }: { editor: ThemeEditorState }) {
  const { themeSettingsCategory, setThemeSettingsCategory } = editor;
  return (
    <div className="p-4">
      <h2 className="mb-2 text-sm font-semibold">Theme settings</h2>
      <Accordion
        open={themeSettingsCategory}
        onToggle={(key) => setThemeSettingsCategory(themeSettingsCategory === key ? null : key)}
        items={THEME_SETTINGS_CATEGORIES.map(({ label, Component }) => ({
          key: label,
          label,
          content: <Component editor={editor} />,
        }))}
      />
    </div>
  );
}

// Dispatches on editorMode first (sections / theme settings / app embeds),
// then — in sections mode — on the selected tree node: Header/Footer
// chrome, a section (shared controls + that type's own settings, content
// fields now live on blocks), a block (BlockSettingsForm's per-type
// dispatch), or nothing selected (a hint to pick something in the tree).
export default function SettingsPanel({ editor }: { editor: ThemeEditorState }) {
  const { config, selection } = editor;
  if (!config) return null;

  if (editor.editorMode === "theme_settings") return <ThemeSettingsAccordion editor={editor} />;
  if (editor.editorMode === "app_embeds") return <AppEmbedsPanel />;

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
      <BlockSettingsForm block={block} onUpdate={(key, value) => editor.updateBlockSetting(container, block.id, key, value)} />
    </div>
  );
}
