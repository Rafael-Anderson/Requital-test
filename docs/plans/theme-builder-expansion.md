# Theme builder capability expansion

**Status:** planning. Not started. No code in the session that produced this doc.

## 0. Goal and non-goals

Three real UAE flower/gift storefronts (`100flower.ae`, `800flower.ae`, Arabian
Petals) set the target capability bar. A merchant on Requital today cannot
reproduce their structure. This plan closes the specific gaps, ordered by
merchant-visible differentiation per unit of architectural churn.

**Non-goals** (explicit, do not drift into these):

- No rebuild of the theme builder. The section/block/globalSettings architecture
  from the storefront-v2 rework stays; every item here is additive to it.
- No cloning of those sites' visual design, assets, copy, or branding. The test
  is "a merchant *could* build something shaped like this," not "it looks like
  theirs."
- No new npm dependency without an explicit justification line and a no-dep
  fallback (see §6). Current expectation: **zero** new deps.
- No i18n / RTL / multi-currency work. The language selector in Site 1's header
  is out of scope as a *functional* control; a non-functional placeholder block
  is in scope only if it costs nothing (see TBE4).

## 1. What exists today

### 1.1 The config shape (`backend/src/themes/theme-config.types.ts`, mirrored in `admin/lib/types.ts` + `storefront/lib/theme-config-types.ts`)

```
ThemeConfig
├─ globalSettings   (20 fixed nested categories: logo, colorSchemes[], typography,
│                     pageLayout, animations, badges, buttons, cart, drawers, icons,
│                     inputFields, popovers, prices, productCards, search, swatches,
│                     variantPickers, customCss, collectionPage, productPage)
├─ header  : { settings: Record<string,unknown>, blocks: ThemeBlock[] }   ← global chrome, NOT in `sections`
├─ footer  : { settings: Record<string,unknown>, blocks: ThemeBlock[] }   ← global chrome, NOT in `sections`
└─ sections: ThemeSection[]   (reorderable homepage body only)

ThemeBlock = { id, type, visible, order, settings: Record<string,unknown>, blocks?: ThemeBlock[] }  ← recursive, depth cap 4
```

Section type catalog (`SECTION_TYPES`): `announcement_bar`, `hero`,
`featured_collections`, `product_grid`, `testimonials`, `rich_text`,
`image_text`, `newsletter`, `brands`. Header block catalog (`BLOCK_TYPES.header`):
`logo`, `nav_menu`, `search_icon`, `cart_icon`, `account_icon`, `header_text`,
`image`, each with a `settings.zone` of `left | center | right` and an `order`.

### 1.2 Validation (`backend/src/themes/theme-config.validation.ts`)

Structural only. Top-level keys are allow-listed (`globalSettings`, `header`,
`footer`, `sections` — anything else 400s). `sections[].type` must be in
`SECTION_TYPE_SET`. Block trees are checked for `{id,type,visible,order,settings}`
shape and depth ≤ 4. **`settings` sub-fields are deliberately not schema-checked**
— a malformed nested field renders with a client fallback, it does not 400 the
save. Custom CSS is the one real content check (1500 char cap, reject-list for
`@import`/`<script`/`expression(`/etc., matched against an escape-normalised
string).

Consequence for this plan: **adding a section type, a block type, or a
`globalSettings.*` category is additive and low-risk.** The migration cost lands
only if we *restructure* an existing key (see §4).

### 1.3 Storefront rendering

- `storefront/app/[shop]/page.tsx` → `SectionRenderer` maps `section.type` →
  one component from `SECTION_COMPONENTS`. Every section renders **one static
  content set**. No section switches content client-side.
