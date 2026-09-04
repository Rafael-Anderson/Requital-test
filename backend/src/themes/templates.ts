// Phase G0 — the four starter templates (Flow A: "New theme from template").
//
// Each is a FULL `ThemeConfig` literal, built by deep-cloning
// `DEFAULT_THEME_CONFIG` and overriding. The `: ThemeConfig` annotation makes
// `tsc` enforce the current shape and every value's type — the primary drift
// guard (stronger than the shallow `assertValidThemeConfig`); a
// per-template validation + clone + byte-cap spec is the belt (see
// theme-config.validation.spec.ts / templates.spec.ts). Held to the same
// in-lockstep-with-theme-config.types.ts discipline as `DEFAULT_THEME_CONFIG`.
//
// SCOPE — G0 templates set ONLY keys that render today (Phases A + B): motion /
// radius / density / typography pairing+scale / colour schemes / product-card
// style+aspect+align+density / sale-price treatment / the shipped section types
// and their settings. "What the merchant gets" == "what's in this file", no
// asterisks: a G0 template references zero unbuilt capability, so there is
// nothing to no-op.
//
// Each template's `deferred` array below is the re-author checklist for when
// C–F lands (see docs/plans/theme-templates-and-motion.md §8.3/§8.4). It is
// data, not code — surfaced nowhere at runtime, kept here so the omissions read
// as deliberate. `animations.addToCart` / `pageTransition` are set to `false`
// on purpose (a published template theme silently gaining motion the day a
// later phase merges is an unrequested behaviour change with no changelog
// trail — re-authoring is the explicit path).
//
// Scheme ids stay `scheme-1` / `scheme-2` (DEFAULT's) so `badges.saleSchemeId`
// / `drawers.schemeId` / `popovers.schemeId` references remain valid without
// remapping here; `cloneConfigWithFreshIds` regenerates every id (schemes,
// sections, blocks) and rewrites those references on create.

import { DEFAULT_THEME_CONFIG } from './constants';
import type {
  ColorScheme,
  SectionEntrance,
  ThemeBlock,
  ThemeConfig,
  ThemeSection,
  ThemeSectionType,
} from './theme-config.types';

