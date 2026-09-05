# Theme templates + motion/layout capability expansion

**Status:** planning. No code written. No branch. This document is the deliverable.

**Scope:** (A) a generative audit of everything the theme builder *could* offer,
heavily weighted toward MOTION and LAYOUT (not colour); (B) four premade theme
templates built from the audit results, that a merchant applies and then freely
edits.

**Reading order:** §1 is context. §2–§5 are the deliverable (the invention pass).
§6 is the four templates. §7 is the application-model decision that needs sign-off.
§8 is phasing. §9 is risk/perf/config-shape.

**Hard constraints honoured throughout:**

- Every new `theme.config` field is an OPTIONAL key inside an EXISTING container
  (`globalSettings.*`, `header.settings`, `footer.settings`, `section.settings`).
  Nothing needs the `assertValidThemeConfig` top-level allow-list touched. Shape
  changes = RESET (there is no config migration — `backfillGlobalSettings` /
  `deepMergeDefaults` only *adds* missing keys from `DEFAULT_THEME_CONFIG` on read).
- Absent/unset ⇒ pixel-identical to today's render. Every proposal states its
  no-op default, achieved with the same `var(--token, <today's literal value>)`
  pattern the codebase already uses everywhere (`var(--theme-radius, 8px)`,
  `var(--theme-card-hover-transition-duration, 300ms)`, …).
- Zero new npm deps. Exceptions are flagged individually (there are three, all
  avoidable).
- Where a proposal finally gives an already-documented dead control a consumer,
  it says so.

---

## 1. Current inventory (context, not the deliverable)

### 1.1 Config shape

`ThemeConfig = { globalSettings, header, footer, sections[] }`
(`backend/src/themes/theme-config.types.ts`, mirrored in `admin/lib/types.ts` +
`storefront/lib/theme-config-types.ts`).

- **`globalSettings`** — 21 fixed nested categories: `logo`, `colorSchemes[]`,
  `typography`, `pageLayout`, `animations`, `badges`, `buttons`, `cart`,
  `drawers`, `icons`, `inputFields`, `popovers`, `prices`, `productCards`,
  `search`, `swatches`, `variantPickers`, `customCss`, `collectionPage`,
  `productPage`, `floatingElements?`.
- **`header` / `footer`** — `{ settings: Record<string,unknown>, blocks: ThemeBlock[] }`.
  Global chrome, not in `sections[]`. `header.settings.rows?: HeaderRow[]`
  (optional row grouping over the flat `blocks[]`, added in the theme-builder-
  expansion Phase 3). `header.settings.sticky: boolean`,
  `header.settings.transparentOnHero: boolean`, `header.settings.scrollBehavior?`
  (§8.9 — BUILT; `scrollBehavior` wins over `sticky` when present).
- **`sections[]`** — reorderable homepage body. 11 types: `announcement_bar`,
  `hero`, `featured_collections`, `product_grid`, `testimonials`, `rich_text`,
  `image_text`, `newsletter`, `brands`, `product_tabs`, `trust_bar`.
- **`ThemeBlock`** — `{ id, type, visible, order, settings, blocks? }`, recursive,
  depth cap 4. `settings` is free-form and **shallow-validated** (structure only;
  sub-fields render with client fallbacks, never 400).

### 1.2 How styling reaches the storefront

Two layered mechanisms, merged into one `useEffect` keyed `[shop, themeConfig]`
in `storefront/lib/shop-context.tsx`:

- `resolveThemeCssVars(shop)` (`lib/theme-css-vars.ts`, pure, also emitted
  server-side pre-paint by `app/[shop]/layout.tsx`) — the **legacy Appearance
  Colors** path: `--color-accent*`, `--font-sans`, and the ~15 wired granular
  colour fields in `WIRED_THEME_COLOR_FIELDS` (`--background`, `--color-header*`,
  `--color-product-name`, `--color-price-main`, `--color-footer-*`, …).
- `applyThemeConfigOverrides(config)` — the **Sections builder** path: the active
  colour scheme (`resolveSchemeCssVars`), `--theme-max-width`, Google-Font
  `<link>` injection + `--theme-body/heading/accent-font`, per-heading text
  presets (`--text-h1-size` …), `--theme-radius` / `--theme-button-*` from
  `buttons.primary`, `--theme-logo-height*`, and the card-hover vars
  (`--theme-card-hover-transform` / `-card-transform` / `-card-shadow` /
  `-transition-duration`).

Tailwind v4 gotcha carried throughout: a plain `@theme` block emits
`var(--token)` (runtime-overridable); `@theme inline` bakes the literal (not
overridable). Custom keyframes must use non-`animate-*` class names (an
`animate-x` class makes Tailwind look for a `--animate-x` token and silently
render nothing).

### 1.3 Animation infrastructure that exists today

| Surface | Mechanism | Merchant control |
|---|---|---|
| Section entrance | `ScrollAnimatedWrapper` + `IntersectionObserver` (threshold 0.1, one-shot, unobserves after first trigger) → `.theme-anim-{fade-in,slide-up,slide-left,slide-right}` + `.theme-anim-visible`. Fixed `0.6s ease-out`, fixed 24px travel. | `section.settings.scrollAnimation` enum (`none`/`fade-in`/`slide-up`/`slide-left`/`slide-right`). Per-section. |
| Product card hover | `--theme-card-hover-transform` (`zoom` → `scale(1.04)` on `.theme-product-image`), `--theme-card-hover-card-transform` (`rise` → `translateY(-4px)` on `.theme-product-card`), `--theme-card-hover-card-shadow`, `--theme-card-hover-transition-duration` (`0ms` when `productCardTransition:false`, else `300ms`). `swap` = second image via `use-product-card-image-index.ts` (no CSS transform). | `globalSettings.animations.cardHoverEffect` enum (`none`/`zoom`/`rise`/`swap`) + `productCardTransition: boolean`. Global. |
| Hero slideshow | `HeroSlideshow` — crossfade/translate between `bannerImages`, `slideDuration` (min 2s, default 5s), `slideTransition` (reuses the `ScrollAnimation` enum), dot indicators (active dot widens `w-2→w-6`), pause on hover, `prefers-reduced-motion` → first image only. | `hero.settings.bannerImages/slideDuration/slideTransition/showSlideIndicators`. Per-section. |
| Announcement bar marquee | `.marquee-track` (`translateX(0)→translateX(-50%)`, 18s linear, doubled track). | `header.settings.announcementBar.scrolling` (chrome) / the homepage-body `announcement_bar` section. |
| Nav link hover | `.theme-nav-link--anim::after` left→right `scaleX` underline reveal in `currentColor`, `0.2s ease`, default on. `.theme-nav-link:hover { color: var(--theme-nav-hover-color) }`. | `nav_menu.settings.hoverAnimation: boolean`. |
| Mega-menu / dropdown entrance | `.theme-mega-panel-fade` (`0.15s`) / `.theme-mega-panel-slide` (`0.18s`, `translateY(-8px)→0`). Chevron rotates 180° on open. `.dropdown-in` generic (`0.14s`) for the collection-page Sort control. | `header.settings.menuAnimation` (`fade`/`slide`/`none`). |
| Everything else | `transition-colors` / `transition-shadow` / `transition-all` sprinkled inline (card shadow grow on hover, icon-button hover tint, etc.). No system. | — |
| `prefers-reduced-motion` | Handled per-rule in `globals.css` (`@media (prefers-reduced-motion: reduce) { .x { animation: none } }` repeated for each animation class). JS effects (`HeroSlideshow`) check `matchMedia` directly. | Not a setting (correct). |

### 1.4 Dead / unwired controls (documented in `storefront/CLAUDE.md` + the code)

- `animations.pageTransition` — **no consumer.** No route-transition wrapper exists.
- `animations.addToCart` — **no consumer.** No add-to-cart motion exists.
- `buttons.secondary`, `buttons.pillCornerRadius` — **no consumer.** No section
  renders a secondary/pill button variant.
- `drawers.schemeId` (+ `bordersStyle`, `dropShadow`) — **no consumer.** The cart
  drawer keeps `bg-header`.
- `swatches.*`, `variantPickers.*` — **no consumer** (no swatch/variant-picker
  renders in a theme section).
- `inputFields.*` — **no consumer** (theme sections render one input: the
  newsletter form, unstyled by this).
- `prices.*` beyond the four `currencyCode` toggles — no consumer. Sale price is
  hardcoded `text-red-600` in `ProductCard.tsx`.
- `cart.*` — mostly checkout-behaviour flags (out of theme-motion scope); the
  `media*` fields have no consumer.
- `search.*` — partially wired (results surface themed in Phase 1; corner-radius /
  `titleCase` / `emptyStateCollectionId` still thin).
- Colours panel: `resolveSchemeCssVars` now maps `button`/`buttonLabel` →
  `--color-accent*` and `background`/`text` → page/header/product-name/popover.
  `secondaryButtonLabel` is **deliberately unmapped** (pending a secondary-button
  variant).

### 1.5 Apply / template mechanisms that already exist

- `HOMEPAGE_PRESETS` (3 entries, ordered lists of section types) +
  `applyHomepagePreset(key)` in `admin/lib/useThemeEditor.ts` — **replaces
  `config.sections` wholesale** (fresh ids via `defaultSettingsForType` /
  `defaultBlocksForType`), immediate `save()`, toast. Does **not** touch
  `globalSettings` / `header` / `footer`. Goes through `updateConfig`, so it is a
  single undo entry.
- `createTheme({ name, duplicateFromId? })` — new theme row from another theme's
  cloned config (fresh ids via `cloneConfigWithFreshIds`) or from
  `DEFAULT_THEME_CONFIG`.
- The theme library (`admin/app/theme/page.tsx`) — create / edit / delete /
  publish. Publish copies draft `config` → `publishedConfig` (what shoppers read).
- `useThemeEditor` has a 20-entry undo/redo snapshot stack, a 30s autosave, a
  save-on-unmount, a `beforeunload`/`pagehide` keepalive flush, and `discard()`
  (reloads last saved draft). Preview iframe gets draft config live via a
  `theme-config-update` postMessage (no save). Legacy Layout-mode fields
  (`shop.buttonRadius/buttonFill/iconStyle/…`, 13 categories) ride a separate
  `legacy-theme-update` message and are **not** part of `theme.config`.

---

## 2. Animation system — architecture proposal

### 2.1 The problem with adding effects one at a time

Every animation in §1.3 is bespoke: its own class, its own hardcoded duration
(`0.6s`, `0.2s`, `0.15s`, `300ms`, `18s`), its own hardcoded distance (`24px`,
`8px`, `4px`), its own `prefers-reduced-motion` block. Adding 40 more effects
this way produces 40 more hardcoded numbers and 40 more media-query blocks, no
coherence between them, and no single lever a merchant (or a template) can pull to
say "this store should feel calm" vs "this store should feel lively."

### 2.2 One motion model: `globalSettings.motion`

A new OPTIONAL nested category (same shape move as `floatingElements` in Phase 6 —
nested under `globalSettings`, so `assertValidThemeConfig`'s top-level allow-list
is untouched; `deepMergeDefaults` backfills it for old themes once it's in
`DEFAULT_THEME_CONFIG`).

```ts
interface MotionSettings {
  intensity?: 'none' | 'subtle' | 'standard' | 'expressive';
  speed?: number;          // 0.5–2.0 multiplier on every duration token, default 1
  easing?: 'standard' | 'gentle' | 'snappy' | 'overshoot' | 'linear';
  scrollMotion?: boolean;  // master switch for scroll-triggered entrances, default true
  hoverMotion?: boolean;   // master switch for hover micro-interactions, default true
  scrollProgressBar?: boolean;   // §3.9
  smoothScroll?: boolean;        // scroll-behavior: smooth on <html>
  snapSections?: boolean;        // scroll-snap between sections
  decorativeParallax?: boolean;  // floating decorative elements (§3.5)
  customCursor?: boolean;        // §5.7
}
```

**`intensity` is the spine.** It maps to a token table that `applyMotionOverrides`
(a new function alongside `applyThemeConfigOverrides` in `shop-context.tsx`)
writes as CSS custom properties on `:root`:

| token | `none` | `subtle` | `standard` | `expressive` | today's hardcoded value (the fallback) |
|---|---|---|---|---|---|
| `--motion-duration-fast` | `0ms` | `120ms` | `150ms` | `220ms` | `150ms` |
| `--motion-duration-base` | `0ms` | `220ms` | `320ms` | `480ms` | `300ms` / `0.6s` (varies) |
| `--motion-duration-slow` | `0ms` | `380ms` | `600ms` | `950ms` | `0.6s` |
| `--motion-entrance-distance` | `0px` | `12px` | `24px` | `48px` | `24px` |
| `--motion-stagger` | `0ms` | `40ms` | `60ms` | `110ms` | n/a (no stagger today) |
| `--motion-hover-lift` | `0px` | `-2px` | `-4px` | `-8px` | `-4px` |
| `--motion-hover-scale` | `1` | `1.02` | `1.04` | `1.06` | `1.04` |
| `--motion-hover-shadow` | `none` | `0 4px 12px …/8%` | `0 8px 20px …/12%` | `0 16px 40px …/18%` | `0 8px 20px rgba(15,23,22,.12)` |
| `--motion-ease` | `linear` | `cubic-bezier(.33,1,.68,1)` | `cubic-bezier(.22,.61,.36,1)` | `cubic-bezier(.34,1.3,.64,1)` (overshoot) | `ease-out` |

`speed` multiplies the three `--motion-duration-*` values. `easing` overrides
`--motion-ease` with a named curve regardless of intensity (`gentle` =
`cubic-bezier(.33,1,.68,1)`, `snappy` = `cubic-bezier(.4,0,.2,1)`, `overshoot` =
`cubic-bezier(.34,1.56,.64,1)`).

**`standard` is a near-today baseline, NOT byte-identical to unset.** It is close
on purpose (a merchant switching from unset → `standard` should barely notice),
but it is not the same: `--motion-duration-base` is `320ms` vs today's `300ms`,
`--motion-duration-fast` `150ms` vs the two real values today (`150ms`/`200ms`
depending on rule), and `--motion-ease` is `cubic-bezier(.22,.61,.36,1)` vs the
literal `ease-out`. **The only true no-op is `motion` unset / `{}`** — then
`applyMotionOverrides` writes nothing and every `var(--motion-*, X)` resolves to
its literal fallback `X` (= the exact pre-edit value). Do not read `standard` as
"== today."

**How the no-op default works:** every hardcoded number in `globals.css` and the
section components is rewritten `var(--motion-*, <the exact current literal>)`.
When `motion` is unset, `applyMotionOverrides` sets nothing, every `var()`
resolves to its literal fallback, and the storefront renders **byte-identical** to
today. When `motion` is present with a known `intensity`, the token table takes
over. `intensity: 'none'` collapses every duration to `0ms` and every distance to
`0` — motion off, without the merchant editing 40 controls.

This is Effort **L** (the wiring PR touches ~12 CSS rules and ~6 components) but
it is the single dependency for everything below and it de-risks the pattern.

### 2.3 Section-level override

`section.settings.motion?` (free-form settings bag, zero shape risk):

```ts
{ intensity?, entrance?: EntranceStyle, stagger?: boolean, animateOnce?: boolean,
  trigger?: 'scroll' | 'load', disableHover?: boolean }
```

- `intensity` — a section can bump itself to `expressive` or drop to `none`
  regardless of the global (a calm store with one show-stopper hero).
- `entrance` — extends the vocabulary (§3.4) without touching the existing
  `scrollAnimation` enum. `scrollAnimation` stays valid; when both are set,
  `motion.entrance` wins. Old enum values (`fade-in` etc.) remain accepted.
- `stagger` — direct children of the section's content wrapper get incremental
  `animation-delay: calc(var(--motion-stagger) * var(--i))` (index set in the
  `.map()`), capped at 12 children.
- `animateOnce` (default `true`) — `false` = re-animate on every scroll-in
  (`ScrollAnimatedWrapper` stops unobserving and toggles the visible class off
  when `!isIntersecting`). Forced back to `true` when a grid exceeds 12 items
  (perf).
- `trigger` — `load` animates on mount (above-the-fold sections; the observer
  fires immediately anyway, this just makes intent explicit and enables on-load
  child sequencing).

### 2.4 `prefers-reduced-motion` — one system-wide rule, not a setting