- Header: `components/TopBar.tsx` dispatches to `theme-sections/ThemeDrivenHeader.tsx`
  when `themeConfig?.header` exists (else the legacy `topBarLayout` dispatch).
  `ThemeDrivenHeader` renders a **single** `grid-cols-3` row from the header
  blocks, keyed by each block's `zone`. `nav_menu` is *not* rendered there — it
  renders full-width **below** the header via `components/MenuBar.tsx`
  (`ShopLayoutClient`'s `Header()`), left-aligned, `overflow-x-auto`.
- `components/AnnouncementBar.tsx` — persistent chrome above the header, gated
  on legacy `shop.announcementBarEnabled`, reads `shop.notificationText`
  (multi-message join / marquee, **not** dismissible, **not** per-message
  rotating with a crossfade).
- `theme-sections/AnnouncementBarSectionThemed.tsx` — a *homepage-body section*
  (scrolls away with the page), repeatable `announcement` blocks, **already
  rotates with a crossfade**, already supports marquee mode. Not dismissible.
- `components/WhatsAppFloatingButton.tsx` — hardcoded chrome in
  `ShopLayoutClient`, gated on legacy `shop.whatsappFloatingButtonEnabled`.
  **Not represented in `theme.config` at all.** No other floating/overlay
  element exists.
- `components/ProductCard.tsx` + `theme-sections/ProductGridSection.tsx`'s
  `GridProductCard` — driven by `globalSettings.productCards` (quick-add,
  `showCarousel`, name font, `showProductDescriptions`), the `product_card`
  sub-block toggles (`product_media` / `product_title` / `product_price`), and
  `globalSettings.animations.cardHoverEffect` — where **`swap` already does a
  hover image swap**. No wishlist control, no sale-badge render, no
  vendor/rating metadata.
- `theme-sections/FeaturedCollectionsSection.tsx` — **already an image-tile grid
  linking to collections** (`grid-cols-2 sm:grid-cols-4`, fixed). This is ~80%
  of Site 2's "Shop by Occasion." Missing: column count, aspect ratio, and
  overlay-text styling as settings.
- `components/home-layouts/SlideshowHero` / `theme-sections/HeroSection.tsx`'s
  `HeroSlideshow` — auto-rotating banner backdrop already exists. **No dot
  pagination indicators.** No "inset / rounded corners (not full-bleed)"
  setting.

### 1.4 Known hardcoded (non-themeable) surfaces

The A3 teal-hover bug (`--color-mouse-over` defaulting to the admin accent) was
one instance of a wider pattern. Others found in the same sweep:

| Location | Hardcoded value | Effect on a dark-themed shop |
|---|---|---|
| `MenuBar.tsx` `MegaMenuPanel` | `bg-white`, `text-zinc-700`, `borderColor:"#E4E7E7"`, `boxShadow` literal | White flyout with dark text over a dark site |
| `MenuBar.tsx` DROPDOWN panel | `bg-white dark:bg-zinc-900`, `border-black/10` | `dark:` never fires on the storefront → always white |
| `SearchBar.tsx` results input | `bg-white dark:bg-zinc-900` | same |
| `ProductCard.tsx` | `text-red-600 dark:text-red-400` (sale price), `bg-white/90 text-red-600` (out-of-stock pill) | fixed red, fixed white pill |
| `ProductCard.tsx` list excerpt | `text-zinc-500` | not `--color-price-main`, ignores theme |

`globalSettings.popovers` / `drawers` / `badges` **exist in the config** with
admin UIs but **have no storefront consumer** (confirmed: `storefront/CLAUDE.md`
lists them among "genuinely have no consumer to wire yet"). The config vocabulary
is ahead of the wiring.

## 2. Capability matrix

Legend: **A** = already possible · **B** = possible but awkward / partial ·
**C** = not possible without new work.

### Site 1 — 100flower.ae

| Feature | Verdict | Why |
|---|---|---|
| Announcement bar, multiple rotating messages + emoji | **B** | `AnnouncementBarSectionThemed` already rotates repeatable blocks with a crossfade. But it is a *homepage-body section* — it scrolls away and does not appear on PDP/collection pages. The *persistent* `AnnouncementBar.tsx` (chrome) does **not** rotate per-message and is driven by a legacy `shop.*` field, not `theme.config`. |
| Announcement bar dismissible with X | **C** | Neither announcement component has a dismiss control or any client-persistence (`localStorage`) hook. |
| Header utility row: language selector, click-to-call, centered logo, then icons | **C** | Header is one `grid-cols-3` row. No second ("utility") row concept. No `phone` or `language` block type. Logo *can* be centred (`zone: center`); the rest cannot be arranged as a distinct row. |
| Nav as a separate centered row below the header, with dropdown indicators | **B** | The nav row already renders below the header (`MenuBar.tsx`) and dropdown/mega items already get a `ChevronDown`. But items are hard-left-aligned — no alignment setting — and the row has no independent background/height/border controls beyond `menuBarBackground`. |
| Hero slideshow with dot pagination | **B** | Slideshow backdrop exists (`HeroSlideshow`). No pagination-dot UI, no "show indicators" setting. |
| Trust / social-proof strip ("Built on Trust & Quality" + reviews badge) | **B** | `components/TrustStrip.tsx` exists but is **legacy-homepage only** (not a builder section) and its content is fixed. `testimonials` section covers quotes but not a compact "badge + tagline" strip. |
| Tabbed product carousel (pill toggles swap the product set, no reload) | **C** | No section type switches content client-side. Every section is one static set. This is the single clearest architectural gap. |
| Wishlist heart icons on product cards | **C** | No wishlist/favourites feature anywhere in backend, storefront, or customer-account. Not just a theme gap — a missing product area. |
| Floating WhatsApp button | **A** | `WhatsAppFloatingButton.tsx` ships it. (But it is not builder-controlled — see the floating-UI row below.) |

### Site 2 — 800flower.ae

| Feature | Verdict | Why |
|---|---|---|
| Three-zone header: logo left, nav centered inline, utilities right, cart count badge | **B** | Zones + block order exist; cart count badge already renders in `ThemeDrivenHeader`. The gap is **nav inline in the header row** — today `nav_menu` always renders as its own full-width row below, never inside a header zone. |
| Hero with inset margins + rounded corners (not full-bleed) + dot pagination | **C** (inset) / **B** (pagination) | `HeroSection` has `height` presets but no "inset / max-width / corner-radius" setting; it is always edge-to-edge. Pagination as above. |
| "Shop by Occasion" category tile grid (image tiles → collections) | **B** | `FeaturedCollectionsSection` *is* this, at a fixed `grid-cols-2 sm:grid-cols-4` with no aspect/overlay controls. |
| Floating rewards widget + chat widget | **C** | No overlay concept in `theme.config`. A generic "custom floating link button" would cover a rewards launcher; an embedded third-party chat script is out of scope (script injection → security review). |

### Site 3 — Arabian Petals

| Feature | Verdict | Why |
|---|---|---|
| Thin contact bar above the header (phone + WhatsApp + hours) | **C** | Same as Site 1's utility row — no bar/row above the header slot other than the announcement bar, and no phone/hours block types. |
| Colored header band with nav inline next to the logo | **B** | Header background is themeable (`header.settings.background`, solid/gradient/image). Nav-inline-with-logo is the same "nav can't sit in a header zone" gap. |
| Inset / rounded hero banner | **C** | Same hero inset gap as Site 2. |
| Collection sections with a "View all" affordance | **A** | `FeaturedCollectionsSection` has `view_all_button`; `ProductGridSection` has `showViewAllButton` / `viewAllLabel`. |

### The five structural questions

| # | Question | Answer |
|---|---|---|
| Q1 | Is the header a configurable surface at all? | **Partially — the real blocker is structure, not the block system.** It is already a block container with a 7-type catalog, three zones, per-block `order`/`visible`, and ~6 header-level settings. What it *cannot* express: (a) more than one structural row (no "contact bar above" / "utility row above nav"), (b) `nav_menu` living inside a header zone rather than a forced full-width row below, (c) block types beyond the fixed 5 utilities (no phone, hours, language, social row), (d) nav-row alignment. Fixing (a)–(d) is additive (§3 P1–P2), **not** a rebuild. |
| Q2 | Are product cards configurable? | **Mostly yes.** `globalSettings.productCards` + `product_card` sub-blocks + `cardHoverEffect: swap` (hover image swap already works) cover most of it. Gaps: sale-badge rendering (`globalSettings.badges` exists but is dead), extra metadata sub-blocks (vendor/rating/short-desc as toggles), and wishlist (a missing feature, not a card-config gap). The sub-block shape is correct — extend it, don't replace it. |
| Q3 | Does the section system support tabbed / filtered content? | **No — genuine blocker.** Every section renders one static content set. Needs one new section type whose `settings` holds an array of `{label, collectionId}` and whose component switches client-side. No config-shape change (a new type + an array inside its own `settings`). |
| Q4 | Is there any concept of floating / persistent UI? | **No — small blocker.** `WhatsAppFloatingButton` is hardcoded chrome on a legacy `shop.*` flag, absent from `theme.config`. Add one `globalSettings.floatingElements` category; wire WhatsApp through it and add a generic custom-link button. Embedded third-party widgets stay out (script injection). |
| Q5 | How much visual polish is themeable vs hardcoded? | **Config vocabulary is ahead of the wiring.** Section- and card-level colour is largely tokenised. But popovers / dropdowns / the mega-menu flyout carry hardcoded `bg-white` / `text-zinc-*` / literal hex and dead `dark:` variants (table in §1.4), and `globalSettings.popovers`/`drawers`/`badges` have no consumer. Same class as the A2/A3 bugs. Pure wiring debt, no architecture change. |

## 3. Prioritised build list

Ordered by **merchant-visible differentiation ÷ architectural churn**, not by
ease alone. Each item states its kind: **[section]** new section type ·
**[section-ext]** extension to an existing section · **[global]** new/extended
`globalSettings` category · **[chrome]** header/footer container change ·
**[arch]** touches how config is stored · **[feature]** needs backend/data work
beyond theming.

### Tier 1 — highest impact, low churn (do first)

1. **Header rows + nav placement + expanded utility catalog.** **[chrome]**
   *Differentiation:* this is most of what separates all three target sites from a
   stock Requital storefront (contact bar, two-row header, centered inline nav,
   colored band).
   *Churn:* additive. `header.settings.rows?: { id, blockIds: string[], align, background?, height? }[]` — optional; when absent, render exactly as today
   (one implicit row from `zone`). New header block types: `contact_bar_item`
   (icon + `tel:` / `https://wa.me` / plain text — covers phone, WhatsApp,
   hours), `social_row`, `language_switcher` (**non-functional placeholder** —
   renders a static label + caret, no i18n; gated behind a "coming soon"
   note in admin, see TBE4). Allow `nav_menu` in a header row (so it can sit
   inline between logo and utilities) *and* keep the below-header render when it
   is not placed in a row. Nav alignment setting on `nav_menu.settings.align`.
   *No config-shape reset* — `rows` is a new optional key inside the already-
   free-form `header.settings`.

2. **Tabbed product section.** **[section]** `product_tabs`.
   *Differentiation:* Site 1's signature feature; reads as "a real modern store."
   *Churn:* self-contained. `settings.tabs: { id, label, collectionId }[]` +
   shared card settings (reuse `ProductGridSection`'s existing `columns` /
   `cardStyle` / limit). Storefront component fetches each tab's products lazily
   on first activation (it already does exactly one collection fetch today —
   this is N of the same call, keyed by tab). Register in `SECTION_TYPES`
   (×3 files), `SECTION_TYPE_LABELS`, `SECTION_COMPONENTS`, `SETTINGS_COMPONENTS`,
   `BLOCK_TYPES.product_tabs = []`. Validation picks it up via `SECTION_TYPE_SET`
   automatically.

3. **Wire the dead config + de-hardcode popovers/dropdowns/mega-menu.**
   **[global]** (no new keys — wiring only).
   *Differentiation:* makes dark themes actually work end to end; removes the
   whole A2/A3 bug class. Every merchant on a non-default palette benefits.
   *Churn:* pure wiring. Give `MegaMenuPanel`, the DROPDOWN panel, and
   `SearchBar`'s results surface a themed background/text/border from
   `globalSettings.popovers` (+ its `schemeId`). Render sale badges from
   `globalSettings.badges` on `ProductCard` / `GridProductCard`
   (position/cornerRadius/scheme already in the schema). Replace the remaining
   `text-zinc-*` / literal-hex in cards with `--color-*` tokens. Add a
   `--color-popover` / `--color-popover-fg` pair in `globals.css` + `theme-colors.ts`
   resolved from the scheme, same mechanism as the A1 fix's server-emitted vars.

### Tier 2 — high impact, moderate churn

4. **Persistent + dismissible announcement bar, builder-controlled.**
   **[chrome]** move the persistent bar into `theme.config`.
   *Churn:* medium. New `announcement_bar` role for the *chrome* slot (distinct
   from the existing homepage-body section) — reuse `AnnouncementBarSectionThemed`'s
   rotation/marquee logic, add `dismissible` + a `localStorage` key (per shop,
   same convention as `cart.tsx` / `CookieConsentBanner`). Keep the legacy
   `shop.announcementBarEnabled` path as the fallback for un-migrated shops.

5. **Hero inset + pagination dots.** **[section-ext]** `hero`.
   *Churn:* small-medium. `settings.layout: 'full_bleed' | 'inset'`,
   `settings.cornerRadius`, `settings.showSlideIndicators`. `HeroSlideshow`
   already tracks the active slide index — the dots are a render addition, not
   new state.

6. **Category tile grid controls.** **[section-ext]** `featured_collections`.
   *Churn:* small. `settings.columns` (2–6), `settings.aspectRatio`
   (`square | portrait | landscape`), `settings.overlayText` (bool — name over
   the image vs. below it). The section already renders the tiles.

7. **Floating elements category.** **[global]** `globalSettings.floatingElements`.
   *Churn:* small-medium. `{ whatsapp: {enabled, position}, customButtons: [{id,label,iconUrl,url,position}] }`.
   Wire `WhatsAppFloatingButton` to read this (fall back to the legacy
   `shop.whatsappFloatingButtonEnabled`). `customButtons` covers a rewards /
   loyalty launcher as a link-out. **No** embedded script widgets.

8. **Trust strip as a real section.** **[section]** `trust_bar` (or fold into
   `testimonials` as a `compact` variant).
   *Churn:* small. Blocks: repeatable `trust_item` (icon + short text) + optional
   `rating_badge` (static number + star row + link). Pure presentational.

### Tier 3 — high impact, high churn (schedule separately)

9. **Wishlist.** **[feature]** not a theming task.
   Needs: a `wishlist` table (or a JSON array on `customer`, matching how
   addresses are stored), `customer-account` endpoints, storefront cart-style
   context, a heart control on `ProductCard` gated by a new
   `globalSettings.productCards.showWishlist`. Real scope: one PR of backend +
   one of storefront. Listed here so it is not mistaken for a quick card toggle.

10. **Header "layout variants" preset picker.** **[chrome]** optional sugar on
    top of item 1 — 3–4 named starting arrangements ("classic," "centered,"
    "contact-bar + centered nav") that just seed `header.settings.rows` + block
    zones. Only worth doing after item 1 proves the row model.

### Explicitly not worth doing now

- Full drag-and-drop header row editor UI — item 1's settings-panel form is
  enough to ship the capability; a visual row editor is polish.
- Per-section colour-scheme overrides beyond what `section.settings.schemeId`
  already allows.
- Mega-menu featured-image columns (image inside a mega column) — the block
  tree supports it structurally; low demand, defer.

## 4. Config-shape / migration constraints

`storefront/CLAUDE.md`: **"`theme.config` JSON shape changes are reset, not
migrated"** — there is no migration path for the config blob; a shape change
means every existing theme silently reverts affected keys to the seed default.

What that rules in and out for this plan:

- **Safe (additive), all of Tier 1–2 above:**
  - New `sections[].type` values (`product_tabs`, `trust_bar`) — `settings` is
    free-form, validation only checks the type is in the set and the block shape.
  - New block types in `BLOCK_TYPES` (`contact_bar_item`, `social_row`, etc.).
  - New `globalSettings.*` categories (`floatingElements`) — the validator only
    deep-checks `colorSchemes[].id` and `customCss`; everything else is opaque.
  - New optional keys inside `header.settings` / `footer.settings` /
    `section.settings` (`rows`, `layout`, `cornerRadius`, `align`, `tabs`) —
    consumers already `typeof`-guard every settings field, so absence = old
    behaviour with zero fallback code.
- **Requires a reset (avoid, or gate behind a deliberate decision):**
  - Changing `header` from `{settings, blocks[]}` to an array of row objects, or
    making `blocks` a map. **Do not.** Item 1 keeps `blocks[]` flat and layers
    `rows` (which reference block ids) on top.
  - Renaming or re-nesting any existing `globalSettings` category or
    `section.settings` field.
  - Removing a `SECTION_TYPES` entry.
- **The allow-list gotcha:** `assertValidThemeConfig` 400s on any unknown
  *top-level* key. A new top-level sibling to `sections` (e.g. `overlays`) would
  need the allow-list updated in lockstep across backend + both mirrors, and is
  still additive-safe once it is. Prefer nesting under `globalSettings` to avoid
  touching the allow-list at all (item 7 does this).

**Rule for every item here:** new data goes into an *optional* field inside an
*existing* container. If a proposal can't be expressed that way, it moves to a
Tier 3 "needs a deliberate reset" bucket and gets its own decision row.

## 5. Phasing (one phase per PR)

Same convention as `docs/plans/custom-domain-resolver.md`: each phase
independently shippable, CI-green, tests included. Cross-app type mirrors
(`backend` ↔ `admin/lib/types.ts` ↔ `storefront/lib/theme-config-types.ts`)
updated in the same PR with cross-reference comments. Storefront pure-logic
resolvers get vitest coverage; admin settings components get a render smoke test;
backend gets a `theme-config.validation` case per new type.

- **Phase 1 — De-hardcode + wire dead config (build item 3). ✅ DONE 2026-09-02.**
  No new config keys. `--color-popover` / `--color-popover-fg` /
  `--color-popover-border` added to `storefront/app/globals.css`'s plain `@theme`
  block (literal light defaults matching the old hardcoded values); resolved
  per-shop from `globalSettings.popovers.schemeId` in `storefront/lib/shop-context.tsx`'s
  `applyThemeConfigOverrides` (falls back to the default active scheme;
  `--color-popover-border` only overridden when the scheme defines a `border`).
  **Deviation from the plan text:** the vars were *not* added to
  `storefront/lib/theme-colors.ts` or the backend/admin `THEME_COLOR_*` mirrors —
  that file is the merchant-settable Appearance Color hex list, and a popover
  colour derived from the colour scheme belongs with `--color-accent` in
  `applyThemeConfigOverrides`, not there. No type/mirror change was needed
  (`PopoverSettings.schemeId` already exists in all three).
  `MegaMenuPanel` + the nav DROPDOWN panel (`MenuBar.tsx`), the header search
  results surface (`SearchBar.tsx`), and `ProductCard.tsx`'s list-excerpt
  `text-zinc-500` + sale-price dead `dark:` variant switched to tokens
  (`bg-popover` / `text-popover-fg[/60]` / `border-popover-border` /
  `text-price-main`). The out-of-stock pill's `bg-white/90` → `bg-background/90`.
  `globalSettings.badges` (position / cornerRadius / scheme / case / font)
  renders a Sale / Sold out chip on `ProductCard` **and** `GridProductCard` via
  the new pure `storefront/lib/product-badge.ts` (`resolveProductBadge`,
  returns `null` for an un-themed shop so the legacy pill still shows). Sale
  badge on `GridProductCard` is deferred — that section deliberately does not
  compute auto-discounts — only the Sold out chip is wired there.
  **`dark:` sweep:** removed at the touched call sites only (4 occurrences in
  `MenuBar.tsx` / `SearchBar.tsx` / `ProductCard.tsx`). A full storefront sweep
  is ~23 files of pure noise removal with zero behaviour change; tracked as a
  separate follow-up commit rather than bundled here to keep this diff
  reviewable.
  Tests: `storefront/lib/product-badge.test.ts` (5 cases). Gate: storefront
  build clean, vitest 288 pass, lint +0. Backend/admin untouched.

- **Phase 2 — Tabbed product section (build item 2). ✅ DONE 2026-09-02.**
  New `product_tabs` section type end to end. `ThemeSectionType` +
  `SECTION_TYPES` + `SECTION_TYPE_LABELS` + `BLOCK_TYPES.product_tabs = []`
  mirrored across `backend/src/themes/{theme-config.types,constants}.ts`,
  `admin/lib/types.ts`, `storefront/lib/theme-config-types.ts` (cross-ref
  comments). `admin/lib/useThemeEditor.ts`'s `defaultSettingsForType` /
  `defaultBlocksForType` seed `{ tabs: [], columns: 4, productLimit: 8 }` /
  `[]`. Admin `ProductTabsSettings.tsx` (label + collection Combobox +
  up/down/remove per tab, "+ Add tab", columns/limit) registered in
  `SettingsPanel.tsx`; the shared `AddSectionModal` picks it up from
  `SECTION_TYPES` automatically. Storefront `ProductTabsSection.tsx`
  (registered in `SectionRenderer.tsx`) — pill toggles, per-tab products
  lazy-fetched on first activation and cached in a `Record`, reuses the
  shared `<ProductCard>`. Tab normalisation is the pure
  `storefront/lib/product-tabs.ts`'s `resolveProductTabs` (drops malformed
  entries, de-dupes by id, `[]` ⇒ section renders nothing).
  **Deviation:** the active-tab / loading state was originally two `useState`s
  updated synchronously in effects (`react-hooks/set-state-in-effect`, +2
  lint); restructured so the effective active id is derived in render and
  loading is `byTab[activeId] === undefined` — no lint delta, no separate
  loading state.
  Tests: `storefront/lib/product-tabs.test.ts` (3),
  `admin/.../ProductTabsSettings.test.tsx` (3 render smoke),
  `backend/.../theme-config.validation.spec.ts` +2 (`product_tabs` accepted;
  a malformed `tabs` array does **not** 400 — matches the validator's shallow
  stance). Gate: backend `tsc` clean + jest green, admin build + vitest 381,
  storefront build + vitest 291, lint +0 (backend baseline 297 → 307, dated
  note in CLAUDE.md — the documented `baseConfig()` `any`-fixture category).

