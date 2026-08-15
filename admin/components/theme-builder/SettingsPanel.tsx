"use client";

import type { ComponentType } from "react";
import Accordion from "@/components/ui/Accordion";
import AppEmbedsPanel from "./AppEmbedsPanel";
import BlockSettingsForm from "./BlockSettingsForm";
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

// The 18 Theme Settings categories, in the confirmed spec order. Category
// bodies are placeholders here — Phase 4 replaces each with its real form
// (Logo/Colors/Typography/... /Custom CSS); this phase's job is the
// accordion shell + editorMode dispatch, not the forms themselves.
const THEME_SETTINGS_CATEGORIES = [
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
];

function ThemeSettingsAccordion({ editor }: { editor: ThemeEditorState }) {
  const { themeSettingsCategory, setThemeSettingsCategory } = editor;
  return (
    <div className="p-4">
      <h2 className="mb-2 text-sm font-semibold">Theme settings</h2>
      <Accordion
        open={themeSettingsCategory}
        onToggle={(key) => setThemeSettingsCategory(themeSettingsCategory === key ? null : key)}
        items={THEME_SETTINGS_CATEGORIES.map((label) => ({
          key: label,
          label,
          content: <p className="text-xs text-zinc-500">Coming in the next phase.</p>,
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
