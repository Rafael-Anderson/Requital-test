import type { ComponentType } from "react";
import type { SectionSettings, ThemeSection, ThemeSectionType } from "@/lib/theme-config-types";
import SectionWrapper from "./SectionWrapper";
import AnnouncementBarSectionThemed from "./AnnouncementBarSectionThemed";
import HeroSection from "./HeroSection";
import FeaturedCollectionsSection from "./FeaturedCollectionsSection";
import ProductGridSection from "./ProductGridSection";
import TestimonialsSection from "./TestimonialsSection";
import RichTextSection from "./RichTextSection";
import ImageTextSection from "./ImageTextSection";
import NewsletterSection from "./NewsletterSection";

const SECTION_COMPONENTS: Record<ThemeSectionType, ComponentType<{ settings: SectionSettings }>> = {
  announcement_bar: AnnouncementBarSectionThemed,
  hero: HeroSection,
  featured_collections: FeaturedCollectionsSection,
  product_grid: ProductGridSection,
  testimonials: TestimonialsSection,
  rich_text: RichTextSection,
  image_text: ImageTextSection,
  newsletter: NewsletterSection,
};

// Homepage body only (see the plan's scope decision) — Header/Footer are
// separate global-chrome components (ThemeDrivenHeader/ThemeDrivenFooter),
// not rendered here.
export default function SectionRenderer({ sections }: { sections: ThemeSection[] }) {
  const visible = [...sections].filter((s) => s.visible).sort((a, b) => a.order - b.order);

  return (
    <>
      {visible.map((section) => {
        const Component = SECTION_COMPONENTS[section.type];
        return (
          <SectionWrapper key={section.id} sectionId={section.id} settings={section.settings}>
            <Component settings={section.settings} />
          </SectionWrapper>
        );
      })}
    </>
  );
}