- **Phase 3 — Header rows + nav placement + utility catalog (build item 1). ✅ DONE 2026-09-02.**
  `HeaderRow` (`{ id, blockIds[], align?, background? }`) mirrored across the
  three type files; stored on the already-free-form `header.settings.rows` —
  **no structural change** to `HeaderFooterConfig`. New header block types
  `contact_bar_item` / `social_row` / `language_switcher` added to
  `BLOCK_TYPES.header` + `BLOCK_TYPE_LABELS` (backend `constants.ts` +
  `admin/lib/types.ts`); the block `type` field has no server allow-list so
  the validator already accepts them (a spec case documents it). Storefront
  `lib/header-rows.ts` (`resolveHeaderRows` / `navMenuInHeaderRow`, pure) —
  **returns `null` whenever `rows` is absent/empty/invalid, and
  `ThemeDrivenHeader` then renders its exact old 3-zone grid code path**
  (`outerClass` extracted, string-identical). Rows path renders one bar per
  row; unplaced blocks (except `nav_menu`) append to the last row.
  `renderBlock` gained the 3 utility cases + a `nav_menu` case
  (`<MenuBar inline />`); the classic zone filter now explicitly excludes
  `nav_menu` (it was already `null` there). `MenuBar` gained an `inline` prop
  (drops the `<nav>` border/bg/centering) and a `nav_menu.settings.align`
  control for the below-header bar. `ShopLayoutClient.showMenuBar` consults
  `navMenuInHeaderRow` to skip the below-header bar when nav is placed in a
  row. Admin: `HeaderSettings.tsx` takes a new `blocks` prop and renders a
  form-based rows editor (align / bg / assign-blocks / reorder / remove);
  `NavElementSettings` gained an Alignment select; `BlockSettingsForm` gained
  the 3 new block-type forms (`language_switcher` = a "coming soon" note,
  TBE4).
  **Regression gate (hard):** `ThemeDrivenHeader.test.tsx` asserts the
  `.grid.grid-cols-3` with exactly 3 zone columns renders when `rows` is
  absent *and* when `rows: []` — **PASS**.
  Tests: `storefront/lib/header-rows.test.ts` (7),
  `storefront/.../ThemeDrivenHeader.test.tsx` (3),
  `admin/.../HeaderSettings.test.tsx` +3 (rows editor),
  `backend/.../theme-config.validation.spec.ts` +2. Gate: backend `tsc` +
  jest green, storefront build + vitest 301, admin build + vitest 380 (the 3
  `AccountSetup.test.tsx` fails are the documented pre-existing full-suite
  flake — pass 12/12 in isolation). Lint: backend baseline 307 → 313 (same
  documented `baseConfig()` `any`-fixture category, dated note in CLAUDE.md);
  admin / storefront +0.