export const TEMPLATE_KEYS = ['atelier', 'market', 'bloom', 'heritage'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface TemplateMeta {
  key: TemplateKey;
  name: string;
  blurb: string;
  previewColors: { bg: string; text: string; button: string };
}

// ---------------------------------------------------------------------------
// authoring helpers
// ---------------------------------------------------------------------------

function base(): ThemeConfig {
  return JSON.parse(JSON.stringify(DEFAULT_THEME_CONFIG)) as ThemeConfig;
}

let seq = 0;
function bid(prefix: string): string {
  seq += 1;
  return `tpl-${prefix}-${seq}`;
}

function block(type: string, settings: Record<string, unknown> = {}, blocks?: ThemeBlock[]): ThemeBlock {
  return { id: bid(type), type, visible: true, order: 0, settings, ...(blocks ? { blocks } : {}) };
}

interface SectionOpts {
  visible?: boolean;
  settings?: Record<string, unknown>;
  entrance?: SectionEntrance;
  schemeId?: string;
  blocks?: ThemeBlock[];
}

function section(type: ThemeSectionType, order: number, opts: SectionOpts = {}): ThemeSection {
  const settings: Record<string, unknown> = { visibility: 'both', ...opts.settings };
  if (opts.entrance) settings.motion = { ...(settings.motion as object), entrance: opts.entrance };
  if (opts.schemeId) settings.schemeId = opts.schemeId;
  return {
    id: bid(type),
    type,
    visible: opts.visible ?? true,
    order,
    settings,
    blocks: opts.blocks ?? [],
  };
}

function hero(order: number, heading: string, ctaLabel: string, opts: SectionOpts = {}): ThemeSection {
  return section('hero', order, {
    ...opts,
    blocks: [
      block('heading', { text: heading }),
      block('subheading', { text: '' }),
      block('cta', { label: ctaLabel }),
    ],
  });
}

function featuredCollections(order: number, title: string, opts: SectionOpts = {}): ThemeSection {
  return section('featured_collections', order, {
    ...opts,
    blocks: [
      block('collection_header', {}, [
        block('collection_title', { text: title }),
        block('view_all_button', { label: 'View all' }),
      ]),
    ],
  });
}

function productGrid(order: number, opts: SectionOpts = {}): ThemeSection {
  return section('product_grid', order, {
    ...opts,
    blocks: [
      block('product_card', {}, [
        block('product_media'),
        block('product_title'),
        block('product_price'),
      ]),
    ],
  });
}

function richText(order: number, html: string, opts: SectionOpts = {}): ThemeSection {
  return section('rich_text', order, { ...opts, blocks: [block('text', { text: html })] });
}

function imageText(order: number, text: string, opts: SectionOpts = {}): ThemeSection {
  return section('image_text', order, {
    ...opts,
    blocks: [block('image', { imageUrl: '' }), block('text', { text })],
  });
}

function newsletter(order: number, heading: string, subtext: string, opts: SectionOpts = {}): ThemeSection {
  return section('newsletter', order, {
    ...opts,
    blocks: [block('heading', { text: heading }), block('text', { text: subtext }), block('email_form', {})],
  });
}

function trustBar(order: number, items: { icon: string; text: string }[], rating: { rating: number; label: string } | null, opts: SectionOpts = {}): ThemeSection {
  return section('trust_bar', order, {
    ...opts,
    blocks: [
      ...items.map((it) => block('trust_item', { icon: it.icon, text: it.text })),
      ...(rating ? [block('rating_badge', { rating: rating.rating, label: rating.label })] : []),
    ],
  });
}

function testimonials(order: number, quotes: { quote: string; author: string; rating?: number }[], opts: SectionOpts = {}): ThemeSection {
  return section('testimonials', order, {
    ...opts,
    blocks: [
      block('heading', { text: 'What our customers say' }),
      ...quotes.map((q) => block('testimonial', { quote: q.quote, author: q.author, ...(q.rating ? { rating: q.rating } : {}) })),
    ],
  });
}

function announcementOff(order: number): ThemeSection {
  return section('announcement_bar', order, {
    visible: false,
    blocks: [block('announcement', { text: '' })],
  });
}

function announcement(order: number, text: string): ThemeSection {
  return section('announcement_bar', order, { blocks: [block('announcement', { text })] });
}

// Settings-only, no blocks (BLOCK_TYPES.brands = []). `scrolling: true` is the
// post-G0-batch marquee mode; the section renders nothing on a shop with no
// brands configured yet (graceful, not an error).
function brands(order: number, opts: SectionOpts = {}): ThemeSection {
  return section('brands', order, opts);
}

function scheme(id: string, name: string, c: Omit<ColorScheme, 'id' | 'name'>): ColorScheme {
  return { id, name, ...c };
}

// ---------------------------------------------------------------------------
// 1. Atelier — quiet editorial luxury
// ---------------------------------------------------------------------------

const atelier: ThemeConfig = (() => {
  const c = base();
  const g = c.globalSettings;

  g.colorSchemes = [
    scheme('scheme-1', 'Paper', { background: '#FBFAF7', text: '#1A1A17', button: '#5A6B54', buttonLabel: '#FBFAF7', secondaryButtonLabel: '#1A1A17' }),
    scheme('scheme-2', 'Ink', { background: '#1A1A17', text: '#FBFAF7', button: '#FBFAF7', buttonLabel: '#1A1A17', secondaryButtonLabel: '#FBFAF7' }),
  ];
  g.typography.pairing = 'editorial-serif';
  g.typography.scale = 'dramatic';
  g.radius = { preset: 'sharp' };
  g.density = { preset: 'spacious' };
  g.motion = { intensity: 'subtle', speed: 0.8, easing: 'gentle' };
  g.animations.cardHoverEffect = 'desaturate';
  g.animations.imageLoad = 'fade';
  g.animations.addToCart = false;
  g.animations.pageTransition = false;
  g.buttons.primary.cornerRadius = 0;
  g.buttons.primary.borderThickness = 0;
  g.buttons.secondary.cornerRadius = 0;
  g.productCards.cardStyle = 'minimal';
  g.productCards.imageAspect = 'portrait';
  g.productCards.textAlign = 'left';
  g.productCards.density = 'comfortable';
  g.productCards.quickAdd = false;
  g.productCards.mobileQuickAdd = false;
  g.productCards.showWishlist = false;
  g.productCards.showProductDescriptions = false;
  g.prices.salePriceStyle = 'strikethrough-only';
  g.badges.cornerRadius = 0;
  g.badges.case = 'default';

  c.sections = [
    announcementOff(0),
    hero(1, 'Flowers for the occasions that matter', 'Enquire', { entrance: 'mask-reveal', settings: { contentPosition: 'bottom-left', height: 'large', heroLayout: 'full_bleed', showSlideIndicators: false } }),
    richText(2, '<p>A studio practice. Seasonal stems, considered arrangements, and a small number of weddings and events each year.</p>', { entrance: 'fade-in', schemeId: 'scheme-2', settings: { contentWidth: 'narrow' } }),
    featuredCollections(3, 'Collections', { entrance: 'mask-reveal', settings: { columns: 2, aspectRatio: 'portrait', overlayText: true, motion: { stagger: true } } }),
    productGrid(4, { entrance: 'fade-in', settings: { columns: 2, cardStyle: 'minimal', imageAspect: 'portrait', motion: { stagger: true } } }),
    imageText(5, 'Every arrangement is made to order in our studio the morning of delivery.', { entrance: 'slide-left' }),
    newsletter(6, 'Seasonal notes', 'Occasional letters on what is in season.'),
  ];

  return c;
})();

// ---------------------------------------------------------------------------
// 2. Market — dense, warm, fast, conversion-focused
// ---------------------------------------------------------------------------

const market: ThemeConfig = (() => {
  const c = base();
  const g = c.globalSettings;

  g.colorSchemes = [
    scheme('scheme-1', 'Rose', { background: '#FFFFFF', text: '#232323', button: '#E24A6A', buttonLabel: '#FFFFFF', secondaryButtonLabel: '#E24A6A' }),
    scheme('scheme-2', 'Blush', { background: '#FDF1F3', text: '#232323', button: '#E24A6A', buttonLabel: '#FFFFFF', secondaryButtonLabel: '#E24A6A' }),
  ];
  g.typography.pairing = 'modern-sans';
  g.typography.scale = 'compact';
  g.typography.h5.case = 'uppercase';
  g.typography.h6.case = 'uppercase';
  g.radius = { preset: 'rounded' };
  g.density = { preset: 'compact' };
  g.motion = { intensity: 'standard', speed: 1.1, easing: 'snappy' };
  g.animations.cardHoverEffect = 'quick-add-slide';
  g.animations.imageLoad = 'fade';
  g.animations.addToCart = false;
  g.animations.pageTransition = false;
  g.productCards.cardStyle = 'shadowed';
  g.productCards.imageAspect = 'square';
  g.productCards.density = 'compact';
  g.productCards.quickAdd = true;
  g.productCards.mobileQuickAdd = true;
  g.productCards.showWishlist = true;
  g.prices.salePriceStyle = 'color';
  g.prices.salePriceColor = '#C81E4A';
  g.badges.case = 'uppercase';

  c.sections = [
    announcement(0, 'Same-day delivery before 6pm'),
    hero(1, 'Fresh flowers, delivered today', 'Shop best sellers', { entrance: 'slide-up', settings: { height: 'medium', heroLayout: 'inset', cornerRadius: 12 } }),
    trustBar(
      2,
      [
        { icon: 'truck', text: 'Same-day delivery' },
        { icon: 'shield', text: 'Freshness guarantee' },
        { icon: 'check', text: 'Secure checkout' },
        { icon: 'star', text: 'Rated 4.8 / 5' },
      ],
      { rating: 4.8, label: '2,000+ reviews' },
      { entrance: 'fade-in', schemeId: 'scheme-2' },
    ),
    featuredCollections(3, 'Shop by occasion', { entrance: 'fade-in', settings: { columns: 4, aspectRatio: 'square', overlayText: true, motion: { stagger: true } } }),
    productGrid(4, { entrance: 'fade-in', settings: { columns: 4, cardStyle: 'shadowed', imageAspect: 'square' } }),
    brands(5, { settings: { scrolling: true } }),
    newsletter(6, 'Get 10% off your first order', 'Delivery updates and seasonal offers.'),
  ];

  return c;
})();

// ---------------------------------------------------------------------------
// 3. Bloom — playful, colourful, bouncy
// ---------------------------------------------------------------------------

const bloom: ThemeConfig = (() => {
  const c = base();
  const g = c.globalSettings;

  g.colorSchemes = [
    scheme('scheme-1', 'Violet', { background: '#FFFFFF', text: '#221B3A', button: '#7C5CFF', buttonLabel: '#FFFFFF', secondaryButtonLabel: '#7C5CFF' }),
    scheme('scheme-2', 'Mint', { background: '#D6F5E8', text: '#221B3A', button: '#7C5CFF', buttonLabel: '#FFFFFF', secondaryButtonLabel: '#7C5CFF' }),
  ];
  g.typography.pairing = 'bold-display';
  g.typography.scale = 'spacious';
  g.radius = { preset: 'soft' };
  g.density = { preset: 'cozy' };
  g.motion = { intensity: 'expressive', speed: 1, easing: 'overshoot' };
  g.animations.cardHoverEffect = 'tilt';
  g.animations.imageLoad = 'fade';
  g.animations.addToCart = false;
  g.animations.pageTransition = false;
  // Deliberately NOT setting buttons.primary.cornerRadius here (found during
  // the scratch-shop pass): --theme-radius is shared between buttons AND the
  // Featured/ImageText/ProductGrid section image containers (B1), so a
  // cornerRadius: 9999 meant only for pill buttons rendered every collection
  // tile as an ellipse. Pill buttons need buttons.pillCornerRadius, a
  // separate, still-dead field (see the deferred block) — not this one.
  g.productCards.cardStyle = 'elevated';
  g.productCards.imageAspect = 'portrait';
  g.productCards.density = 'comfortable';
  g.productCards.quickAdd = true;
  g.productCards.showWishlist = true;
  g.prices.salePriceStyle = 'color';
  g.badges.cornerRadius = 9999;

  c.sections = [
    announcement(0, 'Free gift wrap on every order'),
    hero(1, 'Gifting made joyful', 'Start a gift', { entrance: 'blur-in', settings: { height: 'large', showSlideIndicators: true } }),
    featuredCollections(2, 'Shop by moment', { entrance: 'scale-in', settings: { columns: 3, aspectRatio: 'portrait', overlayText: true, motion: { stagger: true } } }),
    imageText(3, 'Pick it. Personalise it. We deliver it. Three steps to a gift they will remember.', { entrance: 'slide-up', schemeId: 'scheme-2' }),
    productGrid(4, { entrance: 'scale-in', settings: { columns: 3, cardStyle: 'elevated', imageAspect: 'portrait', motion: { entrance: 'scale-in', animateOnce: false } } }),
    testimonials(5, [
      { quote: 'Arrived exactly on time and looked even better than the photo.', author: 'Reem A.', rating: 5 },
      { quote: 'The gift box is gorgeous. Ordering again for every birthday.', author: 'Daniel K.', rating: 5 },
      { quote: 'So easy to personalise. My mum loved it.', author: 'Priya S.', rating: 5 },
    ], { entrance: 'rotate-in', settings: { motion: { stagger: true } } }),
    trustBar(6, [
      { icon: 'truck', text: 'Next-day delivery' },
      { icon: 'star', text: 'Thousands of 5-star gifts' },
      { icon: 'shield', text: 'Happiness guarantee' },
    ], null),
    newsletter(7, 'Join the club', 'Early access to new gifts and seasonal drops.'),
  ];

  return c;
})();

// ---------------------------------------------------------------------------
// 4. Heritage — classic, structured, trustworthy
// ---------------------------------------------------------------------------

const heritage: ThemeConfig = (() => {
  const c = base();
  const g = c.globalSettings;

  g.colorSchemes = [
    scheme('scheme-1', 'Cream', { background: '#F6F3EC', text: '#2B2B2B', button: '#B08D3F', buttonLabel: '#F6F3EC', secondaryButtonLabel: '#1E3A2F' }),
    scheme('scheme-2', 'Deep green', { background: '#1E3A2F', text: '#F6F3EC', button: '#F6F3EC', buttonLabel: '#1E3A2F', secondaryButtonLabel: '#F6F3EC' }),
  ];
  g.typography.pairing = 'classic';
  g.typography.scale = 'default';
  g.typography.h2.case = 'uppercase';
  g.typography.h2.letterSpacing = 'wide';
  g.typography.h3.case = 'uppercase';
  g.typography.h3.letterSpacing = 'wide';
  g.radius = { preset: 'subtle' };
  g.density = { preset: 'comfortable' };
  g.motion = { intensity: 'subtle', speed: 0.9, easing: 'standard' };
  g.animations.cardHoverEffect = 'shadow';
  g.animations.imageLoad = 'fade';
  g.animations.addToCart = false;
  g.animations.pageTransition = false;
  g.productCards.cardStyle = 'bordered';
  g.productCards.imageAspect = 'landscape';
  g.productCards.density = 'comfortable';
  g.productCards.quickAdd = false;
  g.productCards.mobileQuickAdd = false;
  g.productCards.showWishlist = false;
  g.prices.salePriceStyle = 'color';
  g.prices.salePriceColor = '#8A3324';

  c.sections = [
    announcementOff(0),
    hero(1, 'Traditional florists since 1985', 'Shop the collection', { entrance: 'fade-in', settings: { contentPosition: 'center-center', height: 'medium', heroLayout: 'inset', cornerRadius: 4 } }),
    trustBar(2, [
      { icon: 'shield', text: 'Established 1985' },
      { icon: 'truck', text: 'Nationwide delivery' },
      { icon: 'check', text: 'Corporate accounts welcome' },
    ], { rating: 4.9, label: 'Trusted by thousands' }, { entrance: 'fade-in' }),
    featuredCollections(3, 'Our collections', { entrance: 'fade-in', settings: { columns: 3, aspectRatio: 'landscape', overlayText: false } }),
    productGrid(4, { settings: { columns: 3, cardStyle: 'bordered', imageAspect: 'landscape' } }),
    imageText(5, 'A family business for four decades, serving homes, hotels, and offices across the country.', { entrance: 'none', schemeId: 'scheme-2' }),
    richText(6, '<p>Sympathy tributes, corporate contracts, and weekly office flowers. Speak to our team for bespoke arrangements.</p>', { entrance: 'fade-in' }),
    newsletter(7, 'Seasonal updates', 'Sign up for occasional news and offers.'),
  ];

  return c;
})();

// ---------------------------------------------------------------------------

export const THEME_TEMPLATES: Record<TemplateKey, ThemeConfig> = {
  atelier,
  market,
  bloom,
  heritage,
};

export const TEMPLATE_META: Record<TemplateKey, TemplateMeta> = {
  atelier: {
    key: 'atelier',
    name: 'Atelier',
    blurb: 'Quiet editorial luxury. Big serif display type, square corners, generous whitespace, slow motion.',
    previewColors: { bg: '#FBFAF7', text: '#1A1A17', button: '#5A6B54' },
  },
  market: {
    key: 'market',
    name: 'Market',
    blurb: 'Dense and warm. Compact type, four-up grids, snappy motion, trust signals up front.',
    previewColors: { bg: '#FFFFFF', text: '#232323', button: '#E24A6A' },
  },
  bloom: {
    key: 'bloom',
    name: 'Bloom',
    blurb: 'Playful gifting. Very rounded, loud colour, big display type, bouncy motion that replays on scroll.',
    previewColors: { bg: '#FFFFFF', text: '#221B3A', button: '#7C5CFF' },
  },
  heritage: {
    key: 'heritage',
    name: 'Heritage',
    blurb: 'Classic and structured. Serif small caps, bordered cards, a deep-green section, calm symmetrical motion.',
    previewColors: { bg: '#F6F3EC', text: '#2B2B2B', button: '#B08D3F' },
  },
};

export function isTemplateKey(v: unknown): v is TemplateKey {
  return typeof v === 'string' && (TEMPLATE_KEYS as readonly string[]).includes(v);
}

// ── Deferred to C–F (re-author each template when these land — see
//    docs/plans/theme-templates-and-motion.md §8.3/§8.4) ──────────────────
//
// Post-G0 batch (2026-09-04) shipped and adopted here: animations.
// cardHoverEffect's real per-template target (desaturate / quick-add-slide /
// tilt / shadow — no more stand-ins), animations.imageLoad: 'fade' (all four),
// section.settings.motion.stagger (Atelier's featured_collections +
// product_grid, Market's featured_collections, Bloom's featured_collections +
// testimonials — Heritage deliberately has none, "everything appears
// symmetrically"), section.settings.motion.entrance: 'rotate-in' (Bloom's
// testimonials), and Market's brands section with scrolling: true (a
// marquee — renders nothing until the merchant adds brands, same graceful
// degradation as before).
//
// ALL templates:
//   - animations.addToCart / pageTransition — deliberately left false (no
//     silent behaviour change when the consumer lands; re-author instead)
//   - header layout preset (header.settings.rows + zones), footer named preset
//   - header.settings.mobileNav (drawer / bottom-bar / fullscreen)
//   - icons.* (style / corners / size)
//
// atelier:  hero kenBurns; header scrollBehavior 'reveal-on-hero' +
//           transparentOverHero + mobileNav 'fullscreen'; buttons.primary
//           hoverEffect 'sweep' + pressEffect; motion smoothScroll;
//           badges.style 'rectangle'
// market:   fly-to-cart; drawers.animation 'slide-fade'; cart.itemAnimation +
//           subtotalAnimation 'count'; floatingElements.backToTop;
//           inputFields.focusAnimation 'float-label'; motion.scrollProgressBar;
//           header scrollBehavior 'shrink' + mobileNav 'bottom-bar';
//           product_tabs section (needs real collectionIds); trust_bar rating
//           count-up; hero indicatorStyle 'progress';
//           productCards.wishlistAnimation 'pop'; product_vendor /
//           product_stock card sub-blocks; buttons.secondary rendered variant
//           + hoverEffect 'border-fill'; badges.style 'tag' + entranceAnimation
// bloom:    wishlist 'burst'; hero parallax + decorativeParallax floating
//           shapes; buttons.primary hoverEffect 'shine';
//           buttons.pillCornerRadius pills; header scrollBehavior
//           'hide-on-scroll' + mobileNav 'drawer'; footer 'big-CTA' preset +
//           wave background; section separators; product_tabs section;
//           announcement_bar marquee; badges.style 'circle' + entranceAnimation
// heritage: buttons.secondary rendered as outline CTAs;
//           header 'coloured band' preset (HeaderRow.background + nav_menu
//           inline + contact bar) + mobileNav 'drawer'; footer 'multi-column'
//           preset + payment icons + separate bottom bar; badges.style 'ribbon'
