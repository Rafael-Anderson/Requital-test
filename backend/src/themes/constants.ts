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

export type BlockContainer = ThemeSectionType | 'header' | 'footer';

// Human labels for every block/sub-block type this catalog defines — used
// by the admin tree UI and the "+ Add block" picker.
export const BLOCK_TYPE_LABELS: Record<string, string> = {
  logo: 'Logo',
  nav_menu: 'Menu',
  search_icon: 'Search',
  cart_icon: 'Cart',
  account_icon: 'Account',
  header_text: 'Header Text',
  footer_column: 'Column',
  footer_social: 'Social Links',
  footer_copyright: 'Copyright',
  announcement: 'Announcement',
  heading: 'Heading',
  subheading: 'Subheading',
  cta: 'CTA Button',
  collection_header: 'Header',
  collection_title: 'Collection title',
  view_all_button: 'View all button',
  product_card: 'Product card',
  product_media: 'Media',
  product_title: 'Product title',
  product_price: 'Price',
  testimonial: 'Testimonial',
  text: 'Text',
  image: 'Image',
  email_form: 'Email form',
};

// Which block types can be added via "+ Add block" at each container's top
// level. Sub-block types (e.g. collection_title, product_media) are added
// inside their own parent block, not directly here — see
// CHILD_BLOCK_TYPES below.
export const BLOCK_TYPES: Record<BlockContainer, string[]> = {
  header: ['logo', 'nav_menu', 'search_icon', 'cart_icon', 'account_icon', 'header_text'],
  footer: ['footer_column', 'footer_social', 'footer_copyright'],
  announcement_bar: ['announcement'],
  hero: ['heading', 'subheading', 'cta'],
  featured_collections: ['collection_header', 'product_card'],
  product_grid: ['product_card'],
  // 'heading' added alongside the testimonial rating/photo fields — mirrors
  // Featured Collections' collection_header pattern (an optional intro
  // heading), rather than repurposing a testimonial block for it.
  testimonials: ['heading', 'testimonial'],
  rich_text: ['text'],
  image_text: ['image', 'text'],
  newsletter: ['heading', 'text', 'email_form'],
};

// Which sub-block types can be added inside a given block type — a block
// type absent here is a leaf (no nested "+ Add block").
export const CHILD_BLOCK_TYPES: Record<string, string[]> = {
  collection_header: ['collection_title', 'view_all_button'],
  product_card: ['product_media', 'product_title', 'product_price'],
};

// Depth cap for the recursive block tree (section -> block -> sub-block),
// enforced in theme-config.validation.ts. Real Shopify allows 8 levels for
// app-extensible theme blocks; our fixed, non-app-extensible catalog only
// ever needs 2 (block -> sub-block), so 4 leaves real headroom without
// inviting pathological nesting.
export const MAX_BLOCK_DEPTH = 4;

const SCHEME_LIGHT_ID = 'scheme-1';
const SCHEME_DARK_ID = 'scheme-2';