- **Phase 4 — Hero inset + pagination, category-tile controls (build items 5 + 6). ✅ DONE 2026-09-02.**
  `settings` additions only, no new types, no backend change.
  Hero (`HeroSection.tsx` / admin `HeroSettings.tsx`): `heroLayout`
  (`full_bleed` default / `inset` — inset wraps the hero in a
  `--theme-max-width` container with `py-4`), `cornerRadius` (px, only shown
  in admin for the inset layout), `showSlideIndicators` (dot pagination row
  added to `HeroSlideshow`, which already held the `index` state — a dot
  click calls the existing `setIndex`; dots are white/translucent over the
  photo, above the banner link).
  **Deviation:** the key is `heroLayout`, not the plan's `settings.layout` —
  `layout` is too generic a name to reserve on the free-form settings bag.
  Featured Collections (`FeaturedCollectionsSection.tsx` / admin
  `FeaturedCollectionsSettings.tsx`): `columns` (2–6, literal Tailwind class
  map, mobile stays 2-up), `aspectRatio` (`square`/`portrait`/`landscape`),
  `overlayText` (name in a gradient overlay on the image vs. the `<p>`
  below). Tile inner div gained `relative` (no-op with no positioned child).
  Every key absent ⇒ the exact previous rendering.
  Tests: `HeroSection.test.tsx` +4, `FeaturedCollectionsSection.test.tsx` +2,
  `admin/.../HeroSettings.test.tsx` (3, new), `admin/.../FeaturedCollectionsSettings.test.tsx`
  (2, new). Gate: storefront build + vitest 307, admin build + vitest 385
  (+3 documented `AccountSetup` flake), lint +0 both.

