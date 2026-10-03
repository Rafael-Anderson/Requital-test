# UI batch, Phase 0.3 diagnosis (main `ecbd161d`, 2026-10-03)

Measured with `tools/responsive-audit/` (`diagnose.js`, `diagnose2.js`) against production builds of
main and a NODE_ENV=test backend on a freshly seeded shop (advanced editor mode). Screenshots:
`tools/responsive-audit/out/diagnosis-before/` on the coordinator's machine, not committed.
VERIFIED = measured; INFERRED = reasoned, not reproduced.

## Harness corrections found while building it (read these first)

1. **`window.innerWidth` lies on an overflowing mobile page.** On the admin dashboard at 390 wide,
   `innerWidth` read 554 while `documentElement.clientWidth` stayed 390. Chrome zooms the visual
   viewport out to fit the content. Always compare `scrollWidth` with `clientWidth`.
2. **The backend default throttle (100 req/min per IP) answers the pages themselves with 429** under a
   crawl, so a harness against a normal backend measures error states. Run the harness backend with
   `NODE_ENV=test`.
3. **A touch-swipe test needs a control.** `Input.synthesizeScrollGesture` did not move even a plain
   `overflow-x:auto` div; `Input.dispatchTouchEvent` does. Always include a known-scrollable control.
4. **The simple/advanced editor mode changes the UI.** A new shop is `simple`: the dashboard has no
   branch/date filter row. The symptoms below are from `advanced`.

## a. The dark bands at the sides of screenshots

VERIFIED: the page does not draw them. At 390x844 and 1440x900, in both light and OS-dark colour
scheme, on admin dashboard and settings and storefront home and cart: `documentElement.scrollWidth`
equals the viewport width, so there is no area beside the page. Mean colour of the 6px strips at the
left and right edges of the viewport screenshots: admin `#fafaf1` / `#f7f8f6`, storefront
`#f6fbfb` / `#ffffff` / `#f0f8f8`: all light, identical to the centre. `html` background is
transparent (canvas white), `body` is `rgb(247,248,248)` (admin) and `#fff` (storefront),
`color-scheme: normal`. OS dark mode changes nothing (admin `dark:` is class based, the storefront has no
`dark:` classes). The only large dark region in our own CSS is the storefront footer band (`#18181b`),
which spans the full width. INFERRED: the bands come from the capture or the viewer (a 390px image
letterboxed on a wider dark canvas, or a screenshot of the zoomed-out visual viewport of an overflowing
page, see b). If you see them in a Playwright viewport screenshot we produce, send the file.

## b. Admin dashboard at 390: header stops partway

VERIFIED (advanced mode): `documentElement.scrollWidth` 554 vs `clientWidth` 390 (innerWidth 554). The
header (`TopBar`, a plain `div`) is 390 wide, so on a real phone, where Chrome and Safari zoom out to fit
the overflowing content, it covers 70% of the screen with empty space beside it. The widest element is
`div.flex.items-center.gap-2.5` (506px wide, right edge 554, `min-width: auto`) inside
`BranchBar`'s `right` slot, a `div.mb-5.flex.items-center.justify-between.gap-3.flex-wrap`
that is only 294px wide. Contents: `admin/components/ui/DateRangePicker.tsx` (two 143px date inputs and a
"to") next to the branch select; the inputs have a fixed intrinsic width and nothing lets the group wrap
or shrink (no `min-w-0`, no `flex-wrap`). Contributing cause: `AppChrome`'s
`<main class="mx-auto max-w-[1600px] px-12 pt-7 pb-16">` keeps 48px side padding at every width, so a
390px phone gets a 294px content column. Reports uses `ReportsFilterBar` (same two date inputs).

## c. Settings content blank at 1440

VERIFIED: a capture-timing symptom caused by a real layout gap, not a CSS bug. With the API answering in
about 1.2s (a normal remote API): `/settings/business/information` rendered nothing at all (0 characters,
no sidebar) until `/auth/me` resolved, because `settings/layout.tsx` returns `null` until the user is
known to be an admin. Then the sidebar appeared with a content column of 357 characters (the heading
only) until `GET /shop` answered at about 3.5s: that page has no loading skeleton, so the column is
blank. `tax-classes` showed 12 skeletons, so skeletons exist on some pages and not others. On the local
API (about 20ms) the same page is complete after 400ms, which is why a fast capture shows it filled.

## d. Orders at 390: do the tab row and kanban scroll sideways?

VERIFIED YES for both, with a control. Real touch drag (`Input.dispatchTouchEvent`, `hasTouch`,
`isMobile`), `scrollLeft` before then after: control strip 0 to 311; `OrdersTabs` row
(`div.flex.gap-7.overflow-x-auto`, scrollWidth 721, clientWidth 294) 0 to 317; kanban
(`div.flex.gap-4.overflow-x-auto.pb-2`, scrollWidth 1072, clientWidth 294) 0 to 302. The document does
not overflow on this page (390 vs 390). The defects are discoverability and size: no edge fade or
shadow, the active tab is not scrolled into view, the cut "Draft Orde" label gives no hint it scrolls, and
the 256px columns in a 294px container leave a 38px peek. The 294px comes from `px-12` (b).

## e. Storefront cookie banner

VERIFIED: the real banner is correct about its position. `position: fixed; inset-x: 0; bottom: 0`:
at 390x844 it is `top 731, bottom 844, bottomGap 0`; at 1440x900 `top 839, bottom 900, bottomGap 0`, at scroll
0 and at scroll 600/700, home and product page. A Playwright `fullPage` capture places it at y=731 of a
1476px page (image `e2-pdp-390-y0-FULLPAGE.png`, banner in the middle): a full-page capture resizes the
viewport and keeps a fixed element at its viewport offset, so a fixed bottom bar lands mid-page. Not a
product bug; the viewport screenshots are correct. Real, smaller defects: it is full width on desktop
(1440px, no card), its buttons are 36px tall (below 44px), and `bg-header` with `text-zinc-500` copy. No
other fixed element existed in this seed (no WhatsApp float, no announcement bar, no sticky add-to-cart
bar on this theme), so overlap with them is UNVERIFIED: U3 must test with each enabled.

## f. Viewport meta

VERIFIED correct on both apps: `<meta name="viewport" content="width=device-width, initial-scale=1"/>`
(Next default; neither layout overrides it).
