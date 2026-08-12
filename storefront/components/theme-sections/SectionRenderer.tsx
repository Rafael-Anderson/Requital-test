import type { ComponentType } from "react";
import type { SectionSettings, ThemeElement, ThemeSection, ThemeSectionType } from "@/lib/theme-config-types";
import SectionWrapper from "./SectionWrapper";
import ScrollAnimatedWrapper from "./ScrollAnimatedWrapper";
import AnnouncementBarSectionThemed from "./AnnouncementBarSectionThemed";
import HeroSection from "./HeroSection";
import FeaturedCollectionsSection from "./FeaturedCollectionsSection";
import ProductGridSection from "./ProductGridSection";
import TestimonialsSection from "./TestimonialsSection";
import RichTextSection from "./RichTextSection";
import ImageTextSection from "./ImageTextSection";
import NewsletterSection from "./NewsletterSection";

// elements is optional — only HeroSection actually reads it (heading/
// subheading/CTA zone order), the other 7 section types ignore it.
const SECTION_COMPONENTS: Record<
  ThemeSectionType,
  ComponentType<{ settings: SectionSettings; elements?: ThemeElement[] }>
> = {
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
          <ScrollAnimatedWrapper key={section.id} animation={section.settings.scrollAnimation}>
            <SectionWrapper sectionId={section.id} settings={section.settings}>
              <Component settings={section.settings} elements={section.elements} />
            </SectionWrapper>
          </ScrollAnimatedWrapper>
        );
      })}
    </>
  );
}