- **Phase 5 — Persistent dismissible announcement bar (build item 4). ✅ DONE 2026-09-02.**
  `AnnouncementBarConfig` (`{ enabled, messages[], scrolling?, speed?,
  dismissible?, background?, textColor? }`) mirrored across the 3 type files;
  stored at `header.settings.announcementBar` (free-form settings bag, no
  structural change). Storefront `components/AnnouncementBar.tsx` rewritten:
  a themed `ThemedAnnouncementBar` (rotation via the new shared
  `lib/announcement-rotation.ts` hook, marquee, dismiss-with-X persisted per
  shop + per message-set to `localStorage` via `announcementDismissKey`, a
  djb2 hash so a re-worded bar re-shows) when a config exists, else the
  **legacy `shop.announcementBarEnabled` / `shop.notificationText` path,
  byte-identical**. `background`/`textColor` unset ⇒ `bg-accent` fallback.
  Admin: `AnnouncementBarChromeSettings.tsx` (enable / message list / marquee
  / speed / dismissible / colors) rendered inside `HeaderSettings.tsx`.
  **Deviation:** `AnnouncementBarSectionThemed` was NOT refactored to use the
  shared hook (its own test suite + preview-edit concerns) — it keeps its
  inline rotation copy; the shared module carries a comment saying so.
  Tests: `storefront/lib/announcement-rotation.test.ts` (3),
  `storefront/components/AnnouncementBar.test.tsx` (7, incl. legacy-fallback
  + dismiss-persistence), `admin/.../AnnouncementBarChromeSettings.test.tsx`
  (4). Gate: backend `tsc` + jest (validation spec +1), storefront build +
  vitest 317, admin build + vitest 387 (+4 documented `AccountSetup` flake).
  Lint: backend baseline 313 → 317 (`any`-fixture category); storefront
  34 → 35 (`setFaded` in the rotation interval — the same shape
  `AnnouncementBarSectionThemed` already carries in the baseline, now in a
  shared hook; dated note in CLAUDE.md); admin +0.

