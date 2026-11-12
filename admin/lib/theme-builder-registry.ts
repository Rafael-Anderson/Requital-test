// ONE central registry for the theme builder's settings: which entries exist, when each one
// APPLIES, and what the global "Search settings" box can find. The Layout list, the right
// panel's fallback and the search index all read from here, so an entry that does nothing
// for the shop's current mode can never be listed, opened or found.
//
// Two storefront modes exist (see CLAUDE.md "Homepage layout is theme-driven, two independent
// systems"):
//   * Sections mode: the shop has a PUBLISHED Sections theme (theme.config). The storefront
//     renders ThemeDrivenHeader / ThemeDrivenFooter / SectionRenderer and ignores the legacy
//     themesettings layout fields that belong to the old chrome.
//   * Layout mode: no published Sections theme; the legacy themesettings fields drive the page.
// Each Layout entry below says whether it still has an effect in Sections mode, with the
// storefront code that proves it. Keep `evidence` honest: it is the audit trail.

import { THEME_SETTINGS_CATEGORY_LABELS } from "@/lib/theme-settings-categories";
import { SECTION_TYPE_LABELS, type ThemeSectionType } from "@/lib/types";

export interface BuilderContext {
  // True when the shop has a published Sections theme (the storefront is in Sections mode).
  sectionsMode: boolean;
  // Section types present in the theme being edited (a section-level setting can only be
  // opened when there is a section of that type to open).
  sectionTypesPresent: ReadonlySet<ThemeSectionType>;
}

// ---------------------------------------------------------------------------------------------
// Layout mode entries
// ---------------------------------------------------------------------------------------------

export const LAYOUT_ENTRY_IDS = [
  "Home tab",
  "Menu",
  "Homepage layout",
  "Top bar layout",
  "Header size",
  "Footer layout",
  "Footer size",
  "Product page layout",
  "Cart layout",
  "Checkout layout",
  "Icon style",
  "Button shape",
  "Button fill",
] as const;
export type LayoutEntryId = (typeof LAYOUT_ENTRY_IDS)[number];

export interface LayoutEntry {
  id: LayoutEntryId;
  description: string;
  keywords: string[];
  // Predicate on the builder context: does this entry change anything on the storefront?
  applies: (ctx: BuilderContext) => boolean;
  // Storefront code that proves the predicate (the audit table in the PR report).
  evidence: string;
}

const always = () => true;
const layoutModeOnly = (ctx: BuilderContext) => !ctx.sectionsMode;

