import type { ThemeConfig, ThemeSectionType } from './theme-config.types';

// The reorderable homepage-body section catalog (see AddSectionModal in the
// admin editor). Header/Footer are separate global-chrome slots on
// ThemeConfig, not members of this list — see theme-config.types.ts's own
// comment.
export const SECTION_TYPES: ThemeSectionType[] = [
  'announcement_bar',
  'hero',
  'featured_collections',
  'product_grid',
  'testimonials',
  'rich_text',
  'image_text',
  'newsletter',
];

export const SECTION_TYPE_LABELS: Record<ThemeSectionType, string> = {
  announcement_bar: 'Announcement Bar',
  hero: 'Hero',
  featured_collections: 'Featured Collections',
  product_grid: 'Product Grid',
  testimonials: 'Testimonials',
  rich_text: 'Rich Text',
  image_text: 'Image + Text',
  newsletter: 'Newsletter Signup',
};

// Starting point for a brand-new theme (POST /themes with no
// duplicateFromId) — a sensible, minimal homepage rather than an empty
// section list, so a merchant opening the builder for the first time sees
// something real to edit rather than a blank canvas.
export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  globalSettings: {
    primaryColor: '#069494',
    secondaryColor: '#057a7a',
    accentColor: '#069494',
    bodyFont: 'Inter',
    headingFont: 'Inter',
    borderRadius: 'soft',
    buttonStyle: 'filled',
    maxWidth: 1280,
  },
  header: {
    settings: { sticky: false, transparentOnHero: false },
  },
  footer: {
    settings: {},
  },
  sections: [
    {
      id: 'sec-announcement-bar',
      type: 'announcement_bar',
      visible: false,
      order: 0,
      settings: { text: '', scrollAnimation: 'none', visibility: 'both' },
    },
    {
      id: 'sec-hero',
      type: 'hero',
      visible: true,
      order: 1,
      settings: {
        heading: 'Welcome to our store',
        subheading: '',
        ctaLabel: 'Shop now',
        contentPosition: 'center-center',
        height: 'medium',
        scrollAnimation: 'none',
        visibility: 'both',
      },
    },
    {
      id: 'sec-featured-collections',
      type: 'featured_collections',
      visible: true,
      order: 2,
      settings: { scrollAnimation: 'fade-in', visibility: 'both' },
    },
    {
      id: 'sec-product-grid',
      type: 'product_grid',
      visible: true,
      order: 3,
      settings: {
        columns: 3,
        showRating: false,
        showPrice: true,
        cardStyle: 'minimal',
        scrollAnimation: 'fade-in',
        visibility: 'both',
      },
    },
  ],
};
