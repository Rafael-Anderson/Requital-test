# U3 hand-off: storefront empty cart + cookie banner (branch fix/storefront-cart-cookie)

VERIFIED = measured on production builds (backend NODE_ENV=test :3103, storefront :3303, DB rq_u3). INFERRED = reasoned.

## Premise corrections
1. **The empty cart page was NOT missing the shop chrome.** VERIFIED (screenshots `before-cart-*`): announcement bar (when configured), header, menu bar, footer and the mobile bottom nav all render, on a shop with a published theme and on one without, at 390 and 1440. `cart/page.tsx` renders inside `ShopLayoutClient`'s `Body` like every page; the bare look was the page's own content (a left-aligned `<p>` in a 672px column). No layout/theme-state root cause exists to fix. The redesign is the content only.
2. The cookie banner position was already correct (diagnosis.md e). Real defects fixed: full width on desktop, 36px buttons, hardcoded `text-white`/`text-zinc-500`, and (found while measuring) it covered every other fixed bottom element.

## Empty cart
- New `components/EmptyCartState.tsx`, used by `cart/page.tsx`, `checkout/page.tsx` and `CartDrawer.tsx`. Lucide `ShoppingBag` in an accent-tint circle, heading, one line, primary "Continue shopping" using `storeButtonClassName(shop)` (the same chokepoint the cart/PDP/checkout use), href from `shopBasePath || "/"`.
- Page variant adds top-level collections (featured first, max 6, as links) and up to 4 `ProductCard`s from the existing `listCollections` / `listProducts`. No new endpoint. A skeleton with the same footprint shows until both reads settle; nothing is shown if the shop has neither (or the reads fail). Known trade-off: if the shop has nothing to suggest the skeleton collapses and only the footer moves.
- Drawer variant: compact (icon, heading, line, button that closes the drawer), no fetch.
- Checkout's empty branch now uses the same state (wide shell).

## Cookie banner (presentation only; `lib/consent.ts`, choice logic and copy untouched)
- Under `sm` (640px): full-width bottom sheet, its own background runs under the home indicator (`env(safe-area-inset-bottom)`). From `sm`: card, `max-w-[720px]`, centred, `p-4` margin, `rounded-2xl`. 640 is the phone/tablet line the PDP sticky bar already uses; below it a margin would cost too much width, above it a 720px card has room.
- Both buttons `min-h-11`; colours are tokens (`bg-header text-header-fg border-stroke`, accept = `bg-accent text-accent-foreground`).
- Publishes `--cookie-banner-h` on `:root` (whole fixed box: card + margin + safe-area, via ResizeObserver) and removes it on choice/unmount. Never renders, and never sets it, when a choice is stored.
- Fixed bottom inventory (grep of `fixed` / `bottom-` across `app/` and `components/`):
  | element | handling |
  |---|---|
  | WhatsApp float | offset `+ var(--cookie-banner-h)` |
  | FloatingCustomButtons | offset |
  | BackToTopButton | offset |
  | MobileNav `bottom-bar` | offset (sits above the banner) |
  | PDP sticky add-to-cart bar | offset |
  | CartDrawer, MobileNav drawer/fullscreen, ProductGallery lightbox, AddonPrompt, DeleteAccountModal | exempt: full-viewport modals above the banner (z-50), not bottom-pinned |
  | MenuBar mega panel, PreviewInteraction/SectionWrapper preview overlays, fly-to-cart clone | exempt: transient / preview-only / positioned from a trigger |
  | ScrollProgressBar, DecorativeParallax, MobileNav burger | top or non-interactive layer, cannot meet a bottom banner |
  | AnnouncementBar | in the header at the top; cannot overlap a bottom banner |