- **Phase 6 — Floating elements + trust bar (build items 7 + 8). ✅ DONE 2026-09-02.**
  `FloatingElementsSettings` / `FloatingCustomButton` / `FloatingPosition`
  mirrored in the 3 type files; `GlobalThemeSettings.floatingElements?`
  OPTIONAL, nested under `globalSettings` so `assertValidThemeConfig`'s
  top-level allow-list is untouched (§4); `DEFAULT_THEME_CONFIG` seeds a
  no-op `{ whatsapp: { enabled: false }, customButtons: [] }`. Storefront:
  `shouldShowWhatsAppButton` gained an `enabledOverride?` arg (wins over the
  legacy `shop.whatsappFloatingButtonEnabled` both ways; `undefined` ⇒
  legacy); `WhatsAppFloatingButton` passes `floatingElements.whatsapp.enabled`
  + position. New `components/FloatingCustomButtons.tsx` (link-out only, no
  embedded scripts — TBE7; per-side stacks above the WhatsApp button),
  mounted in `ShopLayoutClient`. New admin theme-settings category **"Floating
  elements"** (21st; guards `undefined` with a local `DEFAULT`). New
  **`trust_bar` section** end to end (`heading` / `trust_item` / `rating_badge`
  blocks; `useThemeEditor` seeds two `trust_item`s; `TrustBarSettings` +
  `BlockSettingsForm` forms; presentational `TrustBarSection.tsx`).
  Tests: `whatsapp-button.test.ts` +3, `TrustBarSection.test.tsx` (4),
  `FloatingCustomButtons.test.tsx` (4), `FloatingElementsSettings.test.tsx`
  (3), `theme-config.validation.spec.ts` +2. Gate: backend `tsc` + jest,
  storefront build + vitest 328, admin build + vitest 390 (+4 documented
  `AccountSetup` flake). Lint: backend baseline 317 → 325 (`any`-fixture
  category); storefront / admin +0.

