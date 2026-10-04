# N4 storefront polish: notes (drop before merge)

Branch `fix/storefront-polish`, rebased on origin/main b2e6bc7b. Storefront and harness only; no backend, no migration, admin untouched.
Shots in `docs/handoff/n4-shots/` (WebP, each <= 150KB, 390x844 and 1440x900 viewport only; `-before` = origin/main build, `-after` = this branch).
This directory is its own commit (the last one): drop it, or move it to a review branch.

## Harness (committed in tools/responsive-audit/)
- `seed.js`: `AUDIT_TEMPLATE=atelier|market|bloom|heritage` creates and publishes that template, plus brands, a wide image logo, local placeholder images (`AUDIT_IMAGE_BASE`, `AUDIT_UPLOADS_DIR`), `AUDIT_CART_LAYOUT=drawer`.
- `measure.js`: new `clippedPrimary`, `obscuredPrimary`, `overlapping`. `states.js` (focus ring by pixel diff + hover), `open-states.js` (menu, search, bottom bar, cart drawer), `preview.js` (builder preview iframe). README updated.

## Results, storefront routes (27 routes x 5 viewports per template; 360/390/430 are the gate)
Failing route/viewport cells at 360/390/430 (of 81), counting document overflow, offenders, clipped, obscured, overlapping:

| template | before | after |
|---|---|---|
| Atelier | 75 (25 routes) | 0 |
| Market | 0 | 0 |
| Bloom | 75 (25 routes) | 0 |
| Heritage | 75 (25 routes) + 1 document overflow (+6px, /, 360) | 0 |

768 and 1440: 0 before and after, all templates. Zero harness errors.
Offender kinds before: the fixed hamburger (`button.fixed top-3 start-3`) over the logo on every route (Atelier, Bloom, Heritage); Heritage's auto-generated collection nav (`CollectionNav`) laid across the logo and icons in its 99px header cell and illegible (1.6:1) on the dark band; Heritage "View all" overflowing the row at 360.

## Preview iframe (theme builder)
Admin builder with Mobile (390 iframe) and Desktop toggle, and the iframe URL directly at 390 and 1440 for home, a collection and a product, then a double-click selection. Every template, before and after: document overflow 0, offenders 0, clipped 0. The only "obscured" hits are the preview-only floating selection chip ("Logo", "contact_bar_item") sitting on the selected element, by design. Note the before hamburger overlap is only visible in the after-selection measurement of the before run (it mounts after the first measurement); the three route screenshots show it.
The admin builder's iframe always points at the :3304 build (NEXT_PUBLIC_STOREFRONT_URL), so mode A is an after measurement in both runs.

