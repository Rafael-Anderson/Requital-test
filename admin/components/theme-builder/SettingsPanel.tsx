"use client";

import type { ComponentType } from "react";
import type { ThemeEditorState } from "@/lib/useThemeEditor";
import { HEADER_CHROME_ID, FOOTER_CHROME_ID } from "./SectionTree";
import GlobalSettingsPanel from "./GlobalSettingsPanel";
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

// Dispatches: selectedElementId set -> element settings (Phase 6 — no UI
// writes a non-default element yet, so this branch never actually renders
// before then); else selectedSectionId set -> Header/Footer chrome or that
// section type's settings; else -> GlobalSettingsPanel (nothing selected).
export default function SettingsPanel({ editor }: { editor: ThemeEditorState }) {
  const { config, selectedSectionId, selectedElementId } = editor;
  if (!config) return null;

  if (selectedElementId && selectedSectionId) {
    return <p className="p-4 text-sm text-zinc-500">Element settings coming soon.</p>;
  }

  if (selectedSectionId === HEADER_CHROME_ID) {
    return (
      <div className="p-4">
        <h2 className="mb-4 text-sm font-semibold">Header</h2>
        <HeaderSettings
          settings={config.header.settings}
          onUpdate={(key, value) => editor.updateHeaderSetting(key, value)}
        />
      </div>
    );
  }

  if (selectedSectionId === FOOTER_CHROME_ID) {
    return (
      <div className="p-4">
        <h2 className="mb-4 text-sm font-semibold">Footer</h2>
        <FooterSettings
          settings={config.footer.settings}
          onUpdate={(key, value) => editor.updateFooterSetting(key, value)}
        />
      </div>
    );
  }

  const section = config.sections.find((s) => s.id === selectedSectionId);
  if (section) {
    const SettingsComponent = SECTION_SETTINGS_COMPONENTS[section.type];
    return (
      <div className="p-4">
        <h2 className="mb-4 text-sm font-semibold">{SECTION_TYPE_LABELS[section.type]}</h2>
        <SettingsComponent
          settings={section.settings}
          onUpdate={(key, value) => editor.updateSectionSetting(section.id, key, value)}
        />
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="mb-4 text-sm font-semibold">Theme settings</h2>
      <GlobalSettingsPanel
        settings={config.globalSettings}
        onUpdate={(key, value) => editor.updateGlobalSetting(key, value)}
      />
    </div>
  );
}