export const LAYOUT_ENTRIES: readonly LayoutEntry[] = [
  {
    id: "Home tab",
    description: "Start the homepage from a preset arrangement of sections",
    keywords: ["home", "homepage", "presets", "templates", "arrangement"],
    // The preset picker writes theme.config.sections, so it works in both modes. The Templates /
    // Collections toggle and the collections grid are read only by the legacy homepage, so in
    // Sections mode the panel shows the presets alone (see HomeTabSetting).
    applies: always,
    evidence:
      "Presets: useThemeEditor.applyHomepagePreset rewrites theme.config.sections (live in Sections mode). Mode toggle + collections grid: read only by app/[shop]/page.tsx after its `if (themeConfig)` early return, so dead in Sections mode and hidden there.",
  },
  {
    id: "Menu",
    description: "The storefront navigation menu (links and dropdowns)",
    keywords: ["navigation", "nav", "links", "dropdown", "mega menu"],
    applies: always,
    evidence: "MenuBar.tsx reads the menu module in both modes; ThemeDrivenHeader renders it for the nav_menu block.",
  },
  {
    id: "Homepage layout",
    description: "Classic, slideshow, featured grid or grid-first homepage",
    keywords: ["home", "hero", "slideshow", "featured grid", "classic"],
    applies: layoutModeOnly,
    evidence: "shop.homepageLayout is read only in app/[shop]/page.tsx below `if (themeConfig) return <SectionRenderer/>`.",
  },
  {
    id: "Top bar layout",
    description: "Logo left, logo centre or stacked top bar",
    keywords: ["header", "logo position", "top bar", "navbar"],
    applies: layoutModeOnly,
    evidence: "shop.topBarLayout is read only in TopBar.tsx, which returns ThemeDrivenHeader when themeConfig.header exists.",
  },
  {
    id: "Header size",
    description: "Compact, regular or spacious header height",
    keywords: ["header", "height", "density", "padding"],
    applies: layoutModeOnly,
    evidence: "shop.headerDensity is read only in TopBar.tsx's legacy branch; ThemeDrivenHeader uses header.settings.height instead.",
  },
  {
    id: "Footer layout",
    description: "Columns or centred footer arrangement",
    keywords: ["footer", "columns", "centered"],
    applies: layoutModeOnly,
    evidence: "shop.footerLayout is read only in Footer.tsx below `if (themeConfig?.footer) return <ThemeDrivenFooter/>`.",
  },
  {
    id: "Footer size",
    description: "Compact, regular or spacious footer height",
    keywords: ["footer", "height", "density", "padding"],
    applies: layoutModeOnly,
    evidence: "shop.footerDensity is read only in Footer.tsx's legacy branch (same early return as Footer layout).",
  },
  {
    id: "Product page layout",
    description: "Gallery on the left, or gallery on top, on product pages",
    keywords: ["pdp", "product page", "gallery"],
    applies: always,
    evidence: "ProductDetailClient.tsx reads shop.pdpLayout directly; the product page is not section-driven.",
  },
  {
    id: "Cart layout",
    description: "Cart as a page or as a slide-out drawer",
    keywords: ["cart", "drawer", "basket"],
    applies: always,
    evidence: "ShopLayoutClient mounts CartDrawer when shop.cartLayout === 'drawer'; ThemeDrivenHeader's cart icon also branches on it.",
  },
  {
    id: "Checkout layout",
    description: "Single page or step-by-step checkout",
    keywords: ["checkout", "steps", "single page"],
    applies: always,
    evidence: "app/[shop]/checkout/page.tsx dispatches on shop.checkoutLayout; checkout is not section-driven.",
  },
  {
    id: "Icon style",
    description: "Outline or solid icons across the storefront",
    keywords: ["icons", "outline", "solid", "stroke"],
    applies: always,
    evidence: "ThemeDrivenHeader, CartDrawer and EmptyCartState call iconStyleProps(shop.iconStyle, ...).",
  },
  {
    id: "Button shape",
    description: "Sharp, rounded or pill buttons",
    keywords: ["buttons", "radius", "corners", "pill"],
    applies: always,
    evidence: "shop-context sets --theme-btn-primary-radius from shop.buttonRadius; themeButtonBaseStyle's chain reads it ahead of the theme radius.",
  },
  {
    id: "Button fill",
    description: "Solid or outline buttons",
    keywords: ["buttons", "outline", "solid", "fill"],
    applies: always,
    evidence: "HeroSection, NewsletterSection and ProductGridSection pass shop.buttonFill to resolveButtonFillStyle / the button.",
  },
];

const LAYOUT_BY_ID = new Map<string, LayoutEntry>(LAYOUT_ENTRIES.map((e) => [e.id, e]));

export function applicableLayoutEntries(ctx: BuilderContext): LayoutEntry[] {
  return LAYOUT_ENTRIES.filter((e) => e.applies(ctx));
}

export function isLayoutEntryApplicable(id: string | null | undefined, ctx: BuilderContext): boolean {
  const entry = id ? LAYOUT_BY_ID.get(id) : undefined;
  return !!entry && entry.applies(ctx);
}

/**
 * The entry to show for a saved / deep-linked selection: the selection itself when it is
 * applicable, otherwise the first applicable entry (null only if nothing applies).
 */
export function resolveLayoutEntry(selected: string | null | undefined, ctx: BuilderContext): LayoutEntryId | null {
  if (selected && isLayoutEntryApplicable(selected, ctx)) return selected as LayoutEntryId;
  return applicableLayoutEntries(ctx)[0]?.id ?? null;
}

// ---------------------------------------------------------------------------------------------
// Search index
// ---------------------------------------------------------------------------------------------