- **Extra pre-existing bug found and fixed:** with `mobileNav: 'bottom-bar'`, the WhatsApp float and back-to-top (bottom-5) sat on top of the 56px nav (VERIFIED at 360/390/430, overlaps `Mobile navigation|Chat with us on WhatsApp` and `|Back to top`, with no banner), and the PDP sticky bar covered the nav. `MobileNav` now sets `data-bottom-nav` on `:root` while mounted and `globals.css` publishes `--bottom-nav-h: 3.5rem` below md only; the floats and PDP bar add it to their offset.
- Guard: `components/fixed-bottom-offset.test.ts` fails if any `fixed ... bottom-` line lacks `--cookie-banner-h`.

## Overlap measurement (VERIFIED, `full` shop = WhatsApp + 2 custom buttons + back-to-top + bottom-bar nav + announcement bar; home and PDP scrolled; fixed boxes pairwise)
| | 360 | 390 | 430 | 768 | 1440 |
|---|---|---|---|---|---|
| before this change, banner showing | not run on old build; the old banner was `fixed bottom-0 z-40` and the floats at bottom-5/24, so geometrically covered | | | | |
| after, banner showing | 0 overlaps | 0 | 0 | 0 | 0 |
| after, no banner | 0 | 0 | 0 | 0 | 0 |
Before this change (no banner) the nav/WhatsApp/back-to-top overlaps listed above existed at 360/390/430 (2 pairs each, home and PDP). PDP sticky bar measured separately at 390x600 scrolled to bottom: bar 345-414, nav 414-470, banner 470-600, stacked with no overlap; without banner 475-544 / 544-600.

## Overflow at 360/390/430
- Coordinator's BEFORE baseline: 1 storefront route overflowing, `/[shop]/bio`, +16px at all three widths (`div.rounded-2xl.-mx-4.sm:mx-0`, a leftover negative margin from when `<main>` had a gutter).
- Fix: `bio/page.tsx` wrapper `rounded-2xl -mx-4 sm:mx-0` becomes `sm:rounded-2xl` (no negative margin; the inner `max-w-md px-4` already supplies the gutter). Root cause, not a clip.
- AFTER (`tools/responsive-audit/out/u3-after`, `--apps storefront`, 25 routes x 360/390/430): **0 routes failing, 0 offenders**. Extra: 72 page/viewport combos (home, cart, checkout, bio, collection, PDP, login, track) on the three themed fixture shops incl. all floats and the drawer layout, scrolled, banner showing: `scrollWidth <= clientWidth` on all.
- The two `-mx-4 px-4 overflow-x-auto` carousels (CollectionShowcase, FeaturedCollections) are their own scroll containers and are not flagged.

## Tests
storefront vitest 99 files / 802 tests pass (new: EmptyCartState 9, cart page 1, CartDrawer +1, CookieConsentBanner +5, WhatsApp 1, MobileNav +2, fixed-bottom guard 1). `tsc --noEmit` clean, lint delta +0 (33), `npm run build` ok, logical-properties `--check` 0 swaps, check-page-width and check-form-width clean.
Injection proofs (revert, see fail, restore): remove `removeProperty` -> 2 banner tests fail ("expected '130px' to be ''"); `min-h-11` -> `h-9` fails the 44px test; BackToTop without offset fails the guard; WhatsApp without offset fails its test; hardcoded CTA href fails the CTA test; no `data-bottom-nav` fails the MobileNav test. NOT injection-proven: the bio overflow fix (CSS-only, not observable in jsdom; proven by the harness: before +16px on 3 widths, after 0).

## Screenshots (`docs/handoff/u3-shots/`, WebP, viewport only)
`before-|after-` x `cart-plain|cart-themed|drawer|banner-top|banner-scrolled` x `390|1440`, plus `after-banner-all-floats-{390,1440}`. Product images are blocked placeholders (offline), so cards show grey boxes.

## Not done / inferred
- INFERRED: `env(safe-area-inset-bottom)` renders 0 in headless Chrome, so the inset itself was not measured on a notched device.
- Banner is not accounted for in page bottom padding (it is dismissible and click-through around the card); the last footer line is under the sheet on phones until a choice is made.