## Fixes (root causes)
1. Hamburger now lives in the header row (`MobileNavTrigger` rendered by `ThemeDrivenHeader`, state shared via `lib/mobile-nav.tsx`), not floated over it.
2. Header zones `grid-cols-3` (equal thirds, logo got 99px of 360) -> `minmax(0,1fr) auto minmax(0,1fr)`; logo image `shrink-0` -> `min-w-0`; inline nav gets `min-w-0` and steps aside under md when the drawer/fullscreen panel carries the links (also honours `showOnMobile`). Legacy TopBar logo-centre grid and logo likewise.
3. `CollectionNav` (the fallback when no menu is configured) gets an `inline` variant and follows the `nav_menu` block style and the header text colour (chevrons were the legacy teal).
4. `MobileNav` and `CartDrawer`: shared `useDialogBehavior` (Escape, focus trap, focus in and back to the trigger, scroll lock with scrollbar compensation), `inert` while closed (they were tabbable while invisible), safe-area padding, `overscroll-contain`; the drawer is portalled to body (it was inside the z-30 header, so the z-40 cookie banner covered "Proceed to checkout"); the menu falls back to top-level collections when none is configured (it was an empty panel); the bottom-bar "Search" tab did nothing and now opens the header search (event); bottom-bar spacer now sits after the footer (the footer's last line was under the bar); bar height includes the home-indicator inset.
5. Search dropdown: pinned 12px inside the viewport under sm (it ran off the left edge at 360), Escape closes.
6. Focus: two-tone `:focus-visible` ring from `--theme-focus-ring` / `--theme-focus-halo` (written with the scheme by `lib/focus-ring.ts`, which guarantees >= 3:1 on any surface: pair contrast >= 9 else black on white); `scroll-padding-bottom` and `body` bottom padding for the cookie banner and bottom nav (a focused footer link was under the banner); quick-add button reachable and visible on keyboard focus (was `display:none` until hover); floating corner buttons stack above the PDP sticky bar (`--sticky-bar-h`, back-to-top was under it).
7. Contrast: `--color-accent-text` (new, `lib/accent-text.ts`): the accent as text, shade of the same hue at >= 4.5:1 on the page. The storefront already used `text-accent-text` in 15 places but the token did not exist, so they rendered nothing; the remaining `text-accent` text uses now use it (Heritage gold on cream was 2.9:1, the checkout Pickup/Delivery selected state 2.56:1). `.theme-btn-border-fill:hover` label colour is `!important` (an inline secondary label colour equal to the accent made "View all" invisible on hover in Market and Bloom).
8. `FeaturedCollectionsSection` and `ProductGridSection` headers wrap (`flex-wrap`).

## Interaction states (states.js, 390 and 1440, home + PDP + checkout with a cart, Tab traversal)
Tab stops across the 4 templates: before 765 stops, 90 with no visible ring, 293 weak (< 3:1), 178 under a fixed bar; after 632 stops, 0 invisible, 1 weak (back-to-top under the PDP sticky bar, fixed afterwards and checked by hand: it is topmost at 581-625px, `--sticky-bar-h` 69px), 7 flagged obscured (Heritage footer `li` is the hit-test target of an inline link: measurement artifact, INFERRED). Hover: 0 layout shifts attributable to hover (Market "Call us" is the `shrink` header compacting when the audit scrolls it into view); hover contrast failures before: Heritage nav pills 1.6:1, Market "View all" 3.87 -> 1.0, checkout toggles 2.56; after: none.
Open states (open-states.js, 390 and 360, per template; menu with and without the cookie banner, search, bottom bar, cart drawer with and without the banner): before 9-21 of 41 checks passed, after all pass (Market has no hamburger: 24 of 24).

| | atelier | market | bloom | heritage |
|---|---|---|---|---|
| before 390 pass/fail | 19/22 | 10/14 | 19/22 | 21/20 |
| before 360 | 18/23 | 9/15 | 18/23 | 14/27 |
| after 390 and 360 | 41/0 | 24/0 | 41/0 | 41/0 |

## Tests
storefront vitest 106 files / 858 tests pass (main before: 100 files / ~834); tsc clean; lint delta +0 (33); build OK; logical-properties check and page-width check pass. New: focus-ring, accent-text, use-publish-height, CollectionNav, quick-add-reveal, MobileNav (+11), CartDrawer (+4), SearchBar (+3), ThemeDrivenHeader (+5), FeaturedCollections (+1), globals.css (+3), fixed-bottom-offset (+3).
Injection-proven (revert the fix, test fails for the stated reason, restore): hamburger in the left zone; zone columns; inline nav hidden under md; MobileNav inert / focus return when the click did not focus; CartDrawer inert / dialog behaviour; SearchBar fixed positioning and Escape; CollectionNav inline; header wrap; quick-add focus reveal; focus ring written with the scheme, ring fallback pair, accent-text wiring and floor; border-fill `!important`; focus-visible rule. Proven by harness measurement only (jsdom cannot see layout): header overlap and zone widths at 360 to 430, bottom-bar spacer after the footer, cart drawer above the cookie banner, body padding under the footer, search dropdown inside the viewport, back-to-top over the PDP bar.

## Not done / observations
- Hero text at 1440 sits at x=24 while the header and the sections below align at 96-120 (a design call on `heroLayout`, not changed).
- States audit "Call us" hover shift and Heritage footer `li` obscured: measurement artifacts, see above.
- A closed `MobileNav` panel and drawer remain mounted (needed for the slide transition) but inert.
- VERIFIED: everything with a measurement above. INFERRED: the behaviour of real iOS Safari (focus on click, safe-area insets; the harness is Chromium with no real inset).