// Where selecting a result takes the merchant. `settingLabel` is the label text of the field to
// scroll to and highlight inside the panel that opens.
export type SearchTarget =
  | { mode: "sections"; kind: "announcement" }
  | { mode: "sections"; kind: "header" }
  | { mode: "sections"; kind: "footer" }
  | { mode: "sections"; kind: "section"; sectionType: ThemeSectionType }
  | { mode: "theme_settings"; category: string }
  | { mode: "layout"; category: LayoutEntryId };

export interface SearchEntry {
  id: string;
  // The parent area shown as the group header, e.g. "Hero", "Theme settings: Buttons", "Layout".
  group: string;
  label: string;
  description: string;
  keywords: string[];
  target: SearchTarget;
  // Field label to scroll to inside the opened panel (omitted = top of the panel).
  settingLabel?: string;
}

interface RawSetting {
  label: string;
  description: string;
  keywords?: string[];
}

// Chrome rows of the Sections tab.
const CHROME_SETTINGS: Record<"announcement" | "header" | "footer", { group: string; settings: RawSetting[] }> = {
  announcement: {
    group: "Announcement bar",
    settings: [
      { label: "Announcement bar", description: "Turn the bar above your header on or off", keywords: ["on", "off", "show", "hide", "enable", "banner", "notification"] },
      { label: "Scrolling (marquee)", description: "Scroll the message across the bar", keywords: ["marquee", "ticker", "scroll"] },
      { label: "Message", description: "The text shown in the bar", keywords: ["text", "announcement", "notice", "free delivery"] },
      { label: "Speed", description: "How fast the message scrolls, in pixels per second", keywords: ["marquee", "scroll", "faster", "slower", "px/s"] },
      { label: "Rotation speed", description: "How often several messages change", keywords: ["rotate", "interval"] },
      { label: "Announcement bar position", description: "Above or below the header", keywords: ["above", "below", "placement"] },
      { label: "Dismissible (X button)", description: "Let shoppers close the bar", keywords: ["close", "dismiss"] },
      { label: "Background color", description: "Bar background", keywords: ["colour", "color"] },
      { label: "Text color", description: "Bar text colour", keywords: ["colour", "color"] },
    ],
  },
  header: {
    group: "Header",
    settings: [
      { label: "Header", description: "Header layout, rows, blocks and presets", keywords: ["navigation", "top"] },
      { label: "Sticky header", description: "Keep the header visible while scrolling", keywords: ["sticky", "fixed", "scroll behaviour", "shrink", "hide on scroll"] },
      { label: "Mobile navigation", description: "Scroll, drawer, bottom bar or fullscreen menu on phones", keywords: ["mobile", "hamburger", "menu"] },
    ],
  },
  footer: {
    group: "Footer",
    settings: [
      { label: "Footer", description: "Footer columns, payment icons and layout presets", keywords: ["bottom", "links", "payment icons"] },
    ],
  },
};

// Section-level settings, keyed by section type. Only types present in the theme are listed.
const SECTION_SETTINGS: Record<ThemeSectionType, RawSetting[]> = {
  announcement_bar: [
    { label: "Scrolling", description: "Scroll the homepage announcement strip", keywords: ["marquee"] },
    { label: "Speed", description: "How fast the strip scrolls", keywords: ["marquee", "scroll"] },
  ],
  hero: [
    { label: "Content position", description: "Where the heading, text and button sit on the hero", keywords: ["alignment", "align", "3x3", "grid", "top", "bottom", "left", "right", "center"] },
    { label: "Height", description: "Hero height preset", keywords: ["size", "tall", "short"] },
    { label: "Banner height in pixels", description: "Exact hero height on desktop and mobile", keywords: ["px", "banner height"] },
    { label: "Slide duration", description: "Seconds each banner image stays", keywords: ["slideshow", "carousel", "seconds"] },
  ],
  featured_collections: [
    { label: "Heading", description: "Section title", keywords: ["title"] },
    { label: "Display style", description: "Large tiles or round quick icons", keywords: ["tiles", "icons", "circles"] },
    { label: "Columns", description: "Tiles per row", keywords: ["grid"] },
  ],
  product_grid: [
    { label: "Columns", description: "Products per row", keywords: ["grid"] },
    { label: "Card style", description: "Look of each product card", keywords: ["minimal", "elevated", "polaroid"] },
  ],
  testimonials: [{ label: "Testimonials", description: "Customer quotes", keywords: ["reviews"] }],
  rich_text: [
    { label: "Content width", description: "Narrow, medium or wide text block", keywords: ["width", "narrow"] },
  ],
  image_text: [{ label: "Image and text", description: "Image beside a text block", keywords: ["layout"] }],
  newsletter: [{ label: "Newsletter", description: "Email signup form", keywords: ["subscribe", "email"] }],
  brands: [
    { label: "Logos per row", description: "How many brand logos fit across", keywords: ["brands", "grid"] },
    { label: "Link logos to a brand page", description: "Make each logo clickable", keywords: ["link"] },
  ],
  product_tabs: [{ label: "Tabs", description: "Collections shown as switchable tabs", keywords: ["collections"] }],
  trust_bar: [{ label: "Trust bar", description: "Delivery, payment and rating badges", keywords: ["badges", "guarantee"] }],
};