Replace the repeated per-class media blocks with **one** rule near the top of
`globals.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

`0.01ms` (not `0`) so `transitionend`/`animationend` still fire (the app has a
few listeners). Every JS-driven effect (parallax, fly-to-cart, count-up, tilt,
magic-line, shrink-header) additionally checks
`matchMedia('(prefers-reduced-motion: reduce)').matches` and renders the final
state instantly with no animation loop. **Merchants cannot override this** — it is
not exposed as a setting. `motion.intensity: 'expressive'` + reduced-motion = the
expressive *layout* (bigger distances collapse to `0` via the media rule) with no
movement.

### 2.5 Shared scroll subscription

Parallax, shrink-on-scroll, hide-on-scroll, scroll-progress, scrollspy, and
decorative parallax all need `window.scrollY` per frame. Ship **one**
`useScrollValue()` hook (rAF-throttled, single listener, `passive: true`) that
features subscribe to — never one listener per feature. Effort **S**, prevents the
"six scroll listeners" jank class.

### 2.6 `will-change` discipline

Set `will-change: transform` on interaction start (pointerdown, drag-start,
hover-enter for the duration of the transition), clear it on end. Never in a
stylesheet. `SectionWrapper.tsx` already does exactly this for section drag — the
same rule everywhere.

---

## 3. Animation catalog — exhaustive, per surface

Legend: **S/M/L** effort · **GPU** = compositor-only (transform/opacity, safe to
stack) · **paint** = cheap-ish repaint (shadow/filter/bg-color, don't stack many)
· **layout** = reflow (one-shot only, never in a loop) · **cont.** = continuous
(max one on a page, pause off-screen) · **JS** = needs a per-frame or measurement
script (no new dep). "Ship" = would actually ship it. Every item's no-op default
is "absent ⇒ today's render."

### 3.1 Product card hover (`ProductCard` grid + `GridProductCard`)

Merchant control: **extend the existing single-select enum**
`globalSettings.animations.cardHoverEffect`. Keep it single-select — these all
transform the same element(s), and stacking them is the thing to prevent. The
`--motion-hover-*` tokens scale whichever is chosen.

| # | Effect | Cost | Effort | Ship? | Notes |
|---|---|---|---|---|---|
| 1 | Image zoom (`scale`) | GPU | — | ✅ exists (`zoom`) | scale from `--motion-hover-scale` |
| 2 | Card rise + shadow | GPU + paint | — | ✅ exists (`rise`) | lift from `--motion-hover-lift`, shadow token |
| 3 | Secondary-image crossfade | GPU | — | ✅ exists (`swap`) | JS index swap, opacity |
| 4 | Title underline reveal | GPU | S | ✅ `underline` | reuse `.theme-nav-link--anim` `::after` scaleX |
| 5 | Quick-add slide-up | GPU | S | ✅ `quick-add-slide` | quick-add currently just `group-hover:flex`; animate `translateY(100%)→0` + opacity |
| 6 | Shadow-only lift (no move) | paint | S | ✅ `shadow` | box-shadow grows, card static — subtler than `rise`, Heritage's pick |
| 7 | Overlay wash (scheme-tinted layer fades in) | GPU | S | ✅ `overlay` | `::after` opacity `0→.12` in scheme colour; pairs with a "Quick view" label |
| 8 | Desaturate → colour on hover | paint | S | ✅ `desaturate` | `filter: saturate(.6)→1` (or `grayscale`); Atelier's pick; mild caution on huge images |
| 9 | Image parallax within frame | GPU | S | ✅ (fold into `zoom` as a variant) | image 108% size, `translate` toward hover quadrant, CSS-only fixed offset |
| 10 | Card tilt toward cursor (3D) | GPU + JS | M | ⚠️ `tilt` | `rotateX/rotateY` from pointer position; per-card pointer listener is the cost — cap: CSS-only fixed-angle tilt (no cursor tracking) as the S version, JS tracking only for grids ≤ 12 |
| 11 | Border draw (bracket corners / gradient sweep) | paint/layout | M | ❌ | corner brackets via width/height = layout; gradient-border via `background-size` = paint. Not worth the fragility |
| 12 | Content slide (title/price slide up, reveal hidden line) | GPU | M | ➖ expressive-only | translate + fixed-height clip |
| 13 | Press scale-down (`:active` `scale(.98)`) | GPU | S | ✅ always-on micro-feedback (not part of the enum) | tap feedback, all templates |
| 14 | Badge pop on card entrance | GPU | S | ✅ (ties badges into §3.4) | badge `scale(0)→1` overshoot when the card's entrance fires |
| 15 | Ken Burns on hover (slow pan+zoom while hovered) | GPU cont. | S | ➖ expressive-only | continuous while hovered — one card at a time is fine |
| 16 | Ripple from cursor on click | GPU + JS | M | ❌ | conflicts with `<Link>` navigation timing; not worth it on a card |
| 17 | Price flip (retail → "per stem" unit price) | GPU | M | ❌ niche | needs unit-price data |

**Also:** `productCards.cardEntranceStagger?: boolean` — stagger cards into view
within a grid (uses `--motion-stagger`, capped at 12). Effort **S**, GPU.

### 3.2 Buttons (`themeButtonBaseStyle` consumers: Hero CTA, Newsletter submit,
quick-add; and any future secondary/pill variant)

Merchant control: new OPTIONAL keys inside the EXISTING `ButtonStyleSettings` —
`globalSettings.buttons.primary.hoverEffect?` (enum) and `.pressEffect?: boolean`.
Same for `.secondary` — **this is what finally gives `buttons.secondary` a reason
to exist** (see §6 Heritage / Market).

| # | Effect | Cost | Effort | Ship? | Notes |
|---|---|---|---|---|---|
| 1 | Press depth (`:active` `translateY(1px)` + shadow drop) | GPU + paint | S | ✅ `pressEffect` | universal, all templates |
| 2 | Fill sweep (colour wash slides across on hover) | GPU | S | ✅ `sweep` | `::before` `translateX(-100%)→0` |
| 3 | Shine / gloss (diagonal highlight passes once) | GPU | S | ✅ `shine` | `::after` translate, one pass |
| 4 | Icon nudge (trailing arrow `translateX` on hover) | GPU | S | ✅ `icon-nudge` | needs a trailing icon slot on the CTA block |
| 5 | Border fill (outline → solid on hover) | paint | S | ✅ `border-fill` | `background-color` transition; the natural partner for `buttonFill: outline` |
| 6 | Corner-radius morph (sharp → pill on hover) | GPU-ish | S | ➖ expressive | `border-radius` transition, no layout |
| 7 | Text swap ("Add" → "Added ✓", label slides up) | GPU | M | ✅ `label-swap` (add-to-cart only) | clip + translate; fixed `min-width` so no reflow |
| 8 | Loading morph (label → spinner, width collapses) | layout | M | ⚠️ | width animation reflows — do with fixed `min-width` + opacity crossfade of label/spinner, not a width transition |
| 9 | Magnetic (button drifts toward cursor within a radius) | GPU + JS | M | ➖ expressive-only | pointermove, transform only |
| 10 | Glow pulse (breathing `box-shadow` on the primary CTA) | paint cont. | S | ➖ expressive-only, one per page | continuous — count it against the "one continuous animation" budget |
| 11 | Scale-in on viewport entry (hero CTA) | GPU | S | ✅ (ties to §3.4) | |
| 12 | Ripple from click point (Material) | GPU + JS | M | ❌ | pure-CSS "ripple from centre" is the S fallback; not worth the JS |
| 13 | Shake on invalid submit | GPU | S | ✅ generalise the admin login `.shake` as a storefront utility | newsletter, checkout |

### 3.3 Nav / header

Merchant control:
- `header.settings.scrollBehavior?: 'static' | 'sticky' | 'shrink' | 'hide-on-scroll' | 'reveal-on-hero'`
  (when present, wins over the bare `sticky` boolean, which stays readable for
  back-compat).
- `header.settings.transparentOverHero?: boolean` — **wires the dead
  `transparentOnHero` flag** (rename-tolerant: read both keys).
- `header.settings.dropdownAnimation?` — extends the existing `menuAnimation` enum.
- `nav_menu.settings.activeIndicator?: 'none' | 'underline' | 'pill' | 'magic-line'`.

| # | Effect | Cost | Effort | Ship? | Notes |
|---|---|---|---|---|---|
| 1 | Shrink-on-scroll (bar + logo shrink past N px) | layout (contained) + JS | M | ✅ `shrink` | two fixed heights, CSS `transition: height`, class toggled once per threshold crossing (not per scroll event); animate logo via `transform: scale()` + bar `padding`, not `height`, to avoid per-frame reflow |
| 2 | Hide-on-scroll-down / reveal-on-up | GPU + JS | M | ✅ `hide-on-scroll` | `transform: translateY(-100%)`, class toggled on scroll direction |
| 3 | Background fade-in on scroll (transparent over hero → solid) | paint + JS | M | ✅ `reveal-on-hero` | **consumes `transparentOnHero`**; needs hero-first detection + `useScrollValue` |
| 4 | Sticky drop-shadow appears only once scrolled | paint + JS | S | ✅ (fold into #3) | |
| 5 | Dropdown reveal: `scale-from-top` | GPU | S | ✅ extend `menuAnimation` | `transform-origin: top`, `scaleY(.85)→1` + opacity |
| 6 | Dropdown reveal: `blur-in` | paint | S | ➖ | `backdrop-filter` support-gated; skip |
| 7 | Dropdown reveal: `curtain` (`clip-path: inset(0 0 100% 0)→0`) | GPU-ish | S | ➖ expressive | |
| 8 | Mega-menu column/link stagger on open | GPU | M | ✅ | per-child `animation-delay` from `--i` × `--motion-stagger`; `MegaMenuPanel` already maps columns |
| 9 | Active-link "magic line" (shared underline slides between items on hover) | GPU + JS | M | ✅ `magic-line` | one absolutely-positioned element, `getBoundingClientRect` per item, `transform` to move — cheap once positioned |
| 10 | Active-link `underline` / `pill` (static indicator on the current route) | paint | S | ✅ | no JS; `usePathname` match |
| 11 | Cart badge bounce/pop on count change | GPU | S | ✅ | keyframe `scale` on the count `<span>`, keyed to the number value |
| 12 | Search expand-from-icon (icon click grows to a full-width input) | GPU + layout | M | ➖ | `width` transition from a fixed→fixed value; Market/editorial only |
| 13 | Logo entrance on first load (fade/scale) | GPU | S | ✅ (ties to §3.4 `trigger: load`) | |
| 14 | Announcement bar: slide-down on load, collapse-up on dismiss | GPU/layout | S | ✅ | currently just disappears; `height`+`opacity` on dismiss (one-shot) |
| 15 | Nav dropdown chevron rotate | GPU | — | ✅ exists | |
| 16 | Mobile: header collapses to logo + hamburger + cart on scroll | layout + JS | M | ➖ | fold into `shrink` for mobile breakpoint |

### 3.4 Section entrance (the `ScrollAnimatedWrapper` surface)

Extend the vocabulary via `section.settings.motion.entrance` (a free-form string —
old `scrollAnimation` values still valid). All one-shot; all respect
`--motion-duration-slow` / `--motion-entrance-distance` / `--motion-ease`.

| # | Entrance | Cost | Effort | Ship? | Notes |
|---|---|---|---|---|---|
| 1 | `fade-in` | GPU | — | ✅ exists | |
| 2 | `slide-up` / `slide-left` / `slide-right` | GPU | — | ✅ exist | now `translate` distance from `--motion-entrance-distance` |
| 3 | `scale-in` (`scale(.94)→1` + opacity) | GPU | S | ✅ | |
| 4 | `blur-in` (`filter: blur(8px)→0` + opacity) | paint | S | ✅ | one-shot filter is fine |
| 5 | `mask-reveal` / `wipe-up` (`clip-path: inset(100% 0 0 0)→inset(0)`) | GPU-ish | S | ✅ | compositor-friendly in current Chrome/FF; mild caution older Safari — acceptable one-shot |
| 6 | `rotate-in` (`rotate(-2deg)→0` + opacity) | GPU | S | ➖ expressive | |
| 7 | `flip-in` (`rotateX(-15deg)→0`, perspective on parent) | GPU | M | ➖ expressive | |
| 8 | `line-by-line` text reveal (each line masked, revealed in sequence) | GPU + JS | L | ❌ v1 | needs splitting text into span-per-line at render; real DOM work, defer |
| 9 | `counter` / count-up (0→N for a stat/number) | JS | M | ✅ (for `trust_bar` `rating_badge` + any "10,000+ delivered" stat) | rAF, `matchMedia` guard, stops at N |
| 10 | `draw` (SVG divider/underline stroke-dashoffset) | paint | M | ➖ | pairs with §5 section separators |
| 11 | `split-reveal` (two halves slide apart) | GPU | M | ❌ niche | |

Plus `section.settings.motion.stagger` (per-child) and `.animateOnce` /
`.trigger` from §2.3.

### 3.5 Hero

Merchant control: `hero.settings.kenBurns?`, `.parallax?`, extend
`slideTransition`, `hero.settings.indicatorStyle?: 'dots' | 'bars' | 'progress' | 'fraction'`.

| # | Effect | Cost | Effort | Ship? | Notes |
|---|---|---|---|---|---|
| 1 | Ken Burns (slow zoom+pan on the active slide) | GPU cont. | S | ✅ `kenBurns` | `scale(1)→1.08` + `translate` over `slideDuration`; one continuous transform — counts against the budget; disabled with `parallax` |
| 2 | Parallax layers (bg moves slower than foreground text on scroll) | GPU + JS | M | ✅ `parallax` | `transform: translateY` via `useScrollValue`, throttled; **not** `background-attachment: fixed` (iOS-broken, janky) |
| 3 | Slide transition `zoom-cross` (outgoing scales+fades, incoming from `.9`) | GPU | S | ✅ | |
| 4 | Slide transition `push` (slides push each other) | GPU | S | ➖ | |
| 5 | Slide transition `curtain` (clip-path wipe) | GPU-ish | M | ➖ | |
| 6 | Indicator `progress` (bar fills over `slideDuration`, resets on advance) | GPU | M | ✅ | ties the invisible timer to a visible affordance; `HeroSlideshow` already tracks index + duration |
| 7 | Indicator `bars` / `fraction` (1 / 3) | paint | S | ✅ `bars` | |
| 8 | Text re-entrance on slide change (heading animates in each time its slide activates) | GPU | M | ➖ expressive | |
| 9 | Pause + progress-ring on hover | GPU + JS | S | ➖ | |
| 10 | Content float / bob | GPU cont. | S | ➖ expressive-only, one element | |
| 11 | Animated gradient bg (text-only hero, no image) | paint cont. | S | ⚠️ | `background-position` animation is **not** GPU-composited (paint every frame) — keep slow, small, expressive-only |
| 12 | First-load reveal (image scales/fades in from a solid scheme-colour fill) | GPU | S | ✅ | |
| 13 | Decorative floating shapes (petals/blobs drifting on scroll) | GPU + JS | M-L | ➖ `decorativeParallax` (global) | Bloom's signature; expensive if overused — hard-capped to a handful of elements, off-screen-paused, killed by `intensity:none` + reduced-motion |

### 3.6 Cart / wishlist / drawers

Merchant control:
- `globalSettings.drawers.animation?: 'slide' | 'slide-fade' | 'scale' | 'none'`
  — **gives the dead `drawers` category a consumer**; reads `--motion-*` for
  duration/ease.
- `globalSettings.cart.itemAnimation?: boolean`, `cart.subtotalAnimation?: 'none' | 'flash' | 'count'`
  — **gives the dead `cart` category consumers.**
- `globalSettings.productCards.wishlistAnimation?: 'none' | 'pop' | 'burst' | 'sweep'`.

| # | Effect | Cost | Effort | Ship? | Notes |
|---|---|---|---|---|---|
| 1 | Drawer slide-in easing | GPU | S | ✅ `drawers.animation: slide` | **wires `drawers`** |
| 2 | Drawer `slide-fade` / `scale` | GPU | S | ✅ | |
| 3 | Backdrop fade | GPU | S | ✅ | |
| 4 | Line-item add: row expands in | layout | M | ✅ `cart.itemAnimation` | `grid-template-rows: 0fr→1fr` trick (no JS measurement) + opacity |
| 5 | Line-item remove: row collapses + slides out | layout | M | ✅ | same trick reversed |
| 6 | Quantity stepper: number rolls (odometer) | GPU | M | ➖ | `translateY` on a digit strip; S fallback = scale-pop on the number |
| 7 | Quantity stepper: +/- press-depth + value pulse | GPU | S | ✅ | |
| 8 | Subtotal: count up/down on change | JS | M | ✅ `subtotalAnimation: count` | rAF; `flash` (highlight) is the S variant |
| 9 | Fly-to-cart (added product's image animates from card → cart icon) | GPU + JS | L | ✅ | **wires `animations.addToCart`**. `getBoundingClientRect` start/end, cloned `<img>`, WAAPI or rAF, `transform`+`opacity` only. The single most complex item here; self-contained |
| 10 | Wishlist heart: `pop` (scale bounce on toggle) | GPU | S | ✅ | |
| 11 | Wishlist heart: `sweep` (outline → filled with a left→right wipe) | GPU-ish | S | ✅ | `clip-path` on the filled layer |
| 12 | Wishlist heart: `burst` (a ring + particles radiate on add) | GPU | M | ✅ `burst` | S version = one expanding ring + heart scale-pop; full particles = a few spans with per-element keyframes |
| 13 | Wishlist: card flies to the account/wishlist icon | GPU + JS | L | ➖ | same machinery as fly-to-cart; defer |
| 14 | Empty cart / empty wishlist: illustration floats, CTA pulses once | GPU/paint | S | ✅ (pairs with §5 empty states) | |
| 15 | Free-shipping progress bar fills as subtotal grows | GPU + feature | M | ⚠️ | needs a real threshold — `deliveryzone.minOrderAmount` exists but isn't surfaced; flag as feature-adjacent |
| 16 | Drawer rubber-band over-scroll | GPU + JS | M | ❌ niche | |

### 3.7 Images

Merchant control: `globalSettings.animations.imageLoad?: 'none' | 'fade' | 'blur-up'`
(new optional key in the EXISTING `animations` category).

| # | Effect | Cost | Effort | Ship? | Notes |
|---|---|---|---|---|---|
| 1 | Skeleton → image crossfade (`bg-black/5` shimmer → image fades in `onLoad`) | GPU + paint | M | ✅ `imageLoad: fade` | per-image `onLoad` handler + local state; a real UX upgrade over the current bare `bg-black/5` |
| 2 | Shimmer sweep on the placeholder while loading | GPU | S | ✅ (part of `fade`) | `::after` `translateX` gradient loop, stops on load |
| 3 | LQIP blur-up (tiny blurred preview sharpens as the full image loads) | paint | L | ⚠️ `imageLoad: blur-up` | **genuinely needs backend work** — a tiny preview (base64 or a `?w=32` variant) generated + stored in the upload pipeline. Uploads are static files with no resize endpoint today. `fade` (no LQIP) covers ~80% of the benefit with zero backend. **Flag #1 of 3.** |
| 4 | Progressive top-to-bottom wipe as the image decodes | GPU-ish | L | ❌ | fakeable with a `clip-path` transition on load; not worth it |
| 5 | Hover zoom for content images (`rich_text` / `image_text` blocks) | GPU | S | ✅ | reuse the card-zoom token |
| 6 | Zoom-on-scroll for full-bleed section images | GPU + JS | M | ➖ | parallax cousin |
| 7 | Aspect-lock (reserve space, no layout shift) | — | S | ✅ | not an animation — a layout fix that pairs with load states; see §4 image aspect |

### 3.8 Page transitions / scroll UI

| # | Effect | Cost | Effort | Ship? | Notes |
|---|---|---|---|---|---|
| 1 | Route content fade-in on every navigation | GPU | M | ✅ | **wires `animations.pageTransition`**. A `key`ed wrapper around the route content that plays a short fade/`translateY(8px)` on mount. Universal, cheap |
| 2 | Cross-page shared-element transition | GPU | L | ⚠️ | the View Transitions API (`document.startViewTransition`) — Chromium-only today, Next support experimental. Ship #1 as the real feature, VT as a progressive enhancement gated on `'startViewTransition' in document`. **Flag #2 of 3** (browser-gated, not dep-gated) |
| 3 | Scroll progress bar (top of viewport, `scaleX` = `scrollY/scrollHeight`) | GPU + JS | S | ✅ `motion.scrollProgressBar` | one element, `useScrollValue` |
| 4 | Back-to-top button (appears after N px, smooth-scrolls up) | GPU + JS | S | ✅ | **extends the EXISTING `floatingElements`** category: `floatingElements.backToTop?: { enabled, position }`. No allow-list touch |
| 5 | Section snap-scroll (`scroll-snap-type`) | — | S | ➖ `motion.snapSections` | CSS-only; aggressive UX — editorial templates only |
| 6 | Smooth in-page anchor scroll (`scroll-behavior: smooth`) | — | S | ✅ `motion.smoothScroll` | the hero CTA hrefs `#shop`/`#products` today with no smooth scroll |
| 7 | Scrollspy nav highlight (current section lights up in the nav) | JS | M | ➖ | `IntersectionObserver` per section |
| 8 | Decorative parallax elements (drifting shapes on scroll) | GPU + JS | M-L | ➖ `motion.decorativeParallax` | see §3.5 #13 |
| 9 | Marquee / ticker | GPU cont. | — | ✅ exists (announcement bar) | extend: `brands.scrolling?: boolean` (logo strip scrolls instead of static grid), `trust_bar` marquee mode |
| 10 | Reading-progress for long policy pages | JS | S | ❌ niche | |

### 3.9 Micro-feedback

| # | Effect | Cost | Effort | Ship? | Notes |
|---|---|---|---|---|---|
| 1 | Toast entrance/exit (slide from edge + auto-dismiss slide-out) | GPU | S | ✅ | storefront has no toast system today (only `CookieConsentBanner`); a small one is worth it for add-to-cart / wishlist / "copied" feedback |
| 2 | Form validation shake/pulse | GPU | S | ✅ | generalise the admin login `.shake` + key-remount trick as a storefront utility (newsletter, checkout) |
| 3 | Field focus: label float / border-colour / focus-ring grow | GPU/paint | S | ✅ `inputFields.focusAnimation?: 'none' | 'border' | 'float-label' | 'glow'` | **gives the dead `inputFields` category a consumer** |
| 4 | Checkbox/toggle: checkmark draw, knob slide + slight overshoot | GPU | S | ✅ | |
| 5 | Newsletter success: form collapses, checkmark + "You're in!" scales in | GPU/layout | M | ✅ `newsletter.successAnimation?: boolean` | |
| 6 | Add-to-cart button success state ("Add" → ✓ → "Added" → "Add") | GPU | M | ✅ | see §3.2 #7 `label-swap` |
| 7 | Accordion (FAQ, filter groups): height expand + chevron rotate | layout | M | ✅ | `grid-template-rows: 0fr→1fr` (no JS measurement) |
| 8 | Tab switch (`product_tabs`): active pill slides (magic-line), content crossfades, height animates to new content | GPU + layout | M | ✅ | `product_tabs` currently hard-swaps — clear polish target; used by Market + Bloom |
| 9 | Filter chip add/remove (collection page): pop in / collapse out | GPU/layout | S | ✅ | |
| 10 | "Copied!" feedback on coupon/share copy | GPU | S | ✅ | |
| 11 | Rating stars: fill on hover | paint | S | ➖ | review widgets |
| 12 | Low-stock: subtle pulse on the stock indicator | GPU | S | ➖ expressive-only | `productPage` already themes the stock line colours |
| 13 | Sticky PDP add-to-cart bar: slides up when the main button scrolls out | GPU + JS | — | ✅ exists (the `ProductDetailClient` `IntersectionObserver` toggle) | could theme its entrance |
| 14 | Stepper increments (cart) | — | — | ✅ see §3.6 #6–7 | |

---

## 4. Layout catalog

### 4.1 Header layouts (beyond the current rows model)

Merchant control: **named layout presets** that seed `header.settings.rows[]` +
per-block `zone`/`order` — the "item 10" the expansion plan deferred. Applying one
is a config write, not new rendering. All Effort **S–M**.

