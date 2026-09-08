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
| 5 | Newsletter success: form collapses, checkmark + "You're in!" scales in | GPU/layout | M | ✅ **BUILT §8.12** — `section.settings.successAnimation?: boolean`; the "collapse" is the form unmount (heights are near-equal in this layout), the payoff is the success block's scale-in | |
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
| `icons.corners: 'rounded' | 'sharp'` | ✅ **BUILT §8.11** | S | per-icon `strokeLinecap`/`strokeLinejoin` prop (not a CSS override — mirrors `icons.stroke`); header + search icons only |
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

> **STALE as of 2026-09-06 (see §8.13).** This hand-maintained summary of
> §6.1–6.4 was the pre-G0 build-order signal and is kept for history. It has
> drifted from its source: wrong counts (items 3–4 of §8.7), an internal
> inconsistency (`icons.corners` — Market/Bloom both `rounded`, marked ✗/✓),
> and — found in the §8.13 stock-take — **missing rows for capabilities all
> four templates want** (`badges.style`, 4/4). **Do NOT use this table for
> current planning or add rows to it.** Its ✅ rows are still accurate; its
> open rows are superseded by **§8.13.C**, which is the live remaining-work
> list, cross-checked against §6.1–6.4 directly. Any future stock-take
> re-derives from §6.1–6.4 + `templates.ts`, never from here.