// Notable fields inside each Theme settings category (the category itself is always an entry).
const THEME_SETTING_FIELDS: Partial<Record<(typeof THEME_SETTINGS_CATEGORY_LABELS)[number], RawSetting[]>> = {
  "Logo and favicon": [
    { label: "Logo", description: "Your storefront header logo", keywords: ["brand", "image"] },
    { label: "Inverse logo", description: "Logo for dark or transparent headers" },
    { label: "Favicon", description: "The small icon in the browser tab", keywords: ["tab icon", "browser"] },
  ],
  Colors: [{ label: "Colors", description: "Colour schemes for backgrounds, text and buttons", keywords: ["colour", "scheme", "palette"] }],
  Typography: [
    { label: "Font pairing", description: "Heading and body font bundle", keywords: ["fonts", "typeface"] },
    { label: "Base font size", description: "Body text size", keywords: ["text size"] },
  ],
  Buttons: [{ label: "Primary button", description: "Shape, hover and press effects", keywords: ["cta", "radius", "pill"] }],
  Motion: [
    { label: "Intensity", description: "Overall animation strength", keywords: ["animation"] },
    { label: "Speed", description: "Animation speed multiplier", keywords: ["animation", "faster"] },
  ],
  "Product cards": [
    { label: "Card style", description: "Look of product cards", keywords: ["border", "shadow"] },
    { label: "Show wishlist", description: "Heart button on product cards", keywords: ["favourites", "wishlist"] },
  ],
  "Collection page": [
    { label: "Banner height", description: "Height of the collection banner", keywords: ["banner"] },
  ],
  "Product page": [
    { label: "Earliest delivery", description: "Show the earliest delivery day on product pages", keywords: ["delivery estimate"] },
    { label: "Buy Now Pay Later", description: "Tabby and Tamara card on product pages", keywords: ["bnpl", "tabby", "tamara", "instalments"] },
  ],
  "Floating elements": [
    { label: "WhatsApp", description: "Floating WhatsApp button", keywords: ["chat"] },
    { label: "Back to top", description: "Scroll-to-top button", keywords: ["scroll"] },
  ],
  "Custom CSS": [{ label: "Custom CSS", description: "Your own style rules", keywords: ["css", "code"] }],
};

const THEME_CATEGORY_DESCRIPTIONS: Partial<Record<(typeof THEME_SETTINGS_CATEGORY_LABELS)[number], string>> = {
  "Logo and favicon": "Logo, inverse logo and browser tab icon",
  Colors: "Colour schemes used across the storefront",
  Typography: "Fonts, sizes and heading styles",
  "Page layout": "Page width and margins",
  Radius: "Corner roundness",
  Density: "Spacing between and inside sections",
  Animations: "Hover, image load and add-to-cart effects",
  Motion: "Animation intensity, speed and easing",
  Badges: "Sale, new and sold out badges",
  Buttons: "Button look and behaviour",
  Cart: "Cart drawer and cart page options",
  Drawers: "Drawer colours",
  Icons: "Icon stroke and corners",
  "Input fields": "Form field look",
  "Popovers and modals": "Menus and pop-ups colour scheme",
  Prices: "Sale price colour and style",
  "Product cards": "Product card layout and media",
  Search: "Storefront search look",
  Swatches: "Colour and image swatches",
  "Variant pickers": "Size and option pickers",
  "Custom CSS": "Add your own styles",
  "Collection page": "Collection page banner and filters",
  "Product page": "Product page status line, delivery and Buy Now Pay Later",
  "Floating elements": "WhatsApp, back to top and custom floating buttons",
};