- **Phase 7 (separate track, not blocked by the above) — Wishlist (item 9). ⏸ DEFERRED 2026-09-02 — not started.**
  Deferred deliberately, per the phase's own "stop rather than ship a
  half-tested customer-data feature" instruction. Reasons:
  1. It is **not theme-builder work** — Phases 1–6 (the actual capability-gap
     closure this doc was written for) are complete, gated, and committed.
     Wishlist is a customer-data feature (auth-scoped PII-adjacent state)
     that stands alone.
  2. It requires a **DB migration** (`customer.wishlist` JSON column). This
     repo's #1 documented failure mode is a migration that passes against the
     long-lived local dev DB but fails CI's clean service-container
     `db:migrate` — a path that cannot be exercised from here. Shipping an
     unverifiable migration in the same session as six other phases is the
     wrong risk.
  3. The required multi-tenant **adversarial isolation e2e** (customer A
     cannot read/write customer B's wishlist; cross-shop holds, per the
     `security-outlet-isolation` convention) needs to genuinely run and pass
     in CI to be worth anything — same constraint as (2).
  Scope when picked up (unchanged from item 9): `customer.wishlist` JSON
  array (TBE5, mirroring `customer.addresses`); `customer-account` endpoints
  `GET/POST/DELETE .../account/wishlist[/:productId]` behind
  `CustomerAuthGuard`, scoped to `ctx.customerId` + `ctx.shopId`; storefront
  `lib/wishlist.tsx` context (auth-gated — heart hidden / login-prompt when
  logged out); heart control on `ProductCard` gated by a new optional
  `globalSettings.productCards.showWishlist` (the only theme-side change,
  lands with the storefront PR); `backend/test/wishlist-isolation.e2e-spec.ts`.
  Split: one backend commit, one storefront commit.