Capabilities used by **3 or more** templates ship first. **Updated 2026-09-05
(post-C re-evaluation, §8.7) — ✅ rows are BUILT; the phase that closed each
is noted.** Kept as the historical build-order signal. **For what's left, use
§8.13.C** (§8.7's items 6+ are themselves superseded — see the STALE banner
above and §10.3).

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
| newsletter `successAnimation` | ✓ | ✓ | ✓ | ✗ | 3 | ✅ §8.12 (table confirmed correct this time — matches each template's own §6 entry) |
| `header.settings.scrollBehavior` + `transparentOnHero` wiring | ✓ | ✓ | ✓ | ✗ | 3 | ✅ §8.9 |
| `trust_bar` polish (count-up on `rating_badge`) | ✗ | ✓ | ✗ | ✗ | **1** | ✅ §8.10 (table corrected — Bloom has no `rating_badge`, Heritage's deferred block never asked for it) |
| `icons.corners` (rounded/sharp) | ✓ | ✗ | ✗ | ✓ | **2** | ✅ §8.11 (table corrected — Market and Bloom both spec `rounded`, which is byte-identical to unset) |
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
| card sub-blocks (`product_vendor` / `product_stock`) | ✗ | ✓ | ✗ | ✗ | 1 | ✅ §8.23 |
| card sub-block `product_swatches` | ✗ | ✗ | ✗ | ✗ | 0 | deferred (no consumer) |

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
§8.7 items 1-5 (§8.8–§8.12) + §8.13 stock-take + §8.13.C items 1/5/8 (§8.14)
+ §8.13.C item 2 (§8.15 buttons.secondary via view_all_button) + §8.13.C
items 3 (crossfade only — magic-line/height-animate deferred) + 4 (§8.16
wishlist pop/burst) + §8.13.C items 6 + 11 + 12 (§8.17 backToTop re-author +
hero kenBurns + hero indicatorStyle: progress) + §8.13.C items 13 + 14 (§8.18
drawers.animation + cart.itemAnimation/subtotalAnimation + scrollProgressBar)
+ §8.13.C items 7 + 10 (§8.19 inputFields.focusAnimation float-label +
buttons.primary.pill) + §8.13.C item 16 (§8.20 fly-to-cart via the new
`animations.addToCartStyle: 'fly'`)**, all built and merged through PR
#109; fly-to-cart is `feat/fly-to-cart` (its own checkpoint). §8.13.C item 9
(section separators) stays skipped (0/4 concrete — no template can act on
it). The rest of §8.13.C (items 15, 17-20) and
D/E/F/G1 more broadly are **not** committed scope — **§8.13.C is the live
remaining-work list** (§6.5 is frozen; §8.7's items 6+ are superseded). G0
(Flow A) + batch 1 + C + §8.8–§8.15 already deliver four visibly distinct
starting points that pick up real card-hover effects, image-load fade,
stagger, a brands marquee (Market), header/footer structure, a real mobile
nav, button hover/press feedback, real header scroll behaviour, (Market
only) a real animated trust-bar rating, sharp icon corners (Atelier +
Heritage), a newsletter success animation (Atelier + Market + Bloom),
shaped Sale/Sold-out badges + a pop (Market tag / Bloom circle / Heritage
ribbon), smooth in-page scrolling (Atelier), and an outline secondary
button on "View all" (Market + Heritage); the remaining flourishes each
template wants are in its own deferred block (§8.15 updated Market/Heritage's)
and prioritized in §8.13.C.

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
  entrance). ✅ BUILT §8.10, `useCountUp`'s first real consumer.
- `useCountUp(target, active)` — ✅ BUILT §8.10. rAF count-up, reads
  `--motion-duration-slow`, self-gates on reduced motion. Consumers so far:
  `trust_bar` rating (Market only — §8.10's scope correction). Still
  available for `cart.subtotalAnimation: 'count'` (F) and the collection
  result count (§4.5) if either is picked up later.

**§9.3 dead-control list — updated after this batch:** `section.settings.
motion.stagger` is no longer typed-but-unwired (§8.5) — remove it from the
"missing" list below. The other 4 stale rows and 5 remaining missing rows from
the original pass still need fixing: `buttons.pillCornerRadius` "B/D" → B never
touched it; `prices.*` → RESOLVED in B1, remove; `search.*` "B/D" → B never
touched it; typography `case`/`letterSpacing` → were already wired pre-B1,
`pairing`/`scale` only add a shortcut; and `motion.smoothScroll` (§8.14),
`.scrollProgressBar` (§8.18), `.decorativeParallax` (§8.22) are now wired.
`.scrollMotion` / `.hoverMotion` / `.customCursor` remain typed-but-unwired
(no consumer — `customCursor` re-confirmed 0/4).

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

> **Items 1–5 are BUILT (§8.8–§8.12). Items 6+ below are SUPERSEDED by
> §8.13.C** (2026-09-06 stock-take), which re-derived priority from
> §6.1–6.4 directly and found this list was missing `badges.style` (4/4
> templates — now item 1 of §8.13.C) because it was built from §6.5, which
> had no row for it. Use §8.13.C, not the numbering below, for anything not
> yet started.

1. **`buttons.primary.hoverEffect` + `.pressEffect` (§3.2) — BUILT, see
   §8.8.**
2. **`header.settings.scrollBehavior` + `.transparentOnHero` (§3.3) — BUILT,
   see §8.9.**
3. **`trust_bar` `rating_badge` count-up (§3.4 #9) — BUILT, see §8.10's
   correction: real committed scope was 1/4 (Market), not the table's 3/4.**
4. **`icons.corners` (rounded/sharp, §5.1) — BUILT, see §8.11's correction:
   real committed scope was 2/4 (Atelier + Heritage), not the table's 3/4
   (Market and Bloom both spec `rounded` = unset).**
5. **Newsletter `successAnimation` (§3.9 #5) — BUILT, see §8.12. The §6.5
   table's 3/4 was confirmed correct this time (Atelier + Market + Bloom;
   Heritage plain).**
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

### 8.10 `trust_bar` `rating_badge` count-up — BUILT (2026-09-05, `feat/trust-bar-rating-countup`)

§8.7 item 3. `useCountUp(target, active)`, the first shared JS-animation
utility since `MobileNav`'s swipe math and the first real second consumer of
`useReducedMotion()`. Deliberately does not read `useScrollValue()` — this
is an elapsed-wall-clock animation driven by rAF's own timestamp, not a
scroll-position one. First hook to *read* a `--motion-*` token at runtime
(`--motion-duration-slow`) rather than only setting one; falls back to `600`
(the `standard` intensity's own `durationSlow`, not an invented number) when
unset. Initial/inactive state is `target`, not `0` — SSR and any
pre-hydration or pre-trigger render shows the real, correct number, and
count-up only ever dips to `0` and ramps back up to the *same* value once
`active` flips true, a "ta-da" layered on an always-correct value rather
than a replacement for it. No synchronous `setState` call in the effect body
at all (every `setValue` happens inside the rAF callback, the
`react-hooks/set-state-in-effect` lint rule's own endorsed shape) — avoided
the finding entirely rather than accepting a baseline bump.

**Scope correction, found by checking the actual `trustBar()` call sites and
each template's own deferred block rather than trusting §6.5's table**: the
table's "3/4 templates" was wrong. `rating_badge` stores exactly two data
fields (`rating: number`, `label: string` free text — no stored numeric
review-count field anywhere). Market's deferred block explicitly names
`trust_bar rating count-up` and has a real `rating_badge`. Bloom has **no**
`rating_badge` at all — its own §6.3 catalog description says trust_bar is
"icon + text items" only, and its deferred block never mentions count-up
either; inventing one to make the table's count come out right would have
been scope creep, not a deferred item being closed out. Heritage has a real
`rating_badge` but its deferred block never names count-up either, matching
its established restraint (its label, `'Trusted by thousands'`, also has no
parseable number, though that's moot since only `rating` ever animates —
see below). **Real committed scope is Market only (1/4)** — table corrected.

**`label` never animates, only `rating`.** `label` is arbitrary merchant
free text (`'2,000+ reviews'`, `'Trusted by thousands'`) with no separate
numeric field — the latter has no number to parse at all, proving the
general case can't be handled robustly. The admin toggle's caption states
this plainly so a merchant doesn't expect their label text to count.

**Trigger: `RatingBadge` gets its own one-shot `IntersectionObserver`
(threshold `0.1`, matching `ScrollAnimatedWrapper`'s own value), not a reuse
of `ScrollAnimatedWrapper`'s.** Confirmed by reading `ScrollAnimatedWrapper.tsx`:
it renders bare `<>{children}</>` with **no ref, no observer at all** when
the section's `motion.entrance === 'none'` — the same trap
`section.settings.motion.stagger` already fell into (documented in
storefront's own CLAUDE.md). Reusing it wasn't structurally possible anyway
(it exposes no visibility signal to children) and would have made count-up
silently inert on any trust_bar with no configured entrance — independence
from the section's own entrance choice is the point.

**Stars stay static**, driven by the real, final `rating` — animating fill
state per frame would flicker through 0★→1★→2★... as visual noise nobody
asked for; every count-up reference in the catalog is about the *number*.

New optional key: `rating_badge` block settings gain `countUp?: boolean`.
`ThemeBlock.settings` is already `Record<string, unknown>` (confirmed
`assertValidBlock` never inspects `settings` fields) — zero backend
validation change. Admin: the existing rating_badge settings form (Rating /
Label / Link) gains an "Animate on scroll" Toggle + caption.

**No-op guarantee:** `countUp` absent/`false` ⇒ `RatingBadge` never mounts
an observer, `useCountUp`'s `active` stays `false`, returns `target`
unconditionally — byte-identical to today. The pre-existing
`TrustBarSection.test.tsx` rating-badge test (never sets `countUp`)
exercises this with zero changes needed.

**Scratch-shop pass — the real point of this batch, per the header batch's
lesson that "looks safe on inspection" isn't proof.** Publishing the actual
re-authored Market template (not a manual patch) and sampling the DOM
text via an in-page `requestAnimationFrame` loop (a per-sample Playwright
IPC round trip was slow enough on its own that the whole ~500ms ramp
finished before even the first read landed — a real methodology lesson,
not a product bug) confirmed: a genuine `0.0 → 4.8` ease-out ramp under real
motion; an instant jump straight to `4.8` with zero dip under
`prefers-reduced-motion: reduce`; and a clean `4.8` on the very first read
after a fresh page load, proving Strict Mode's dev-only
mount→cleanup→remount cycle (exercised for free by every `next dev` load)
never leaves a stuck partial value. A short viewport was needed to keep the
trust_bar below the fold at load — otherwise the one-shot observer fires
during initial page load, before any explicit test scroll, and the ramp
finishes before sampling starts.

**Gate:** backend `tsc` + `jest` (themes, 87/87) + lint +0 (261); storefront
`tsc` + `build` + `vitest` 497/497 + lint +0 (33); admin `tsc` + `build` +
`vitest` 465/465 + lint +0 (77).

---

### 8.11 `globalSettings.icons.corners` — BUILT (2026-09-05, `feat/icon-corners`)

§8.7 item 4. New optional `'rounded' | 'sharp'` field on the existing
`icons` category — a CSS-level stroke-join treatment on the lucide icons
already in use, distinct from the gated Phase I icon-glyph project.

**Mechanism follows `icons.stroke`'s exact precedent — verified, not
assumed.** `resolveIconStrokeWidth(stroke)` in
`storefront/lib/theme-element-style.ts` is a pure function returning a
numeric SVG prop (not a CSS var), merged into an `iconProps` object that
gets spread onto each rendered icon. New sibling `resolveIconCorners
(corners)` mirrors it exactly: unset/`'rounded'`/unknown returns lucide's
own baked-in `{ strokeLinecap: 'round', strokeLinejoin: 'round' }` pair
explicitly (checked `node_modules/lucide-react/dist/cjs/lucide-react.js` —
those are lucide's real `defaultAttributes`), so a shop that never touches
the control renders byte-identical to today; `'sharp'` returns `{
strokeLinecap: 'butt', strokeLinejoin: 'miter' }`. `LucideProps extends
SVGProps<SVGSVGElement>`, so both attributes are plain props — no CSS
override, no new mechanism.

**Scope confirmed narrow, by design.** Grepped every `lucide-react` import
in `storefront/` — 27 files render lucide icons, but only two
(`ThemeDrivenHeader.tsx`, `SearchBar.tsx`) construct `iconProps` from
`globalSettings.icons`. `icons.stroke` already has exactly this narrow
scope (header + search icons); `icons.corners` follows it. A site-wide `svg
{ stroke-linejoin: var(...) }` CSS rule would have been easier to write but
would make `corners` behave differently from its sibling `stroke` for no
reason — a worse inconsistency than the narrow scope.

**Scope correction: 2/4 templates, not the §6.5 table's 3/4.** Each
template's own §6 catalog table names an `icons.corners` value: Atelier
`sharp`, Market `rounded`, Bloom `rounded`, Heritage `sharp`. §6.5's table
marks Atelier ✓, Market ✗, Bloom ✓, Heritage ✓ — but Market and Bloom have
the *identical* stated value (`rounded`), so marking one ✓ and the other ✗
is an internal inconsistency in the tracking artifact, not a real
distinction. `'rounded'` is byte-identical to unset (lucide's own
default), so **only Atelier and Heritage get `icons.corners` set in code
(`'sharp'`)**; Market and Bloom are left untouched — their stated
preference is already exactly what unset renders. Matches this engagement's
established practice (e.g. Heritage's `buttons.primary.hoverEffect` staying
genuinely unset elsewhere).

**Admin:** `IconsSettings.tsx` gains a second `SegmentedToggle`
(Rounded/Sharp), writing `corners: undefined` for the "Rounded" choice per
`RadiusSettings.tsx`'s "write undefined for the true no-op" convention (not
`icons.stroke`'s own always-write-a-string convention, since `stroke` has
no unset state and `corners` does).

**Type mirrors:** `IconSettings.corners?: 'rounded' | 'sharp'` added to
backend/admin/storefront. No `DEFAULT_THEME_CONFIG` seed — unset renders
identically to `'rounded'`. No validation-shape change
(`theme-config.validation.ts` doesn't inspect `icons` sub-fields).

*(Side observation, not acted on: each template's catalog table also names
a `stroke` value — Atelier `thin`, Heritage `default` — that no template
has ever set. Flagged for a future pass, out of scope here.)*

**Scratch-shop pass — purely visual, no scroll or timing**, so none of
§8.9/§8.10's scroll-step or in-page rAF-sampler machinery. Published the
real re-authored Atelier and Heritage templates plus Market as an
untouched control, and read the header cart/account icon's rendered
`stroke-linecap`/`stroke-linejoin` DOM attribute via `getAttribute` (a
discrete attribute value — strictly more precise and non-flaky than a
screenshot pixel-diff): Atelier/Heritage's `lucide-search` /
`lucide-shopping-cart` / `lucide-user` icons render `butt`/`miter`, Market
stays `round`/`round`, and the deliberately-out-of-scope `lucide-menu` /
`lucide-chevron-down` icons in the same header stay `round`/`round`
everywhere. Zero console errors. Scratch file deleted and
`playwright.config.ts` reverted after.

**Gate:** backend `tsc` + `jest` (themes, 87/87) + lint +0 (261); storefront
`tsc` + `build` + `vitest` 501/501 + lint +0 (33); admin `tsc` + `build` +
`vitest` (2 failures in `AccountSetup.test.tsx` — the pre-documented
full-suite-only flakiness, 12/12 in isolation, untouched by this change) +
lint +0 (77).

---

### 8.12 newsletter `successAnimation` — BUILT (2026-09-05, `feat/newsletter-success-animation`)

§8.7 item 5. On a successful newsletter signup, the form is swapped for a
checkmark + message that scales in via a one-shot CSS animation, instead of
the plain instant `<p>Thanks for subscribing!</p>` swap that happens today.

**This time the §6.5 table was confirmed correct, not corrected.** Items
2–4 each found the table wrong, imprecise, or internally inconsistent. Here
§6.5's "3/4" matches each template's own §6 catalog table exactly: Atelier
(§6.1) `newsletter — successAnimation: true`, Market (§6.2)
`successAnimation: true`, Bloom (§6.3) `form collapses to a checkmark on
success (successAnimation: true)`, Heritage (§6.4) `newsletter — plain`.
The one gap closed: `templates.ts`'s terse deferred-block comments had
never mentioned it for any template (the last few rounds leaned on those as
a secondary source) — the detailed §6 tables are authoritative and
internally consistent, so 3/4 stood; the deferred-block comments for
Atelier/Market/Bloom now record it closed.

**Settings location: `section.settings.successAnimation` (per-section), not
a `globalSettings` category** — unlike most of this batch. `NewsletterSection`
already reads `settings.typography` from its own `section.settings`;
`SectionSettings` is `[key: string]: unknown` (free-form) in all three
mirrors, and validation only checks `sections[].settings must be an
object`. An explicit optional `successAnimation?: boolean` was added to the
`SectionSettings` interface in all three anyway, for read-site clarity
alongside `imageAspect?` — not a structural requirement.

**Baseline confirmed first:** `NewsletterSection.tsx` today does an
*instant* conditional swap on `status === 'success'` — `<p className="text-sm
font-medium">Thanks for subscribing!</p>` replaces `<form>`, no animation,
no checkmark. `subscribeNewsletter` POSTs to
`/public/:shopSlug/newsletter-subscribe` (real `newslettersubscriber` row
insert — no email provider).

**"Collapse" = the swap itself, no height animation — and why.** The
`grid-template-rows: 0fr→1fr` collapse trick the plan mentions "used
before" is used **nowhere** in the storefront today (it's a *planned*
accordion item, §3.9 #7). More to the point: in this section's centred
`max-w-xl` layout the `<form>` (one row) and the success block (one line)
are nearly the same height — a height-morph would animate ~0–20px while
fighting the accessibility friction of keeping a `required`-input form
mounted-but-inert through a transition. The form unmounts as today; the
visible payoff — "a checkmark scales in where the form was" — comes
entirely from the success block's own entrance animation.

**Scale-in: one new class, zero new keyframes.** `.theme-newsletter-success
{ animation: theme-scale-in var(--motion-duration-base, 300ms)
var(--motion-ease, ease-out) forwards; }` — reuses Phase A's `@keyframes
theme-scale-in` (opacity 0→1 + scale 0.94→1). The success `<div>` mounts
fresh when `status` flips to `'success'`, so the animation plays exactly
once on appearance — no `IntersectionObserver`, no `.theme-anim-visible`
toggle, no `ScrollAnimatedWrapper` (that's for on-scroll entrances, the
wrong trigger). `--motion-duration-base` (not `-slow`) — a quick
micro-feedback, not a section entrance.

**Reduced motion:** the single blanket `@media (prefers-reduced-motion:
reduce)` rule sets `animation-duration: 0.01ms !important` on `*` — it
neutralizes `.theme-newsletter-success` for free. The checkmark + message
still appear, just without the ramp. Zero new gating.

**Checkmark:** a lucide `Check` icon, rendered only when `successAnimation`
is on. Existing copy kept — the catalog's "You're in!" was illustrative;
changing user-facing copy is a separate concern.

**No-op:** `section.settings.successAnimation` absent/`false` ⇒ the current
instant `<p>` swap, byte-for-byte. No `DEFAULT_THEME_CONFIG` seed (per-
section setting). The existing `NewsletterSection.test.tsx` cases all pass
`settings={{}}` and keep passing.

Admin: `NewsletterSettings.tsx` gains a "Success animation" `<Toggle>` +
caption. Templates: `successAnimation: true` on Atelier/Market/Bloom's
`newsletter(...)` calls (the helper already forwards `opts.settings`);
Heritage untouched.

**Scratch-shop pass — a real form submission, not a mock.** The dev shop's
`/newsletter-subscribe` just inserts a row. Published the real re-authored
Atelier template plus Heritage as an untouched control; for each, filled
the email with a timestamp-unique address, clicked Subscribe, waited for
the swap. Atelier: a `.theme-newsletter-success` div containing an svg,
`getComputedStyle().animationName === 'theme-scale-in'`,
`animationDuration` a real `0.176s` (Atelier's `subtle` motion tier).
Atelier again with `emulateMedia({ reducedMotion: 'reduce' })`: the div +
svg still present, `animationDuration` computed at `1e-05s` (the blanket
rule). Heritage: the plain `<p>`, `animationName: none`, no such div. Zero
console errors. Scratch spec deleted + `playwright.config.ts` reverted
after.

**Gate:** backend `tsc` + `jest` (themes, 87/87) + lint +0 (261); storefront
`tsc` + `build` + `vitest` 503/503 + lint +0 (33); admin `tsc` + `build` +
`vitest` (3 failures in `AccountSetup.test.tsx` — the pre-documented
full-suite-only flakiness, 12/12 in isolation, untouched by this change) +
lint +0 (77).

---

### 8.13 Post-§8.12 capability stock-take — RECOMMENDATION (recorded 2026-09-06, before picking up items 6+)

Same structure as the pre-G0 stock-take (§8.3). Everything through §8.12 is
merged: motion tokens + reduced-motion rule, radius, density, typography
pairing/scale, colours completion, section-entrance vocab + stagger +
animateOnce, card-hover enum extension, card-style extension, imageAspect,
grid gap, header/footer layout presets, mobile nav, `imageLoad: fade`,
`brands.scrolling`, buttons hoverEffect/pressEffect, header scrollBehavior +
transparentOnHero, trust_bar count-up, icons.corners, newsletter
successAnimation.

**Cross-checked per template against §6.1–6.4's own catalog tables and
`templates.ts`'s deferred-block comments — NOT §6.5, which is wrong or
imprecise on 4 of the last 5 items and, as this pass found, is also
*missing entire rows*.**

#### A. What §6.5 is missing entirely (verified against the templates' own text + the code)

| Item | Templates that want it (per their own §6 table) | count | Wired today? | Catalog ref |
|---|---|:-:|---|---|
| **`badges.style`** (`pill`/`rectangle`/`ribbon`/`tag`/`circle`) | Atelier `rectangle`, Market `tag`, Bloom `circle`, Heritage `ribbon` | **4** | **No** — `BadgeSettings` is `{ position, cornerRadius, saleSchemeId, soldOutSchemeId, font, case }`; `lib/product-badge.ts` renders a plain rounded chip, no shape variants | §5.5 |
| **`badges.entranceAnimation`** (pop-in on card entrance) | Market `true`, Bloom `true` | **2** | **No** — not a field on `BadgeSettings` | §5.5 / §3.1 #14 |
| **`motion.smoothScroll`** (`scroll-behavior: smooth` on `<html>`) | Atelier (`smoothScroll: true`, in its `motion` block **and** its "→ needs" list) | 1 | **No** — the field is declared on `MotionSettings` with a `// scroll-behavior: smooth` comment, but `grep` finds zero consumers in `storefront/` | §2 (motion model) |
| **`buttons.pillCornerRadius`** (fully-round pill buttons) | Bloom (`pillCornerRadius: 9999`, in its `buttons.primary` block **and** "→ needs") | 1 | **No** — field exists on `ButtonStyleSettings`; `shop-context.tsx` has two explicit comments that it "has no CSS var here". Tracked in §9.3's prose but never given a §6.5 row or a §8.7 item | §3.2 |
| hero `slideTransition` extended values (`zoom-cross`) | Market (`slideTransition: zoom-cross`) | 1 | **Partial** — `HeroSection.tsx` reads `settings.slideTransition` but types it as `ScrollAnimation` (`fade-in`/`slide-*`), so `zoom-cross` silently falls back to `fade-in`. Acceptable substitute; lowest priority | §3.5 |

`badges.style` at **4/4** is the single highest-count open item on the
entire board, and it was invisible to §8.7's priority list because that
list was "re-derived from §6.5" and §6.5 has no row for it. **This is the
headline finding.**

#### B. §6.5's existing "open" rows — all verified consistent with the templates' §6 text this pass

`buttons.secondary` (Market + Heritage, 2), `product_tabs` magic-line
(Market + Bloom, 2), wishlist animation (Market `pop` + Bloom `burst`, 2),
`floatingElements.backToTop` re-author (Market + Bloom, 2 — capability
built, neither template's literal enables it), `icons.style: solid/duotone`
(Market + Bloom, 2 — **separate gated Phase I**, ~100 hand-drawn SVGs, not
a normal batch item), `drawers.animation` + `cart.itemAnimation`/
`subtotalAnimation` (Market, 1), fly-to-cart (Market, 1), `scrollProgressBar`
(Market, 1), hero `kenBurns` (Atelier, 1), hero `parallax` +
`decorativeParallax` (Bloom, 1), hero `indicatorStyle: progress` (Market,
1), section separators (Bloom, 1), `inputFields.focusAnimation` (Market, 1),
card sub-blocks `product_vendor`/`product_stock`/`product_swatches` (Market,
1). Route-content fade / View Transitions (§3.8) is universal, not
template-specific. `customCursor` — 0/4, no template wants it.

#### C. Re-derived priority order (real per-template count, highest first)

1. **`badges.style` — BUILT §8.14** (real committed scope 3/4: Atelier's
   `rectangle` = the no-op value, left unset; Market `tag` / Bloom `circle`
   / Heritage `ribbon`). **`badges.entranceAnimation` (item 5) and
   `motion.smoothScroll` (item 8) folded into the same PR** — see §8.14 for
   why. Bloom's "contrasting yellow badge colour scheme" (a 3rd
   `colorScheme` + `saleSchemeId` re-point) is a newly-noted still-open
   *colour* item, not shape.
2. **`buttons.secondary` rendered variant — BUILT §8.15.** No render slot
   existed anywhere; the chosen slot (asked + answered) is
   `featured_collections`' `view_all_button` with an opt-in "button" mode —
   not a hero 2nd CTA (which would have meant authoring hero content §6
   doesn't specify). `secondaryButtonLabel` scheme wiring folded in.
   Market + Heritage. `ProductGridSection`'s own "View all" left as a
   follow-up.
3. **`product_tabs` crossfade shipped §8.16; magic-line + height-animate
   deferred — blocked on `collectionIds`, not template count.** The
   "2/4 (Market, Bloom)" is aspirational: both templates' §6 tables name a
   `product_tabs` section with `activeIndicator: magic-line`, but **neither
   template contains one and can't** (a `product_tabs` section needs real
   `collectionIds`, which a template literal can't hardcode — their own
   deferred blocks say so). So the full mechanism would be scope for a
   consumer that doesn't exist — the same shape as item 9 (section
   separators) being skipped as 0/4: the deferred-block text describes an
   intent no template can currently act on. **What shipped:** the content
   crossfade only (`.theme-tab-panel`, a keyed-remount one-shot
   `theme-fade-in` — resting render byte-identical, only the tab-switch
   transition changed). **Deferred until a template has a real
   `product_tabs` section:** the magic-line (also a pattern mismatch —
   `ProductTabsSection` uses solid-fill accent pills, not an underlinable
   nav; "active pill slides" needs a pill restyle that breaks the
   byte-identical resting look, or a fiddly behind-the-pills illusion) and
   the height-animate (L-shaped: real `scrollHeight` JS measurement +
   transition + cleanup, not the hand-waved `0fr→1fr` trick, which is
   collapse↔expand, not height-between-two-contents).
4. **Wishlist animation (`pop`/`burst`) — BUILT §8.16.** 2/4 (Market
   `pop`, Bloom `burst`). One-shot `@keyframes` set in `WishlistButton`'s
   click handler (not an effect — dodges the `set-state-in-effect` lint
   shape), cleared on `animationend`; `--motion-duration-base`,
   reduced-motion covered by the blanket rule. `burst` adds an expanding
   `::after` ring. `sweep` is reserved in the type enum (all 3 mirrors) but
   unbuilt — falls through to no animation, not offered in the admin
   dropdown.
5. **`badges.entranceAnimation` — BUILT §8.14** (folded into item 1). Note:
   shipped as a *mount-triggered* pop, not scroll-into-view — the faithful
   version needs the §8.10 observer pattern in both render components
   (disjoint work); a below-fold badge pops off-screen, the accepted
   stagger-without-entrance tradeoff. Market + Bloom.
6. **Enable `floatingElements.backToTop` on Market + Bloom — BUILT §8.17.**
   2/4, re-author only. `g.floatingElements = { …, backToTop: { enabled:
   true } }` on both templates (full assignment, not a property write — the
   category is optional in the type). `BackToTopButton.tsx` already consumes
   it (C1/C2). Atelier + Heritage deliberately stay without it.
7. **`inputFields.focusAnimation` — BUILT §8.19.** 1/4 (Market
   `float-label`). `NewsletterSection` wraps its email input in a
   `.theme-float-label` `<label>` (CSS-only: `placeholder=" "` +
   `:placeholder-shown`/`:focus` float the span to the border) when
   `globalSettings.inputFields.focusAnimation === 'float-label'`; any other
   value (incl. absent) ⇒ today's bare placeholder input. `'border'`/`'glow'`
   reserved, unbuilt. Checkout inputs are not theme-section-driven, left as a
   follow-up — the newsletter email is the only input a theme section
   renders (this was the "dead `inputFields` category"'s only assigned
   consumer).
8. **`motion.smoothScroll` — BUILT §8.14** (folded into item 1). Confirmed
   XS: a new `applyScrollBehavior()` one-liner in `lib/motion.ts`, called
   from `applyMotionOverrides`. `!reducedMotion` gating turned out
   unnecessary — `globals.css`'s blanket `scroll-behavior: auto !important`
   already beats the non-important inline `smooth` (verified in the scratch
   pass). Atelier.
9. **Section separators (wave/angle SVG edges) — 1/4** (Bloom). Effort
   **S–M**. Roughly unchanged (decorative inline SVG between sections,
   `section.settings.separator`).
10. **`buttons.pillCornerRadius` → `buttons.primary.pill` — BUILT §8.19.**
    1/4 (Bloom). Chosen shape (asked + answered): a new
    `buttons.primary.pill?: boolean` flag. When set, `themeButtonBaseStyle`
    reads `--theme-button-pill-radius` (= `buttons.pillCornerRadius`, default
    9999) as a fallback *between* the legacy `--theme-btn-primary-radius` and
    `--theme-radius` — so `--theme-radius` and the section image containers
    that share it are untouched, zero regression for any existing shop
    (including one with a hand-set `cornerRadius`). `pill` unset ⇒ the var is
    removed on `:root` (SPA-leak clear) ⇒ byte-identical to today. Leaves
    `pillCornerRadius`'s name slightly redundant with the new boolean (field
    = the value, boolean = whether it's used) — minor schema untidiness, not
    worth touching the existing field.
11. **Hero `kenBurns` — BUILT §8.17.** 1/4 (Atelier). `hero.settings.kenBurns?`
    ⇒ `.theme-ken-burns` on the active slide `<img>` (`scale(1)→1.08`,
    `alternate infinite`, `animation-duration` = the slide duration set
    inline). `HeroSlideshow` skips the class under reduced motion.
12. **Hero `indicatorStyle: progress` — BUILT §8.17.** 1/4 (Market).
    `hero.settings.indicatorStyle?: 'dots' | 'bars' | 'progress' | 'fraction'`;
    `'progress'` swaps the dot row for a `scaleX` bar keyed on the active
    slide (fills over the slide duration, pauses on hover, not rendered under
    reduced motion). `dots`/absent ⇒ today's `showSlideIndicators` dots;
    `bars`/`fraction` reserved, unbuilt (fall back to dots).
13. **`drawers.animation` + `cart.itemAnimation`/`subtotalAnimation` —
    BUILT §8.18.** 1/4 (Market). `drawers.animation: 'slide' | 'slide-fade'
    | 'scale' | 'none'` swaps which closed/open classes the cart-drawer
    panel carries (`slide`/absent = today's `translate-x`); `cart.itemAnimation`
    fades a newly-added `CartLineItems` row in (first-seen key only, never
    the initial mount); `cart.subtotalAnimation: 'count'` tweens the subtotal
    via a new `lib/use-animated-number.ts` (from→to, distinct from
    `useCountUp`'s 0→target), `'flash'` is a keyed one-shot highlight.
    `'none'`/absent on any of them ⇒ today's instant render.
14. **`scrollProgressBar` — BUILT §8.18.** 1/4 (Market). New
    `ScrollProgressBar.tsx` (mounted in `ShopLayoutClient`), gated on
    `globalSettings.motion.scrollProgressBar`; a fixed top bar whose
    `scaleX` fill = `scrollY / (scrollHeight - innerHeight)` via
    `useScrollValue`. Not a motion flourish (no transition, just tracks) so
    it stays on under reduced motion.
15. **Hero `parallax` + `decorativeParallax` — BUILT §8.22.** 1/4 (Bloom).
    `hero.settings.parallax` ⇒ the `HeroSlideshow` backdrop lags on scroll
    (`translateY` via `useScrollValue`, clamped inside a `scale(1.15)`
    bleed; wins over `kenBurns`). `motion.decorativeParallax` ⇒
    `DecorativeParallax.tsx` (5 fixed accent blobs drifting on scroll),
    **hard-capped at 5**, returns `null` under `intensity:'none'` /
    reduced-motion / sub-640px. New shared `lib/use-min-width.ts`.
16. **Fly-to-cart — BUILT §8.20.** 1/4 (Market). Gated on a NEW opt-in
    `animations.addToCartStyle?: 'none' | 'fly'` (not `animations.addToCart`
    alone — that's a required boolean, `true` by default, so gating on it
    would have turned the effect on for every non-template shop). WAAPI
    clone from the quick-add card / PDP gallery to `[data-fly-to-cart-target]`
    on the header cart icon; 5-concurrent cap (rapid-click spam guard, cart
    correctness never affected); reduced-motion skips it; no badge bounce
    (there is none today). `FlyToCartProvider` in `ShopLayoutClient`.
17. **Route-content fade — BUILT §8.21.** Plain keyed fade wired on
    `animations.pageTransition` (already `false` in DEFAULT + all templates,
    so byte-identical). 0/4 templates — capability only, no re-author. View
    Transitions deliberately not layered on (Chromium-only, Next support
    still moving — §8.20 flag #2 stays a flag).
18. **Card sub-blocks (`product_vendor`/`product_stock`) — BUILT §8.23**
    (2026-09-06, `feat/card-metadata-subblocks`). 1/4 (Market). Opt-in
    child block types on `product_card`; a card without them is
    byte-identical. **`product_swatches` deferred** — no template §6 table
    asks for it, so the dead `swatches` category stays dead (don't build a
    zero-consumer feature).
19. **`icons.style: solid/duotone` — 2/4** (Market, Bloom). **Separate
    gated Phase I** (~100 hand-drawn SVGs + a glyph-list sign-off).
    Not a normal batch item; stays parked until explicitly greenlit.
20. **`customCursor` — SKIPPED (re-confirmed 0/4, 2026-09-06).** No §6
    table row on any template, no `g.motion.customCursor` in `templates.ts`.
    `MotionSettings.customCursor?` stays typed-but-unwired. Not built — a
    zero-consumer feature, same call as item 9 (section separators). Revisit
    only if a future template wants it.

#### D. Spec-vs-code mismatches spotted from the templates' own text (flagged now, not mid-build)

- **`badges.style`**: the templates assume a shape enum that has never
  existed on `BadgeSettings`. Not a count discrepancy like
  count-up/icons.corners — a whole missing field, 4/4.
- **`motion.smoothScroll`** and **`buttons.pillCornerRadius`**: both are
  *declared* on their interfaces (with comments implying intent) but have
  zero consumers. A reader skimming the types would reasonably assume
  they work.
- **`slideTransition: zoom-cross`** (Market): the field is read but typed
  to a value set that excludes it — it silently degrades to `fade-in`.
- **No count discrepancies found this pass** in §6.5's *existing* open
  rows (unlike items 3–4, where "3/4" was really 1/4 and 2/4). Every
  surviving "open" row's count matches the templates' §6 text. The
  problem this time is omission, not miscounting.

#### E. §6.5 structural fix — RECOMMENDED

§6.5 is a hand-maintained summary of §6.1–6.4. It has now been wrong or
imprecise on counts (items 3–4), internally inconsistent (Market vs Bloom
both `rounded` for `icons.corners`, marked ✗/✓), and — this pass —
**missing rows for capabilities all four templates want** (`badges.style`).
A hand-maintained "derived" table drifts from its source every batch.

**Recommendation: demote §6.5 to a frozen historical artifact.** Add a
banner at its top: *"STALE as of 2026-09-06 (§8.13). This table was the
pre-G0 build-order signal and is kept for history. Do NOT use it for
current planning or add rows to it — every remaining item is tracked in
§8.13's priority list, cross-checked against §6.1–6.4 directly. §6.5's ✅
rows are still accurate; its open rows are superseded by §8.13.C."* Then
never touch §6.5 again — §8.13.C is the live list, and any future
stock-take re-derives from §6.1–6.4 + `templates.ts`, not from §6.5.

(A genuinely machine-checkable version would need §6.1–6.4 restructured
into a per-template YAML block that a script diffs against
`templates.ts` + a "wired capabilities" manifest. Worth doing if this
plan runs many more batches; overkill if items 1–2 above roughly close it
out. Flagging, not recommending, that build-out.)

**Not committed scope.** A recorded recommendation, same as §8.3 was
before G0. Picking up item 1 (`badges.style`) — or any subset — still gets
its own plan-mode round first.

---

### 8.14 `badges.style` + `badges.entranceAnimation` + `motion.smoothScroll` — BUILT (2026-09-06, `feat/badges-style`)

§8.13.C items 1, 5, 8 in one PR. `badges.style` was the headline finding of
the §8.13 stock-take: wanted by all four templates, invisible to every
prior priority list because §6.5 had no row for it.

**Scope: 3/4, not 4/4** — the icons.corners pattern a third time. Today's
chip (`lib/product-badge.ts`) is a `cornerRadius`-respecting rounded
rectangle, so `style: 'rectangle'` is byte-identical to unset. Per each
template's §6 table: **Atelier `rectangle`** (the no-op — left unset,
following the icons.corners `rounded` / Heritage `hoverEffect` precedent;
Atelier still rides this PR via `smoothScroll`), **Market `tag`**, **Bloom
`circle`**, **Heritage `ribbon`**.

**Mechanism: `resolveProductBadge` returns a full `className` string** (the
two hardcoded render-site template literals — `ProductCard.tsx`,
`ProductGridSection.tsx` — collapse to `className={badge.className}`). For
rectangle/unset the token order and inline `borderRadius` are byte-for-byte
what they were; the existing `product-badge.test.ts` needed only the
`positionClass` → `className` rename. `pill` → inline `9999px`, no class.
`circle` / `tag` → a `.theme-badge-*` class owning padding + geometry
(`aspect-ratio` / `clip-path`), no inline radius. Geometry is deliberately
`clip-path` / `transform` / `aspect-ratio` — **not** the `--theme-round-*`
scale (that's for `rounded-*` shapes); pill/circle use a `9999px` literal
(there is no `--theme-round-pill`).

**Ribbon is ~40% of the item, flagged not descoped** (Heritage needs it).
It's a rotated corner banner, not a chip: `.theme-badge-ribbon` +
one of `--tl/--tr/--bl/--br` (rotate ±45°, top/bottom pinning), and it
**ignores the position inset class** — `resolveProductBadge` omits it for
ribbon. The parent media wrapper is already `relative overflow-hidden`, so
the rotated band clips to the card with no wrapper change. The other four
shapes are position-agnostic in-place tweaks.

**Circle + long text**: `aspect-ratio: 1` + flex-centre + `min-width` +
normal wrapping. "Sale" → a true circle; "Sold out" wraps to two short
lines inside it — an accepted cosmetic edge, no icon-only fallback (that
would break `product-badge.ts`'s "no fallback branching beyond the null
check" convention). Verified in the scratch pass.

**`badges.entranceAnimation` (item 5) — folded in as a mount-triggered
pop.** `.theme-badge-pop` (a dedicated `@keyframes theme-badge-pop`
scale 0→1, `var(--motion-duration-fast)`) appended by the resolver. All
product cards mount together on section render, so above-fold badges pop on
load and `product_tabs` cards re-pop per tab switch. **No
IntersectionObserver** — a below-the-fold badge pops off-screen, the same
accepted tradeoff as `stagger`-without-a-real-entrance; the §8.10
observer pattern is the documented upgrade. Not applied on `ribbon` (its
`rotate()` and the pop's `scale()` `transform` would fight; no template
combines them). Reduced motion: the blanket rule zeroes the duration —
verified `1e-05s` in the scratch pass. Stock-take said "folds into #1" —
true for the type + admin panel, but the *scroll-triggered* version would
have been disjoint work; the mount-triggered version is what genuinely
folded in cheaply.

**`motion.smoothScroll` (item 8) — folded in, confirmed XS.** New
`applyScrollBehavior(root, motion)` one-liner in `lib/motion.ts` (kept out
of `applyMotionCssVars`, which is CSS-custom-props only), called from
`shop-context.tsx`'s `applyMotionOverrides` in the same merged
`[shop, themeConfig]` effect. `""` clears → browser default. **No
`!reducedMotion` gate needed** — `globals.css`'s blanket
`scroll-behavior: auto !important` beats the non-important inline `smooth`
(scratch pass: computed `smooth` normally, `auto` under
`reducedMotion: 'reduce'`, with the inline value still `smooth`).
`MotionSettings.smoothScroll?` was already typed in all three mirrors (zero
consumers until now).

**Admin**: `BadgesSettings.tsx` — a "Shape" `<Select>` (Rectangle writes
`style: undefined`, the true no-op) + a "Pop-in animation" `<Toggle>`.
`MotionSettings.tsx` — a "Smooth scrolling" `<Toggle>`, **not** gated on the
intensity `active` state (independent of the token system); its old
"smoothScroll is hidden" test was updated.

**Templates**: Market `style: 'tag'` + `entranceAnimation: true`; Bloom
`style: 'circle'` + `entranceAnimation: true` (its pre-existing
`cornerRadius: 9999` left — harmless once `circle` owns geometry, the sane
fallback if `style` is unset); Heritage `style: 'ribbon'` (no
`entranceAnimation` — Heritage is calm); Atelier `motion.smoothScroll:
true` (no `badges.style`). Deferred-block comments updated; **Bloom's
"contrasting yellow badge colour scheme" (a 3rd `colorScheme` +
`saleSchemeId` re-point) noted as a still-open colour item — not shape.**

**No-op**: `badges.style` absent/`'rectangle'` and `entranceAnimation`
absent/`false` ⇒ the exact className string + `borderRadius` produced
today; `resolveProductBadge(undefined)` still `null`. `motion.smoothScroll`
absent/`false` ⇒ `scrollBehavior` cleared ⇒ browser default. No
`DEFAULT_THEME_CONFIG` values.

**Scratch-shop pass — visual + DOM-attribute, no scroll/timing machinery**
(`entranceAnimation` is mount-triggered). Put a `compareAtPrice` on a seed
product (restored after) so a Sale badge renders; published the real
re-authored Market / Bloom / Heritage templates + Atelier as the
`rectangle`/no-op control; read the badge `<span>`'s `className` +
`getComputedStyle()` on the "Flowers" collection grid: Market
`theme-badge-tag theme-badge-pop` + a `clip-path: polygon(...)` notch +
`animationName: theme-badge-pop`; Bloom `theme-badge-circle` +
`aspect-ratio: 1 / 1` + pop; Heritage `theme-badge-ribbon
theme-badge-ribbon--tr` + `border-radius: 0` + a `rotate(45deg)` matrix +
**no** `theme-badge-pop`; Atelier a plain `absolute … px-2 py-0.5 …` chip,
no `theme-badge-*` class, `scroll-behavior` computed `smooth`. A
reduced-motion pass: shapes still render, `theme-badge-pop`'s
`animation-duration` computes `1e-05s`, Atelier's `scroll-behavior`
computes `auto` (inline still `smooth`). Zero console errors. Scratch spec
deleted + `playwright.config.ts` reverted.

**Gate:** backend `tsc` + `jest` (themes, 87/87) + lint +0 (261); storefront
`tsc` + `build` + `vitest` 514/514 + lint +0 (33); admin `tsc` + `build` +
`vitest` (5 failures in `AccountSetup.test.tsx` — the pre-documented
full-suite-only flakiness, 12/12 in isolation, untouched by this change) +
lint +0 (77).

**Note:** this PR also re-lands **§8.13** (the capability stock-take),
which was stranded when its PR #102 merged into #101's branch instead of
`main` and #101 then merged a snapshot without it.

---

### 8.15 `buttons.secondary` rendered variant — BUILT (2026-09-06, `feat/secondary-button`)

§8.13.C item 2. `globalSettings.buttons.secondary` (schema since B1;
`hoverEffect`/`pressEffect` since §8.8) and `ColorScheme.secondaryButtonLabel`
had **rendered nowhere** — dead in §9.3 since Phase A.

**Different in kind from §8.8–§8.14 — a content-model question, not a style
tweak.** Investigation confirmed: the hero has *one* `cta` block (styled
primary), newsletter submit is primary, and both "View all"s
(`FeaturedCollectionsSection`, `ProductGridSection`) are plain
`text-accent hover:underline` links. **Neither Market's nor Heritage's §6
table names a section or CTA where a secondary button appears** — the
`buttons.secondary: rendered …` rows are `globalSettings` entries with no
location. Options were put to the user (AskUserQuestion): a hero 2nd-CTA
slot (needs authoring hero labels/links §6 doesn't specify), the
`view_all_button` as a button (no invented content — "View all" exists), or
defer. **Answer: `view_all_button` as a button.**

**The styling was ~90% pre-built.** `resolveButtonFillStyle('outline')`
already produced the outline look; `resolveButtonHoverClass(hoverEffect,
pressEffect)` (§8.8) already takes generic params so `border-fill` (Market)
and `pressEffect` (Heritage) work as-is —
`.theme-btn-border-fill:hover` fills with `--color-accent`,
`.theme-btn-press:active` translateY(1px). **Zero new CSS.** This round is a
render-slot + `secondaryButtonLabel` mapping.

- **`resolveSecondaryButtonStyle(s)`** (`theme-element-style.ts`): the
  outline base, reading `buttons.secondary`'s own `cornerRadius`/
  `borderThickness`/`case`/`font`, colour from
  `--color-secondary-button-label` (fallback `--color-accent`). **No inline
  `background`** on purpose — an `<a>` is transparent by default, and an
  inline `background` would beat `.theme-btn-border-fill:hover`'s
  `background-color` (inline > stylesheet), so the fill effect would never
  show. **This same latent issue exists in the primary button's
  `resolveButtonFillStyle('outline')`** (it does set `background:
  "transparent"` inline) — noted, out of scope; no template combines
  primary outline + `border-fill`, and §8.8 already documented `border-fill`
  as inert on a solid primary.
- **`resolveSchemeCssVars`** gains `--color-secondary-button-label` from
  `scheme.secondaryButtonLabel` — a brand-new var nothing else reads, inert
  for every existing surface. Its `shop-context.test.ts` case flips from
  "does not map" to "maps".
- **`FeaturedCollectionsSection.tsx`** — a `ViewAll` sub-component.
  `viewAllBlock.settings.style === "button"` ⇒ an `<a>` with
  `resolveSecondaryButtonStyle` + `resolveButtonHoverClass(secondary?.hoverEffect,
  secondary?.pressEffect)` + the trailing `ArrowRight` for `icon-nudge`
  (matching the hero CTA); anything else ⇒ **today's exact `<Link
  className="text-sm font-medium text-accent hover:underline">`**,
  byte-for-byte. The `href` stays `shopBasePath || "/"` (the pre-existing
  no-all-collections-route quirk).
- **Admin**: `BlockSettingsForm.tsx`'s `view_all_button` gains a "Display
  as" `<Select>` ("Text link" writes `style: undefined`). `ButtonsSettings.tsx`
  passes `showEffects` to the Secondary `<ButtonStyleFields>` now that it
  has a render path.
- **Templates**: Market's `featuredCollections('Shop by occasion')` →
  `viewAllAsButton` + `g.buttons.secondary.hoverEffect = 'border-fill'`;
  Heritage's `featuredCollections('Our collections')` → `viewAllAsButton` +
  `g.buttons.secondary.pressEffect = true` (no hoverEffect — Heritage is
  calm). **2/4 confirmed** against each §6 table — Atelier sets
  `buttons.secondary.cornerRadius` defensively but has no §6
  `buttons.secondary` row (stays a link); Bloom has none.
- **Follow-up flagged**: `ProductGridSection`'s "View all" is a *section
  setting* (`showViewAllButton`), a different mechanism — not touched this
  round; a `viewAllStyle` setting there would give it the same treatment.

**No-op**: `view_all_button.settings.style` absent/`'link'` ⇒ the current
link, byte-for-byte. `resolveSecondaryButtonStyle` is only ever *called*
when `style: 'button'` is set, so a shop that never opts in is untouched.
`--color-secondary-button-label` reads nowhere else. No `DEFAULT_THEME_CONFIG`
change.

**Scratch-shop pass — visual + DOM.** Published the real Market and
Heritage templates + Atelier as the link/no-op control; the seed shop's
homepage renders a `featured_collections` with tiles + a "View all". Market:
an `<a>` with `theme-btn-border-fill`, `border-style: solid`,
`border-width: 1px`, transparent background — and on `page.hover()` the
`background-color` becomes the accent (the border-fill effect). Heritage:
`theme-btn-press` + the outline, no `border-fill`. Atelier: still the plain
`<a … text-accent hover:underline>`, no border. Reduced-motion pass: the
border-fill transition computes at `~0.001s` (blanket rule). Zero real
console errors (one transient publish-race 500 on a re-run, gone on the
next). Scratch spec deleted + `playwright.config.ts` reverted.

**Gate:** backend `tsc` + `jest` (themes, 87/87) + lint +0 (261); storefront
`tsc` + `build` + `vitest` 519/519 + lint +0 (33); admin `tsc` + `build` +
`vitest` (9 failures across `AccountSetup.test.tsx` / `login/page.test.tsx`
/ `PreviewFrame.test.tsx` — the pre-documented full-suite-only flaky set,
31/31 in isolation, untouched by this change) + lint +0 (77).

---

### 8.16 wishlist `pop`/`burst` + `product_tabs` crossfade — BUILT (2026-09-06, `feat/tabs-wishlist-polish`)

§8.13.C items 3 + 4 in one PR (batch PR A). Both are one-shot CSS keyframes
on an existing element; neither adds a CSS var, so there is no SPA-leak
clear to write.

**Item 4 — `productCards.wishlistAnimation` (`'none' | 'pop' | 'burst' |
'sweep'`).** New optional key on `ProductCardSettings`, mirrored across all
three type files. `WishlistButton.tsx` sets an `adding` flag **in the click
handler** (only when `!active` — i.e. toggling ON) and clears it on
`animationend`; the flag adds `theme-wishlist-anim` (`pop`: a
`theme-wishlist-pop` scale bounce) or that plus `theme-wishlist-anim-burst`
(`burst`: an expanding, fading `::after` ring), both `--motion-duration-base`.
The flag lives in the handler rather than an effect specifically to avoid
the `set-state-in-effect` lint shape. `sweep` is reserved in the enum for
mirror consistency with §3.6 but **not implemented** — it falls through to
no class, and is not offered in the admin dropdown. Admin: a "Wishlist heart
animation" `<Select>` in `ProductCardsSettings.tsx`, shown only when
`showWishlist` is on. Templates: Market `pop`, Bloom `burst`.

- **No-op proof:** absent key ⇒ `ANIM_CLASS[""]` ⇒ `""`, byte-identical to
  today's plain colour swap. No `DEFAULT_THEME_CONFIG` change, no validation
  change (`productCards` sub-keys are deliberately unvalidated, per the
  file's own "shallow beyond structure" comment).
- **Test note:** the `onAnimationEnd` clear path can't be exercised in
  jsdom — React 19 + jsdom doesn't wire `animationend` into the synthetic
  event system (verified with a probe: neither `fireEvent.animationEnd` nor
  a native `dispatchEvent` reaches an `onAnimationEnd` handler). The
  `WishlistButton.test.tsx` cases cover the config→class mapping; the clear
  is verified in the scratch pass.

**Item 3 — `product_tabs` content crossfade only.** `ProductTabsSection.tsx`
wraps its loading/empty/grid states in one `<div key={activeId}
className="theme-tab-panel">`; the key remounts the wrapper on every tab
switch, so the one-shot `theme-fade-in` (already in `globals.css`) plays
once per switch. Resting render is byte-identical — only the previously
instant content swap now fades. **Magic-line + height-animate deferred**
(see the §8.13.C item 3 entry for the full reasoning): no template can ship
a `product_tabs` section yet (needs hardcodable `collectionIds`), the
magic-line pattern fights the section's solid-fill pills, and the
height-animate is L-shaped. Same discipline as item 9 (separators) skipped
as 0/4 — not building a mechanism ahead of any consumer that can use it. No
dedicated `ProductTabsSection` component test added (a keyed wrapper + one
class); `globals.css.test.ts` covers the stylesheet parsing.

**Scratch-shop pass (dev seed shop, puppeteer, DOM + computed style,
reduced-motion pass).** Published Market (`pop`) onto shop 1 with an injected
`product_tabs` section (Flowers/Gifts tabs). Wishlist, `no-preference`:
resting heart has no `theme-wishlist-*` class; on toggle-on the class appears
with computed `animationName: theme-wishlist-pop`; after `animationend` the
class is cleared (real-browser confirmation of the `onAnimationEnd`
`setAdding(false)` path jsdom can't exercise); zero console errors. Wishlist,
`prefers-reduced-motion: reduce`: resting no class; toggle-on is functionally
instant (blanket rule zeroes the duration, class added + cleared faster than
a 10ms poll) — no visible motion, correct. `product_tabs`: `.theme-tab-panel`
present; clicking the "Gifts" tab yields computed `animationName:
theme-fade-in` / `duration: 0.352s` on the keyed remount; zero console
errors. Scratch theme + spec deleted; seed shop back to no published theme.
**One dev-server artifact, not a code bug:** turbopack's `next dev` HMR
didn't fully reprocess `globals.css` after the second consecutive edit —
`.theme-tab-panel` was missing from the *dev* CSS while present in every
`next build` output and passing `globals.css.test.ts`; a `.next` wipe + dev
restart fixed it.

**Gate:** backend `tsc` + `jest themes` 87/87 + lint +0 (261); storefront
`tsc` + `build` + `vitest` 524/524 (+5 `WishlistButton.test.tsx`) + lint +0
(33); admin `tsc` + `build` + `vitest` `ProductCardsSettings` 4/4 (+2) +
lint +0 (77).

---

### 8.17 hero `kenBurns` + `indicatorStyle: progress` + `backToTop` re-author — BUILT (2026-09-06, `feat/hero-motion-backtotop`)

§8.13.C items 6 + 11 + 12 (batch PR B). Two new optional `hero.settings`
keys (`SectionSettings` is free-form `[key: string]: unknown`, so no type
mirror) + a two-line templates re-author for item 6.

**Item 11 — `hero.settings.kenBurns?: boolean`.** `HeroSlideshow` adds
`.theme-ken-burns` to the active slide `<img>` when `kenBurns && !reducedMotion`,
with `animationDuration` set inline to the slide duration. Keyframe:
`scale(1) → scale(1.08)`, `animation-direction: alternate`,
`animation-iteration-count: infinite` — a single-image hero breathes in/out
rather than zooming once and stopping; on a multi-slide hero each slide's
zoom restarts as it becomes active (the class toggles off→on on the reused
`<img>` node). While it runs it overrides the img's inline `transform: none`.
Reduced motion: the class isn't applied at all (belt: the blanket rule).
Atelier only.

**Item 12 — `hero.settings.indicatorStyle?: 'dots' | 'bars' | 'progress' |
'fraction'`.** `'progress'` renders a thin bottom bar whose fill (`scaleX`,
`transform-origin: left`, `animation-timing-function: linear`, duration =
slide duration inline) is keyed on the active slide so it restarts each
rotation; `animation-play-state: paused` while the slideshow is hover-paused;
not rendered under reduced motion (no rotation to track). `'dots'`/absent ⇒
today's `showSlideIndicators` dot row unchanged. `'bars'`/`'fraction'`
reserved in the enum, unbuilt — fall through to dots. Market only. Admin:
"Slide indicator style" `<Select>` (Dots / Progress bar; "dots" writes
`undefined`) + a "Ken Burns effect" `<Toggle>` in `HeroSettings.tsx`.

**Item 6 — enable `floatingElements.backToTop` on Market + Bloom.**
`g.floatingElements = { whatsapp: {…}, customButtons: [], backToTop: { enabled:
true } }` (full assignment mirroring the `g.motion`/`g.radius` re-author
style — the category is `?:` in the type even though `DEFAULT_THEME_CONFIG`
seeds it, so a bare `g.floatingElements.backToTop = …` fails `tsc`).
`BackToTopButton.tsx` already reads it (C1/C2). Atelier + Heritage stay
without it per their §6 tables.

**No-op proof:** `kenBurns`/`indicatorStyle` absent ⇒ `HeroSlideshow` takes
the exact prior branch (`kenBurnsOn` false ⇒ no class / no inline
`animationDuration`; `showDots` = the old `showIndicators && count > 1`
condition; `showProgress` false). New CSS classes are inert until applied.
No CSS var, no `DEFAULT_THEME_CONFIG` change, no validation change
(`hero.settings` shallow-validated).

**Scratch-shop pass (dev seed shop, puppeteer, DOM + computed style,
reduced-motion pass).** Atelier + Market published onto shop 1 with two
injected hero `bannerImages` (`slideDuration: 6`). kenBurns, `no-preference`:
exactly one `img.theme-ken-burns` (the active slide), computed
`animationName: theme-ken-burns`, inline `animation-duration: 6000ms`; under
`prefers-reduced-motion: reduce` the class is absent. indicatorStyle
`progress`, `no-preference`: `.theme-hero-progress` present, computed
`animationName: theme-hero-progress`, inline `6000ms`, **zero** dot buttons
(bar replaced dots); under reduced motion the bar is not rendered. Back-to-top
button in the DOM after scrolling on the Market theme; published
`theme-config.globalSettings.floatingElements.backToTop.enabled === true` on
both Market and Bloom. Zero console errors throughout. Scratch themes + spec
deleted; seed shop back to no published theme. (Same turbopack dev-HMR
staleness as §8.16 — `.theme-ken-burns` / `.theme-hero-progress` missing from
the *dev* CSS after a consecutive `globals.css` edit while present in every
`next build`; `.next` wipe + restart before the pass.)

**Gate:** backend `tsc` + `jest themes` 87/87 + lint +0 (261); storefront
`tsc` + `build` + `vitest` `HeroSection`/`globals.css` 23/23 (+6) + lint +0
(33); admin `tsc` + `build` + `vitest` `HeroSettings` 5/5 (+2) + lint +0 (77).

---

### 8.18 `drawers.animation` + `cart.itemAnimation`/`subtotalAnimation` + `scrollProgressBar` — BUILT (2026-09-06, `feat/cart-drawer-scrollbar`)

§8.13.C items 13 + 14 (batch PR C), all Market. Three new optional keys on
existing categories (`DrawerSettings.animation`, `CartSettings.itemAnimation`
/ `subtotalAnimation`) + wiring for the pre-existing `MotionSettings.scrollProgressBar`.
Mirrored across all three type files.

**Item 13a — `drawers.animation: 'slide' | 'slide-fade' | 'scale' | 'none'`.**
`CartDrawer.tsx`'s `DRAWER_MOTION` table maps the value to
`{ transition, closed, open }` class sets. `slide` (and absent) is
**byte-identical to today** — `transition-transform` + `translate-x-full` /
`translate-x-0`. `slide-fade` adds an opacity transition; `scale` replaces
the translate with `origin-right scale-95↔scale-100` + opacity (and
`pointer-events-none` while closed, since it stays on-screen); `none` drops
the transition class. `transitionDuration` still reads `--motion-duration-base`
so the blanket reduced-motion rule zeroes it.

**Item 13b — `cart.itemAnimation: boolean`.** `CartLineItems.tsx` puts a
mount-triggered one-shot `.theme-cart-item-in` (fade + 6px slide,
`--motion-duration-base`, no `forwards`) on every row `<div>` when the
setting is on. Since the drawer stays mounted and rows are keyed by
product/variant, a newly-added row animates on its own mount and a
quantity bump never replays it; the whole list fades in once on the first
mount of a cart page (a reasonable entrance). Setting off ⇒ **no class, no
markup change**. (An earlier draft tracked seen keys in a `useRef<Set>` read
during render — that trips the `react-hooks/refs` rule; the plain per-row
class is simpler and lint-clean.)

**Item 13c — `cart.subtotalAnimation: 'none' | 'flash' | 'count'`.** New
`lib/use-animated-number.ts` — `useAnimatedNumber(value, enabled)` tweens
from the currently-shown number to a new `value` on every change (a
`displayRef` mirrors the on-screen value so a mid-tween change animates from
where it is). Distinct from `useCountUp` (0→target on an external trigger,
only dips once) — this tracks a live up-and-down number. Returns `value`
verbatim on first render, when `enabled` is false, and under reduced motion;
every `setState` is inside the rAF callback. `'count'` uses it; `'flash'` is
a keyed one-shot `.theme-cart-subtotal-flash` highlight; `'none'`/absent ⇒
plain `subtotal.toFixed(2)`.

**Item 14 — `motion.scrollProgressBar: boolean`.** New `ScrollProgressBar.tsx`
mounted in `ShopLayoutClient` (before `<Header>`), returns `null` unless
`globalSettings.motion.scrollProgressBar`. A `fixed inset-x-0 top-0 h-0.5`
bar; the inner `bg-accent origin-left` fill's `transform: scaleX()` =
`scrollY / (scrollHeight - innerHeight)`, clamped, via the shared
`useScrollValue`. Deliberately no transition (it's a position indicator, not
a flourish) so it's correct and unaffected under reduced motion.

**No-op proof:** every new key absent ⇒ the exact prior branch —
`DRAWER_MOTION.slide` = today's classes; `itemAnimation` off ⇒ untouched row
markup; `useAnimatedNumber(subtotal, false)` returns `subtotal`;
`ScrollProgressBar` renders `null`. No new CSS var, no `DEFAULT_THEME_CONFIG`
change, no validation change (`cart`/`drawers` fields shallow, `motion` is
`?:`).

Admin: "Cart drawer open animation" `<Select>` in `DrawersSettings.tsx`;
"Animate newly added items" `<Toggle>` + "Subtotal change animation"
`<Select>` in `CartSettings.tsx`; "Scroll progress bar" `<Toggle>` in
`MotionSettings.tsx` (next to the §8.13.C item 8 smooth-scroll toggle,
likewise not gated on `intensity`). Every "off" value writes `undefined`.

**Scratch-shop pass (dev seed shop, puppeteer, DOM + computed style,
reduced-motion pass).** Market published onto shop 1 with `theme.cartLayout`
flipped to `drawer` and a 1-item cart seeded via `localStorage`.
`scrollProgressBar`: the `.origin-left` fill's `transform` is `scaleX(0)` at
the top and `scaleX(1)` scrolled to the bottom, in both motion states.
`drawers.animation: 'slide-fade'`: the open panel carries `translate-x-0` +
`opacity-100`, computed `transitionDuration: 0.352s` (`--motion-duration-base`
× Market's `speed: 1.1`) and `~1e-05s` under `prefers-reduced-motion: reduce`.
`cart.itemAnimation`: the drawer row carries `.theme-cart-item-in`.
`cart.subtotalAnimation: 'count'`: bumping the line quantity 1→2 (subtotal
120→240) sampled a smooth eased tween — `120.00 → 152.78 → 179.01 → 199.37 →
214.61 → 225.46 → 232.67 → 236.98` — and no `.theme-cart-subtotal-flash`
class (count mode). Zero console errors. Scratch theme + spec deleted;
`cartLayout` restored to `full_page`. (Same turbopack dev-HMR staleness as
§8.16/§8.17 — `.next` wipe + restart before the pass.)

**Gate:** backend `tsc` + `jest themes` 87/87 + lint +0 (261); storefront
`tsc` + `build` + `vitest` 540/540 (+`CartDrawer` 5, `ScrollProgressBar` 3,
`use-animated-number` 3) + lint +0 (33); admin `tsc` + `build` + `vitest`
`MotionSettings` +2 / `CartDrawerAnimation` 3 + lint +0 (77).

---

### 8.19 `inputFields.focusAnimation` + `buttons.primary.pill` — BUILT (2026-09-06, `feat/input-focus-pill-buttons`)

§8.13.C items 7 + 9 (batch PR D). Both are new optional keys on existing
type interfaces, mirrored across all three files.

**Item 7 — `inputFields.focusAnimation: 'none' | 'border' | 'glow' |
'float-label'`.** `NewsletterSection.tsx` — its email input is the only
input a theme section renders. When `focusAnimation === 'float-label'` the
input is wrapped in a `<label class="theme-float-label">` with a
`placeholder=" "` and a `<span>Email address</span>`; the CSS floats the
span to the top border via `:focus` / `:not(:placeholder-shown)` (the
transition reads `--motion-duration-fast`, blanket reduced-motion rule
zeroes it). Any other value (incl. absent) ⇒ the **exact prior bare
`placeholder="you@example.com"` input**. `'border'`/`'glow'` reserved,
unbuilt. Market. Checkout inputs (not theme-driven) left as a follow-up.
Admin: "Focus animation" `<Select>` (None / Floating label) in
`InputFieldsSettings.tsx`.

**Item 9 — `buttons.primary.pill?: boolean`** (chosen over widening
`--theme-radius`; asked + answered). When set, `applyThemeConfigOverrides`
writes `--theme-button-pill-radius` = `buttons.pillCornerRadius` (default
9999) and **removes it** otherwise (SPA-leak clear, in the always-run
`g.buttons.primary` block). `themeButtonBaseStyle`'s `borderRadius` becomes
`var(--theme-button-pill-radius, var(--theme-btn-primary-radius, var(--theme-radius, 8px)))`
— the pill var is checked **first** so an opted-in pill wins over the legacy
Layout-mode shape var too (the scratch pass caught the first cut, which put
it after the legacy var: `applyLegacyThemeOverrides` *always* sets
`--theme-btn-primary-radius` to `8px` for the "rounded" default, so the pill
value never won). `--theme-radius` is untouched (the
Featured/ImageText/ProductGrid image containers that share it, and the
newsletter input, are unaffected). `pill` unset ⇒ var absent ⇒ the chain is
`var(--theme-btn-primary-radius, var(--theme-radius, 8px))` — byte-identical
to before, including for a shop with a hand-set `cornerRadius`. Bloom sets
`pill: true` (its earlier
"can't set cornerRadius: 9999, it'd ellipse the tiles" note is now
resolved). Note: `pillCornerRadius`'s name is now slightly redundant with
the boolean (field = value, boolean = whether it's used) — accepted minor
untidiness, not worth touching the existing field. Admin: "Pill shape"
`<Toggle>` on the Primary button only (`showPill` prop) in
`ButtonsSettings.tsx`.

**No-op proof:** `focusAnimation` absent ⇒ `NewsletterSection` renders the
untouched `<input>` branch; `pill` absent ⇒ `--theme-button-pill-radius`
removed, `themeButtonBaseStyle` resolves to `var(--theme-radius, 8px)` as
before. One test updated (`theme-element-style.test.ts`'s
`themeButtonBaseStyle` borderRadius string). No `DEFAULT_THEME_CONFIG`
change, no validation change.

**Scratch-shop pass (dev seed shop, puppeteer, DOM + computed style,
reduced-motion pass).** Market + Bloom published onto shop 1. float-label
(Market): the newsletter input is inside `label.theme-float-label` with
`placeholder=" "` and a `<span>Email address</span>`; no bare
`placeholder="you@example.com"` input; focusing the input moves the span's
computed `transform` from `translateY(-7px)` to `scale(0.82)
translateY(-26.2px)` (and it lands there under `prefers-reduced-motion` too —
end state kept, transition zeroed). Pill (Bloom): `buttons.primary.pill`
publishes `true`, `--theme-button-pill-radius: 9999px` on `:root`,
`--theme-radius` still `8px`, the primary button's computed `border-radius`
is `9999px` while a `--theme-radius` section tile stays at its small value.
Zero console errors. Scratch themes + spec deleted; seed shop clean. **One
bug caught + fixed:** the pill var was first placed *after*
`--theme-btn-primary-radius` (which `applyLegacyThemeOverrides` always sets),
so pill buttons still rendered at 8px — reordered to check the pill var
first.

**Gate:** backend `tsc` + `jest themes` 87/87 + lint +0 (261); storefront
`tsc` + `build` + `vitest` 543/543 (+`NewsletterSection` 3, `theme-element-style`
string updated) + lint +0 (33); admin `tsc` + `build` + `vitest`
`ButtonsSettings` +1 / `InputFieldsSettings` 2 + lint +0 (77).

---

### 8.20 fly-to-cart (`animations.addToCartStyle: 'fly'`) — BUILT (2026-09-06, `feat/fly-to-cart`)

§8.13.C item 16 — the catalog's flagged "single most complex item", built on
its own checkpoint. Market only (1/4). A cloned product image arcs from the
add-to-cart source to the header cart icon, then fades.

**The gate problem + the opt-in field.** `animations.addToCart` is a *required
`boolean`*, `true` in `DEFAULT_THEME_CONFIG` and backfilled to `true`
(`backfillGlobalSettings`) for any theme missing it — so gating fly-to-cart on
it directly would turn the effect ON for every non-template shop the instant
it shipped (not byte-identical). **New `AnimationSettings.addToCartStyle?:
'none' | 'fly'`** (optional, no `DEFAULT` value) mirrored across the three
type files. Fly-to-cart fires only when
`animations.addToCart === true && animations.addToCartStyle === 'fly'` —
`addToCart` stays the master "animations allowed" switch, `addToCartStyle`
selects the effect. Absent field ⇒ every existing shop, template or not,
renders exactly as today. Market re-authors `addToCart: false → true` +
`addToCartStyle: 'fly'`; the other three templates unchanged.
`templates.spec.ts`'s 4/4 `addToCart === false` assertion is split so Market
is the exception.

**Mechanism (`storefront/lib/fly-to-cart.tsx`, new).** `FlyToCartProvider` +
`useFlyToCart()` → `{ flyToCart(sourceEl) }`, mounted in `ShopLayoutClient`
inside `CartProvider` (peer of `CartDrawerProvider`, pattern from
`cart-drawer.tsx`). The caller has already run `addItem(...)` before calling
`flyToCart`, so the cart count updates immediately regardless of the
animation. `flyToCart`:
- no-ops if the gate is off, reduced motion, no `sourceEl`, no visible
  `[data-fly-to-cart-target]`, a zero-size source rect, or **≥ 5 live
  clones** (see the cap below);
- otherwise imperatively creates an `<img data-fly-to-cart-clone>` (fresh
  `src` from the source's `currentSrc`, `position: fixed` at the source
  rect, `border-radius: var(--theme-radius, 8px)`, `z-index: 2147483000`,
  `pointer-events: none`), appends it to `document.body`, and runs one
  **WAAPI** `element.animate` — 3 keyframes: start → mid arc (`dy*0.5 − 60px`
  lift, `scale 0.6`) → destination (`translate(dx, dy) scale 0.15 opacity 0`).
  Duration = parsed `--motion-duration-slow` (fallback 600), easing = parsed
  `--motion-ease`.
- Cleanup: `anim.onfinish` **and** a `setTimeout(duration + 250)` safety net
  (a backgrounded tab can starve `onfinish` — the `use-scroll-value.ts`
  lesson). Provider-unmount `useEffect` cleanup removes any stray
  `[data-fly-to-cart-clone]` from `body` (SPA-leak guard — clones live on
  `body`, not the provider subtree, so a shop switch mid-flight could
  otherwise orphan one).

**The 5-concurrent cap.** `liveClones` is a `useRef` counter in the provider,
`+1` on append, `-1` on cleanup. It is a **rapid-click spam guard, not an
arbitrary number**: a shopper who double/triple-clicks quick-add (same
product, or several products in quick succession) would otherwise flood
`document.body` with detached `<img>` nodes, each animating ~600ms. Five lets
a genuine burst of a few adds all animate; a **6th concurrent call skips only
the visual clone** — `addItem` has already run at the call site, so cart
correctness is never affected by the cap. Concurrent clones (not a queue) —
each is independent and self-cleaning.

**Reduced motion.** `flyToCart` returns immediately; the item is still added
(the call site's `addItem` already ran). "Neutralize, never break."

**No cart badge bounce.** There is none today — `TopBar.tsx`'s
`CartIconButton` renders a plain reactive `{count}` span, no animation class
anywhere. The count updates the instant `addItem` runs, unchanged; **no
bounce is added** (keeps fly-to-cart self-contained per the catalog — the
clone's own fade + shrink at arrival is the finish).

**Wiring (2 real surfaces — exhaustive).** `ProductGridSection.tsx`'s
`QuickAddButton.onClick` (after `addItem`, still behind the
`if (previewMode) return`) → `flyToCart(closest('.theme-product-card')
.querySelector('.theme-product-image'))`. `ProductDetailClient.tsx`'s
`handleAddToCart()` (the `cart`/default branch only — not `buy_now`, which
`router.push`es away) → `flyToCart(document.querySelector('[data-pdp-fly-source]'))`,
a marker on `ProductGallery.tsx`'s main image. `ProductCard.tsx` (collections
page / related / search / `product_tabs`) has **no add-to-cart action** —
nothing to wire. `AddonPrompt` (checkout) + `cart/recover` deliberately out
of scope.

**No-op proof.** `addToCartStyle` absent ⇒ `flyToCart` early-returns ⇒
`addItem` still runs ⇒ byte-identical. No CSS var, no CSS class, no
`DEFAULT_THEME_CONFIG` change, no `theme-config.validation.ts` change
(`animations` isn't deep-validated). `data-fly-to-cart-target` /
`data-pdp-fly-source` are inert markers. `FlyToCartProvider` mounting adds one
context, no render output.

**Scratch-shop pass (dev seed shop, puppeteer, page-side rAF sampling — the
count-up round's technique, not before/after).** Market published
(`addToCart:true`, `addToCartStyle:'fly'`). Quick-add, `no-preference`: a
`[data-fly-to-cart-clone]` appears; sampled across 41 frames its centre moves
from **1403px → 0px** distance to the `[data-fly-to-cart-target]` cart-icon
centre (lands dead-on); removed from the DOM by the end; the cart badge goes
`(none) → 1` immediately, not gated on the flight. `prefers-reduced-motion:
reduce`: **no clone ever appears**; the badge still goes `→ 1`. Concurrent (3
rapid quick-add clicks): peak 3 live clones (under the 5-cap), all cleaned up
by ~1.6s. PDP "Add to cart": clone flies from `[data-pdp-fly-source]`, cleaned
up, badge → 1. No-op control (Atelier, no `addToCartStyle`): no clone. Zero
console errors throughout. Scratch theme + spec deleted; seed shop clean.
**One bug caught + fixed:** the destination marker was first only on
`TopBar.tsx` (the legacy Layout-mode header) — every published-theme shop
uses `ThemeDrivenHeader.tsx`, so `resolveTarget()` found nothing and threw.
Marker added to `ThemeDrivenHeader`'s `cart_icon` block **and** `MobileNav`'s
bottom-bar cart button; `resolveTarget()` picks the first with a non-null
`offsetParent`.

**Gate:** backend `tsc` + `jest themes` 91/91 (+4 from the split spec) + lint
+0 (261); storefront `tsc` + `build` + `vitest` 550/550 (+`fly-to-cart` 7) +
lint +0 (33); admin `tsc` + `build` + `vitest` `AnimationsSettings` +2 + lint
+0 (77).

---

### 8.21 route-content fade + `view_all` button on `product_grid` + cart-drawer theming — BUILT (2026-09-06, `feat/route-transition-followups`)

§8.13.C item 17 + the two remaining §8.15/§8.18 follow-ups, one PR. Stacks
conceptually after §8.20 (fly-to-cart) but is an independent branch off
`main` — the only overlap is this file's section ordering right before §9.

**Item 17 — route-content fade (`animations.pageTransition`).** No new field
needed: `pageTransition` is a required boolean but **`false` in
`DEFAULT_THEME_CONFIG`** and `false` in all 4 templates, so gating on
`=== true` is byte-identical (default off). New `RouteTransition.tsx` wraps
`<main>`'s children in `ShopLayoutClient`: when on, a `<div key={pathname}
className="theme-route-transition">` remounts on every `usePathname()` change
and replays a one-shot `theme-route-in` keyframe (fade + 8px rise,
`--motion-duration-fast`); search-param-only changes don't count (correct —
a sort/filter shouldn't full-fade the page). When off/absent ⇒
`<>{children}</>`, **no wrapper at all**, DOM byte-identical. Blanket
reduced-motion rule neutralises the keyframe. 0/4 templates — ships as a
capability only, no re-author. The admin "Page transition" toggle already
existed. **View Transitions deliberately not layered on** — Chromium-only,
Next App Router support still moving; the plain keyed fade is the real
feature (§8.20 flag #2 stays a flag).

**§8.15 follow-up — `product_grid`'s "View all" as a secondary button.**
`ProductGridSection`'s View all is a section setting (`showViewAllButton` /
`viewAllLabel`), not a `view_all_button` block like `featured_collections` —
so it gets its own `settings.viewAllStyle?: 'link' | 'button'` (free-form
`SectionSettings` key, no type change). `'button'` renders the same outline
secondary button `FeaturedCollectionsSection`'s `ViewAll` does
(`resolveSecondaryButtonStyle` + `resolveButtonHoverClass` from §8.15);
absent/`'link'` ⇒ today's exact `text-accent hover:underline` `<Link>`.
Admin: a "View all display" `<Select>` in `ProductGridSettings.tsx`, shown
only when a collection is scoped + the button is on; "Text link" writes
`undefined`. No template re-author.

**§8.18 follow-up — cart-drawer `schemeId` / `bordersStyle` / `dropShadow`
theming** (the open half of the `drawers` category). Mirrors the
`popovers.schemeId` wiring exactly: new `--color-drawer` / `--color-drawer-fg`
/ `--color-drawer-border` in `globals.css` `@theme` (literal defaults =
`--color-header`'s), written from `resolveScheme(g.drawers.schemeId,
colorSchemes) ?? activeScheme` in `applyThemeConfigOverrides` (always
present, like popovers — no SPA-leak clear needed). `CartDrawer.tsx`'s panel
swaps `bg-header text-header-fg` → `bg-drawer text-drawer-fg`, and
`bordersStyle: 'solid'` adds `border border-drawer-border`, `dropShadow:
false` drops `shadow-2xl`. **Byte-identical no-op:** `DEFAULT`
`drawers.schemeId === colorSchemes[0].id` for every shop + template, so
`--color-drawer` === the active-scheme background === what `--color-header`
resolves to; `bordersStyle: 'none'` + `dropShadow: true` are the defaults =
today's panel. `DrawersSettings.tsx` already had the SchemePicker + the two
toggles (dead until now) — no admin change.

**Deferred:** checkout-input `focusAnimation` — the checkout `<input>`s use
above-field `<label>`s + a shared `FIELD_CLASS` across 4+ files on a
conversion-critical form; converting them to the placeholder-based
`.theme-float-label` (§8.19) is a real multi-file restructure, not a small
extension. Flagged, not built.

**No-op proof.** `pageTransition` false (default) ⇒ no `RouteTransition`
wrapper. `viewAllStyle` absent ⇒ the plain link. `drawers` defaults ⇒
`--color-drawer` = active-scheme bg, no panel border, `shadow-2xl` kept. No
`DEFAULT_THEME_CONFIG` change, no validation change.

**Scratch-shop pass (dev seed shop, puppeteer).** Route fade (theme with
`pageTransition: true`): `main > .theme-route-transition` present on load and
after a client nav, computed `animationName: theme-route-in` / `0.165s`
(`~1e-05s` under `prefers-reduced-motion`). No-op (no `pageTransition`): no
wrapper. View-all (`viewAllStyle` on the `product_grid` scoped to "Flowers",
disambiguated by the `/collections/…` href): unset ⇒ `class="text-sm
font-medium text-accent hover:underline"` — the plain link, byte-identical;
`'button'` ⇒ `class="inline-block px-5 py-2.5 text-sm font-medium
theme-btn-border-fill"` (Market's secondary `border-fill`). Cart drawer
(`cartLayout: 'drawer'`): default ⇒ `--color-drawer` = `--color-header` =
`#FFFFFF`, panel `bg-drawer` + `shadow-2xl`, no border; `drawers.schemeId`
→ scheme-2 (`#FDF1F3`) ⇒ `--color-drawer` = `#FDF1F3` ≠ `--color-header`,
panel `border border-drawer-border`, `shadow-2xl` gone. Zero console errors.
Scratch themes deleted; seed shop clean.

**Gate:** backend n/a (no backend change); storefront `tsc` + `build` +
`vitest` 548/548 (+`RouteTransition` 3, `CartDrawer` chrome +2) + lint +0
(33); admin `tsc` + `build` + `vitest` `ProductGridSettings` +2 + lint +0
(77).

---

### 8.22 hero `parallax` + `motion.decorativeParallax` — BUILT (2026-09-06, `feat/hero-decorative-parallax`)

§8.13.C item 15, Bloom only (1/4). Independent branch off `main` — the only
overlap with §8.20/§8.21 is this file's section ordering just before §9.

**Hero `parallax` (`hero.settings.parallax?: boolean`).** Free-form
`SectionSettings` key (like `kenBurns`), no type change. `HeroSlideshow`'s
backdrop layer (`div.absolute.inset-0.overflow-hidden`) gets an inline
`transform: translateY(min(scrollY * 0.15, 40)px) scale(1.15)` — the page
scrolls up, the backdrop lags (factor < 1), clamped at 40px inside the 15%
scale bleed so no hero edge is ever revealed. `translateY` value via the
shared `useScrollValue`; **not** `background-attachment: fixed` (iOS-broken).
`parallaxOn = parallax && !reducedMotion && count > 0 && useMinWidth(640)` —
new shared `lib/use-min-width.ts` is the JS equivalent of the Phase A
sub-640px CSS tier (a media query can't gate a scrollY-driven transform).
**Parallax wins over `kenBurns`** (§3.7 — one continuous transform per hero):
`kenBurnsOn` now also requires `!parallaxOn`. Admin: a "Parallax" toggle in
`HeroSettings.tsx`; it and the Ken Burns toggle each `disabled` the other.

**`motion.decorativeParallax` (already typed, was dead).** New
`DecorativeParallax.tsx`, mounted in `ShopLayoutClient` (like
`ScrollProgressBar`). **Perf cap built in, not bolted on:**
`DECORATIVE_COUNT = 5` is a hard constant, no merchant control widens it;
the whole component returns `null` (no scroll listener, no DOM) under ANY of
`motion.intensity === 'none'`, `useReducedMotion()`, or
`!useMinWidth(640)`; each blob is `position: fixed` + `pointer-events: none`
+ `aria-hidden` + `z-index: 0` (behind content, never intercepts input, and
being fixed is always on-screen so "off-screen pause" is moot — the cap +
kill switches are the guard); transform is `translate3d(0, scrollY*rate,
0)` only (compositor-only), rates all < 0.2, from the ONE shared
`useScrollValue`. The blob look (`.theme-decorative-blob`: fixed, round,
`radial-gradient(var(--color-accent))`, `blur(40px)`) is a CSS class; only
position/size/opacity/translate are inline. Admin: a "Decorative parallax"
toggle in `MotionSettings.tsx` (next to smooth-scroll / scroll-progress —
not gated on `intensity` in the UI, but killed by `intensity: 'none'` at
render).

**Templates:** Bloom's hero gets `parallax: true`, `g.motion` gets
`decorativeParallax: true`. No other template.

**No-op proof.** `hero.settings.parallax` absent ⇒ `parallaxOn` false ⇒ the
backdrop div's inline `style` is `{}` (byte-identical). `decorativeParallax`
absent ⇒ `DecorativeParallax` renders `null`. No `DEFAULT_THEME_CONFIG`
change, no validation change.

**Scratch-shop pass (dev seed shop, puppeteer, scroll + computed-style
sampling).** Bloom published (`hero.parallax: true`, `decorativeParallax:
true`, `intensity: expressive`) with 2 injected `bannerImages`. Desktop
(1280px, `no-preference`): the hero backdrop's computed transform goes
`matrix(1.15,0,0,1.15,0,0)` → `matrix(1.15,0,0,1.15,0,40)` on scroll to
600px — `scale(1.15)` throughout, `translateY` clamped at **40px**
(600 × 0.15 = 90 → 40); **5** `.theme-decorative-blob`s, transforms change on
scroll. `prefers-reduced-motion: reduce`: backdrop transform `none`, **0**
blobs. Mobile (480px): backdrop `none`, **0** blobs (the sub-640 kill).
No-op control (Atelier — neither key): backdrop `none`, 0 blobs. Zero
console errors. Scratch themes deleted; seed shop clean.

**Gate:** backend `tsc` + `jest themes` 87/87 + lint +0 (261); storefront
`tsc` + `build` + `vitest` 553/553 (+`HeroSection` parallax 6, `DecorativeParallax`
5) + lint +0 (33); admin `tsc` + `build` + `vitest` `HeroSettings` +1 /
`MotionSettings` +1 + lint +0 (77).

---

### 8.23 card metadata sub-blocks `product_vendor` + `product_stock` — BUILT (2026-09-06, `feat/card-metadata-subblocks`)

§8.13.C item 18. Market §6.2 wants "sub-blocks `product_vendor` +
`product_stock` visible" on `product_card`. 1/4.

**Mechanism.** Two new leaf child block types under `product_card`:
`product_vendor` (renders `product.brand.name`, muted, above the title) and
`product_stock` (renders the shared "In stock / Only N left / Out of stock"
line off `product.stockQuantity`, below the price — green / amber / sale-price
colour by tone). Both are **opt-in**: `ProductGridSection` reads
`showVendor` / `showStock` as `!!subBlocks.find(b => b.type === … )?.visible`
with **no `subBlocks.length === 0` fallback** (unlike media/title/price), so a
`product_card` authored before these types renders byte-identically. Each line
also self-gates on real data — a `product_vendor` block on a product with no
brand renders nothing; `product_stock` on `stockQuantity: null` shows the
plain "In stock" state. Rendered in both the normal card and the `overlay`
card-style branch.

**`product_swatches` deferred.** `SwatchSettings` has renderable fields, but
**no template §6 table asks for `product_swatches`** — building it would wire
the `swatches.*` category purely to have a consumer. Same call as section
separators and `customCursor`: don't build a zero-consumer feature. `swatches.*`
stays dead; §9.3 updated.

**Files.** `storefront/lib/stock-label.ts` (new — extracted verbatim from the
PDP's local `stockLabel`, now shared by `ProductDetailClient` + the sub-block;
`stock-label.test.ts` covers the 4 branches). `ProductGridSection.tsx`
(`GridProductCard` gains `showVendor`/`showStock` props + `vendorEl`/`stockEl`;
parent resolves the two flags). `backend/src/themes/constants.ts` +
`admin/lib/types.ts` — `BLOCK_TYPE_LABELS` += `product_vendor: 'Vendor'` /
`product_stock: 'Stock status'`, `CHILD_BLOCK_TYPES.product_card` += both
(the two hand-mirrored copies; storefront has no such constant and
`theme-config.validation.ts` is shallow, so no third mirror).
`admin/.../BlockSettingsForm.tsx` — the two types fall through to the existing
"shows live product data, use the eye icon" note. `backend/src/themes/templates.ts` —
`productGrid()` gains an `extraCardBlocks: string[] = []` param; Market's call
passes `['product_vendor', 'product_stock']`; Market deferred-block comment
closed for this item.

**No-op proof.** New optional child block types, absent ⇒ `showVendor` /
`showStock` are `false` ⇒ nothing renders. No CSS var, no CSS class, no
`DEFAULT_THEME_CONFIG` change, no validation change. Every existing published
`product_card` (which has no vendor/stock sub-block) is untouched.

**Scratch pass.** Published Market on the seed dev shop → `product_grid` cards
show the brand line above the title and the stock line below the price;
published Atelier as the no-op control → cards render neither. Zero console
errors. Scratch themes deleted.

**Gate.** backend `tsc` + `jest themes` 87/87 + lint +0 (261); storefront
`tsc` + `build` + `vitest` 550/550 (+`ProductGridSection` 3, `stock-label` 4) +
lint +0 (33); admin `tsc` + `build` + `vitest` (+0 — form switch cases only) +
lint +0 (77).

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
| `animations.pageTransition` | ✅ route-content fade — `RouteTransition.tsx`, keyed on pathname (§8.21) | ✅ §8.21 |
| `animations.addToCart` | ✅ master switch for fly-to-cart (§8.20), which is selected by the new opt-in `animations.addToCartStyle: 'fly'` (Market) | ✅ §8.20 |
| `buttons.secondary` | a rendered secondary button variant on the CTA block, used by Market + Heritage (D) | D |
| `buttons.pillCornerRadius` | ✅ B1 radius scale + §8.19 `buttons.primary.pill` flag → `--theme-button-pill-radius` (Bloom); the field itself now has a live consumer | ✅ B1 / §8.19 |
| `drawers.schemeId` + `drawers.*` | ✅ fully resolved — `drawers.animation` (§8.18) + `schemeId` → `--color-drawer*` / `bordersStyle` / `dropShadow` on `CartDrawer` (§8.21) | ✅ §8.18 + §8.21 |
| `swatches.*` | was going to be the `product_swatches` card sub-block — **not built §8.23**: no template §6 table asks for `product_swatches`, so it stays a zero-consumer control (same call as section separators / `customCursor`) | deferred |
| `inputFields.*` | ✅ `inputFields.focusAnimation: 'float-label'` on the newsletter input (§8.19); `borderThickness`/`textPreset` on other inputs still open | ✅ §8.19 / D open |
| `prices.*` (beyond currency) | ✅ `prices.salePriceColor` / `salePriceStyle` replacing hardcoded `text-red-600` | ✅ B1 |
| `search.*` (corner radius / titleCase) | ✅ radius scale half done (B1); search-results theming itself still open | B1 ✅ / D open |
| `cart.*` (media fields) | ✅ `cart.itemAnimation` / `subtotalAnimation` (§8.18); media/scheme fields + checkout-behaviour flags still out of scope | ✅ §8.18 / F open |
| Typography paragraph/heading `case`/`letterSpacing` | ✅ reachable via one `typography.pairing`/`scale` control | ✅ B1 |
| `secondaryButtonLabel` (scheme) | consumed when a secondary button variant renders (D) | D |
| `header.settings.rows` / footer named layout | ✅ named header/footer presets that seed both | ✅ C1 |
| `header.settings.mobileNav` | ✅ `MobileNav.tsx` (drawer/bottom-bar/fullscreen) | ✅ C2 |
| `globalSettings.floatingElements.backToTop` | ✅ `BackToTopButton.tsx`, gated on scroll position | ✅ C1/C2 |
| `header.settings.transparentOnHero` | ✅ `reveal-on-hero` scroll behavior consumes it | ✅ §8.9 |
| `buttons.primary.hoverEffect`/`.pressEffect` | ✅ `resolveButtonHoverClass()`, Hero CTA + Newsletter submit | ✅ §8.8 |
| `rating_badge.countUp` | ✅ `useCountUp()`, Market's trust_bar (only template that requested it) | ✅ §8.10 |
| `icons.corners` | ✅ `resolveIconCorners()`, header + search icons (same narrow scope as `icons.stroke`) | ✅ §8.11 |
| `section.settings.successAnimation` (newsletter) | ✅ `.theme-newsletter-success` scale-in on the success swap | ✅ §8.12 |
| `badges.style` (+ `entranceAnimation`) | ✅ `resolveProductBadge` className + `.theme-badge-*` shape classes / `.theme-badge-pop` | ✅ §8.14 |
| `motion.smoothScroll` | ✅ `applyScrollBehavior()` in `lib/motion.ts` | ✅ §8.14 |
| `buttons.secondary` + `secondaryButtonLabel` (scheme) | ✅ `resolveSecondaryButtonStyle()` + `--color-secondary-button-label`, consumed by `featured_collections`' `view_all_button` in "button" mode | ✅ §8.15 |
| `productCards.wishlistAnimation` (new key, never a "dead control") | ✅ `.theme-wishlist-anim` / `-burst` one-shot on `WishlistButton`, click-handler flag; `sweep` reserved-unbuilt | ✅ §8.16 |
| `product_tabs` tab-switch polish | ◑ crossfade only (`.theme-tab-panel` keyed remount); magic-line + height-animate deferred until a template ships a real `product_tabs` section (blocked on hardcodable `collectionIds`) | ◑ §8.16 |
| hero `kenBurns` / `indicatorStyle: progress` (new keys) | ✅ `.theme-ken-burns` on the active slide (Atelier) / `.theme-hero-progress` bar replacing dots (Market) | ✅ §8.17 |
| `floatingElements.backToTop` enabled on Market + Bloom | ✅ templates re-author (capability was already built C1/C2) | ✅ §8.17 |
| `motion.scrollProgressBar` (typed since Phase A, no consumer) | ✅ `ScrollProgressBar.tsx` in `ShopLayoutClient` (Market) | ✅ §8.18 |
| `cart.itemAnimation` / `cart.subtotalAnimation` / `drawers.animation` (new keys) | ✅ `.theme-cart-item-in` / `useAnimatedNumber` + `.theme-cart-subtotal-flash` / `CartDrawer` motion table (Market) | ✅ §8.18 |

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

---

## 10. Engagement close-out (2026-09-06)

This section wraps the theme-builder capability engagement that began with the
generative audit (§1) and the four-template + motion/layout proposal (§2–§7).
It is the permanent record: a reader with zero context on the working threads
should be able to read §10.1 and know what the theme builder can do now that
it couldn't before, read §10.2 and know exactly what was consciously left
undone and why, and read §10.4 for the working rules this engagement
established. **§10 is a summary, not a fresh plan** — nothing here is
committed scope. If any deferred item is picked up, it gets its own plan-mode
round (see §10.5).

### 10.1 What shipped — inventory by phase

Every row is merged to `main`. "No-op" throughout means: a shop that never
adopts a template and never touches the new control renders byte-identically
to before the phase (§10.4).

#### Foundations

| Phase | PR | What it added |
|---|---|---|
| **A — Motion foundation** | #88 | `globalSettings.motion` category (`intensity` / `speed` / `easing`, seeded `{}`) + the `--motion-*` CSS-variable token table (durations, travel distances, hover-scales, easings) with a sub-640px mobile tier. Every previously-hardcoded storefront animation value was rewritten as `var(--motion-*, <the exact old literal>)`, so unset ⇒ pixel-identical. One blanket `@media (prefers-reduced-motion: reduce)` rule (`0.01ms`, not `0`, so `transitionend` still fires) replaced five scattered per-class blocks. Shared `useScrollValue()` hook (one rAF-throttled scroll subscription). `ScrollAnimatedWrapper` extended for the `motion.entrance` vocabulary + `stagger` + `animateOnce` + `trigger` plumbing (plumbing only — no section wired stagger yet). |
| **B1 — Design tokens: radius / type / cards** | #89 (+ hotfix #90) | `globalSettings.radius` (`{ preset?, applyToButtons? }`) → `--theme-round-sm/-md/-lg` driving every previously-hardcoded card radius. `typography.pairing` (7 named font bundles) + `typography.scale` (per-name px table, overrides `--text-h*-size` only; stored h1–h6 sizes never mutated) + `typography.baseFontSize`. `productCards.cardStyle` extended (`elevated` / `outlined-hover` / `filled` / `polaroid` / `overlay`) + `imageAspect` / `textAlign` / `density` + per-section `settings.imageAspect` / `settings.cardStyle`. `prices.salePriceColor` / `salePriceStyle` replacing the hardcoded `text-red-600`. **Hotfix #90:** B1 first named the radius tokens `--radius-sm/-md/-lg`, which collided with Tailwind v4's `rounded-*` utility scale and shifted ~88 unrelated call sites; renamed to `--theme-round-*` off every TW namespace. |
| **B2 — Global density scale** | #91 | `globalSettings.density` (`{ preset?: compact/cozy/comfortable/spacious }`, seeded `{}`) → `--section-py` / `--grid-gap` / `--grid-gap-m` / `--section-heading-gap` via `.theme-section-py` / `.theme-grid-gap` / `.theme-heading-gap` on the standard body sections. `section.settings.spacing` unchanged (outer padding that stacks, not an override). |
| *(docs)* | #92 | Storefront pre-PR checklist for theme-token work (the Tailwind-v4-namespace rule, full-swap-never-additive, JS-animations-self-gate-on-reduced-motion). |

#### Templates + the first capability round

| Phase | PR | What it added |
|---|---|---|
| **G0 — Four starter templates (Flow A)** | #93 | `backend/src/themes/templates.ts`'s `THEME_TEMPLATES` — Atelier / Market / Bloom / Heritage as four full, explicitly-typed `ThemeConfig` literals authored against **only** what A/B render. `POST /themes { fromTemplate }` (`CreateThemeDto`, `@IsIn(TEMPLATE_KEYS)`) → a new **unpublished** theme row via `cloneConfigWithFreshIds` (regenerates every id, remaps scheme refs). `GET /themes/templates` returns preview metadata only. The merchant's live theme is never read or written. **Flow B (apply-to-current-theme) deferred — see §10.2 / G1.** |
| **Post-G0 batch 1** | #94 | Card-hover enum += `desaturate` / `quick-add-slide` / `overlay` / `shadow` / `tilt` (extracted to `lib/card-hover.ts`). `animations.imageLoad: 'fade'` (per-image `onLoad` crossfade). Stagger *wiring* — `.theme-stagger-child` + `--i` rendered by 6 list sections, capped by a pure-CSS `:nth-child(n+13 of …)` rule; admin toggle on the shared per-section `ScrollAnimationControl`. `section.settings.motion.entrance: 'rotate-in'`. `brands.settings.scrolling` marquee. All four templates updated from G0 stand-in values to real ones. Two G0 template-authoring bugs fixed first (Bloom's `cornerRadius: 9999` leaking into `--theme-radius`; no template actually using its `schemeId` plumbing). |
| **C1 + C2 — Header/footer presets + mobile nav** | #95 | `header.settings` / `footer.settings` gain `height` / `contentWidth` / `separator` / `announcementPosition` and `columns` / `showPaymentIcons` / `waveEdge` / `bottomBarSeparate` (all optional, no new global CSS var). Client-side `HEADER_PRESETS` / `FOOTER_PRESETS` literals applied once via `applyHeaderPreset` / `applyFooterPreset` (apply-then-diverge, no stored preset identity). **`storefront/components/MobileNav.tsx`** — the storefront's first real mobile nav (`header.settings.mobileNav`: `scroll` default = untouched `MenuBar`, or `drawer` / `bottom-bar` / `fullscreen`). New shared `storefront/lib/use-reduced-motion.ts`. Two real bugs caught by the scratch Playwright pass: `cloneConfigWithFreshIds` not remapping `header.settings.rows[].blockIds`; `MobileNav`'s `setPointerCapture` suppressing synthesized clicks on nested buttons. `globalSettings.floatingElements.backToTop` also shipped this batch. |
| *(docs)* | #96 | Post-C capability re-evaluation (§8.7) — the priority recommendation for the next round, recorded before picking up D/E/F. |

#### §8.7 post-C items (five small capability wirings)

| PR | §8 | What it added |
|---|---|---|
| #97 | §8.8 | `buttons.primary.hoverEffect` + `.pressEffect` — `lib/button-hover.ts` resolver; hover lift/grow/underline-icon + press scale-down, all `--motion-*`-tokened and reduced-motion-safe. |
| #98 | §8.9 | `header.settings.scrollBehavior` (`static` / `sticky` / `shrink` / `reveal-on-scroll-up`) + `.transparentOverHero` wired to the real header via `use-header-scroll-state.ts`. |
| #99 | §8.10 | `trust_bar` `rating_badge` count-up — `useCountUp()` (rAF, `--motion-*`, IntersectionObserver-triggered, its first real consumer). |
| #100 | §8.11 | `globalSettings.icons.corners` (`rounded` / `sharp`) — per-icon `strokeLinecap` / `strokeLinejoin` on the header + search icons (a prop, not a CSS override). |
| #101 | §8.12 | Newsletter `successAnimation` — `section.settings.successAnimation?: boolean`; form unmounts, success block scales in. |
| *(docs)* | #102 | §8.13 post-§8.12 capability stock-take — re-derived the remaining-work list (§8.13.C) **against each template's own §6.1–6.4 table**, not the stale §6.5. Headline finding: `badges.style` is wanted 4/4 and was invisible to §8.7 because §8.7 was re-derived from §6.5, which had no row for it. |

#### §8.13.C priority list — items 1 through 18 (the "post-C batch")

Item numbers are §8.13.C's own. PRs #103–#113. All merged.

| §8.13.C item(s) | PR | §8 | Mechanism (one line) |
|---|---|---|---|
| **1** `badges.style` + **5** `badges.entranceAnimation` + **8** `motion.smoothScroll` | #103 | §8.14 | Badge shape enum (`pill`/`rectangle`/`ribbon`/`tag`/`circle`) on `lib/product-badge.ts` (Market `tag`, Bloom `circle`, Heritage `ribbon`; Atelier `rectangle` = the no-op value, left unset). `entranceAnimation` = a mount-triggered pop (Market + Bloom). `smoothScroll` = a one-line `applyScrollBehavior()` in `lib/motion.ts` (Atelier). |
| **2** `buttons.secondary` rendered variant | #104 / #105 | §8.15 | The first-ever render slot for a secondary button: `featured_collections`' `view_all_button` gains an opt-in "button" mode (`resolveSecondaryButtonStyle` + `resolveButtonHoverClass`). Market + Heritage. |
| **3** `product_tabs` crossfade + **4** wishlist `pop`/`burst` | #106 | §8.16 | `product_tabs` tab-switch content crossfade (`.theme-tab-panel` keyed remount; resting render byte-identical). Wishlist heart click-burst — one-shot `@keyframes` in the click handler, cleared on `animationend` (Market `pop`, Bloom `burst`). **Magic-line + height-animate deferred — see §10.2.** |
| **6** enable `floatingElements.backToTop` + **11** hero `kenBurns` + **12** hero `indicatorStyle: 'progress'` | #107 | §8.17 | `backToTop` template re-author on Market + Bloom (capability was built C1/C2). `.theme-ken-burns` scale-breathe on the active hero slide (Atelier). `.theme-hero-progress` bar replacing the dot row, keyed to slide rotation (Market). |
| **13** `drawers.animation` + `cart.itemAnimation` / `subtotalAnimation` + **14** `scrollProgressBar` | #108 | §8.18 | Cart-drawer open-transition table (`slide` / `slide-fade` / `scale` / `none`); new-cart-row fade-in; subtotal tween via new `lib/use-animated-number.ts` (from→to) or one-shot flash. `ScrollProgressBar.tsx` in `ShopLayoutClient`, `scaleX` = scroll fraction (Market; stays on under reduced motion — it tracks, doesn't flourish). |
| **7** `inputFields.focusAnimation` + **10** `buttons.primary.pill` | #109 | §8.19 | `NewsletterSection`'s email input gets a CSS-only float-label when `inputFields.focusAnimation === 'float-label'` (Market). `buttons.primary.pill?: boolean` → `--theme-button-pill-radius` checked between the legacy `--theme-btn-primary-radius` and `--theme-radius` in the fallback chain, set only when `pill === true` (Bloom). |
| **16** Fly-to-cart | #110 | §8.20 | A cloned product `<img>` arcs (WAAPI, first storefront use) from the quick-add card / PDP gallery to the `data-fly-to-cart-target` header cart icon, then fades. Gated on a **new opt-in `animations.addToCartStyle?: 'none' \| 'fly'`** — not `animations.addToCart` alone, which is a required boolean `true` by default. `FlyToCartProvider` in `ShopLayoutClient`; **5-concurrent-clone cap** (rapid-click spam guard; a 6th call skips only the visual clone, `addItem` always runs); `onfinish` + `setTimeout` safety-net cleanup; provider-unmount SPA-leak sweep. Market only. |
| **17** Route-content fade (+ two follow-ups) | #111 | §8.21 | `RouteTransition.tsx` — a `key={pathname}` wrapper replaying a one-shot fade+rise keyframe on nav; gated on `animations.pageTransition` (already `false` in DEFAULT + all templates, so no new field needed). 0/4 templates — capability only. **View Transitions deliberately not layered on — see §10.2.** Folded in: `ProductGridSection`'s own "View all" as a secondary button (`settings.viewAllStyle`); cart-drawer `schemeId` / `bordersStyle` / `dropShadow` theming (`--color-drawer*`, mirrors `popovers.schemeId`). |
| **15** Hero `parallax` + `motion.decorativeParallax` | #112 | §8.22 | `hero.settings.parallax` → the `HeroSlideshow` backdrop lags on scroll (`translateY` via `useScrollValue`, clamped inside a `scale(1.15)` bleed; wins over `kenBurns`). `motion.decorativeParallax` → `DecorativeParallax.tsx` (5 fixed accent-tinted blobs drifting on scroll) — **hard-capped at `DECORATIVE_COUNT = 5`**, returns `null` (no DOM, no listener) under any of `intensity: 'none'`, reduced-motion, or sub-640px. New shared `lib/use-min-width.ts`. Bloom only. |
| **18** Card metadata sub-blocks `product_vendor` + `product_stock` | #113 | §8.23 | Two opt-in leaf child block types under `product_card` — vendor (`brand.name`) above the title, stock line ("In stock / Only N left / Out of stock", shared `lib/stock-label.ts`) below the price. No `subBlocks.length === 0` fallback ⇒ a card predating these types is byte-identical. Market only. **`product_swatches` not built — see §10.2.** |

Not in the table: **item 9 (section separators)** — skipped, 0/4-concrete
(§10.2). **Item 3's magic-line + height-animate half** — deferred; only the
tab-switch crossfade shipped (#106). **Item 19 (`icons.style`)** — Phase-I-gated.
**Item 20 (`customCursor`)** — skipped, 0/4.

### 10.2 Known gaps — consolidated, re-verified 2026-09-06

Every entry re-checked against `templates.ts` and each template's own §6.1–6.4
table this pass, not copied forward.

| Gap | Status | Verified reason it's not done | What it would take |
|---|---|---|---|
| **`icons.style` (solid / duotone) — Phase I** | **Not started.** Gated on its own glyph-list sign-off round. | 2/4 (Market, Bloom) per §6.2/§6.3. Real cost is ~100 hand-drawn SVGs (a second icon dependency was rejected in §2). Not a normal batch item. | A glyph-list sign-off (which of the ~50 storefront icons need a solid + duotone variant), then the SVG work + an `icons.style` switch in the icon resolver. **Re-verify first:** how many icon call sites exist now (C1/C2 + the §8.x batches added several); whether `lib/icon-style.ts`'s current shape (built for `icons.corners` / `icons.stroke`) can carry a third axis. |
| **`customCursor`** | **Skipped.** 0/4. | No `§6` table row on any template; no `g.motion.customCursor` in `templates.ts`. `MotionSettings.customCursor?` is typed-but-unwired. | Don't build it without a template that wants it. |
| **`product_swatches` card sub-block** | **Deferred.** 0/4. | Market's §6.2 asks for `product_vendor` + `product_stock` only. No template §6 table names `product_swatches`. Building it would wire the dead `swatches.*` theme-settings category purely to have a consumer. | A template that actually wants variant-colour dots on the card, then a `product_swatches` leaf block reading `product.variants` + the `swatches.*` shape. `swatches.*` stays a zero-consumer category until then (§9.3). |
| **Checkout-input `focusAnimation`** | **Deferred.** | The checkout `<input>`s use above-field `<label>`s + a shared `FIELD_CLASS` across 4+ files on a conversion-critical form. Converting them to the placeholder-based `.theme-float-label` (§8.19) is a real multi-file restructure, not a small extension. §8.19's float-label is newsletter-only (the one input a theme *section* renders). | A deliberate checkout-form pass: move every field to `placeholder=" "` + a floating span, verify no regression to validation / error display / autofill on the form that takes the money. |
| **View Transitions on the route fade** | **Deferred.** | Chromium-only; Next 16 App Router VT support is still moving. Layering `startViewTransition` gating adds a second code path for a progressive enhancement. §9.4 flag #2. | A `'startViewTransition' in document` progressive-enhancement branch wrapped around the existing keyed fade — never a replacement for it, never a gate on `pageTransition`. Re-verify Next's VT API is stable first. |
| **Section separators (wave / angle SVG edges)** | **Skipped.** 1/4 aspirational, **0/4 concrete.** | Bloom's §6.3 prose mentions "section separators (optional)" but Bloom's template literal sets `section.settings.separator` on zero sections — the same shape as `product_tabs` magic-line and `customCursor`: an intent no template can currently act on. (§8.13.C item 9's own text still says "1/4 (Bloom) … roughly unchanged" — that line is **stale**; the operative decision is item 20's cross-reference and the §8.13 recommendation prose: skipped as 0/4-concrete.) | A template that sets `separator` on real sections, then `section.settings.separator?: 'none' \| 'line' \| 'wave' \| 'angle' \| 'dots'` rendering a decorative inline SVG between sections. |
| **`product_tabs` magic-line + height-animate** | **Blocked.** | 2/4 aspirational (Market + Bloom §6 tables name a `product_tabs` section with `activeIndicator: magic-line`), but **neither template contains one and can't** — a `product_tabs` section needs real `collectionIds`, which a template literal cannot hardcode (the templates' own deferred blocks say so). What shipped (#106) is the content crossfade only. The magic-line is also a pattern mismatch (`ProductTabsSection` uses solid-fill accent pills, not an underlinable nav). The height-animate is L-shaped (real `scrollHeight` JS measurement + transition + cleanup, not the `0fr→1fr` trick). | First solve "a template ships a real `product_tabs` section" (needs either hardcodable collection handles or a post-create binding step). Then the magic-line needs a pill restyle that doesn't break the byte-identical resting look, and the height-animate needs the real measure/transition/cleanup. |
| **Hero `slideTransition: 'zoom-cross'`** (Market §6.2) | **Silent degrade, accepted.** | `HeroSection.tsx` reads `settings.slideTransition` but types it as `ScrollAnimation` (`fade-in` / `slide-*`), so `zoom-cross` falls back to `fade-in`. Acceptable substitute, lowest priority (§8.13.D). | Widen the `slideTransition` type + add a `zoom-cross` branch to the slideshow transition map. |
| **Reserved-but-unbuilt enum values** | **Intentional stubs.** | Each falls through to the built default, is not offered in its admin control, and has no template consumer: hero `indicatorStyle: 'bars'` / `'fraction'` (§8.17), wishlist `sweep` (§8.16), `inputFields.focusAnimation: 'border'` / `'glow'` (§8.19), `drawers.animation` beyond what Market uses. | Only if a template wants one — add the branch + the admin option. |
| **`inputFields` / `search` / `swatches` category tails** | **Partly open (§9.3).** | `inputFields.borderThickness` / `textPreset` on non-newsletter inputs, `search.*` results theming, `swatches.*` — none has a rendering surface in a theme section today. | Deferred to a hypothetical "D" content round; no template needs them. |
| **G1 — `applyTemplate` (Flow B)** | **Never built.** This is **the one deferred item from the ORIGINAL plan** (§7 D1 "BOTH … Flow B also ships, secondary"), not a post-C addition. | G0 (#93) shipped Flow A only — "New theme from template" → a new unpublished row. The riskier half was always going to be its own round. | Replace `config.globalSettings` + `config.header` + `config.footer` + `config.sections` in one `updateConfig` call (one Ctrl+Z), with fresh ids throughout; **preserve only the merchant's uploaded logo / favicon** (`globalSettings.logo.defaultLogoUrl` / `inverseLogoUrl` / `faviconUrl`); a confirm modal with the standalone line *"Your custom CSS will be replaced."* (D3); **re-author all four `templates.ts` literals against everything shipped since G0** (A–F capabilities they were never written to use). Draft-only, one undo entry, no snapshot-pruning special case (D6). |

### 10.3 §6.5 is frozen; §8.13.C is authoritative

Confirmed still correct:

- **§6.5** ("Cross-template capability dependency") carries the STALE banner
  added in the §8.13 structural fix. Its ✅ rows remain accurate as history;
  its open rows are **superseded by §8.13.C**. Do not add rows to §6.5 or use
  it for planning. *(One nit corrected in this close-out: §6.5's post-banner
  prose still said "§8.7 is the current priority recommendation" — §8.7's
  items 6+ are themselves superseded by §8.13.C; the line now points at
  §8.13.C.)*
- **§8.13.C** is the live remaining-work list. It is cross-checked against
  §6.1–6.4 + `templates.ts` directly, never re-derived from §6.5. Items 1–18
  are addressed — built, except item 9 (section separators, skipped
  0/4-concrete) and item 3's magic-line/height-animate half (deferred); 19
  (`icons.style`) is Phase-I-gated; 20 (`customCursor`) is skipped. §10.2 is
  the consolidated view of everything §8.13.C leaves open plus the
  cross-section deferrals.
- Any future stock-take **re-derives from §6.1–6.4 + `templates.ts` + a
  "wired capabilities" read of the code** — never from a summary table. See
  §10.4's last convention.

### 10.4 Conventions this engagement established

These held for every phase A→§8.23 and are the working rules for anyone
picking this up.

1. **Optional key in an existing container.** New capability data is an
   optional key on an interface that already exists (`animations.imageLoad`,
   `hero.settings.parallax`, `typography.pairing`), or a new small category
   *nested under* `globalSettings` (never a new top-level `theme.config` key —
   `assertValidThemeConfig`'s top-level allow-list stays untouched, and
   `deepMergeDefaults` backfills the nested category once it's in
   `DEFAULT_THEME_CONFIG`).

2. **Byte-identical no-op is the non-negotiable default.** A shop that does
   not adopt a template and does not touch the new control must render
   pixel-for-pixel as it did before the PR. Proven per-PR with a parity table
   and, where CSS vars are involved, computed-style assertions. **The trap:
   gating on a *required* boolean that has a non-`false` default** (fly-to-cart
   / `animations.addToCart`) — that flips the feature on for every non-template
   shop on ship. The fix each time was a **new optional field** (`addToCartStyle`)
   with the existing boolean kept as a master switch.

3. **New `globalSettings` categories are always objects, seeded `{}` — never
   bare enums or scalars.** `motion`, `radius`, `density` all ship as
   `{ preset?: … }` / `{ intensity?: … }` objects with `DEFAULT_THEME_CONFIG.
   globalSettings.<cat> = {}`. A bare scalar breaks `updateGlobalSettingsCategory`
   + `deepMergeDefaults`.

4. **Don't write a value identical to unset.** Where a template's intent
   matches today's default (Atelier's `badges.style: 'rectangle'`, `icons.corners:
   'rounded'`, Heritage's card `hoverEffect`, Bloom's `motion` near-baseline),
   the template leaves the key **unset** rather than writing the equal value —
   so "unset" stays the one provable no-op and a later default change doesn't
   silently diverge from templates that pinned the old value.

5. **New per-theme CSS vars get an SPA-leak clear.** Any `--motion-*` /
   `--theme-*` / `--color-drawer*` var written from config must be *removed*
   from `:root` when a theme without it loads (the storefront is a client SPA;
   a theme switch mid-session otherwise leaves stale props). Pattern: a pure
   `resolveXCssVars(config)` + an `applyXCssVars` that sets *and clears*, unit-
   tested with a set-then-unset transition. Imperatively-created DOM (fly-to-cart
   clones on `document.body`) gets the same treatment on provider unmount.

6. **The scratch-shop Playwright pass is mandatory practice, not optional
   polish.** Every phase ended with: create + publish each affected template on
   the seed dev shop, drive the real storefront in headless Chromium, assert
   the new behaviour *and* a no-op control template, confirm zero console
   errors, then delete the scratch themes. It caught real bugs unit tests
   structurally could not — `cloneConfigWithFreshIds` not remapping
   `header.settings.rows[].blockIds` (C), `MobileNav`'s `setPointerCapture`
   killing nested-button clicks (C), the fly-to-cart target marker being on the
   wrong header component (F), Bloom's `cornerRadius: 9999` ellipse bug (post-G0).
   Technique variants that evolved:
   - **scroll-step sampling** for scroll-driven effects (parallax, progress
     bar, decorative blobs) — step `window.scrollTo` in increments, read the
     transform at each.
   - **in-page rAF sampler** for timing-sensitive one-shots (fly-to-cart,
     count-up) — a page-side `requestAnimationFrame` loop recording an
     element's `getBoundingClientRect` every frame for ~1s, asserting the
     trajectory (monotonic approach to the target, DOM removal after), *not* a
     before/after snapshot.
   - **`prefers-reduced-motion` forced** on a second pass so below-the-fold
     scroll-triggered entrances don't read as false blank gaps in screenshots,
     and to assert every JS animation self-gates.
   - a **`.next` wipe + `next dev` restart** before the pass — turbopack's HMR
     repeatedly failed to reprocess `globals.css` after consecutive edits,
     showing stale CSS in dev while every `next build` was correct.

7. **Per-template counts in any summary table drift — re-verify against each
   template's own §6 text before trusting them.** §6.5 was wrong or imprecise
   on 4 of the last 5 items it was consulted for, and was *missing entire rows*
   (`badges.style`, 4/4). §8.7 inherited the error because it was re-derived
   from §6.5. Every stock-take from §8.13 on reads §6.1–6.4 + `templates.ts`
   directly. "2/4 (Market, Bloom)" in a table has twice meant "1/4 concrete,
   1 aspirational" (`product_tabs` magic-line) or "0/4 concrete" (section
   separators) once the templates' actual literals were checked.

### 10.5 If this is picked back up later

The two candidates are **G1 (`applyTemplate` / Flow B)** and **Phase I
(`icons.style`)**. Both were last scoped against a much smaller codebase, so
the first move for either is a re-verification pass, not a build:

- **For G1:** re-read all four `templates.ts` literals against the current
  `ThemeConfig` shape and the full A–§8.23 capability set — they were authored
  for A/B only and every post-G0 batch added keys they don't set. Decide
  per-template which new keys each *should* set (this is the bulk of the work,
  and it needs the same per-template §6-table cross-check from §10.4
  convention 7). Then confirm the builder's `updateConfig` + undo-snapshot
  path can take one full-config replacement in a single entry (D6 assumed 20
  snapshots × ≤ 200 KB; check `MAX_CONFIG_BYTES` hasn't moved), that the
  preview `theme-config-update` channel relays a wholesale config swap
  cleanly, and that `cloneConfigWithFreshIds` covers every id-bearing
  sub-structure added since G0 (the `header.settings.rows[].blockIds` remap
  bug from C is the precedent — new nested id references are the risk).
  Finally, the confirm-modal UX (the standalone "Your custom CSS will be
  replaced." line, D3) and the logo/favicon-preservation carve-out.

- **For Phase I:** first count the real icon call sites — C1/C2 and the §8.x
  batches added header/nav/mobile-nav/floating-button/trust-bar icons, so the
  "~12 SVGs" estimate from §2 is stale. Confirm whether `lib/icon-style.ts`
  (built for `icons.corners` + `icons.stroke`, both stroke-geometry props) can
  carry a fill-based `style` axis at all, or needs a different mechanism
  (swapping the icon component vs. a prop). Then the glyph-list sign-off:
  which icons get a solid variant, which get duotone, which stay line-only —
  and whether Market and Bloom actually differ enough on this axis to justify
  the SVG work, or whether shipping `line`-only (both templates lose one
  differentiator, explicitly called acceptable in §9.4 flag #3) closes it out.

Everything else in §10.2 is genuinely inert — a zero-consumer control or a
reserved enum value — and should be built only alongside a template (or a
merchant request) that needs it.

---

## 11. Template visual-flaws fix round (2026-09-07, `fix/theme-visual-flaws`)

A dedicated fix batch after the four G0 templates were live on the seed shop
and reviewed. Puppeteer/Playwright inspection of the real rendered
storefronts (computed styles + bounding boxes + DOM, desktop + mobile, at
rest / scrolled / `prefers-reduced-motion`, across home / collection / PDP /
cart / account). Not a feature batch.

### 11.1 What shipped

| Item | Root cause | Fix |
|---|---|---|
| **Squeezed scheme-tinted bands** (Atelier manifesto, Market trust strip, Bloom "Pick it…", Heritage "A family business…") | `SectionWrapper` paints `schemeId`'s bg on the full-bleed `<section>` but adds no padding of its own; the child provides only the standard `theme-section-py` (or, for `trust_bar`, ~nothing). | New `--section-band-py` (`:root`, 3.5rem). `SectionWrapper` applies it as `padding-block` on the `<section>` **only when `settings.schemeId` is set** (overridable by `settings.spacing`). `RichTextSection` / `ImageTextSection` / `TrustBarSection` drop their own `theme-section-py` when banded so it doesn't stack. |
| **Rich-text / image-text statement bands not centred** | `RichTextSection` hard-coded `max-w-3xl` + left-aligned, ignoring `settings.contentWidth`; a text-only `image_text` rendered a squeezed left-half column. | `RichTextSection` honours `contentWidth` (`narrow` ⇒ `max-w-2xl` + `text-center`; absent ⇒ today's `max-w-3xl` left). A **banded** `image_text` with no image renders full-width, centred. New admin "Content width" select. |
| **Trust-bar rating badge reads as an accidental wrap** | `TrustBarSection` is `flex-col`: items row, then the rating on its own line — a designed two-tier that looks unintentional. | New `settings.ratingLayout` (`stacked` default = byte-identical, plus a hairline + spacing so the two tiers read as deliberate; `inline` folds the rating into the items' wrap row). New admin "Rating badge layout" select. |
| **Nav menu is the same grey pill on every template** | `MenuBar` hard-coded `rounded-full … text-zinc-600` on every nav link. | New free-form `nav_menu.settings.style` (`pill` default = byte-identical; `pill-solid` / `underline` / `caps` / `bordered`). Non-pill styles follow `--theme-round-*`, colour from `currentColor` (readable on any header row), and the pairing's **heading font**. `lib/nav-menu-style.ts` (pure resolver + test). Templates: Atelier `underline` (Fraunces), Market `bordered` (Inter), Bloom `pill-solid` (Archivo Black), Heritage `caps` (Cormorant). New admin "Link style" select. |
| **Multi-row header spreads icons across the full width** (Market, Heritage) | The `rows` path renders each row's blocks as a flat `justify-*` flex list — no left/center/right zones. `align: 'between'` + 4-5 flat blocks ⇒ edge-to-edge. | New `HeaderRow.align: 'zones'` (all 3 type mirrors). `ThemeDrivenHeader` renders a `zones` row as the classic 3-column grid, placing blocks by `settings.zone` (default left) — same model as the no-rows header. Existing `align` values unchanged (byte-identical). A row with a `background` now also gets `getReadableTextColor(bg)` so logo/nav/icons on a dark band aren't low-contrast. Templates + the `colored-band` preset opt into `zones`. |
| **Heritage green header band renders as a ~36px sliver** | The template (and the shipped `colored-band` preset) put `background` on `rows[0]` = contact bar + social (a thin strip), not `rows[1]` = logo/nav/icons. | Move the band to the main content row in both Heritage's template and `admin/lib/header-footer-presets.ts`'s `colored-band` preset. |
| **Market rose line under the header at rest** | `ScrollProgressBar` paints its `bg-accent` fill unconditionally; on first paint `document.scrollHeight` can be too small, so `y / max` briefly clamps toward 1. | The fill is not rendered at all while `pct <= 0.001` — at rest / first paint there's simply no element. `pointer-events-none` added to the bar. |
| **Bloom horizontal overflow / shapes off the left edge** | `.theme-decorative-blob` was `position: fixed`, which escapes the wrapper's `overflow: hidden`; blobs placed past a viewport edge (`left: -4%`) extended `document.scrollWidth`. | `.theme-decorative-blob` → `position: absolute` (the wrapper is already `fixed inset-0 overflow-hidden`, so blobs stay viewport-anchored **and** get clipped; the scroll-driven `translate3d` is unaffected). |
| **Closed cart drawer causes horizontal overflow** (pre-existing, any `cartLayout: drawer` shop) | The `fixed top-0 right-0 translate-x-full` closed panel's in-flow content sat at x=[viewportW, viewportW+384] and grew `document.scrollWidth`. | Wrap the backdrop + panel in one `fixed inset-0 overflow-hidden pointer-events-none` shell; panel becomes `absolute` within it (identical open position). |
| **"General spacing feels tight"** | Body text pinned at 14px; the `px-4 sm:px-6` gutter never density-scaled. | `DEFAULT_THEME_CONFIG.typography.paragraph.size` 14 → **15** (new themes + all four templates; existing published themes keep their stored 14 — no migration, per the reset-not-migrated convention). New `--gutter-x` / `--gutter-x-lg` density vars + `.theme-gutter-x` class; `px-4 sm:px-6` swapped for it on the 8 standard body-section wrappers. |
| **Oversized `featured_collections` tiles** (all four) | `aspectRatio: square`/`portrait` at 2-4 columns ⇒ 300-850px tall tiles for a "shop by X" nav strip. | `max-h-[360px]` cap on the tile image box (object-cover keeps the crop); templates → `aspectRatio: 'landscape'` (Atelier also `columns` 2 → 3). |
| **Empty-hero dead space** (no banner image) | The configured `height` (up to 560px / 100vh) is a blank band when there's no backdrop. | `HeroSection` falls back to `min-h-[300px]` when `bannerImages` is empty. A hero with a backdrop keeps its configured height. |

Not fixed (flagged as separate concerns): the **AedGlyph** reading as a
bitcoin symbol at card size — it is the intentional `AedGlyph` component, not
a currency bug, but is a real product question independent of theme work; the
**PDP "Add to cart" / "Buy Now" CTAs** are legacy Layout-mode
(`storeButtonClassName` / `shop.buttonFill`), not `globalSettings.buttons` —
a known architectural boundary. The **cart drawer itself was NOT broken** on a
fresh dev server (the "transparent panel" report was stale turbopack CSS —
`storefront/CLAUDE.md` gained a troubleshooting entry + `dev:clean` scripts in
both Next apps).

### 11.2 Second sweep (post-fix) — new flaws found + fixed

1. **Dark text on Heritage's green header row** — moving the band to the main
   row (fixing the sliver) put dark `text-header-fg` logo/nav/icons on
   `#1E3A2F`. Fixed by `getReadableTextColor(row.background)` on the row +
   `currentColor` for the non-pill nav styles.
2. **Closed cart drawer overflow** — surfaced by the same overflow probe that
   caught the decorative blobs (both flagged; the blob was already fixed, the
   drawer was pre-existing). Fixed with the shell wrapper.
3. **`underline` nav style underline misaligned** — `.theme-nav-link--anim::after`
   assumes `px-3`; the first draft used `px-1`. Fixed to `px-3`.

### 11.3 Gate

backend `tsc` + `jest themes` 91/91 + lint +0 (261); storefront `tsc` +
`next build` + `vitest` 572/572 (+`nav-menu-style` 4, +`header-rows` 1;
`density` / `ScrollProgressBar` tests updated) + lint +0 (33); admin `tsc` +
`next build` + `vitest` (1 pre-existing `AccountSetup` parallel-load flake,
passes in isolation) + lint +0 (77). `check-page-width` clean. Puppeteer
re-pass on all four templates across every real route, both viewports, at
rest / scrolled / reduced-motion: every listed flaw gone, zero console
errors, zero horizontal overflow.