/**
 * Every setting the builder can open, minus the ones that do not apply (rule 7): a Layout entry
 * that does nothing for this shop's mode is never listed, and a section-level setting is only
 * listed when the theme has a section of that type.
 */
export function buildSearchIndex(ctx: BuilderContext): SearchEntry[] {
  const out: SearchEntry[] = [];

  (["announcement", "header", "footer"] as const).forEach((kind) => {
    const { group, settings } = CHROME_SETTINGS[kind];
    for (const s of settings) {
      out.push({
        id: `chrome:${kind}:${s.label}`,
        group,
        label: s.label,
        description: s.description,
        keywords: s.keywords ?? [],
        target: { mode: "sections", kind } as SearchTarget,
        settingLabel: s.label === group ? undefined : s.label,
      });
    }
  });

  (Object.keys(SECTION_SETTINGS) as ThemeSectionType[]).forEach((type) => {
    if (!ctx.sectionTypesPresent.has(type)) return;
    const group = SECTION_TYPE_LABELS[type];
    for (const s of SECTION_SETTINGS[type]) {
      out.push({
        id: `section:${type}:${s.label}`,
        group,
        label: s.label,
        description: s.description,
        keywords: s.keywords ?? [],
        target: { mode: "sections", kind: "section", sectionType: type },
        settingLabel: s.label,
      });
    }
  });

  for (const category of THEME_SETTINGS_CATEGORY_LABELS) {
    const group = `Theme settings: ${category}`;
    out.push({
      id: `theme:${category}`,
      group,
      label: category,
      description: THEME_CATEGORY_DESCRIPTIONS[category] ?? category,
      keywords: [],
      target: { mode: "theme_settings", category },
    });
    for (const s of THEME_SETTING_FIELDS[category] ?? []) {
      if (s.label === category) continue;
      out.push({
        id: `theme:${category}:${s.label}`,
        group,
        label: s.label,
        description: s.description,
        keywords: s.keywords ?? [],
        target: { mode: "theme_settings", category },
        settingLabel: s.label,
      });
    }
  }

  for (const entry of applicableLayoutEntries(ctx)) {
    out.push({
      id: `layout:${entry.id}`,
      group: "Layout",
      label: entry.id,
      description: entry.description,
      keywords: entry.keywords,
      target: { mode: "layout", category: entry.id },
    });
  }

  return out;
}

export interface SearchGroup {
  group: string;
  entries: SearchEntry[];
}

function score(entry: SearchEntry, q: string): number {
  const label = entry.label.toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;
  if (entry.keywords.some((k) => k.toLowerCase().includes(q))) return 40;
  if (entry.description.toLowerCase().includes(q)) return 30;
  if (entry.group.toLowerCase().includes(q)) return 20;
  return 0;
}

/** Grouped results, best group first, best match first inside a group. Empty query = no results. */
export function searchSettings(index: SearchEntry[], query: string): SearchGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = index
    .map((entry) => {
      const parts = tokens.map((t) => score(entry, t));
      return { entry, s: parts.every((p) => p > 0) ? Math.min(...parts) : 0 };
    })
    .filter((x) => x.s > 0);
  const groups = new Map<string, { group: string; entries: { entry: SearchEntry; s: number }[]; best: number }>();
  for (const x of scored) {
    const g = groups.get(x.entry.group) ?? { group: x.entry.group, entries: [], best: 0 };
    g.entries.push(x);
    g.best = Math.max(g.best, x.s);
    groups.set(x.entry.group, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.best - a.best || a.group.localeCompare(b.group))
    .map((g) => ({
      group: g.group,
      entries: g.entries.sort((a, b) => b.s - a.s || a.entry.label.localeCompare(b.entry.label)).map((x) => x.entry),
    }));
}