Header layout-variant presets (item 10) fold into Phase 3 as a follow-up commit
only if Phase 3 review agrees the row model is stable.

## 6. New dependencies

**None proposed.** Every item is achievable with what is installed:

- Tabbed section: React state + the existing `lib/api.ts` fetch helpers. No tab
  library.
- Pagination dots: plain buttons + the slide index `HeroSlideshow` already
  tracks. No carousel library.
- Dismiss persistence: `localStorage`, matching `cart.tsx` /
  `CookieConsentBanner`. No cookie/state library.
- Floating buttons: `<a>` + `position: fixed`, matching `WhatsAppFloatingButton`.

If a future reviewer wants a carousel lib for the hero, the no-dep fallback is
the current CSS-translate `HeroSlideshow` — it already works; a library would
only add swipe gestures, which can be done with pointer events (the codebase
already does this in `PreviewInteraction.tsx`).

## 7. Decisions (TBE1–TBE8 — all locked 2026-09-02)

All eight resolved as the recommendation below. No open questions remain; this
section is now a decision record.

| ID | Question | **Decision** |
|---|---|---|
| **TBE1** | Header structure: optional `header.settings.rows[]` grouping flat block ids, or restructure `header` into an array of row objects? | **DECIDED: `rows[]` grouping.** Additive, no config reset. The three target sites are all expressible with 2 rows + zones. A structural rewrite is revisited only if real merchants hit the limits. |
| **TBE2** | Tabbed section scope: collections only, or also rule-based / template product sets? | **DECIDED: collections only in v1.** Reuses the existing `?collectionId=` fetch with zero backend work. Rule-based tabs can layer on later via `templateId`. |
| **TBE3** | Announcement bar: one component for both lifecycles, or a separate persistent-chrome bar? | **DECIDED: separate persistent-chrome bar.** The existing homepage-body `announcement_bar` section stays exactly as-is. |
| **TBE4** | Language switcher block: non-functional placeholder, or omit until i18n exists? | **DECIDED: non-functional placeholder**, clearly labelled "coming soon" in admin, following the "Coming Soon" toggle convention. |
| **TBE5** | Wishlist storage: dedicated table, or JSON array on `customer`? | **DECIDED: JSON array on `customer`**, matching the `customer.addresses` precedent. A table is revisited only if "who wishlisted product X" analytics are ever needed. |
| **TBE6** | Wire `globalSettings.badges` in Phase 1, or leave badges out of scope? | **DECIDED: wire it in Phase 1.** Schema, admin UI, and `DEFAULT_THEME_CONFIG` values already exist; it is a missing render call. |
| **TBE7** | Is a generic "custom link button" an acceptable answer for rewards / chat launchers? | **DECIDED: yes.** Custom link buttons only (label + icon + URL). No embedded third-party scripts. Custom CSS remains the escape hatch. |
| **TBE8** | Phase 1 (de-hardcode/wiring) first, or the tabbed section first for a visible early win? | **DECIDED: Phase 1 first.** It de-risks the token-wiring pattern every later phase reuses and fixes real dark-theme bugs on `irmain.com`. |