| Preset | Structure | New capability it needs |
|---|---|---|
| Classic | logo L · icons R · nav full-width below (today's default) | none |
| Centered | logo centre · icons split L/R · nav centred below | `nav_menu.settings.align` (exists) |
| Contact-bar + centered nav | utility row (phone/hours/account) · logo L + icons R · centred nav row | `contact_bar_item` (exists), `rows` (exists) |
| Split nav ("gateway") | half the nav L of a centred logo, other half R · icons far R | nav-split rendering (M) |
| Minimal | logo L · hamburger + cart R · everything else in a drawer | mobile drawer (§4.7) used at all breakpoints |
| Editorial | oversized centred logo · tiny nav · generous height · one search icon | `header.settings.height`, `contentWidth` |
| Colored band | full-bleed coloured header · nav inline next to the logo · thin contact bar above | `nav_menu` in a header row (exists), `HeaderRow.background` (exists) |

Additional header settings (all optional keys in the free-form `header.settings`):
`height: 'compact' | 'regular' | 'tall'`, `contentWidth: 'full' | 'contained'`,
`separator: 'none' | 'border' | 'shadow'`, `scrollBehavior` (§3.3),
`transparentOverHero` (§3.3), `announcementPosition: 'above' | 'below' | 'sticky'`.
Icon blocks gain `showLabel: boolean` (icon + "Cart" text vs icon only).

### 4.2 Product card layouts / orientations

| Axis | Options (past the obvious two) | Control | Effort |
|---|---|---|---|
| Card style | `minimal` · `bordered` · `shadowed` (exist) → + `elevated` · `outlined-hover` · `filled` · `polaroid` (white frame, caption below) · `overlay` (text on the image in a gradient) | extend `product_grid`'s `cardStyle` enum + a global `productCards.cardStyle` default | S |
| Image aspect | `square` (hardcoded today) → + `portrait` (3:4) · `landscape` (4:3) · `tall` (2:3) · `natural` | `productCards.imageAspect` (global) + `section.settings.imageAspect` override | S |
| Text alignment | `left` (today) · `center` | `productCards.textAlign` | S |
| Info density | `comfortable` · `compact` (padding, font size, whether description shows) | `productCards.density` | S |
| Price position | below title · beside title · on image | `productCards.pricePosition` | S |
| Metadata rows | new `product_card` sub-block types: `product_vendor` (brand) · `product_rating` (stars — needs review data, **flag**) · `product_swatches` (variant colour dots — **wires `swatches`**) · `product_stock` (in/low-stock line) · `product_short_desc` | `CHILD_BLOCK_TYPES.product_card` += these | M |
| Quick-add style | floating button (today) · full-width bar under image · slide-up panel w/ variant picker · icon-only | `productCards.quickAddStyle` | M |
| Hover reveal target | second image · quick-add · wishlist + "Quick view" · variant swatches | folds into `cardHoverEffect` + `quickAddStyle` | M |
| Badge placement | 4 corners (exists) · ribbon (diagonal) · pill-in-flow (above title) | `badges.style` (§5) | S |
| Card shape | sharp · rounded · pill-top (image rounded, card not) | `globalSettings.radius` scale (§5) | S |
| "Featured" card | one card spans 2×2 in the grid | `section.settings.featuredFirst: boolean` | M |

### 4.3 Grid density and asymmetric grids

| Layout | Notes | Control | Effort |
|---|---|---|---|
| Columns 2–6 | exists (`product_grid`, `featured_collections`) | — | — |
| Gap scale | `tight` · `normal` · `roomy` (hardcoded `gap-4 sm:gap-6` today) | `section.settings.gap` + `globalSettings.density` default | S |
| "Featured first" (item 1 spans 2×2) | editorial catalog look | `section.settings.featuredFirst` | M |
| Alternating large/small | fixed pattern | `section.settings.rhythm: 'even' | 'alt'` | M |
| Mosaic featured-collections | tiles of varying size in a fixed pattern — the target sites' occasion grids | `featured_collections.settings.layout: 'grid' | 'mosaic'` | M |
| Masonry (Pinterest) | true CSS masonry is not universal yet — `columns` is the no-dep approximation but breaks reading order. **Flag** as "ship `columns`-based, revisit when CSS masonry lands" | `product_grid.settings.layout: 'masonry'` | M |
| Horizontal scroll / carousel row | product row is swipeable instead of a grid | `section.settings.layout: 'grid' | 'carousel'` — `scroll-snap` + `overflow-x` + optional arrow buttons + pointer-events swipe (no carousel lib) | M |
| Bento grid (mixed content tiles: collection + promo + product + quote) | a genuinely new flexible section type | new `bento` section type | L — defer |

### 4.4 PDP layouts

The PDP (`ProductDetailClient` + the small `globalSettings.productPage` category)
is **not** section-composed. Full block-based PDP theming is a large separate
track. The tractable v1 is **layout enums on `globalSettings.productPage`**:

- `galleryPosition: 'left' | 'right' | 'top' | 'below-fold'`
- `galleryStyle: 'grid' | 'main-plus-thumbs' | 'stacked-scroll' | 'carousel'`
- `stickyBuyBox: boolean` (info column sticky while the gallery scrolls)
- `layout: 'standard' | 'wide-gallery' | 'centered-narrow' | 'full-width-tabs'`
- `detailsStyle: 'tabs' | 'accordions' | 'stacked'`
- `relatedStyle: 'grid' | 'carousel'`
- trust elements under the buy button (delivery estimate / returns / secure
  checkout) — `productPage.showTrustRow: boolean`

Effort **M** for the enum set; **L** for a real PDP block system (out of scope here).

### 4.5 Collection page layouts

`globalSettings.collectionPage` exists (`textAbove/Below`, `columns`,
`mobileColumns`, `loadMoreStyle`, `fontFamily/Size/Color`). Add:

- `filterPosition: 'top-bar' (today) | 'left-sidebar' | 'drawer' | 'none'`
- `headerStyle: 'title-only' | 'title-description' | 'banner-image' | 'breadcrumb'`
- `subCollectionNav: 'pills' | 'dropdown' | 'sidebar-tree' | 'hidden'`
- `sortControl: 'dropdown' (today) | 'segmented' | 'inline-links'`
- `showResultCount: boolean`, `showActiveFilterChips: boolean`
- `emptyStateCollectionId?` (mirror `search.emptyStateCollectionId`)

Effort **M** (mostly render-branch work on one page).

### 4.6 Footer layouts

`footer.blocks[]` + legacy `footerLayout: 'columns' | 'centered'` + `footerDensity`.
Add **named presets** (seed `footer.settings` + blocks):

- `multi-column` (2–5 columns, collapse to accordions on mobile)
- `centered-stack` (minimal)
- `big-CTA` (newsletter-forward, large heading)
- `one-line` (copyright + legal only)
- `mega` (columns + newsletter + payment icons + social + locale + bottom bar)

Plus `footer.settings`: `columns: 2..5`, `showPaymentIcons: boolean` (the app
knows enabled providers), `showBackToTop: boolean`, `background: solid|gradient|image|wave`
(wave = an SVG top edge), `bottomBarSeparate: boolean` (copyright/legal/locale in
their own strip). Effort **S–M**.

### 4.7 Mobile nav patterns

**Currently missing a real mobile menu** — `MenuBar` is one horizontally-scrolling
pill row at every width (`TopBar.tsx` has no hamburger). This is the single
biggest genuinely-new *component* in the whole plan.

`header.settings.mobileNav?: 'scroll' (today) | 'drawer' | 'bottom-bar' | 'fullscreen'`
+ `mobileNavStyle` details.

| Pattern | Notes | Effort |
|---|---|---|
| Off-canvas drawer | hamburger → slide-in panel; nested collections as accordions; swipe-from-edge to open (pointer events, no dep — the codebase already does pointer DnD in `PreviewInteraction.tsx`) | M-L |
| Bottom tab bar | Home / Shop / Search / Cart / Account, app-like, `position: fixed` | M |
| Full-screen overlay | hamburger → full-viewport menu, big tap targets | M |
| Horizontal scroll pills | keep as an option (today's behaviour) | — |
| Gestures | swipe between hero slides / product images / `product_tabs` (pointer events, no dep) | M |

### 4.8 Misc layout

- **Section separators** — `section.settings.separator?: 'none' | 'line' | 'wave' | 'angle' | 'dots'`
  (decorative SVG edges between sections; florist sites lean on these). S–M.
- **Overlay / scrim controls** for image sections — darkness %, gradient
  direction, for text legibility on hero/`image_text`. `section.settings.overlay`. S.
- **Container bleed** — `section.settings.contentWidth: 'contained' | 'full' | 'narrow'`
  (a section breaks out of `--theme-max-width`). S.
- **Themed loading skeletons** per section type (today: one generic
  `StorefrontLoadingSkeleton`). M — nice-to-have.
- **Empty states** per surface (empty cart / wishlist / no search results / no
  products in collection / no reviews) — each a small themed component with an
  illustration slot + CTA. Currently bare text. M.

---

## 5. Icons / type / density / corner-radius / badge & price catalog

### 5.1 Icon set as a merchant choice

Today: `globalSettings.icons.stroke: 'thin' | 'default' | 'heavy'` → lucide
`strokeWidth` 1.25 / 2 / 2.75. lucide ships **one** visual style (outline, rounded
joins) — it has no filled/solid variants.

| Proposal | Achievable no-dep? | Effort | Notes |
|---|---|---|---|
| `icons.corners: 'rounded' | 'sharp'` | ✅ yes | S | CSS override on lucide SVGs: `stroke-linecap`/`stroke-linejoin: butt` vs `round` |
| `icons.size: 'sm' | 'md' | 'lg'` | ✅ yes | S | scale the icon-size classes |
| `icons.style: 'line' | 'solid' | 'duotone'` **+ per-icon glyph variants** | ⚠️ partial | M | **Expanded to its own parallel phase — see §8 Phase I.** `line` = lucide as-is (no-op default). `solid`/`duotone` + 2–3 glyph variants per icon = a **hand-drawn inline-SVG set** in `storefront/lib/icons/`, ≈ 100+ SVGs across the ~12 storefront icons × 2–3 glyphs × 3 styles. Config: `globalSettings.icons.style` (global) + `globalSettings.icons.glyphs?` (per-icon override — final shape decided at the Phase I gate). **Zero new deps** — a second icon package is explicitly **rejected**. **Gated:** a glyph-variant list + SVG count + config shape + admin-picker-design-pass flag come back for sign-off before any SVG is drawn. |

Per-element icon override already exists (`resolveIconElementStyle`).

### 5.2 Typography pairing presets — BUILT as part of Phase B1 (see §8.2)

`typography` already takes arbitrary Google-Font names per role (`bodyFont`,
`subheadingFont`, `headingFont`, `accentFont`) + per-heading presets. Add:

- **`typography.pairing?`** — named bundles applied to the four font roles + a
  starting h1–h6 scale + case/tracking. Each is a config preset (S each):
  - "Modern Sans" — Inter / Inter
  - "Editorial Serif" — Fraunces (or Cormorant) / Inter
  - "Warm Humanist" — Fraunces / Nunito Sans
  - "Grotesque" — Space Grotesk / IBM Plex Sans
  - "Classic" — Cormorant Garamond / Lato
  - "Bold Display" — Archivo Black (heading) / Inter (body)
  - "Handwritten Accent" — Inter body + Caveat accent
- **`typography.scale?: 'compact' (1.15) | 'default' (1.2) | 'spacious' (1.333) | 'dramatic' (1.5)`**
  — regenerates h1–h6 from a base size × ratio. When absent, the explicit h1–h6
  sizes win (today's behaviour). S.
- **`typography.baseFontSize?: 14 | 15 | 16 | 17`** — scales everything. S.
- Heading weight per role, uppercase/tracking presets — already expressible via
  the per-heading `case`/`letterSpacing` fields; a `pairing` bundles them.

All Google fonts load via the existing dynamic `<link>` mechanism
(`loadGoogleFont` in `shop-context.tsx`) — no new dep, no `next/font` change.

### 5.3 Spacing / density scale — BUILT as Phase B2 (see §8.2b)

**`globalSettings.density?: { preset?: 'compact' | 'cozy' | 'comfortable' |
'spacious' }`** — drives `--section-py` (was `py-8`), `--grid-gap` +
`--grid-gap-m` (was `gap-4 sm:gap-6`), `--section-heading-gap` (was `mb-4`) via
`.theme-section-py` / `.theme-grid-gap` / `.theme-heading-gap` classes on the
homepage sections. `density` unset ⇒ nothing written ⇒ every class falls back to
its pre-B2 Tailwind literal (byte-identical).

Revisions from this original sketch, made when B2 was built:

- **Object wrapper, not a bare enum.** `{ preset? }`, matching B1's `radius` —
  see the convention note below. `DEFAULT_THEME_CONFIG.globalSettings.density = {}`.
- **No `--space-scale` multiplier** — an explicit per-preset px table
  (`lib/density.ts`); a single multiplier over `py` + gaps + margins compounds
  unpredictably (same call Phase A made for the type scale).
- **`py-12` (Hero) is out** — a deliberate showcase one-off. Also out: the
  horizontal gutter `px-4 sm:px-6`, Newsletter/Footer/TrustBar bands, the
  non-product grid gaps. B2 tokenises the standard `py-8` body sections + the
  product-grid `gap-4 sm:gap-6` + the `mb-4` heading gap only.
- **Precedence is additive, not override.** `section.settings.spacing` is outer
  inline padding on `<section>`; `--section-py` is the inner content padding.
  They stack, exactly as `section.settings.spacing` already stacks on `py-8`
  today — not a replace.

### Conventions these three phases now share (state once, not per phase)

1. **A new `globalSettings` category is an object seeded as `{}`** in
   `DEFAULT_THEME_CONFIG`, never a bare scalar — so
   `updateGlobalSettingsCategory` (`admin/lib/useThemeEditor.ts`, spreads the
   category value as an object) and `deepMergeDefaults`
   (`backend/src/themes/themes.service.ts`, backfills `{}` inertly onto old
   themes) both work with no special-casing. Now `motion`, `radius`, `density`.
2. **The near-today-baseline convention.** Phase A's `intensity: 'standard'`,
   B1's `radius` preset, and B2's `density: 'cozy'` each reproduce today's values
   *approximately* — but the **only** guaranteed byte-identical no-op is the
   setting left **unset** (resolver returns `{}`, nothing is written, every
   `var()` / class falls to its literal). A preset is a starting point, not a
   promise of identity.

### 5.4 Corner-radius language — BUILT as part of Phase B1 (see §8.2; shipped as `globalSettings.radius: { preset?, applyToButtons? }`, not the bare enum this section originally sketched)

**`globalSettings.radius?: 'sharp' (0) | 'subtle' (4) | 'rounded' (8) | 'soft' (16) | 'pill-ish'`**
— sets `--radius-sm` / `--radius-md` / `--radius-lg` tokens that buttons, cards,
inputs, images, badges, drawers, swatches all read. Today each hardcodes its own
(`rounded-xl` card, `--theme-radius` button, `badges.cornerRadius`,
`inputFields.cornerRadius`, `swatches.cornerRadius`, …). Per-component values
(already in the schema) become overrides on top of the global scale. Absent ⇒
today's mix via `var()` fallbacks. **The single highest-leverage "makes a
template feel coherent" lever, and it's mostly wiring.** Effort **M**.

### 5.5 Badge styling

`globalSettings.badges` exists (position / cornerRadius / scheme / case / font).
Extend: `badges.style?: 'pill' | 'rectangle' | 'ribbon' (diagonal) | 'tag' (notched) | 'circle'`,
`badges.size?`, `badges.entranceAnimation?: boolean` (pop-in on card entrance, §3.1 #14).
Effort **S**.

### 5.6 Price styling — `salePriceColor`/`salePriceStyle` BUILT as part of Phase B1 (see §8.2); the rest below still open

`globalSettings.prices` only has the four `currencyCode` toggles today. Extend
(**gives `prices` a real consumer**):

- ✅ `prices.salePriceColor?` — replaces the hardcoded `text-red-600` in
  `ProductCard.tsx` / `PriceDisplay`
- ✅ `prices.salePriceStyle?: 'color' | 'strikethrough-only'` (`'badge'` not built — no badge-as-price-treatment consumer exists)
- `prices.showUnitPrice?: boolean` ("per stem" / "per box" — feature-adjacent,
  needs a unit field; **flag**)
- `prices.fontWeight?`, `prices.compareAtPosition?: 'before' | 'after' | 'below'`

Effort **S** (minus the unit-price flag).

### 5.7 Misc

- **Custom cursor** — `globalSettings.motion.customCursor?: boolean` — a small dot
  that grows over interactive elements (editorial trend). Pointer JS, no dep.
  **Accessibility rule:** must NOT hide the real cursor for keyboard/AT users;
  disabled on touch; killed by reduced-motion. Expressive-only. Effort **M**.
- **Focus-visible ring style** — `globalSettings.inputFields.focusRing?: { color, width, offset }`
  — themeable but always visible (a11y). S.
- **Selection colour** — exists (`--color-selection`).
- **404 / store-not-found theming** — pick up scheme + type. S.

---

## 6. The four templates

Each is a full `ThemeConfig` literal (see §7 for how it's stored and applied).
Each has a real point of view and differs from the others in **layout, motion,
iconography, density, and type** — colour scheme is the least of it, though each
ships a distinct one. All four serve florists/gifting; they are not
florist-identical.

The per-section `theme.config` values below are the **notable** settings each
template sets — not an exhaustive dump of every default. A "→ needs" line lists
the new §2–§5 capabilities the template depends on (this doubles as the build-
order signal in §8).

---

### 6.1 "Atelier" — editorial / premium studio florist (weddings, events, bespoke)

**POV:** quiet luxury. Whitespace, big serif display type, almost no colour, no
chrome, slow deliberate motion. The storefront should feel like a lookbook.

**`globalSettings`:**

| Category | Value |
|---|---|
| `colorSchemes[0]` | bg `#FBFAF7` (warm paper), text `#1A1A17` (ink), button `#5A6B54` (muted sage), buttonLabel `#FBFAF7`, secondaryButtonLabel `#1A1A17` |
| `colorSchemes[1]` | bg `#1A1A17`, text `#FBFAF7`, button `#FBFAF7`, buttonLabel `#1A1A17` (one dramatic inverted section) |
| `typography.pairing` | "Editorial Serif" — Fraunces heading, Inter body |
| `typography.scale` | `dramatic` (h1 ≈ 64px) |
| `typography` per-heading | `case: default`, `letterSpacing: normal` |
| `radius` | `sharp` (0 — buttons, cards, images all square) |
| `density` | `spacious` |
| `icons` | `style: line`, `stroke: thin`, `corners: sharp`, `size: sm` |
| `motion` | `intensity: subtle`, `speed: 0.8`, `easing: gentle`, `scrollMotion: true`, `hoverMotion: true`, `smoothScroll: true` |
| `animations.cardHoverEffect` | `desaturate` |
| `animations.imageLoad` | `fade` |
| `productCards` | `imageAspect: portrait`, `textAlign: left`, `density: comfortable`, `quickAdd: false`, `showWishlist: false`, `cardStyle: minimal` |
| `badges` | `style: rectangle`, `case: default`, small |
| `prices` | `salePriceStyle: strikethrough-only` (no red) |
| `buttons.primary` | `hoverEffect: sweep`, `pressEffect: true`, `borderThickness: 0` |

**`header`:** "Editorial" preset — one row: oversized centred `logo`, a single
`search_icon` far right. Second row: centred `nav_menu`, `align: center`,
`hoverAnimation: true`. `header.settings`: `height: tall`, `contentWidth: contained`,
`separator: none`, `scrollBehavior: reveal-on-hero`, `transparentOverHero: true`,
`mobileNav: fullscreen`.

**`sections`:**

1. `hero` — `heroLayout: full_bleed`, one `bannerImages` entry, `kenBurns: true`,
   `showSlideIndicators: false`, one `heading` (h1) + one `cta` (label "Enquire"),
   `contentPosition: bottom-left`, `motion.entrance: mask-reveal`.
2. `rich_text` — a short centred manifesto, `contentWidth: narrow`,
   `motion.entrance: fade-in`.
3. `featured_collections` — `columns: 2`, `aspectRatio: portrait`,
   `overlayText: true`, `motion.entrance: mask-reveal`, `motion.stagger: true`.
4. `product_grid` — `columns: 2`, `gap: roomy`, `cardStyle: minimal`,
   no quick-add, `motion.stagger: true` (slow).
5. `image_text` — alternating image/text story block, `motion.entrance: slide-left`.
6. `newsletter` — centred, understated, `successAnimation: true`.

**`footer`:** `centered-stack` preset, minimal — one line + social row.

**→ needs:** motion token system + reduced-motion rule · `radius` scale ·
`density` scale · typography pairing + `scale` · Colours panel completion ·
section-entrance vocab (`mask-reveal`) + stagger · card hover `desaturate` ·
`imageAspect` control · header layout presets + `scrollBehavior` +
`transparentOverHero` + `mobileNav: fullscreen` · button `sweep`/`pressEffect` ·
`imageLoad: fade` · hero `kenBurns` · footer presets · `smoothScroll`.

**On apply (over an existing theme):** everything gets bigger, squarer, slower,
quieter. Colour scheme → paper/ink/sage. Nav moves to centred-below-logo. Product
grid drops to 2-up, quick-add disappears. Hero goes full-bleed with a slow zoom.
The most restrained of the four.

---

### 6.2 "Market" — busy everyday flower shop (same-day delivery, high SKU count)

**POV:** conversion-focused, dense, reassuring, fast. Lots of product on screen,
trust signals everywhere, snappy tactile feedback, warm inviting colour.

**`globalSettings`:**

| Category | Value |
|---|---|
| `colorSchemes[0]` | bg `#FFFFFF`, text `#232323`, button `#E24A6A` (warm rose), buttonLabel `#FFFFFF`, secondaryButtonLabel `#E24A6A` |
| `colorSchemes[1]` | bg `#FDF1F3` (blush), text `#232323` (alternating sections) |
| `typography.pairing` | "Modern Sans" — Inter / Inter |
| `typography.scale` | `compact` |
| `typography` per-heading | `case: uppercase` for h5/h6 (small labels), weight bold |
| `radius` | `rounded` (8) |
| `density` | `compact` |
| `icons` | `style: solid`, `corners: rounded`, `size: md` |
| `motion` | `intensity: standard`, `speed: 1.1`, `easing: snappy`, `scrollProgressBar: true` |
| `animations.cardHoverEffect` | `quick-add-slide` |
| `animations.addToCart` | `true` (**fly-to-cart**) |
| `animations.imageLoad` | `fade` |
| `productCards` | `imageAspect: square`, `density: compact`, `quickAdd: true`, `mobileQuickAdd: true`, `showWishlist: true`, `wishlistAnimation: pop`, `cardStyle: shadowed`, sub-blocks `product_vendor` + `product_stock` visible |
| `badges` | `style: tag`, `case: uppercase`, `entranceAnimation: true` |
| `prices` | `salePriceStyle: color`, `salePriceColor: #C81E4A` |
| `buttons.primary` | `hoverEffect: sweep`, `pressEffect: true` |
| `buttons.secondary` | rendered — `hoverEffect: border-fill` (**consumes `buttons.secondary`**) |
| `drawers` | `animation: slide-fade` (**consumes `drawers`**) |
| `cart` | `itemAnimation: true`, `subtotalAnimation: count` (**consumes `cart`**) |
| `floatingElements.backToTop` | `{ enabled: true, position: bottom_right }` |
| `inputFields.focusAnimation` | `float-label` (**consumes `inputFields`**) |

**`header`:** "Contact-bar + centered nav" preset — 3 rows: (1) `contact_bar_item`
phone (click-to-call) + text "Same-day delivery before 6pm" + `account_icon`;
(2) `logo` L, `search_icon` + wishlist + `cart_icon` (with count badge) R;
(3) centred `nav_menu` with MEGA dropdowns, `align: center`. `header.settings`:
`scrollBehavior: shrink`, `separator: shadow`, `mobileNav: bottom-bar`.

**`sections`:**

1. `announcement_bar` (chrome) — `dismissible: true`, rotating messages
   ("Free delivery over AED 200" / "Order by 6pm for today").
2. `hero` — `heroLayout: inset`, `cornerRadius: 12`, 3 `bannerImages`,
   `slideTransition: zoom-cross`, `indicatorStyle: progress`,
   `motion.entrance: slide-up`.
3. `trust_bar` — 4 `trust_item`s (same-day delivery, fresh guarantee, secure
   checkout) + `rating_badge` (4.8★, "2,000 reviews", `motion.entrance: counter`).
4. `product_tabs` — tabs "Best Sellers" / "New In" / "Under AED 150" / "Roses",
   `activeIndicator: magic-line`, content crossfade + height animate.
5. `featured_collections` — "Shop by Occasion", `columns: 4`, `aspectRatio: square`,
   `overlayText: true`, hover-zoom tiles, `motion.stagger: true`.
6. `product_grid` — `columns: 4`, `gap: tight`, `cardStyle: shadowed`,
   quick-add slide-up, badges, `motion.stagger: true` (`animateOnce: true` —
   forced, grid > 12).
7. `brands` — `scrolling: true` (marquee logo strip).
8. `newsletter` — `successAnimation: true`.

**`footer`:** `mega` preset — 4 columns + `showPaymentIcons: true` + social +
bottom bar; columns → accordions on mobile.

**→ needs:** motion tokens · `radius`/`density` scales · typography pairing ·
Colours completion · section entrances + stagger + `counter` · card hover
`quick-add-slide` · `imageAspect` · header presets + `scrollBehavior: shrink` +
`mobileNav: bottom-bar` · button `sweep`/`border-fill`/`pressEffect` +
secondary variant · `drawers.animation` · `cart.itemAnimation`/`subtotalAnimation` ·
**fly-to-cart** · wishlist `pop` · `scrollProgressBar` · `backToTop` ·
`inputFields.focusAnimation` · `product_tabs` magic-line polish · `trust_bar`
count-up · hero `progress` indicator · `brands` marquee · card sub-blocks
(`product_vendor`, `product_stock`) · footer `mega` preset · `imageLoad: fade` ·
newsletter success.

**On apply:** the storefront gets busier and warmer — more columns, quick-add
buttons appear, trust bar + tabs sections are inserted, the header grows a utility
row and a bottom bar on mobile, and motion becomes noticeably snappy (fly-to-cart,
button feedback, badge pops). The "make it sell" template.

---

### 6.3 "Bloom" — playful gifting / younger DTC (balloons, cakes, gift boxes + flowers)

**POV:** expressive, colourful, tactile, fun. Bouncy motion, rounded everything,
big friendly type, decorative flourishes. Explicitly the "we changed everything"
template.

**`globalSettings`:**

| Category | Value |
|---|---|
| `colorSchemes[0]` | bg `#FFFFFF`, text `#221B3A`, button `#7C5CFF` (violet), buttonLabel `#FFFFFF`, secondaryButtonLabel `#7C5CFF` |
| `colorSchemes[1]` | bg `#D6F5E8` (mint), text `#221B3A` |
| `badges` scheme | a contrasting yellow `#FFD23F` / `#221B3A` |
| `typography.pairing` | "Bold Display" — Archivo Black heading, Nunito Sans body |
| `typography.scale` | `spacious` |
| `radius` | `pill-ish` / `soft` (16–20 — very rounded cards, pill buttons, rounded images) |
| `density` | `cozy` |
| `icons` | `style: duotone`, `corners: rounded`, `size: lg` |
| `motion` | `intensity: expressive`, `speed: 1`, `easing: overshoot`, `decorativeParallax: true` |
| `animations.cardHoverEffect` | `tilt` (grid ≤ 12) or `rise` (larger lift, expressive token) |
| `animations.imageLoad` | `fade` |
| `productCards` | `imageAspect: portrait`, `density: comfortable`, `quickAdd: true` (slide-up panel), `showWishlist: true`, `wishlistAnimation: burst`, `cardStyle: elevated` |
| `badges` | `style: circle`, `entranceAnimation: true` |
| `buttons.primary` | `hoverEffect: shine`, `pressEffect: true`, `pillCornerRadius: 9999` (**consumes `buttons.pillCornerRadius`**) |
| `floatingElements.backToTop` | `{ enabled: true }` |

**`header`:** "Centered" or "Split nav" preset — centred `logo`, oversized nav
pills, `cart_icon` with a bouncy badge. `header.settings`: `scrollBehavior: hide-on-scroll`,
`separator: none`, `mobileNav: drawer` (slide-in + overshoot).

**`sections`:**

1. `announcement_bar` (chrome) — `scrolling: true` (marquee).
2. `hero` — `parallax: true`, decorative floating shapes (`decorativeParallax`),
   big rounded `cta`, `showSlideIndicators: true` (dots),
   `motion.entrance: blur-in`.
3. `featured_collections` — `columns: 3`, `aspectRatio: portrait`,
   `overlayText: true`, hover-zoom, `motion.stagger: true`.
4. `product_tabs` — "Birthday" / "Anniversary" / "Just Because" / "New",
   `activeIndicator: magic-line`.
5. `image_text` — a "How it works" 3-step, icons that `counter`/pop in,
   `motion.stagger: true`.
6. `product_grid` — `columns: 3`, `gap: roomy`, `cardStyle: elevated`,
   quick-add slide-up panel, `wishlistAnimation: burst`,
   `motion.entrance: scale-in`, `motion.animateOnce: false` (replays on scroll-in,
   grid ≤ 12).
7. `testimonials` — cards `motion.entrance: rotate-in`, `motion.stagger: true`.
8. `trust_bar` — icon + text items.
9. `newsletter` — form collapses to a checkmark on success (`successAnimation: true`).

**`footer`:** `big-CTA` preset — newsletter-forward, `background: wave`
(SVG top edge).

**→ needs:** motion tokens (`expressive`) · `radius`/`density` · typography
pairing (`Bold Display`) · Colours completion · section entrances
(`blur-in`, `scale-in`, `rotate-in`, `counter`) + stagger + `animateOnce: false` ·
card hover `tilt` · `imageAspect` · header presets + `scrollBehavior: hide-on-scroll` +
`mobileNav: drawer` · button `shine`/`pressEffect` + `pillCornerRadius` ·
wishlist `burst` · `product_tabs` magic-line · hero `parallax` +
`decorativeParallax` · `backToTop` · card style `elevated` · footer `big-CTA` +
wave background · section separators (optional) · `imageLoad: fade` · newsletter
success.

**On apply:** the biggest visual jump of the four — everything rounds off, colours
get loud, motion becomes bouncy and replays on scroll, decorative shapes float in
the hero, headings get huge. This is the template that proves "apply" can change
*everything* safely.

---

### 6.4 "Heritage" — established traditional florist (corporate, sympathy, permanence)

**POV:** classic, structured, trustworthy, restrained motion, symmetrical layout,
a coloured header band, traditional serif accents (not editorial-huge).

**`globalSettings`:**

| Category | Value |
|---|---|
| `colorSchemes[0]` | bg `#F6F3EC` (cream), text `#2B2B2B`, button `#B08D3F` (gold), buttonLabel `#F6F3EC`, secondaryButtonLabel `#1E3A2F` |
| `colorSchemes[1]` | bg `#1E3A2F` (deep green), text `#F6F3EC` (a full green section + the header band) |
| `typography.pairing` | "Classic" — Cormorant Garamond heading, Lato body |
| `typography.scale` | `default` (h1 ≈ 44px) |
| `typography` per-heading | h2/h3 `case: uppercase` + `letterSpacing: wide` (small-caps feel) |
| `radius` | `subtle` (4 — barely rounded, formal) |
| `density` | `comfortable` |
| `icons` | `style: line`, `stroke: default`, `corners: sharp` |
| `motion` | `intensity: subtle`, `speed: 0.9`, `easing: standard` |
| `animations.cardHoverEffect` | `shadow` (grows, no movement) |
| `animations.imageLoad` | `fade` |
| `productCards` | `imageAspect: landscape`, `density: comfortable`, `quickAdd: false`, `showWishlist: false`, `cardStyle: bordered` |
| `badges` | `style: ribbon`, `case: default` |
| `prices` | `salePriceStyle: color`, `salePriceColor: #8A3324` (muted brick, not bright red) |
| `buttons.primary` | `hoverEffect: none`, `pressEffect: true` |
| `buttons.secondary` | rendered as outline CTAs (**consumes `buttons.secondary`**) |

**`header`:** "Coloured band" preset — 3 rows: (1) thin contact bar
(`contact_bar_item` phone + `contact_bar_item` whatsapp + `contact_bar_item` text
"Mon–Sat 9–7"); (2) coloured green band with `logo` L + `nav_menu` inline
(`align: left`, next to the logo) + `search_icon`/`account_icon`/`cart_icon` R,
`HeaderRow.background: #1E3A2F`; static. `header.settings`: `scrollBehavior: static`
(or a gentle `sticky`), `separator: border`, `mobileNav: drawer` (accordion
collections).

**`sections`:**

1. `announcement_bar` — off, or a single non-rotating line.
2. `hero` — `heroLayout: inset`, `cornerRadius: 4`, one `bannerImages` entry,
   no `kenBurns`, no dots, centred `heading` + one `cta` (label "Shop the
   collection"), `motion.entrance: fade-in`.
3. `trust_bar` — 3 `trust_item`s ("Established 1985" / "Nationwide delivery" /
   "Corporate accounts welcome") + `rating_badge` with a real number,
   `motion.entrance: fade-in` (no counter — calm).
4. `featured_collections` — "Our Collections", `columns: 3`,
   `aspectRatio: landscape`, `overlayText: false` (name below — formal),
   `motion.entrance: fade-in` (no stagger — everything appears symmetrically).
5. `product_grid` — `columns: 3`, `gap: normal`, `cardStyle: bordered`, no
   quick-add (click through to PDP).
6. `image_text` — an "About us" block, image L / text R, `motion.entrance: none`.
7. `rich_text` — a sympathy / corporate-services note.
8. `newsletter` — plain, "Sign up for seasonal updates".

**`footer`:** `multi-column` preset — 4 columns (Shop / Occasions / Company /
Contact) + `showPaymentIcons: true` + a separate bottom bar with legal links.

**→ needs:** motion tokens (`subtle`) · `radius`/`density` · typography pairing
(`Classic`) · Colours completion (green section bg / cream text — the scheme
`background`/`text` must fully drive a section) · section entrance `fade-in` only
(no stagger) · card hover `shadow` · `imageAspect` · header presets +
`HeaderRow.background` + `nav_menu` inline + contact bar · `mobileNav: drawer` ·
button secondary (outline) + `pressEffect` · `imageLoad: fade` · footer
`multi-column` + payment icons + bottom bar · `badges.style: ribbon`.

**Notably does NOT need:** any scroll-behaviour header, kenBurns, parallax,
fly-to-cart, magic-line, wishlist animation, decorative motion, page transitions,
`scrollProgressBar`. Heritage is the template that proves the system can also
produce *calm*.

**On apply:** the header gains a green band and a contact bar, the nav moves
inline next to the logo, everything takes a formal cream/green/gold scheme, motion
goes quiet and symmetrical, cards get borders, quick-add disappears. The "make it
look established" template.

---

### 6.5 Cross-template capability dependency (→ build-order signal)

Capabilities used by **3 or more** templates ship first. **Updated 2026-09-05
(post-C re-evaluation, §8.7) — ✅ rows are BUILT; the phase that closed each
is noted.** Kept as the historical build-order signal; §8.7 is the current
priority recommendation for what's left.

| Capability | Atelier | Market | Bloom | Heritage | count | Status |
|---|:-:|:-:|:-:|:-:|:-:|---|
| `globalSettings.motion` token system + `--motion-*` wiring | ✓ | ✓ | ✓ | ✓ | **4** | ✅ A |
| system-wide reduced-motion blanket rule | ✓ | ✓ | ✓ | ✓ | **4** | ✅ A |
| `globalSettings.radius` scale + wiring | ✓ | ✓ | ✓ | ✓ | **4** | ✅ B1 |
| `globalSettings.density` / spacing scale + wiring | ✓ | ✓ | ✓ | ✓ | **4** | ✅ B2 |
| `typography.pairing` presets + `typography.scale` | ✓ | ✓ | ✓ | ✓ | **4** | ✅ B1 |
| Colours panel completion (`background`/`text` fully driving page + a green section; scheme → cards/badges) | ✓ | ✓ | ✓ | ✓ | **4** | ✅ header/menu-polish batch (2026-09-03) |
| section-entrance vocab extension + `motion.stagger` + `animateOnce` | ✓ | ✓ | ✓ | ✓ | **4** | ✅ A + batch 1 |
| card hover enum extension (`desaturate`/`quick-add-slide`/`tilt`/`shadow`/`overlay`) | ✓ | ✓ | ✓ | ✓ | **4** | ✅ batch 1 |
| card style extension (`elevated`/`bordered`/`overlay`/`polaroid`) | ✓ | ✓ | ✓ | ✓ | **4** | ✅ B1 |
| `productCards.imageAspect` + `section.settings.imageAspect` | ✓ | ✓ | ✓ | ✓ | **4** | ✅ B1 |
| grid `gap` scale | ✓ | ✓ | ✓ | ✓ | **4** | ✅ B2 |
| header layout presets (seed `rows` + zones) | ✓ | ✓ | ✓ | ✓ | **4** | ✅ C1 |
| mobile nav patterns (drawer / bottom-bar / fullscreen) | ✓ | ✓ | ✓ | ✓ | **4** | ✅ C2 |
| button `hoverEffect` / `pressEffect` (`buttons.primary`) | ✓ | ✓ | ✓ | ✓ | **4** | ✅ §8.8 |
| footer layout presets | ✓ | ✓ | ✓ | ✓ | **4** | ✅ C1 |
| `animations.imageLoad: fade` | ✓ | ✓ | ✓ | ✓ | **4** | ✅ batch 1 |
| newsletter `successAnimation` | ✓ | ✓ | ✓ | ✗ | 3 | open |
| `header.settings.scrollBehavior` + `transparentOnHero` wiring | ✓ | ✓ | ✓ | ✗ | 3 | ✅ §8.9 |
| `trust_bar` polish (count-up on `rating_badge`) | ✗ | ✓ | ✓ | ✓ | 3 | open |
| `icons.corners` (rounded/sharp) | ✓ | ✗ | ✓ | ✓ | 3 | open |
| `buttons.secondary` rendered variant | ✗ | ✓ | ✗ | ✓ | 2 | open |
| `product_tabs` magic-line + crossfade polish | ✗ | ✓ | ✓ | ✗ | 2 | open |
| wishlist animation (`pop`/`burst`/`sweep`) | ✗ | ✓ | ✓ | ✗ | 2 | open |
| `floatingElements.backToTop` | ✗ | ✓ | ✓ | ✗ | 2 | ✅ capability built (C1/C2) — **not yet enabled on Market/Bloom themselves**, see §8.7 |
| `icons.style: solid/duotone` (hand-drawn set) | ✗ | ✓ | ✓ | ✗ | 2 | open — separate gated Phase I, untouched |
| `drawers.animation` (+ `cart.itemAnimation`/`subtotalAnimation`) | ✗ | ✓ | ✗ | ✗ | 1 | open |
| **fly-to-cart** (`animations.addToCart`) | ✗ | ✓ | ✗ | ✗ | 1 | open |
| `scrollProgressBar` | ✗ | ✓ | ✗ | ✗ | 1 | open |
| hero `kenBurns` | ✓ | ✗ | ✗ | ✗ | 1 | open |
| hero `parallax` + `decorativeParallax` | ✗ | ✗ | ✓ | ✗ | 1 | open |
| hero `indicatorStyle: progress` | ✗ | ✓ | ✗ | ✗ | 1 | open |
| `brands.scrolling` (marquee) | ✗ | ✓ | ✗ | ✗ | 1 | ✅ batch 1 |
| section separators (wave/angle) | ✗ | ✗ | ✓ | ✗ | 1 | open |
| `inputFields.focusAnimation` | ✗ | ✓ | ✗ | ✗ | 1 | open |
| card sub-blocks (`product_vendor` / `product_stock` / `product_swatches`) | ✗ | ✓ | ✗ | ✗ | 1 | open |

Already shipped (theme-builder-expansion Phases 1–6), reused by all four:
`featured_collections` column/aspect/overlay controls, hero inset + corner radius,
`product_tabs` section, `trust_bar` section, chrome dismissible announcement bar +
marquee, `floatingElements` category.

---

## 7. Template application model — DECIDED (2026-09-04)

This is the riskiest part of the feature. `theme.config` shape changes RESET
merchant data (no migration), and a full template touches `globalSettings` +
`header` + `footer` + `sections` — far more than the existing `applyHomepagePreset`
(which only replaces `sections`).

**All of D1–D6 are locked.** This section is now a decision record, not a
question. §7.2 is the table of what was decided.

### 7.1 The two viable flows

**Flow A — "New theme from template" (create, never mutate). PRIMARY (decided).**
A template is a full `ThemeConfig` literal. "Use this template" calls
`createTheme({ fromTemplate: 'atelier' })` → a brand-new **unpublished** theme row
in the library, pre-filled, fresh ids (via the existing `cloneConfigWithFreshIds`
+ `deepMergeDefaults` against `DEFAULT_THEME_CONFIG`). The merchant's current live
theme is untouched. They open the new one in the builder, tweak, and publish when
ready.

- **Undo story:** trivial — it's a new row. Delete it. Nothing was mutated.
- **RESET risk:** none. The new config is built from the template + the default
  merge, against the current type.
- **Fit:** maps almost exactly onto the existing `createTheme` / library /
  publish flow. New surface = a `fromTemplate` param on `CreateThemeDto`, a
  `THEME_TEMPLATES` lookup, and a template-picker card in the library page.
- **Limitation:** doesn't answer "apply this look to the theme I've already
  built." That's arguably the wrong ask (templates are starting points), but see
  Flow B.

**Flow B — "Apply template to this theme" (replace the current draft). ALSO SHIPS (decided), secondary.**
`applyTemplate(key)` replaces `config.globalSettings` + `config.header` +
`config.footer` + `config.sections` in one `updateConfig` call (⇒ **one Ctrl+Z
reverts the whole application**), fresh ids, **preserving only** the merchant's
uploaded `globalSettings.logo` fields (`defaultLogoUrl` / `inverseLogoUrl` /
`faviconUrl`) — everything else, `customCss` included, is replaced. Behind a
confirm modal whose copy must include, **as its own line, not buried in body
copy**: *"Your custom CSS will be replaced."* (plus the general "this replaces
your colours, type, layout, and homepage sections; undo with Ctrl+Z or Discard
changes"). Draft only — the live storefront is unchanged until the merchant
publishes.

- **Undo story:** three nets — (1) one undo-stack entry, (2) `discard()` reloads
  the last saved draft, (3) it isn't published, so shoppers never saw it.
- **RESET risk:** none *if* the template literal is a valid full `ThemeConfig`
  matching the current shape — the same discipline `DEFAULT_THEME_CONFIG` already
  lives under (there's a validation spec `accepts the real DEFAULT_THEME_CONFIG
  unchanged`; add one per template).

**Do NOT ship a partial merge in v1** (Flow C — "apply only layout" vs "apply
only styling"). A template's sections are authored assuming that template's
density / radius / scheme; splitting them produces incoherent results and a lot of
edge-case UI. Revisit only if merchants ask.

### 7.2 Decision record (locked 2026-09-04)

| # | Question | **Decision** |
|---|---|---|
| **D1** | Ship Flow A, Flow B, or both? | **BOTH.** Flow A ("New theme from template") is **primary**: `createTheme({ fromTemplate })` → a new **unpublished** library row, offered as a picker card in the theme library. Flow B ("Apply to current theme") **also ships**, secondary, behind a confirm modal, draft-only, one `updateConfig` undo entry. |
| **D2** | Templates as **code** or **data**? | **CODE.** `THEME_TEMPLATES: Record<string, ThemeConfig>` in `backend/src/themes/templates.ts`. **One validation spec per template**, mirroring the existing `accepts the real DEFAULT_THEME_CONFIG unchanged` case in `theme-config.validation.spec.ts`. Held to the same in-lockstep-with-`theme-config.types.ts` discipline as `DEFAULT_THEME_CONFIG`. Admin/storefront mirrors only carry per-template *preview metadata* (name, blurb, thumbnail) if the picker needs it, never the full config. |
| **D3** | Flow B: preserve anything? | Preserve **only** the merchant's uploaded logo/favicon — `globalSettings.logo.defaultLogoUrl` / `inverseLogoUrl` / `faviconUrl`. **`customCss` IS replaced.** The confirm modal states this **on its own line**: *"Your custom CSS will be replaced."* — not folded into the general body copy. Domain/SEO are not in `theme.config` and are untouched regardless. |
| **D4** | Templates touch the legacy Layout-mode row (`shop.buttonRadius` / `buttonFill` / `iconStyle` / `homepageLayout` / …)? | **NO.** Templates write `theme.config` only. Every capability a template needs (button shape/fill, icon style, radius, density) is a `theme.config` concern by the time templates land (Phases A–F). One write path, one undo story. |
| **D5** | Full-screen preview-before-apply in v1? | **NO.** Confirm modal + one-undo + `discard()` + unpublished-draft is sufficient safety. Revisit only if the confirm-modal UX tests poorly. |
| **D6** | Undo-stack memory for Flow B. | **Unchanged.** 20 snapshots × ≤ 200 KB (the validator's `MAX_CONFIG_BYTES`) ≈ 4 MB worst case — acceptable. No cap change, no snapshot-pruning special-case for `applyTemplate`. |

---

## 8. Build order / phasing

Same convention as the existing plans: one phase per PR, each independently
shippable and CI-green, cross-app type mirrors updated in lockstep with
cross-reference comments, storefront pure-logic resolvers get vitest, admin
settings components get a render smoke test, backend gets a `theme-config.validation`
case per new type, and a per-template validation spec once templates land.

### Build scope authorised (2026-09-04)

- **Phase A (merged 2026-09-04, PR #88) and Phase B are green-lit.** Phase B is
  split into **B1** (radius + typography + card style/aspect/density + prices
  sale-colour — planned in detail in §8.2) and **B2** (the global density scale —
  a follow-up PR after B1 is reviewed). Rationale for the split is on the B1/B2
  rows below.
- **Phases C–F are NOT started.** After B (B1 + B2) lands, the plan is
  re-evaluated against what the token foundations actually look like in practice
  — assume the C–F specs in the table below may need revision (they were written
  before A/B were real). Do not treat C–F as committed scope.
- **Phase I (icon set)** runs in parallel, is independent of A–G, and blocks
  nothing — but it has its own gate: a glyph-variant proposal comes back for
  sign-off *before* any SVG is drawn (see the Phase I row).
- **Phase G (templates)** stays last.

| Phase | Content | Depends on | Effort |
|---|---|---|---|
| **A — Motion foundation** *(BUILT 2026-09-04 on `feat/motion-foundation-phase-a`; awaiting review — see §8.1)* | `globalSettings.motion` category + `applyMotionOverrides` + the `--motion-*` token table **including the sub-640px mobile tier** (mobile values shipped from the start: under 639px `intensity` steps down one level and `parallax` / `kenBurns` / `decorativeParallax` / `customCursor` are force-disabled — doing this now avoids retouching every token later). Rewrite every hardcoded duration/distance/scale/easing in `globals.css` + the animated components as `var(--motion-*, <today's literal>)` (exhaustive file-by-file list in §8.1). The single blanket `prefers-reduced-motion` rule replacing the per-class blocks (+ the `transitionend`/`animationend` listener audit the `0.01ms` value protects). `useScrollValue()` shared hook. Extend `ScrollAnimatedWrapper` for `motion.entrance` vocab + `stagger` + `animateOnce` + `trigger`. Type mirrors across backend/admin/storefront. **No-op proven** by both computed-style assertions and a preview visual pass (§8.1). | — | **L** |
| **B1 — Design-token foundation (radius + type + cards)** *(BUILT 2026-09-04 on `feat/design-tokens-phase-b1`; awaiting review — see §8.2)* | `globalSettings.radius` scale (`{ preset?, applyToButtons? }`: preset → `--radius-sm/-md/-lg` + `.theme-round-*` classes drive every previously-hardcoded card radius; `buttons.primary.cornerRadius` ALWAYS wins for `--theme-radius` unless the merchant flips the explicit `applyToButtons` opt-in — no seed sentinel). `typography.pairing` (7 named font bundles) + `typography.scale` (px table per name, overrides `--text-h*-size` only, stored h1–h6 sizes untouched) + `typography.baseFontSize`. `productCards.cardStyle` extension (`elevated`/`outlined-hover`/`filled`/`polaroid`/`overlay`) + `productCards.imageAspect` / `textAlign` / `density` (card-level `comfortable`/`compact` — padding/name-size/excerpt) + `section.settings.imageAspect`. `prices.salePriceColor` / `salePriceStyle` (`color`/`strikethrough-only`) — replaces the hardcoded `text-red-600`. Same pure-resolver + `var(--token, <literal>)` + SPA-leak-clear + parity-table + no-op discipline as A. | A | **L** |
| **B2 — Global density scale** *(BUILT 2026-09-04 on `feat/design-tokens-phase-b2`; awaiting review — see §8.2b)* | `globalSettings.density` (`{ preset?: compact/cozy/comfortable/spacious }`) → `--section-py` (was `py-8`) + `--grid-gap`/`--grid-gap-m` (was `gap-4 sm:gap-6`) + `--section-heading-gap` (was `mb-4`), via `.theme-section-py` / `.theme-grid-gap` / `.theme-heading-gap` classes on the standard body sections. Responsive `gap` reproduced byte-identically with one `@media (max-width: 639px)` block (the Phase-A motion-tier idiom). `section.settings.spacing` is unchanged — an outer layer that stacks, not an override. Same pure-resolver + SPA-leak-clear + parity-table + no-op discipline as A / B1. | A, B1 | **M** |
| **C — Header/footer layout + mobile nav** *(BUILT 2026-09-05 on `feat/theme-header-footer-presets-mobile-nav` — see §8.6)* | Named header presets (seed `rows` + zones) + footer presets. `height`/`contentWidth`/`separator`/`announcementPosition` + icon `showLabel`. `showPaymentIcons` + `waveEdge` + `bottomBarSeparate`. **`MobileNav.tsx`** — drawer / bottom-bar / fullscreen (the one genuinely new interactive build). `header.settings.scrollBehavior`/`transparentOverHero` deferred (out of this batch's scope). | A | **L** |
| **D — Card & button micro-interactions** | `animations.cardHoverEffect` enum extension (`underline`/`quick-add-slide`/`overlay`/`desaturate`/`shadow`/`tilt`). `buttons.primary.hoverEffect`/`pressEffect` + `buttons.secondary` rendered variant + `pillCornerRadius`. `productCards.wishlistAnimation`. `animations.imageLoad: fade` (skeleton→image crossfade). `inputFields.focusAnimation`. `icons.corners` + `icons.size`. | A, B | **M** |
| **E — Section polish** | `product_tabs` magic-line + crossfade + height animate. `trust_bar` `rating_badge` count-up. Hero `kenBurns` / `parallax` / `indicatorStyle` / `slideTransition` extensions. `brands.scrolling` marquee. Section separators (`section.settings.separator`) + overlay/scrim + `contentWidth`. Newsletter `successAnimation`. Accordion (FAQ/filter) animation. | A, B | **M** |
| **F — The expensive one-offs** | **Fly-to-cart** (`animations.addToCart`). Route-content fade (`animations.pageTransition`) + View Transitions progressive enhancement. `motion.scrollProgressBar`. `floatingElements.backToTop`. `motion.decorativeParallax`. `motion.customCursor`. `drawers.animation` + `cart.itemAnimation`/`subtotalAnimation`. Card metadata sub-blocks (`product_vendor`/`product_stock`/`product_swatches` — wires `swatches`). | A, and the specific dead-control it targets | **M–L** |
| **G0 — Templates against A/B (Flow A)** *(BUILT 2026-09-04 on `feat/theme-templates-g0` — see §8.4)* | `THEME_TEMPLATES` (4 full typed `ThemeConfig` literals) authored against **only** what A/B render today; each with a `// ── Deferred to C–F ──` block. Flow A only: `fromTemplate` on `CreateThemeDto` + `GET /themes/templates` + a picker block in the library. Per-template validation + clone + byte-cap spec (D2). Zero keys without a live consumer ⇒ nothing to no-op. | A, B | **S** |
| **Post-G0 batch 1 — §8.3 items 1-5** *(BUILT 2026-09-04 on `feat/theme-motion-batch-1` — see §8.5)* | Card-hover enum += `desaturate`/`quick-add-slide`/`overlay`/`shadow`/`tilt` (extracted to `lib/card-hover.ts`); `animations.imageLoad: 'fade'`; stagger wiring (`.theme-stagger-child` + `--i` in the 6 list sections + the `nth-child(n+13 of ...)` cap + the admin toggle on `ScrollAnimationControl.tsx`); `section.settings.motion.entrance: 'rotate-in'`; `brands.settings.scrolling` marquee. All 4 G0 templates updated to their real (no-stand-in) values. | A, B, G0 | **S** |
| **G1 — `applyTemplate` (Flow B)** *(deferred — separate later plan)* | `applyTemplate(key)` replaces `globalSettings` + `header` + `footer` + `sections` in one `updateConfig` (one Ctrl+Z), fresh ids, preserves only uploaded logo/favicon, confirm modal with the standalone "Your custom CSS will be replaced." line (D3). The riskier half — draft-mutating, RESET-adjacent, modal UX. Re-author the G0 template literals against whatever C–F has shipped at that point. | G0, + whatever C–F capabilities the re-authored templates use | **S–M** |
| **I — Icon set** *(parallel; blocks nothing; own sign-off gate)* | Multi-glyph, multi-style icon system. For each of the ~12 storefront icons (search, cart, account, heart, chevron, close, menu, phone, whatsapp, star, truck, shield): **2–3 distinct glyph variants** (e.g. cart: trolley / basket / tote; account: person / circle-person / outline-head), each drawn in all **3 styles** (`line` / `solid` / `duotone`) → **≈ 100+ inline SVGs** in `storefront/lib/icons/`. Config: `globalSettings.icons.style` (global `line`/`solid`/`duotone`) + a per-icon glyph override (proposed `globalSettings.icons.glyphs?: { cart?: 'trolley'\|'basket'\|'tote', account?: …, … }` — final shape decided at the gate). lucide stays the `line` default so **absent config ⇒ today's render exactly**. **Zero new deps** (no second icon package). **GATE:** before drawing any SVG, come back with (a) the exact glyph-variant list per icon, (b) the total SVG count, (c) the final config shape, and (d) a flag on whether the admin picker UI (12 icons × glyph choice + style) needs its own design pass. | — | **M** (SVG authoring) + a design-pass flag |

**Dependency summary:** A blocks everything. B1 needs A; B2 needs B1. D/E/G need
B1. C is independent of B (both only need A). G needs A–F for the templates to be
complete but is structurally independent (the create/apply flow). Phase I is
fully parallel and gated on its own glyph-list sign-off.

**Current commitment:** Phases **A + B + G0 + §8.3 batch 1 (items 1-5) + C +
§8.7 items 1-2 (§8.8 buttons hoverEffect/pressEffect, §8.9 header
scrollBehavior)**, all built and merged. The rest of §8.7's priority list
(items 3+) and D/E/F/G1 more broadly are **not** committed scope — **see
§8.7 for the current re-evaluation and priority order** (recorded
2026-09-05, supersedes §8.3's ordering the same way §8.3 superseded the raw
table below where they disagree). G0 (Flow A) + batch 1 + C + §8.8/§8.9
already deliver four visibly distinct starting points that pick up real
card-hover effects, image-load fade, stagger, a brands marquee (Market),
header/footer structure, a real mobile nav, button hover/press feedback,
and real header scroll behaviour; the remaining D/E/F flourishes each
template wants are listed in its own deferred block (§8.9 updated the three
templates it closed) and re-prioritized in §8.7.

### 8.1 Phase A — detailed plan (approved 2026-09-04, with three amendments) — BUILT

**Deliverable:** the `--motion-*` token foundation. No merchant-visible motion
change on any shop that hasn't set `globalSettings.motion`. Full working notes
live in the session plan file. **Landed on `feat/motion-foundation-phase-a`
(2026-09-04):** backend `MotionSettings`/`SectionMotionSettings` types +
`DEFAULT_THEME_CONFIG.globalSettings.motion = {}` + validation spec; storefront
`lib/motion.ts` (`resolveMotionCssVars`, 17 tests), `lib/section-motion.ts`
(`resolveSectionMotion`, 7 tests), `lib/use-scroll-value.ts` (3 tests), the
`globals.css` token rewrite + one blanket reduced-motion rule + mobile tier +
`scale-in`/`blur-in`/`mask-reveal` + stagger plumbing, `shop-context.tsx`
`applyMotionOverrides` (with SPA-leak clear), the component token substitutions,
`ScrollAnimatedWrapper` descriptor rework (6 tests); admin `MotionSettings.tsx`
panel (intensity/speed/easing only) + "Motion" category (5 tests) + type mirror.
Gate: backend tsc + `jest themes` 40/40 + lint +0; storefront tsc + build +
vitest **374/374** + lint +0 (baseline 33); admin tsc + build + `MotionSettings`
5/5 + lint +0 (baseline 77). Amendments applied as below. The load-bearing
points:

**Token table (base + mobile):** as §2.2, plus a `-m` (sub-640px) parallel set
that `applyMotionOverrides` writes at `intensity` stepped **down one level**
(`expressive→standard`, `standard→subtle`, `subtle→none`, `none→none`), plus
`--motion-marquee-duration` (18s default). `globals.css` maps the base token names
to the `-m` names inside one `@media (max-width: 639px)` block **with no
self-reference** (`--motion-duration-fast: var(--motion-duration-fast-m, 150ms)` —
the literal is today's value, so motion-unset ⇒ mobile also byte-identical). The
JS-only continuous effects (parallax / kenBurns / decorativeParallax /
customCursor) land in C–F and each self-gate on
`matchMedia('(max-width: 639px)')`, the same way `HeroSection` / `announcement-
rotation` already self-gate on `prefers-reduced-motion` — nothing to build for
them now.

**`intensity: 'standard'` is a deliberate near-today baseline, not byte-identical
to unset** (`--motion-duration-base` 320 vs 300ms; `--motion-ease`
`cubic-bezier(.22,.61,.36,1)` vs `ease-out`). The **only** true no-op is `motion`
unset / `{}`. This is called out in the §2.2 prose and must be a comment on the
token table in code.

**Pure core:** `storefront/lib/motion.ts` — `resolveMotionCssVars(motion)` returns
`{}` for unset/`{}`/`intensity`-absent, else the base + `-m` token map (speed and
easing applied). `applyMotionOverrides(config)` in `shop-context.tsx` is a thin
`Object.entries(...).forEach(setProperty)` wrapper, called in the existing merged
`[shop, themeConfig]` effect right after `applyThemeConfigOverrides`.

**Every hardcoded motion value → `var(--motion-*, <exact prior literal>)`,
file-by-file:** `globals.css` (`.marquee-track` 18s; `.theme-nav-link--anim`
`0.2s ease`; the four `.theme-anim-*` classes + their `.visible` `0.6s ease-out` +
their `24px` translate, incl. the `@keyframes … from` offsets — `var()` in
`@keyframes` resolves per-element and works in all current browsers;
`.theme-mega-panel-fade`/`-slide` `0.15s`/`0.18s`; `.dropdown-in` `0.14s`),
`shop-context.tsx` (`CARD_IMAGE_HOVER_TRANSFORM` `scale(1.04)`,
`CARD_WRAPPER_HOVER_TRANSFORM` `translateY(-4px)`, `CARD_WRAPPER_HOVER_SHADOW`,
the `"300ms"` in `--theme-card-hover-transition-duration`), `HeroSection.tsx`
(`SLIDE_RESTING` `24px`, the `600ms ease` inline slide transition),
`ProductCard.tsx` / `ProductGridSection.tsx` (the `150ms`/`300ms` image + shadow
durations), `CartDrawer.tsx` (drawer `duration-300`),
`AnnouncementBar.tsx` / `AnnouncementBarSectionThemed.tsx` (`opacity 0.4s`
crossfade), `FeaturedCollectionsSection.tsx` (`scale-105` hover-zoom), the legacy
`home-layouts/{SlideshowHero,FeaturedGrid,CollectionShowcase}.tsx` (flagged
low-stakes — only render with no Sections theme), and the two floating buttons.
**Explicitly left:** ~40 bare `transition-colors`/`-opacity`/`-shadow` with no
explicit number (chrome hover tints — Phase D territory), `ProductGallery`'s
`scale(1.7)` magnifier ratio, `AdditionalInfoAccordion`'s `max-height` transition
(Phase E `grid-template-rows` refactor), builder-only drag transforms.

**One blanket `prefers-reduced-motion` rule** replaces the 5 per-class blocks
(`*, *::before, *::after { animation-duration: .01ms !important; transition-
duration: .01ms !important; animation-iteration-count: 1 !important; scroll-
behavior: auto !important }`). **Audit done:** zero `transitionend`/`animationend`
listeners anywhere in `storefront/` — the `.01ms` (not `0`) is pure defence in
depth. The JS `setInterval` self-gates in `HeroSlideshow` / `announcement-rotation`
stay (a CSS rule can't stop a timer).

**`useScrollValue()`** (`storefront/lib/use-scroll-value.ts`) — one rAF-throttled
`passive` scroll listener, `scrollY` + direction. No Phase A consumer; ships so
C–F don't each add their own listener.

**`ScrollAnimatedWrapper` extension** — a new pure `resolveSectionMotion(settings)`
merges legacy `settings.scrollAnimation` with new `settings.motion` (new wins) →
`{ entrance, stagger, animateOnce, trigger }`; both absent ⇒ today's exact
behaviour. `SectionRenderer` passes the descriptor instead of the raw enum.
Entrance vocab gains `scale-in` / `blur-in` / `mask-reveal` (new two-class
CSS + keyframes, same split as the existing ones). `trigger: 'load'` skips the
observer (rAF-set `visible` on mount). `animateOnce: false` keeps observing and
re-hides on scroll-out.

**Amendment 1 — stagger: option (b) chosen.** Per-child stagger is **not**
mechanical: `ScrollAnimatedWrapper` receives a single `SectionWrapper` child (the
list items are two components deeper), so a naive `> *` selector can't reach them;
and section-entrance vs child-stagger composition is a real design question. So
Phase A keeps the **type field** (`SectionSettings.motion.stagger`) and the
**CSS + keyframes plumbing**, `resolveSectionMotion` still returns `stagger` in
the descriptor, and `ScrollAnimatedWrapper` still stamps `data-stagger` — but
**no stagger control is exposed anywhere** (not in the admin Motion panel, not in
any section settings form). Nothing merchant-visible does nothing. B/D/E wire
`theme-stagger-child` + `style={{ '--i': i }}` into each list section and add the
control then. (The eventual per-child cap is a pure-CSS
`:nth-child(n+13) { animation-delay: 0 }`, no JS count needed.)

**Amendment 2 — `animateOnce` cap: not needed in Phase A.** The cap concern only
bites when `animateOnce: false` composes with per-child stagger (N children
re-run each scroll pass). With stagger deferred (Amendment 1), `animateOnce: false`
re-animates exactly **one** element (the section wrapper) regardless of how many
products/collections it contains — cheap at any size. `ScrollAnimatedWrapper` also
structurally can't count list items (it receives one `SectionWrapper`). So Phase A
ships `animateOnce: false` uncapped; the cap becomes a B/D/E concern, enforced by
the pure-CSS `:nth-child(n+13)` rule when the stagger children are actually wired
(needs no count).

**Amendment 3 — `standard` ≠ unset** noted in §2.2 above and required as a code
comment on the token table.

**Type mirrors:** `MotionSettings` interface hand-mirrored across
`backend/src/themes/theme-config.types.ts` (+ `DEFAULT_THEME_CONFIG.globalSettings.
motion = {}` in `constants.ts`), `admin/lib/types.ts` (+ `"Motion"` in
`theme-settings-categories.ts` after `"Animations"`), `storefront/lib/theme-config-
types.ts` (+ `SectionSettings.motion?`). New admin `MotionSettings.tsx` panel
(intensity / speed / easing / scrollMotion / hoverMotion / smoothScroll only —
the deferred booleans are typed but not shown), registered in `SettingsPanel.tsx`.
`theme-config.validation.spec.ts` +1 case (`motion` is opaque to the validator —
no validator code change).

**No-op proof:** (1) `motion.test.ts` — `resolveMotionCssVars(undefined|{}|{speed:1})`
→ `{}`; `({intensity:'standard'})` → exact table values. (2) The §2-style parity
table in the PR description, literal-for-literal. (3) Full existing suites green
(storefront build + ~340 vitest incl. the reduced-motion + rotation cases; backend
`tsc`+jest; admin `tsc`+build+vitest; lint +0 all three). (4) Deploy-time visual
pass on the 4 themed prod shops (reviewer / post-merge — the browser extension is
not connected this session).

---

### 8.2 Phase B1 — detailed plan (approved 2026-09-04, one change) — BUILT

**Deliverable:** the radius + typography + product-card design-token layer. No
merchant-visible radius/type/card/sale-colour change on any shop that hasn't set
the new keys. **Landed on `feat/design-tokens-phase-b1` (2026-09-04).**

**New optional keys** (all in EXISTING containers — RESET-not-migrated safe):

- `globalSettings.radius?: { preset?: 'sharp'|'subtle'|'rounded'|'soft'|'pill'; applyToButtons?: boolean }`
  (`DEFAULT_THEME_CONFIG.globalSettings.radius = {}`, inert).
- `typography.pairing?` (7 named bundles), `typography.scale?: 'compact'|'default'|'spacious'|'dramatic'`,
  `typography.baseFontSize?: 14|15|16|17`.
- `productCards.cardStyle?` (extended: `elevated`/`outlined-hover`/`filled`/`polaroid`/`overlay`),
  `productCards.imageAspect?: 'square'|'portrait'|'landscape'|'tall'`, `productCards.textAlign?: 'left'|'center'`,
  `productCards.density?: 'comfortable'|'compact'`, `section.settings.imageAspect?` (per-section override).
- `prices.salePriceColor?: string`, `prices.salePriceStyle?: 'color'|'strikethrough-only'`.

**Radius precedence — no seed sentinel (the one approved change).** The
`cornerRadius !== 8` guess is dropped. `buttons.primary.cornerRadius` ALWAYS drives
`--theme-radius` (buttons, newsletter input, the Featured/ImageText/ProductGrid
section image containers) unless the merchant explicitly turns on
`radius.applyToButtons`, in which case the scale's `--radius-md` takes over.
Picked the explicit opt-in flag over a nullable `cornerRadius` because
`cornerRadius` is a shared `buttons.primary`+`.secondary` field written
unconditionally today (nullable would be the only nullable dimension field +
an admin Slider retrofit); the flag is one optional boolean on the already-opt-in
`radius` category. `resolveThemeRadius(radius, cornerRadius)` in `lib/radius.ts`.

- `radius.preset` set → `resolveRadiusCssVars` writes `--radius-sm/-md/-lg`; the
  new `.theme-round-sm/-md/-lg` classes (fallbacks = the exact pre-B1 Tailwind
  literals `0.375rem`/`0.5rem`/`0.75rem` = `rounded-md`/`-lg`/`-xl`) follow them.
- `preset: 'rounded'` (md 8 = `rounded-lg`, lg 12 = `rounded-xl`) is a deliberate
  near-today baseline, NOT byte-identical to unset — the only true no-op is
  `radius` unset / `{}` / no `preset`.

**Typography.** `resolveTypographyPairing(pairing)` → 4 role fonts or `null`
(unset ⇒ per-role `bodyFont`/`headingFont`/… reads run as today).
`resolveScaleSizes(scale)` → `{h1..h6}` px table or `null` (unset ⇒
`applyHeadingPreset` writes each preset's own `.size`; the stored h1–h6 sizes
are NEVER mutated, so unsetting `scale` restores them). `scale` set → override
`--text-h{n}-size` only, everything else still from `applyHeadingPreset`; admin
greys the per-heading Size sliders. `baseFontSize` set → `--text-paragraph-size`
= `${n}px` (else the existing `paragraph.size`).

**Cards.** New pure `lib/product-card-style.ts` — `resolveCardStyleClass`,
`resolveCardAspectClass`, `cardDensity`, `cardTextAlignClass` (each `undefined` ⇒
today's default: `minimal` `""` / `aspect-square` / `mt-3` + excerpt / left).
`overlay` style renders title+price in a gradient strip over the image
(`GridProductCard` branch). Section `settings.cardStyle` / `settings.imageAspect`
win over the global `productCards.*`. `GridProductCard`'s image container KEEPS
`style={{ borderRadius: "var(--theme-radius, 8px)" }}` — moving it to `--radius-md`
would change a shop with a custom `cornerRadius` (byte-identical forbids it).

**Prices.** `--color-sale-price` (`@theme`, default `#dc2626` = `text-red-600`),
overwrite-healed from `prices.salePriceColor` in `applyThemeConfigOverrides`.
`ProductCard`'s `PriceDisplay` discounted span → `text-sale-price`;
`salePriceStyle: 'strikethrough-only'` drops the colour class entirely.

**SPA-leak guard.** `applyRadiusCssVars(root, radius)` sets `--radius-*` and
removes any it doesn't define (mirrors `applyMotionCssVars`) — unit-tested incl.
the set-then-unset transition. The `--theme-*-font` / `--text-*` / `--color-sale-price`
vars are already overwrite-healed (every themed shop writes them).

**No-op proof:** (1) `radius.test.ts` (`resolveRadiusCssVars` / `applyRadiusCssVars`
/ `resolveThemeRadius`), `product-card-style.test.ts`, `theme-typography.test.ts`
new cases — every `resolve*(undefined)` → the today value. (2) Parity table in the
PR body, literal-for-literal, plus the 4-themed-prod-shop regression rows
(Testadmin/1, Irmain/7, Dubai Fresh Flowers/11, DFF/12 — all `cornerRadius: 8`,
`radius` + every B1 key `undefined`; DFF's `h1.size: 36` unaffected since `scale`
is unset → `--theme-radius` before = after = `"8px"`). (3) Full suites + builds
green — backend `tsc` + `jest themes` 41/41 + lint +0 (261); storefront `tsc` +
build + vitest 404/404 + lint +0 (33); admin `tsc` + build + `RadiusSettings` +
`ProductCardsSettings` 7/7 + lint +0 (77). (4) Deploy-time visual pass on the 4
themed prod shops (reviewer / post-merge).

**Deferred to B2 (separate PR):** the global density scale
(`--section-py` / `--grid-gap` via `.theme-*` classes + `@media` — responsive
Tailwind classes need a class layer, a wider shallow diff). `productCards.density`
(card-level enum) stays in B1.

**Follow-up hotfix (`fix/radius-tokens-out-of-theme-block`, merged separately):**
B1 named its runtime radius tokens `--radius-sm/-md/-lg` in the `globals.css`
`@theme` block. In Tailwind v4 `--radius-*` is a theme namespace — the
`rounded-sm/-md/-lg` utilities compile to `var(--radius-md)` with no fallback, so
defining those properties anywhere (`@theme` or `:root`) moved the whole utility
family +2–4px on ~88 unrelated call sites. Renamed to `--theme-round-*` (outside
every TW namespace); `.theme-round-*` behaviour and B1's sections are unchanged.
Guarded by `storefront/app/globals.css.test.ts`.

---

### 8.2b Phase B2 — detailed plan (approved 2026-09-04) — BUILT

**Deliverable:** the global density scale. No merchant-visible spacing change on
any shop that hasn't set `globalSettings.density`. **Landed on
`feat/design-tokens-phase-b2` (2026-09-04).**

**Shape:** `globalSettings.density?: { preset?: 'compact' | 'cozy' | 'comfortable'
| 'spacious' }` — an **object wrapper**, not §5.3's original bare enum (which
predates B1 shipping `radius` as an object). Object so
`updateGlobalSettingsCategory` can write it and `DEFAULT_THEME_CONFIG` can seed
`{}` inertly. `DEFAULT_THEME_CONFIG.globalSettings.density = {}`.

**Three tokens** (all on plain `:root` + `.theme-*` class fallbacks — NOT
`@theme`, per the B1 hotfix rule):

| token | class | replaces | fallback |
|---|---|---|---|
| `--section-py` | `.theme-section-py` (`padding-block`) | `py-8` on the standard body-section content `<div>` (9 sites / 7 components) | `2rem` |
| `--grid-gap` + `--grid-gap-m` | `.theme-grid-gap` (`gap`) | `gap-4 sm:gap-6` on the product grids (3 sites / 2 components) | `1.5rem` / `1rem` |
| `--section-heading-gap` | `.theme-heading-gap` (`margin-bottom`) | `mb-4` on the section title → content wrapper (4 sites) | `1rem` |

Per-preset px table in `storefront/lib/density.ts` (`resolveDensityCssVars` →
`{}` on unset / `{}` / unknown; `applyDensityCssVars` sets + clears over
`DENSITY_CSS_VAR_NAMES`, SPA-leak guard, unit-tested incl. set-then-unset).
`shop-context.tsx`'s `applyDensityOverrides` runs last in the merged
`[shop, themeConfig]` effect. `cozy` reproduces today's values but the only
guaranteed no-op is `density` unset (near-today-baseline convention below).

**`.theme-grid-gap` @media — byte-identical at both breakpoints.** Tailwind
`gap-4 sm:gap-6` = `1rem` unconditionally, `1.5rem` at `min-width: 640px`. The
class inverts the cascade like the Phase-A motion mobile tier: the `≥640px`
value is the base declaration, one `@media (max-width: 639px)` block overrides it
with the `<640px` value. Verified in the built CSS (base rule precedes the media
block): at every **integer** viewport width the two match exactly (639 → mobile,
640 → desktop); the only divergence is a sub-pixel fractional band, the same
already-accepted trade-off as the motion tier (§9.2).

**Precedence — additive, not override.** `section.settings.spacing`
(`{top,bottom,left,right}` px) is inline `padding-*` on the **outer `<section>`**
in `SectionWrapper.tsx`, unchanged by B2. `--section-py` drives `padding-block`
on the **inner content `<div>`**. They compose — exactly as
`section.settings.spacing` already stacks on the hardcoded `py-8` today. Worked
example (Testadmin/1, the one prod shop with section spacing set —
`featured_collections`, `{top:5,bottom:4}`): today `5px + 32px` top; B2 with
`density` unset `5px + var(--section-py, 2rem)` = `5px + 32px` — identical.
§5.3's "becomes the override" wording is corrected below.

**OUT of scope** (flagged): the horizontal gutter `px-4 sm:px-6` (a page gutter,
not density); Hero `px-6 py-12`; Newsletter/Footer `py-10`; TrustBar `py-5`;
AnnouncementBar/Header chrome; the non-product grid gaps
(`FeaturedCollections` `gap-3`, `Testimonials` `gap-6`, `Brands` `gap-x/y-6`,
`ImageText` `gap-8`); `RichText` `space-y-4`; `BrandsSection` `mb-5` /
`ProductTabs` tab-row `mb-6`; legacy `home-layouts/*` (unreachable — no
`themeConfig`); a new `section.settings.gap` per-section override (no prod
section carries one; speculative).

**No-op proof:** (1) `density.test.ts` — `resolveDensityCssVars(undefined | null
| {} | { preset: bogus })` → `{}`; each preset → its 4 vars; `cozy` = today's
values; `applyDensityCssVars` set-then-unset clears all 4. `globals.css.test.ts`
gains a `postcss.parse` assertion (a `*/`-in-comment silently dropped every
hand-written class during B2 dev — build still exited 0). (2) Parity table in the
PR body (the file-by-file class → fallback map) + the 4-themed-prod-shop
regression rows (none has `density`; `deepMergeDefaults` backfills `{}` ⇒
`resolveDensityCssVars({})` → `{}`; only Testadmin/1 has `section.settings.spacing`
— additive, unchanged). (3) Full suites + builds green — backend `tsc` +
`jest themes` 42/42 (+1 validation case); storefront `tsc` + build + vitest
414/414 (+`density` / +`globals.css` parse) + lint +0 (33); admin `tsc` + build +
`DensitySettings` 3/3 + lint +0 (77). (4) Deploy-time visual pass on the 4 themed
prod shops (post-merge).

**Deferred:** nothing — B2 completes the design-token foundation (A + B).

---

### 8.3 Post-G0 capability priority — RECOMMENDATION (recorded 2026-09-04, before the templates were authored) — items 1-5 BUILT (see §8.5)

G0 ships the four templates against A/B only (Flow A — see §8.4). It exists to
inform what C–F should build first. This priority is written **before** the
`templates.ts` literals exist, deliberately, so it isn't anchored by whatever
the four templates happen to look like. Supersedes the raw §8 C–F ordering where
they disagree; the §8 rows stay as the capability inventory.

The re-evaluation of C–F against the built A/B foundations (the constraints A/B
introduced — the Tailwind-v4 `@theme` namespace rule, the full-swap-never-additive
class rule, JS animations self-gating on reduced motion — and what A/B made
cheaper — motion timing/magnitude tokens, `use-scroll-value.ts`, the stagger
plumbing, the `scale-in`/`blur-in`/`mask-reveal` entrances) produced this order:

1. **BUILT — Card-hover enum extension** (`animations.cardHoverEffect` +=
   `desaturate` / `quick-add-slide` / `overlay` / `shadow` / `tilt` — `underline`
   deferred, see §8.5) — **4/4 templates, and all four fell back to a stand-in
   value without it** (Atelier `zoom`→`desaturate`, Market `swap`→
   `quick-add-slide`, Bloom `rise`→`tilt`, Heritage `rise`→`shadow`, all four now
   on their real target). Extracted into `storefront/lib/card-hover.ts`
   (resolver + SPA-leak clear, matching motion/radius/density) rather than the
   inline `shop-context.tsx` maps the sketch above named.
2. **BUILT — `animations.imageLoad: 'fade'`** — 4/4 templates now set it.
3. **BUILT — Stagger wiring** — `.theme-stagger-child` + `style={{'--i':i}}`
   wired into `product_grid`, `product_tabs`, `featured_collections`,
   `testimonials`, `trust_bar`, and `brands` (grid mode); the
   `:nth-child(n+13 of .theme-stagger-child)` cap; the admin toggle lives in the
   shared `ScrollAnimationControl.tsx` (an optional `stagger`/`onStaggerChange`
   prop pair — see §8.5, this is a *per-section* motion control, not the global
   Motion category page the original phrasing suggested). Adopted by Atelier
   (featured_collections + product_grid), Market (featured_collections), Bloom
   (featured_collections + testimonials); Heritage deliberately has none.
4. **BUILT — `section.settings.motion.entrance: 'rotate-in'` +
   `brands.settings.scrolling` marquee** — Bloom's testimonials now use
   `rotate-in`; Market gained a real `brands` section with `scrolling: true`.
5. **C1 — header/footer layout presets** (named presets seeding `header.settings.rows`
   + zones, `footer` presets, `separator` / `height` / `contentWidth`,
   `scrollBehavior` via `use-scroll-value.ts`). Split from C. **M.** Makes
   Market's contact-bar and Heritage's coloured band read as intentional
   structure rather than a pile of rows.
6. **C2 — the mobile nav component** (drawer / bottom-bar / fullscreen). Split
   from C. **L** — the single biggest genuinely-new interactive build; its own
   PR + review (focus trap, body-scroll-lock, pointer-events swipe, ESC,
   backdrop).
7. Then the rest of D/E (button `hoverEffect`/`pressEffect`, `buttons.secondary`
   rendered variant, `product_tabs` magic-line, `trust_bar` count-up, section
   separators, accordion, newsletter success) and F (fly-to-cart, route
   transition + View Transitions PE, `scrollProgressBar`, `backToTop`,
   decorative parallax, custom cursor, `drawers.animation` + `cart.*`).

**Shared utilities to extract before the phase that first needs each** (both
mirror how `use-scroll-value.ts` was pre-shipped in Phase A):

- `useReducedMotion()` — a `matchMedia('(prefers-reduced-motion: reduce)')`
  subscription. Every JS animation in D/E/F + C2's drawer needs it; the blanket
  `globals.css` rule only covers CSS. Build with the second JS animation.
  **Checked against items 1-5 (§8.5): none needed it** — card hover / imageLoad
  / stagger / rotate-in / the marquee are all CSS-driven (transitions, CSS
  `animation`, one `onLoad` React-state toggle), already covered by the
  blanket rule (rotate-in added to its neutralize list, same as every other
  entrance). Still not built — first real JS animation (fly-to-cart, count-up,
  parallax, custom cursor) still owns this.
- `useCountUp(target)` — rAF count-up, reads `--motion-duration-*`, self-gates
  on reduced motion. Consumers: `trust_bar` rating (E), `cart.subtotalAnimation:
  'count'` (F), collection result count (§4.5). Not touched by items 1-5. Build
  once in E.

**§9.3 dead-control list — updated after this batch:** `section.settings.
motion.stagger` is no longer typed-but-unwired (§8.5) — remove it from the
"missing" list below. The other 4 stale rows and 5 remaining missing rows from
the original pass still need fixing: `buttons.pillCornerRadius` "B/D" → B never
touched it; `prices.*` → RESOLVED in B1, remove; `search.*` "B/D" → B never
touched it; typography `case`/`letterSpacing` → were already wired pre-B1,
`pairing`/`scale` only add a shortcut; and `motion.smoothScroll` /
`.scrollMotion` / `.hoverMotion` / `.parallax` / `.kenBurns` /
`.decorativeParallax` / `.customCursor` are still typed-but-unwired.

### 8.4 Phase G0 — the four templates against A/B only (Flow A) — planning

**Deliverable:** `THEME_TEMPLATES` (Atelier / Market / Bloom / Heritage) as full
typed `ThemeConfig` literals in `backend/src/themes/templates.ts`, spread from
`DEFAULT_THEME_CONFIG`, authored against **only capabilities that render today**
(motion + radius + density + typography pairing/scale + colour schemes + card
style/aspect/align/density + sale-price + the shipped section types + the
`header.settings.rows` structure). **Flow A only** — `POST /themes { fromTemplate }`
→ a new **unpublished** library row via `cloneConfigWithFreshIds`, current live
theme untouched. **Flow B (`applyTemplate` + confirm modal, D1/D3) → G1**, a
separate later plan (the riskier half; Flow A alone answers "let me try one").

**The no-op guarantee:** a G0 template sets **zero keys without a live consumer**
— "what the merchant gets" == "what's in the file", no asterisks. Each template
carries a `// ── Deferred to C–F (re-author when these land) ──` block listing
every intended-but-unavailable setting, **including `animations.addToCart` /
`pageTransition`** (left `false` deliberately — a published template theme
silently gaining motion the day F merges is an unrequested behaviour change with
no changelog trail; re-authoring is the explicit path). `animations.cardHoverEffect`
is the one concession — the enum is still `none|zoom|rise|swap`, so each template
picks the closest valid stand-in (Atelier `zoom`, Market `swap`, Bloom `rise`,
Heritage `rise`) with the real target (`desaturate` / `quick-add-slide` / `tilt`
/ `shadow`) in its deferred block. `rotate-in` (Bloom) → `scale-in` in G0.

**Drift protection:** `: ThemeConfig` annotation ⇒ `tsc` enforces the full
current shape (stronger than the shallow validator); one
`assertValidThemeConfig(THEME_TEMPLATES.<key>)`-doesn't-throw case per template
(mirrors `accepts the real DEFAULT_THEME_CONFIG unchanged`); one
`cloneConfigWithFreshIds` no-throw + fresh-ids + scheme-remap test per template;
a `< 200_000` byte guard per template. Held to the same in-lockstep-with-
`theme-config.types.ts` discipline as `DEFAULT_THEME_CONFIG`.

**Surface:** `fromTemplate?` on `CreateThemeDto` (`@IsIn(TEMPLATE_KEYS)`); a third
branch in `ThemesService.create` (`duplicateFromId` + `fromTemplate` together →
400); `GET /themes/templates` → `{ key, name, blurb, previewColors }[]` (one
source of truth, no hand-mirrored admin const); a "Start from a template" block
of 4 cards above the "Custom themes" grid in `admin/app/theme/page.tsx`.

**Distinctness (honest):** all four stay visibly distinct in G0 on the axes that
carry the most weight (type / radius / density / motion intensity+easing / scheme
/ card style+aspect / section composition). No two collapse. **Heritage is
strongest** (§6.4: "notably does NOT need" most of C–F). **Bloom is weakest** —
its `expressive` bouncy motion, `soft` radius, loud scheme, big display type and
`elevated` cards land, but its signature flourishes (decorative parallax, `tilt`,
wishlist `burst`, wave footer) are all C–F. **Market loses the most flourish**
(fly-to-cart, count-up, magic-line, marquee, bottom-bar) but keeps its dense +
fast + trust-heavy structure. Closest pair: Market/Bloom, held apart by radius
(8 vs 16), motion (`snappy`/`standard` vs `overshoot`/`expressive`), type scale
(`compact` vs `spacious`) and card style. §8.3 items 1 and 4 are the cheap fixes
that sharpen the two weak templates.

---

### 8.5 Post-G0 batch 1 — §8.3 items 1–5 — BUILT (2026-09-04, `feat/theme-motion-batch-1`)

**Scratch-shop pass (before):** creating + publishing all four G0 templates and
eyeballing the storefront (a real headless-browser pass, `prefers-reduced-motion`
forced so below-the-fold scroll-triggered entrances don't read as false blank
gaps) found and fixed two **template-authoring bugs** before this batch started:
Bloom's `buttons.primary.cornerRadius: 9999` (meant for pill buttons) leaked
into `--theme-radius`, which the Featured/ImageText/ProductGrid section image
containers also read — rendering every collection tile as an ellipse; and none
of the four templates actually used the `schemeId` plumbing they were built
with, so the "one accent-scheme section" each template's own description
promised never appeared. Both fixed in `templates.ts` before building anything
new (see the branch's first commit).

**1 — Card-hover enum extension.** `animations.cardHoverEffect` gains
`desaturate` / `quick-add-slide` / `overlay` / `shadow` / `tilt` (`underline`
deferred — no CTA trailing-icon slot to reuse `.theme-nav-link--anim` against
yet). Extracted the three Phase-A/B1 inline maps out of `shop-context.tsx` into
`storefront/lib/card-hover.ts` (`resolveCardHoverCssVars` + `applyCardHoverCssVars`,
same resolver + SPA-leak-clear shape as `motion.ts`/`radius.ts`/`density.ts`) —
`cardHoverEffect` is a *required* field (default `'zoom'`), so there's no "unset"
case to prove; the byte-identical parity is "the four pre-batch values
(`none`/`zoom`/`rise`/`swap`) resolve to exactly what the old inline maps
produced, plus the three new vars neutral" — asserted directly in
`card-hover.test.ts`.
- `desaturate`: image `filter: saturate(0.55)` at rest → `saturate(1)` on hover
  (new `--theme-card-hover-filter-base/-hover` vars + a `.theme-product-image`
  base rule).
- `overlay`: a new always-rendered `<span class="theme-product-hover-overlay">`
  (opacity 0 at rest, `--theme-card-hover-overlay-opacity` on hover — 0.12 only
  for this effect) in both `ProductCard.tsx` and `GridProductCard`.
- `shadow`: reuses `rise`'s exact `--motion-hover-shadow` magnitude with no
  paired transform (card stays static).
- `tilt`: a fixed-angle CSS-only `rotate(-1.5deg)` on the card wrapper — the
  plan's §3.1 #10 "S version", no cursor tracking, no JS.
- `quick-add-slide`: `ProductGridSection.tsx`'s desktop quick-add button gets a
  **separate** className (`QUICK_ADD_SLIDE_CLASS`, opacity+translateY+
  pointer-events, transitionable) instead of the default `hidden
  sm:group-hover:flex` (a `display` toggle can't be transitioned) — picked at
  render time by `cardHoverEffect`, so every other effect's markup is
  byte-identical.

**2 — `animations.imageLoad: 'fade'`.** Each product image starts at opacity 0
and crossfades in on its own `onLoad` (per-image `Set<number>` state in both
`ProductCard.tsx` and `GridProductCard`); unset skips the state entirely,
opacity governed only by the pre-existing carousel/swap `activeIndex` logic —
identical to today. Known, accepted coupling: turning this on also means a
subsequent hover-swap crossfade on that image inherits the load-fade's
`--motion-duration-base` transition-duration instead of `-fast`, since both
share the one `opacity` transition on the same element — cosmetic, opt-in only.

**3 — Stagger wiring.** `.theme-stagger-child` + inline `style={{'--i': i}}` on
the list items in `FeaturedCollectionsSection`, `TestimonialsSection`,
`TrustBarSection`, `BrandsSection` (grid mode), `ProductTabsSection`, and
`ProductGridSection`'s `GridProductCard` (its own root `<Link>`, no extra
wrapper). Cap: `.theme-stagger-child:nth-child(n+13 of .theme-stagger-child) {
animation-delay: 0s }` — pure CSS, degrades gracefully on the few pre-`:nth-child(of)`
browser versions. **Load-bearing detail confirmed in `ScrollAnimatedWrapper.tsx`:**
`stagger: true` alone does nothing — the wrapper returns children with no
`.theme-anim-visible`/`data-stagger` at all when `entrance === 'none'`, so every
section that wants stagger also needs a real entrance value (all six G0 uses
already had one). Admin control: `ScrollAnimationControl.tsx` (the shared
per-section motion control every list section's settings panel already uses)
gained optional `stagger`/`onStaggerChange` props rendering a `Toggle` — **not**
the global "Motion" theme-settings category, which only ever governed
`globalSettings.motion` (intensity/speed/easing); `stagger` is a per-section
field (`section.settings.motion.stagger`), so the per-section shared control is
the correct, and only sensible, home for it.

**4 — `rotate-in` entrance + `brands.scrolling` marquee.** `rotate-in`
(`rotate(-2deg) → 0` + opacity) added to `SectionEntrance`, `KNOWN_ENTRANCES`,
`ScrollAnimatedWrapper`'s `ANIMATION_CLASS`, and — easy to miss — the blanket
`prefers-reduced-motion` rule's neutralize list (every entrance class needs to
be in both places). `brands.settings.scrolling: true` doubles the logo list and
wraps it in `.marquee-track` (the exact same class + `--motion-marquee-duration`
token the announcement bar already uses) inside an `overflow-hidden` parent —
~30 lines including the admin toggle, once the plumbing pattern already existed.

**Templates updated to their real values** (no more stand-ins):
`cardHoverEffect` (Atelier `desaturate`, Market `quick-add-slide`, Bloom `tilt`,
Heritage `shadow`), `imageLoad: 'fade'` (all four), `motion.stagger: true`
(Atelier's `featured_collections`+`product_grid`, Market's
`featured_collections`, Bloom's `featured_collections`+`testimonials` —
Heritage deliberately none), Bloom's testimonials `entrance: 'rotate-in'`
(was `scale-in`), and a new `brands` section on Market with `scrolling: true`
(position 5, before newsletter).

**No-op guarantee for every existing shop:** none of the 5 changes alter any
default value in `DEFAULT_THEME_CONFIG` — `cardHoverEffect` keeps its `'zoom'`
default, `imageLoad` is a new optional key (absent ⇒ `undefined` ⇒ the fade
branch never runs), `motion.stagger`/`entrance: 'rotate-in'`/`brands.scrolling`
are all only reachable by a merchant (or template) explicitly setting them. A
shop with none of these touched renders pixel-identical to before this batch.

**Gate:** backend `tsc` + `jest` 484/484 (templates.spec.ts's stale
`cardHoverEffect` allow-list test updated to the 9-value set) + lint +0 (261);
storefront `tsc` + `build` + `vitest` 428/428 (+13 `card-hover.test.ts`) + lint
+0 (33); admin `tsc` + `build` + `vitest` (+4 `AnimationsSettings.test.tsx`,
theme-builder subset 63/63) + lint +0 (77).

**Scratch-shop pass (after):** the same four themes edited in place and
republished (not recreated) — Bloom picked up `tilt` card hover + fading
product images + staggered collection tiles/testimonials; Market picked up
`quick-add-slide` + a scrolling brands marquee (renders nothing until brands
exist) + staggered collection tiles; zero console/page errors on any of the
four. See the session report for the actual before/after screenshots.

**Deferred, not built this batch:** `underline` card hover (needs a CTA
trailing-icon slot); `useReducedMotion()` / `useCountUp()` (neither needed by
1–5 — see the note under §8.3's "Shared utilities").

---

### 8.6 Phase C (C1 header/footer presets + C2 mobile nav) — BUILT (2026-09-05, `feat/theme-header-footer-presets-mobile-nav`)

The last piece of Phase C from §8's table. Plan reviewed before code (see the
session's plan-mode transcript); one design question — the drawer's swipe
gesture depth — was put to the user directly (AskUserQuestion) rather than
decided silently: discrete threshold swipe (no live drag-follow), dismissed
via X/backdrop/Escape.

**C1 — header/footer presets: one-time apply-then-diverge, matching
`HOMEPAGE_PRESETS`.** No backend endpoint — `admin/lib/header-footer-presets.ts`'s
`HEADER_PRESETS`/`FOOTER_PRESETS` are plain client-side literals, applied via
`useThemeEditor.ts`'s `applyHeaderPreset`/`applyFooterPreset` (same
`updateConfig` + `save()` + `toast` shape as `applyHomepagePreset`). 7 header
presets (Classic/Centered/Contact-bar+centered nav/Split nav/Minimal/
Editorial/Colored band), 5 footer presets (Multi-column/Centered stack/Big
CTA/One line/Mega) — every one a literal built only from block/row shapes
`ThemeDrivenHeader.tsx`/`ThemeDrivenFooter.tsx` already rendered before this
batch (confirmed by reading both files in full first, not assumed).

New settings, all optional, none with a `DEFAULT_THEME_CONFIG` value:
`header.settings.height`/`.contentWidth`/`.separator`/`.announcementPosition`/
`.mobileNav`, icon block `.showLabel`, `footer.settings.columns`/
`.showPaymentIcons`/`.waveEdge`/`.bottomBarSeparate`. None needed a new global
CSS var — every one is a render-time class/component-order choice.
`showPaymentIcons` reuses the legacy `Footer.tsx`'s real `paymentBadges()`
helper (extracted to `lib/payment-badges.ts`). Back-to-top
(`globalSettings.floatingElements.backToTop`) was moved off `footer.settings`
mid-plan per review feedback — it now lives with `floatingElements`
(matching `motion`/`radius`/`density`'s object-wrapper convention) and
consumes the already-shipped-but-unused `use-scroll-value.ts`; this closes
that item out of Phase F's remaining scope.

**C2 — `MobileNav.tsx`, the storefront's first real mobile nav.**
`header.settings.mobileNav`: `'scroll'` (default, `MenuBar.tsx`'s existing
horizontal-scroll row, completely untouched) / `'drawer'` / `'bottom-bar'` /
`'fullscreen'`. Own component, not a `MenuBar` branch — mounted only when the
setting is non-`'scroll'` (`ShopLayoutClient.tsx` gates it before mounting at
all, so the no-op path is "this component isn't in the tree," not "a new
branch that happens not to fire"). Drawer/fullscreen share one `<details>`-
based accordion renderer for nested menu items and a portaled panel (same
portal-for-overflow precedent as `MegaMenuPanel`); bottom-bar is structurally
different (5 fixed destinations, no menu fetch, no trigger). New shared
`storefront/lib/use-reduced-motion.ts` (promised in `storefront/CLAUDE.md`'s
pre-PR checklist as "build when the second JS animation lands" — this is
that phase), gating the swipe listener and open/close transition duration
only — tap/keyboard interaction always works regardless of reduced motion.

**Two real bugs found via the scratch-shop Playwright pass** (not caught by
any unit test — both are exactly the "verify against actual behaviour in a
real browser" class of finding this methodology exists to catch):
1. `cloneConfigWithFreshIds` gave every header block a fresh id but never
   remapped `header.settings.rows[].blockIds` to match — `resolveHeaderRows`
   found no match for any reference and dumped every block into the last row
   via its "leftover" fallback, silently collapsing Market's and Heritage's
   multi-row header presets into one row on every real `fromTemplate`
   creation, even though the stored config looked correct in isolation.
   Fixed with the same map-old-id-to-new-id-then-rewrite shape
   `cloneColorSchemesWithRemap` already used for colour scheme references.
2. `MobileNav.tsx`'s swipe-to-close handler called `setPointerCapture`
   immediately on `pointerdown` — safe in isolation, but on a panel
   containing real interactive children (the Close button, menu links) this
   suppresses the browser's synthesized `click` event on those children
   entirely once Chromium retargets the captured `pointerup`. jsdom has no
   `setPointerCapture` at all, so the unit test never exercised this path.
   Fixed by deferring capture until real horizontal movement (>10px)
   confirms an actual swipe — a plain tap releases before any movement, so
   capture never engages for it.

**Re-authored all 4 templates off their header/footer/mobileNav deferred
items:** Atelier (`mobileNav: 'fullscreen'`), Market ("Contact-bar + centered
nav" header preset + `mobileNav: 'bottom-bar'`), Bloom (`mobileNav: 'drawer'`
+ a wave-edge footer with a CTA column), Heritage ("Colored band" header
preset using its own deep-green scheme colour, not a generic placeholder +
`mobileNav: 'drawer'` + "Multi-column" footer preset with payment icons and a
separate bottom bar). `floatingElements.backToTop` intentionally not enabled
on any of the four — available for a future re-author.

**No-op guarantee:** every new key is optional with no default value and the
same `settings.<key> as X | undefined` reader convention every existing
header/footer setting already uses; `mobileNav` unset/`'scroll'` means
`MobileNav.tsx` is never mounted, zero fetch, zero DOM.

**Scratch-shop pass:** a disposable shop this batch's own Playwright spec
seeded (own signup, not the shared `e2e/seed.ts` fixture), verified on both
desktop (1280×800) and a mobile viewport (390×844, `hasTouch: true` — the
first mobile-viewport pass in this plan's history) — baseline no-op (classic
header, no hamburger/bottom-bar), a custom header/footer preset combo (wave
edge, `showLabel`, hamburger open/close via tap, backdrop, X, and Escape,
plus a real touch-emulated edge-swipe-open), and all 4 re-authored templates
(mobile nav affordance present, zero real console errors past the two bugs
above, which were fixed and re-verified). The scratch spec and its
screenshots were deleted after verification, per this plan's standing
scratch-shop-pass convention.

**Gate:** backend `tsc` + `jest` 490/490 (+6: 2 in `themes.service.spec.ts`,
4 via `templates.spec.ts`'s `describe.each`) + lint +0 (261); storefront
`tsc` + `build` + `vitest` 461/461 + lint +0 (33); admin `tsc` + `build` +
`vitest` 452/454 (2 failures are the pre-documented full-suite-only
flakiness in `AccountSetup.test.tsx`, confirmed by re-running the file alone:
20/20) + lint +0 (77). `check-page-width`/`check-outlet-scoping`/
`check-no-console-log` guardrails all clean.

**Deferred, not built this batch:** `header.settings.scrollBehavior`
(`shrink`/`hide-on-scroll`/`reveal-on-hero`) and `.transparentOverHero` —
out of the user's given C1/C2 field list, stay on each template's deferred
ledger. `icons.*` (style/corners/size). This closes out Phase C (§8's table)
in full except those two scroll-behaviour fields, which move to whichever
future phase actually wires header scroll behaviour.

---

### 8.7 Post-C capability re-evaluation — RECOMMENDATION (recorded 2026-09-05, before picking up D/E/F/G1)

Phases A, B1, B2, G0, post-G0 batch 1, and C (C1+C2) are all built. Same
instinct as §8.3 (re-evaluate the remaining catalog against what's actually
been absorbed, rather than assume the original D/E/F specs still describe
what's left) — this time applied one phase later, since batch 1 and C both
closed out items originally attributed to D/E/F. §6.5's dependency table is
updated in place with ✅/open status; this section is the fresh priority
recommendation drawn from it, not a re-derivation from scratch.

**Scorecard — how much of D/E/F's original scope is actually gone:**

- **D** (`animations.cardHoverEffect` extension, `buttons.primary/secondary`
  hover/press effects + `pillCornerRadius`, `productCards.wishlistAnimation`,
  `animations.imageLoad`, `inputFields.focusAnimation`, `icons.corners`/`.size`)
  — 2 of 7 line items closed (card-hover enum via batch 1, `imageLoad` via
  batch 1). **The button/icon/input/wishlist micro-interaction items are
  entirely untouched.**
- **E** (`product_tabs` polish, `trust_bar` count-up, hero `kenBurns`/
  `parallax`/`indicatorStyle` extensions, `brands.scrolling`, section
  separators/overlay/`contentWidth`, newsletter `successAnimation`, accordion
  animation) — 1 of 7 closed (`brands.scrolling` via batch 1). **Everything
  else in E is untouched.**
- **F** (fly-to-cart, route-content fade + View Transitions,
  `scrollProgressBar`, `floatingElements.backToTop`, `decorativeParallax`,
  `customCursor`, `drawers.animation` + `cart.itemAnimation`/
  `subtotalAnimation`, card metadata sub-blocks) — 1 of 8 closed
  (`backToTop`, this batch). **The rest — including the two most expensive
  single items, fly-to-cart and page transitions — is untouched.**
- **G1** (`applyTemplate` Flow B) — untouched, still its own separate later
  plan per §7.2's decision record.

**Conclusion: unlike the G0→C1/C2 gap (which genuinely absorbed most of what
D/E's easy wins would have covered), D/E/F are still substantially open.**
Batch 1 + C picked the lowest-hanging, highest-template-count fruit each time
(`cardHoverEffect`, `imageLoad`, stagger, `brands.scrolling`, `backToTop`,
header/footer/mobile-nav structure) — real progress, but D/E/F's *bulk*
(button/input/wishlist micro-interactions, hero motion, drawer/cart
animation, fly-to-cart, page transitions) was never touched by either batch.
Treat the current §8 D/E/F rows as still-accurate scope, not stale.

**Priority-ordered remaining work**, re-derived from §6.5's updated table
(highest surviving template-count first) plus the layout-catalog items
(§4.2–4.5, 4.8) that were never actually assigned to a lettered phase:

1. **`buttons.primary.hoverEffect` + `.pressEffect` (§3.2) — BUILT, see
   §8.8.**
2. **`header.settings.scrollBehavior` + `.transparentOnHero` (§3.3) — BUILT,
   see §8.9.**
3. **`trust_bar` `rating_badge` count-up (§3.4 #9)** — 3/4 templates, a
   contained, self-testable JS item (rAF + `matchMedia` guard, no shared
   infra needed) — this is the first real consumer for `useCountUp()`,
   flagged as a prerequisite back in the original C1/C2 instruction but
   never actually needed until now.
4. **`icons.corners` (rounded/sharp, §5.1)** — 3/4 templates, Effort **S**
   (a CSS override on lucide SVGs, no new icons drawn — distinct from the
   separately-gated Phase I glyph/style work).
5. **Newsletter `successAnimation` (§3.9 #5)** — 3/4 templates, Effort **S–M**
   (form collapses, a checkmark + confirmation text scales in).
6. **`buttons.secondary` rendered variant (§3.2, §9.3)** — 2/4 templates
   (Market, Heritage) — the one remaining item that finally gives
   `buttons.secondary` and `secondaryButtonLabel` (scheme) a real consumer.
   Effort **M** (needs a real secondary-button render path on the CTA
   block, not just a style enum).
7. **`product_tabs` magic-line + crossfade + height-animate polish (§3.9
   #8)** — 2/4 templates (Market, Bloom), Effort **M**. `product_tabs`
   currently hard-swaps; this is a clear, contained polish target.
8. **Wishlist animation (`pop`/`burst`/`sweep`, §3.6 #10–12)** — 2/4
   templates, Effort **S–M**, self-contained (no shared infra beyond what
   exists).
9. **Enable `floatingElements.backToTop` on Market + Bloom** — not new work,
   just template re-authoring: the capability shipped this batch but neither
   template that originally wanted it (§6.5) actually turned it on. **S**,
   arguably worth folding into whichever PR does item 1 or 3 above rather
   than its own PR.
10. **`inputFields.focusAnimation` (§3.9 #3)** — 1/4 (Market), but it's the
    dead `inputFields` category's only assigned consumer — Effort **S**.
11. **Section separators (§4.8, §3.4 pairs with #10 `draw`)** — 1/4 (Bloom),
    Effort **S–M**, decorative SVG edges between sections.
12. **Hero `kenBurns` / `parallax` + `decorativeParallax` / `indicatorStyle:
    progress` (§3.5)** — 1/4 each (Atelier, Bloom, Market respectively),
    Effort **S** (`kenBurns`), **M** (`parallax`), **M–L**
    (`decorativeParallax` — Bloom's signature flourish, explicitly flagged
    as expensive-if-overused in §9.4).
13. **`drawers.animation` + `cart.itemAnimation`/`subtotalAnimation` (§3.6
    #1–8)** — 1/4 (Market) today, but this is the natural prerequisite for
    fly-to-cart (#14) and gives the still-dead `drawers`/`cart` categories
    their consumers. Effort **S** (drawer easing) up to **M** (line-item
    expand/collapse, count-up subtotal).
14. **Fly-to-cart (`animations.addToCart`, §3.6 #9)** — 1/4 (Market), but
    it's F's single most-requested "expensive one-off" and the whole reason
    `animations.addToCart` has stayed `false` in every template's literal
    since G0. Effort **L**, self-contained (`getBoundingClientRect` +
    WAAPI/rAF, no shared infra) — do it after drawers/cart (#13) since a fly
    animation ending at a themed, already-animating drawer reads better than
    landing on a static one.
15. **Route-content fade + View Transitions progressive enhancement (§3.8
    #1–2)** — universal (not template-specific — every navigation on every
    shop), Effort **M** for the real feature, **L** if the View Transitions
    layer is attempted (Chromium-only, Next support experimental — ship the
    plain fade, gate VT behind `'startViewTransition' in document`, never
    block on it, per §9.4's Flag #2).
16. **`scrollProgressBar` (§3.8 #3)** — 1/4 (Market), Effort **S**, trivial
    once `useScrollValue()` has a second real consumer (item 2 above is the
    first).
17. **Card metadata sub-blocks (`product_vendor`/`product_stock`/
    `product_swatches`, §3.6 F-row / §4.2)** — 1/4 (Market) for the
    animation angle, but this is really a **card-content** feature (wires
    the dead `swatches` category) more than an animation — flag for a
    content-block-shaped PR, not a motion one.
18. **`customCursor` (§5.7)** — 0/4 templates want it today (not in §6.5's
    table at all), expressive-only, accessibility-sensitive (must not hide
    the cursor for keyboard/AT users, disabled on touch, killed by reduced
    motion). Lowest priority of everything above; revisit only if a future
    template wants an editorial cursor treatment.

**Layout-catalog items never assigned to a lettered phase** (§4.2 metadata
rows/quick-add styles/featured-card, §4.3 asymmetric grids/carousel row,
§4.4 PDP layout enums, §4.5 collection-page layout enums, §4.8 overlay/scrim
+ container bleed + themed skeletons + empty states) — these were cataloged
but never folded into D/E/F's table rows in the original plan. None is
requested by any of the 4 templates' own descriptions (§6), so none is
prioritized above — flagging their existence here so a future re-evaluation
doesn't have to rediscover them.

**Decision (2026-09-05): §4.4 (PDP layouts) and §4.5 (collection-page
layouts) stay unassigned line items in §4, not their own phases.** Fold
either into E opportunistically whenever a change already touches that
surface, rather than scheduling either as a dedicated phase — despite being
the largest ungrouped chunks in the catalog, nothing currently requests
them (not one of the 4 templates, not this priority list), and a dedicated
phase for unrequested scope would be exactly the kind of premature build-out
this plan has otherwise avoided.

**Doc hygiene fixed this pass:** §5.2 (typography pairing), §5.4
(corner-radius — shipped as `globalSettings.radius`, not the bare enum
originally sketched), and §5.6 (`salePriceColor`/`salePriceStyle`) were all
actually built in Phase B1 but never marked BUILT in their own section
headers — fixed. §9.3's dead-control table had the same staleness
(`prices.*`, `search.*`'s radius half, typography `case`/`letterSpacing`,
`buttons.pillCornerRadius`'s radius half all resolved but unmarked) — fixed,
plus three new rows for what C1/C2 resolved.

**Not committed scope.** This is a recorded recommendation, not a build
authorization — picking up item 1 (or any subset) still gets its own
plan-mode round before code, per this plan's standing practice, especially
once the list reaches the **L**-effort items (fly-to-cart, View Transitions,
`decorativeParallax`).

---

### 8.8 `buttons.primary.hoverEffect` + `.pressEffect` — BUILT (2026-09-05, `feat/button-hover-press-effects`, PR #97)

§8.7 item 1. `ButtonStyleSettings` gained `hoverEffect?: 'none'|'sweep'|
'shine'|'border-fill'|'icon-nudge'` and `pressEffect?: boolean`, mirrored
across backend/admin/storefront, shared by `.primary`/`.secondary` even
though only `.primary` has a real render path today. New pure
`resolveButtonHoverClass()` in `storefront/lib/theme-element-style.ts` (same
convention as `card-hover.ts`/`product-badge.ts`) selects the right
`.theme-btn-*` class(es), consumed by `themeButtonBaseStyle()`'s two real
call sites — Hero CTA and Newsletter submit. **Quick-add is not a third
consumer** (confirmed via grep — it's styled entirely through
`globalSettings.productCards`, a separate category), which narrowed this
batch's scope from what the catalog implied. All four effects read the
existing `--motion-*` tokens, no new timing invented; none hold an element
in a hidden/offset base state, so the existing blanket
`prefers-reduced-motion` rule covers them with zero additions.
`icon-nudge` needed a small markup addition (a trailing lucide `ArrowRight`,
rendered only for that value). `border-fill` is visually inert on both
consumers' default solid fill — correct, not a bug (its natural partner is
the legacy `buttonFill: outline` look).

Admin: `ButtonsSettings.tsx`'s shared `ButtonStyleFields` gained an optional
`showEffects` prop, passed only on the Primary call site (Secondary renders
nowhere yet, so the controls would be a new unused setting there).

Templates re-authored per each one's own deferred note: Atelier
(`hoverEffect: 'sweep'`, `pressEffect: true`), Bloom (`hoverEffect: 'shine'`),
Market (`hoverEffect: 'icon-nudge'`, `pressEffect: true` — its deferred block
only named `border-fill` tied to the secondary variant, still out of scope;
`icon-nudge` was picked instead for real visual variety across all four
templates' now-real values), Heritage (left genuinely unset, matching its
own restraint).

**No-op guarantee:** both fields absent/`'none'`/`false` resolve to an empty
className — byte-identical to today's plain `bg-accent` button. Neither
field has a `DEFAULT_THEME_CONFIG` value.

**Gate:** backend `tsc` + `jest` 490/490 + lint +0 (261).

---

### 8.9 `header.settings.scrollBehavior` + `.transparentOnHero` — BUILT (2026-09-05, `feat/header-scroll-behavior`)

§8.7 item 2. `scrollBehavior?: 'static'|'sticky'|'shrink'|'hide-on-scroll'|
'reveal-on-hero'` (new `HeaderScrollBehavior` type alias, mirrored across
backend/admin/storefront next to the existing `MobileNavMode` alias) wins
over the legacy `header.settings.sticky` boolean when present; `sticky`
stays the sole reader for a shop that never touches this control (confirmed
via grep it has exactly one reader, `ThemeDrivenHeader.tsx`, before
designing the precedence around it). The catalog's "transparentOverHero"
spelling was never real code — the already-shipped key is
`transparentOnHero` (kept as-is, no rename); it was genuinely unread on the
storefront before this batch (confirmed via grep, not assumed from the
doc).

**Ownership split, found by reading the actual component tree first:** the
header's real opaque background lives on the *ancestor* `<header>` in
`ShopLayoutClient.tsx`, not on `ThemeDrivenHeader.tsx`'s own inner div — so
`shrink`/`hide-on-scroll`/`reveal-on-hero` promote that ancestor to sticky
and own its hidden/transparent-vs-solid state there; the plain `'sticky'`
value (or the legacy boolean) stays exactly as before, narrowly applied
inside `ThemeDrivenHeader`'s own div. New shared `use-header-scroll-state.ts`
hook (wrapping the already-shipped-but-until-now-unused-for-direction
`useScrollValue()`) returns `{ shrunk, hidden, solid }`: `shrink` swaps the
effective height key to `'compact'`, reusing C1's existing
`HEADER_ROWS_PY`/`HEADER_CLASSIC_PY` tables (no new padding scale); a
`.theme-logo-shrink` class scales the logo via `transform` only, no reflow.
`hide-on-scroll` translates the header off-screen on down-scroll past an
80px dead zone, reappears on any up-scroll. `reveal-on-hero` reads a hero's
height via a `data-theme-hero` DOM marker on `HeroSection.tsx` (no React-tree
access exists between global chrome and a homepage-only section — a marker
plus `getBoundingClientRect()` was simpler and equally correct than
ref-threading) and only means anything on the homepage route, where
`SectionRenderer` mounts a hero at all. All three states are CSS-transition-
driven (transform/padding/background-color) triggered by class/style
toggles, not a continuous JS animation loop — the existing blanket
`prefers-reduced-motion` rule covers them with zero additions; the scroll
*listener* itself stays active under reduced motion (a real functional
behaviour, not an animation).

**Two real bugs found, both in `use-scroll-value.ts`, both invisible to
every prior unit test** (this is the first real consumer of the hook's
`direction` field, and the first real-browser-scroll exercise `BackToTopButton`
never got either):
1. rAF-only throttling can starve in a backgrounded/unfocused tab — `onScroll`
   sets a `pending` guard, but if the scheduled `requestAnimationFrame`
   callback never fires, nothing ever clears it. Fixed by racing a
   `setTimeout(runOnce, 100)` fallback against the rAF call, whichever fires
   first wins.
2. **The one that was actually blocking every render in the real dev
   server, found via instance-tagged console logging across a genuine
   Playwright scroll pass:** React Strict Mode's dev-only mount → cleanup →
   remount cycle cancelled the scheduled rAF/timeout in cleanup but never
   reset the `pending` guard — the second (real, final) mount's own
   sync-on-mount call then saw a stale `pending: true` and never scheduled
   anything again, permanently starving every future scroll event for the
   component's lifetime. Neither bug showed up in any isolated unit test —
   React Testing Library's `render()` doesn't wrap in Strict Mode, so the
   remount cycle that triggers bug 2 never happens there. Fixed by resetting
   the guard inside the cleanup function itself.

**Admin:** `HeaderSettings.tsx`'s "Sticky header" Toggle replaced with a
"Scroll behavior" Select, displayed value seeded from the legacy `sticky`
boolean when `scrollBehavior` is unset; picking any option always writes
`scrollBehavior` going forward, never touches `sticky` again. "Transparent
over hero" stays the existing Toggle, unchanged — it simply starts doing
something once `reveal-on-hero` is picked.

Templates re-authored per each one's own deferred note: Atelier
(`reveal-on-hero` + `transparentOnHero: true`), Market (`shrink`), Bloom
(`hide-on-scroll`). Heritage stays unset — not named in its own deferred
block, matching the 3/4 count in §6.5's table exactly.

**No-op guarantee:** `header.settings` stays free-form (no validation
change needed); `scrollBehavior` absent falls back to reading `sticky`
exactly as before this batch; a shop with neither set renders byte-identical
to today.

**Scratch-shop pass:** the user explicitly required confirming the existing
methodology actually *scrolls* the page (not just loads it) before writing
any header logic — it didn't; `page.mouse.wheel()` plus before/scrolled-down/
scrolled-up snapshots is the first real scroll exercise in this plan's
scratch-pass history. Verified all four `scrollBehavior` values (including
the no-op case with the legacy `sticky` boolean explicitly set) on desktop
and mobile viewports, then re-verified against the actual re-authored
Atelier/Market/Bloom templates (not a manually-patched config) publishing
for real. Zero real console errors in every pass. Both scratch spec files
and the temporary `playwright.config.ts` `globalSetup` disablement were
removed/reverted after verification.

**Gate:** backend `tsc` + `jest` (themes, 87/87) + lint +0 (261); storefront
`tsc` + `build` + `vitest` 489/489 (1 pre-existing flaky timing test,
confirmed passing in isolation) + lint +0 (33); admin `tsc` + `build` +
`vitest` (full-suite-only flakiness across a different file set on each of
two consecutive runs, none touching this change; the one relevant file,
`HeaderSettings.test.tsx`, confirmed 13/13 in isolation twice) + lint +0
(77).

---

## 9. Risks, performance budget, config-shape flags

### 9.1 Config-shape flags

Every proposal fits the "optional key in an existing container" rule:

| New data | Container | Shape risk |
|---|---|---|
| `globalSettings.motion` | new nested category under `globalSettings` (like `floatingElements` in P6) | **None** — nested, not top-level; `deepMergeDefaults` backfills once it's in `DEFAULT_THEME_CONFIG`; absent-in-code ⇒ every `var(--motion-*, today)` fallback ⇒ pixel-identical. |
| `globalSettings.radius`, `globalSettings.density` | new tiny categories under `globalSettings` (like `pageLayout`) | **None** — same as above. |
| `typography.pairing` / `.scale` / `.baseFontSize` | new optional keys in the EXISTING `typography` | **None** — when `scale` absent, explicit h1–h6 sizes win (today). |
| `animations.imageLoad`, extended `animations.cardHoverEffect` values | EXISTING `animations` | **None** — `cardHoverEffect` is a string field; any value tolerated, unknown ⇒ `none` behaviour. |
| `buttons.primary.hoverEffect`/`pressEffect`, `buttons.secondary.*` | EXISTING `buttons` | **None.** |
| `prices.salePriceColor` etc., `badges.style` etc., `drawers.animation`, `cart.itemAnimation`, `inputFields.focusAnimation`, `search.*`, `productCards.imageAspect`/`textAlign`/`density`/`wishlistAnimation`, `icons.corners`/`size`/`style`, `floatingElements.backToTop` | new optional keys in EXISTING categories | **None.** |
| `header.settings.scrollBehavior`/`transparentOnHero`/`mobileNav`/`height`/`contentWidth`/`separator`/layout-preset-seeded `rows` | `header.settings` is already `Record<string, unknown>` | **None.** — ✅ `scrollBehavior`/`transparentOnHero` BUILT §8.9. |
| `footer.settings.*` (preset, columns, payment icons, bottom bar) | `footer.settings` free-form | **None.** |
| `section.settings.motion`/`gap`/`imageAspect`/`separator`/`overlay`/`contentWidth`/`featuredFirst`, hero `kenBurns`/`parallax`/`indicatorStyle`, `brands.scrolling` | `section.settings` free-form, shallow-validated | **None.** |
| `globalSettings.productPage.*` layout enums (§4.4), `globalSettings.collectionPage.*` additions (§4.5) | EXISTING small categories | **None.** |

**The one thing to never do:** add a NEW top-level sibling to `sections` (an
`overlays[]`, a `templates` key). That needs `assertValidThemeConfig`'s allow-list
updated in lockstep across backend + both mirrors. **Nothing here needs it** —
everything nests. Keep it that way.

**`THEME_TEMPLATES` drift:** the template literals must track
`theme-config.types.ts` exactly like `DEFAULT_THEME_CONFIG`. A type change not
reflected in a template = a template that silently backfills to defaults for that
key on read. Mitigation: one validation spec per template (mirrors the existing
`accepts the real DEFAULT_THEME_CONFIG unchanged` case), run in CI.

### 9.2 Performance budget

**Property tiers (the merchant-facing enums are built so a merchant can only pick
compositor-safe combinations):**

- **Compositor-only — animate freely, safe to stack:** `transform`
  (translate/scale/rotate), `opacity`. Every `--motion-*` token drives one of
  these. Card hover, section entrances, drawer slides, fly-to-cart, magic-line,
  parallax, badge pops, button press/sweep — all transform/opacity.
- **Paint — cheap-ish, don't stack many:** `box-shadow`, `background-color`,
  `color`, `filter` (blur/saturate — GPU on most modern hardware, variable),
  `clip-path` (compositor in current Chrome/FF for simple insets, paint
  elsewhere), `border-color`, `border-radius`. Used for: `shadow` hover,
  `border-fill` button, `blur-in`/`mask-reveal` entrances, `desaturate` hover.
  One-shot only where possible.
- **Layout — never in a loop; one-shot, small scope only:** `width`, `height`,
  `top/left/right/bottom`, `margin`, `padding`, `font-size`. Where a height
  animation is unavoidable (accordion, cart-row add/remove, announcement dismiss)
  use the `grid-template-rows: 0fr→1fr` trick (no JS measurement) or a
  `transform: scaleY` + mask — **not** a `height`/`max-height` transition in a
  scroll or hover loop.
- **Continuous — MAX ONE running on a page at once; must pause off-screen
  (IntersectionObserver) and under reduced-motion + `intensity: none`:** Ken
  Burns, gradient-shift hero bg, glow-pulse CTA, marquee, decorative parallax
  shapes. The admin UI enforces mutual exclusion where they'd overlap (hero
  `kenBurns` disables `parallax` and vice versa).
- **JS per-frame — one shared rAF-throttled listener (`useScrollValue`), never
  one per feature; `will-change` only during interaction, cleared after:**
  parallax, shrink/hide header, scroll progress, scrollspy, magic-line,
  fly-to-cart, count-up, card tilt.

**What a merchant must never be able to stack (enforced in the admin UI, not just
docs):**

- Card hover: pick ONE of `{zoom, rise, tilt, parallax, overlay, desaturate,
  shadow}` — they transform the same element(s). The control is already a single
  `<select>`; keep it single-select, never split into independent toggles.
- Section entrance: one `scrollAnimation`/`motion.entrance` per section + optional
  `stagger` — fine.
- `intensity: expressive` + `stagger` + `animateOnce: false` on a grid > 12 items
  = 12+ elements re-animating on every scroll pass. Cap: `stagger` children at 12;
  force `animateOnce: true` when a section's item count exceeds 12.
- Hero `kenBurns` + `parallax` — one continuous transform per hero; admin disables
  one when the other is on.
- `intensity: none` hard-disables **everything**, including continuous decorative
  animations and JS effects (not just durations → 0).

**Runtime cost of the token system itself:** zero when `motion` is absent (pure
CSS `var()` fallback, no JS). When present, `applyMotionOverrides` is ~15
`setProperty` calls once per theme change — negligible.

**Bundle:** all CSS. New JS (fly-to-cart, count-up, magic-line, `useScrollValue`,
mobile drawer, `useWishlistAnimation`, custom cursor) is small vanilla modules, no
deps. Estimate < 8 KB gzipped total across all phases.

**Mobile motion tier — DECIDED: built into Phase A, not deferred.** A
`@media (max-width: 639px)` tier in the `--motion-*` table steps `intensity` down
one level and force-disables `parallax` / `kenBurns` / `decorativeParallax` /
`customCursor`. **`639px`, not `640px`** — Tailwind's `sm:` is `min-width: 640px`,
so `max-width: 639px` leaves no 1px band where neither rule applies (§8.1 and the
implementation use `639px`; this line is the authority). `applyMotionOverrides`
writes both the base and the `-m` (mobile) values from the start; `globals.css`
has `@media (max-width: 639px){ :root{ --motion-duration-base: var(--motion-duration-base-m, 300ms); … }}`
(no self-reference — the literal fallback is today's value). Doing this in Phase A
avoids retouching every token later. Full table in §8.1.

### 9.3 Dead-control resolution (what each dead control finally gets)

**Updated 2026-09-05 — ✅ rows are resolved.**

| Dead control | Gets a consumer via | Phase |
|---|---|---|
| `animations.pageTransition` | route-content fade (F) | F |
| `animations.addToCart` | fly-to-cart (F) | F |
| `buttons.secondary` | a rendered secondary button variant on the CTA block, used by Market + Heritage (D) | D |
| `buttons.pillCornerRadius` | ✅ the `radius` scale half is done (B1); Bloom's pill buttons themselves still open (D) | B1 ✅ / D open |
| `drawers.schemeId` + `drawers.*` | `drawers.animation` + cart-drawer theming (F) | F |
| `swatches.*` | the `product_swatches` card sub-block (F) | F |
| `inputFields.*` | `inputFields.focusAnimation` + radius/border tokens on the newsletter input (D) | D |
| `prices.*` (beyond currency) | ✅ `prices.salePriceColor` / `salePriceStyle` replacing hardcoded `text-red-600` | ✅ B1 |
| `search.*` (corner radius / titleCase) | ✅ radius scale half done (B1); search-results theming itself still open | B1 ✅ / D open |
| `cart.*` (media fields) | drawer theming (F); the boolean feature-flags stay checkout-behaviour, out of scope — leave flagged | F |
| Typography paragraph/heading `case`/`letterSpacing` | ✅ reachable via one `typography.pairing`/`scale` control | ✅ B1 |
| `secondaryButtonLabel` (scheme) | consumed when a secondary button variant renders (D) | D |
| `header.settings.rows` / footer named layout | ✅ named header/footer presets that seed both | ✅ C1 |
| `header.settings.mobileNav` | ✅ `MobileNav.tsx` (drawer/bottom-bar/fullscreen) | ✅ C2 |
| `globalSettings.floatingElements.backToTop` | ✅ `BackToTopButton.tsx`, gated on scroll position | ✅ C1/C2 |
| `header.settings.transparentOnHero` | ✅ `reveal-on-hero` scroll behavior consumes it | ✅ §8.9 |
| `buttons.primary.hoverEffect`/`.pressEffect` | ✅ `resolveButtonHoverClass()`, Hero CTA + Newsletter submit | ✅ §8.8 |

### 9.4 Other risks

- **Scope.** A–F is ~6 substantial PRs. The token foundations (A + B) are the
  commitment; if they don't land, templates degrade to no-ops and look less
  distinct. Templates (G) are cheap *after* A–F.
- **The blanket `prefers-reduced-motion` rule** can suppress a transition
  something depends on for a `transitionend` callback. The `0.01ms` (not `0`)
  mitigates it (the event still fires); still audit the existing `transitionend`
  listeners in Phase A.
- **View Transitions** (page transitions) is Chromium-only and Next support is
  experimental — ship the plain route-content fade as the real feature, VT as a
  `'startViewTransition' in document` progressive enhancement, never block
  `pageTransition` on it. **(Flag #2.)**
- **LQIP / blur-up** genuinely needs backend image-pipeline work (generate + store
  a tiny preview per upload; uploads are static files with no resize endpoint).
  `imageLoad: 'fade'` (no LQIP) is the no-backend version and covers ~80% of the
  benefit. Ship `fade`; treat `blur-up` as a separate backend-gated follow-up.
  **(Flag #1.)**
- **Solid icon set** = hand-drawing ~12 SVGs (the no-dep answer; a second icon
  package is rejected). If not wanted, `icons.style` ships `line`-only and
  Market/Bloom lose one differentiator (acceptable). **(Flag #3.)**
- **Mobile nav drawer** is the one genuinely new *interactive component* (not a
  style) — the biggest single build in Phase C. Everything else is tokens + CSS +
  small hooks.
- **`customCss` interaction:** merchants with existing custom CSS targeting stable
  hardcoded classes (`.theme-product-image`, `.theme-product-card`, `.theme-nav-link`)
  could see it interact with the new tokens. The class names are stable; risk is
  low. Flow B's confirm modal should mention custom CSS is replaced (D3).
- **Template ↔ legacy-row separation** (D4): templates set `theme.config` only.
  If a future template author reaches for a legacy `shop.*` field, that's a bug —
  the capability now lives in `theme.config`.
- **Preview fidelity for "apply":** the builder relays `theme-config-update`
  already, so posting one big config on apply should just work. The legacy
  `legacy-theme-update` channel is separate and templates must not touch it (D4).