// Starting point for a brand-new theme (POST /themes with no
// duplicateFromId) — a sensible, minimal homepage with realistic defaults
// across all 18 Theme Settings categories, rather than an empty canvas.
// Header/Footer/section block defaults reproduce PR #31's original fixed
// layout exactly (same order: logo left, search/cart/account right for
// Header; heading/subheading/cta for Hero) so an untouched new theme looks
// identical to before this rework.
export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  globalSettings: {
    logo: {
      desktopHeight: 32,
      mobileHeight: 24,
    },
    colorSchemes: [
      {
        id: SCHEME_LIGHT_ID,
        name: 'Scheme 1',
        background: '#ffffff',
        text: '#18181b',
        button: '#069494',
        buttonLabel: '#ffffff',
        secondaryButtonLabel: '#069494',
      },
      {
        id: SCHEME_DARK_ID,
        name: 'Scheme 2',
        background: '#18181b',
        text: '#ffffff',
        button: '#2dd4bf',
        buttonLabel: '#18181b',
        secondaryButtonLabel: '#2dd4bf',
      },
    ],
    typography: {
      bodyFont: 'Inter',
      subheadingFont: 'Inter',
      headingFont: 'Inter',
      accentFont: 'Inter',
      paragraph: { size: 14, lineHeight: 'normal' },
      h1: { font: 'heading', size: 48, lineHeight: 'tight', letterSpacing: 'normal', case: 'default' },
      h2: { font: 'heading', size: 36, lineHeight: 'tight', letterSpacing: 'normal', case: 'default' },
      h3: { font: 'heading', size: 28, lineHeight: 'normal', letterSpacing: 'normal', case: 'default' },
      h4: { font: 'heading', size: 22, lineHeight: 'normal', letterSpacing: 'normal', case: 'default' },
      h5: { font: 'heading', size: 18, lineHeight: 'normal', letterSpacing: 'normal', case: 'default' },
      h6: { font: 'heading', size: 16, lineHeight: 'normal', letterSpacing: 'normal', case: 'default' },
    },
    pageLayout: { width: 'normal' },
    animations: {
      pageTransition: false,
      productCardTransition: true,
      addToCart: true,
      cardHoverEffect: 'lift',
    },
    badges: {
      position: 'top_right',
      cornerRadius: 4,
      saleSchemeId: SCHEME_LIGHT_ID,
      soldOutSchemeId: SCHEME_LIGHT_ID,
      font: 'body',
      case: 'uppercase',
    },
    buttons: {
      primary: { borderThickness: 0, cornerRadius: 8, font: 'body', case: 'default' },
      secondary: { borderThickness: 1, cornerRadius: 8, font: 'body', case: 'default' },
      pillCornerRadius: 9999,
    },
    cart: {
      allowNote: true,
      allowDiscounts: true,
      installments: false,
      acceleratedCheckout: true,
      mediaBorderStyle: 'none',
      mediaCornerRadius: 8,
    },
    drawers: {
      schemeId: SCHEME_LIGHT_ID,
      bordersStyle: 'none',
      dropShadow: true,
    },
    icons: { stroke: 'default' },
    inputFields: {
      borderThickness: 1,
      cornerRadius: 8,
      textPreset: 'paragraph',
    },
    popovers: {
      schemeId: SCHEME_LIGHT_ID,
      cornerRadius: 8,
      borders: 'solid',
      dropShadow: true,
    },
    prices: {
      currencyCode: {
        productPages: true,
        productCards: true,
        cartItems: true,
        cartTotal: true,
      },
    },
    productCards: {
      quickAdd: true,
      mobileQuickAdd: false,
      quickAddBackground: '#ffffff',
      quickAddText: '#18181b',
      showSecondImageOnHover: true,
      showCarousel: true,
    },
    search: {
      productCornerRadius: 8,
      cardCornerRadius: 8,
      titleCase: 'default',
    },
    swatches: {
      variantImages: false,
      width: 24,
      height: 24,
      cornerRadius: 9999,
      borders: 'solid',
      borderThickness: 1,
      borderOpacity: 20,
    },
    variantPickers: {
      borderThickness: 1,
      cornerRadius: 8,
      width: 'fit',
    },
    customCss: { css: '' },
  },
  header: {
    settings: { sticky: false, transparentOnHero: false },
    blocks: [
      { id: 'hdr-logo', type: 'logo', visible: true, order: 0, settings: { zone: 'left' } },
      { id: 'hdr-nav-menu', type: 'nav_menu', visible: true, order: 1, settings: {} },
      { id: 'hdr-search', type: 'search_icon', visible: true, order: 2, settings: { zone: 'right' } },
      { id: 'hdr-cart', type: 'cart_icon', visible: true, order: 3, settings: { zone: 'right' } },
      { id: 'hdr-account', type: 'account_icon', visible: true, order: 4, settings: { zone: 'right' } },
    ],
  },
  footer: {
    settings: {},
    blocks: [
      { id: 'ftr-copyright', type: 'footer_copyright', visible: true, order: 0, settings: {} },
    ],
  },
  sections: [
    {
      id: 'sec-announcement-bar',
      type: 'announcement_bar',
      visible: false,
      order: 0,
      settings: { scrollAnimation: 'none', visibility: 'both' },
      blocks: [
        { id: 'blk-announcement', type: 'announcement', visible: true, order: 0, settings: { text: '' } },
      ],
    },
    {
      id: 'sec-hero',
      type: 'hero',
      visible: true,
      order: 1,
      settings: {
        contentPosition: 'center-center',
        height: 'medium',
        scrollAnimation: 'none',
        visibility: 'both',
      },
      blocks: [
        { id: 'blk-heading', type: 'heading', visible: true, order: 0, settings: { text: 'Welcome to our store' } },
        { id: 'blk-subheading', type: 'subheading', visible: true, order: 1, settings: { text: '' } },
        { id: 'blk-cta', type: 'cta', visible: true, order: 2, settings: { label: 'Shop now' } },
      ],
    },
    {
      id: 'sec-featured-collections',
      type: 'featured_collections',
      visible: true,
      order: 2,
      settings: { scrollAnimation: 'fade-in', visibility: 'both' },
      blocks: [
        {
          id: 'blk-collection-header',
          type: 'collection_header',
          visible: true,
          order: 0,
          settings: {},
          blocks: [
            { id: 'blk-collection-title', type: 'collection_title', visible: true, order: 0, settings: {} },
            { id: 'blk-view-all', type: 'view_all_button', visible: true, order: 1, settings: { label: 'View all' } },
          ],
        },
      ],
    },
    {
      id: 'sec-product-grid',
      type: 'product_grid',
      visible: true,
      order: 3,
      settings: {
        columns: 3,
        cardStyle: 'minimal',
        scrollAnimation: 'fade-in',
        visibility: 'both',
      },
      blocks: [
        {
          id: 'blk-product-card',
          type: 'product_card',
          visible: true,
          order: 0,
          settings: {},
          blocks: [
            { id: 'blk-product-media', type: 'product_media', visible: true, order: 0, settings: {} },
            { id: 'blk-product-title', type: 'product_title', visible: true, order: 1, settings: {} },
            { id: 'blk-product-price', type: 'product_price', visible: true, order: 2, settings: {} },
          ],
        },
      ],
    },
  ],
};
