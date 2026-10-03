# U2 handoff: admin lists (branch `fix/admin-lists-responsive`)

Measured with `tools/responsive-audit/` on production builds (admin :3202, NODE_ENV=test backend :3102, fresh seeded DB),
admin only, 360/390/430. VERIFIED = measured here; INFERRED = reasoned.

## What changed

- `components/ui/ScrollFade.tsx` (new, minimal API: `className`, `activeSelector`, `stickyFirst`): a horizontal scroller with a
  mask edge fade on each side that still has hidden content (`.scroll-fade` in globals.css, data attributes written straight to
  the DOM, no React state, RTL-aware). U1 may create a file of the same name: keep either side on conflict, the API above is the contract.
- `Table` (used by every list page) is now a `ScrollFade`, so every table that scrolls sideways says so. `stickyFirst` pins the first
  column with a shadow once scrolled; applied to 22 tables whose first column is the row identity (reports, inventory, discounts,
  gift cards, templates, affiliate, abandoned carts, branch status, newsletter, activity log, external delivery).
- `Tabs` (every sub-nav in the admin) is a `ScrollFade` that centres the active tab (`aria-current="page"` added).
- Orders kanban: snap-x mandatory below sm, columns 85% of the board (so the next column peeks regardless of the shell padding), fade.
- `components/ui/CardList.tsx` (new): phone card list (below md) used by FOUR pages: Products, Customers, Order History, Draft orders
  (the table is `hidden md:block`, the cards `md:hidden`). Whole card is the tap target (stretched link or button), selection
  checkbox and actions sit above it, select-all row, skeleton that mirrors the card.
- Products: toolbar wraps (primary "New product" rides on the title row below sm), cards with thumbnail, name, price, stock,
  status chip (toggles), kebab menu (adjust, transfer, duplicate, delete), SKU and total sales secondary; Customers gets a sort control
  in place of the sortable headers.
- Inventory toolbar group wraps (`flex-wrap`).
- `EmptyState` and the new `LoadFailed` size themselves to the scroller's visible width (`--sf-w`), so an empty table's message
  is no longer centred on the whole scrollable width (off screen on a phone).
- Stuck-loading fix (below) on Products, Order History, Customers, Draft orders and the draft order detail page.
- Harness: `tools/responsive-audit/swipe-check.js` (touch swipe over a selector list with an injected control; exit 2 when the control
  does not scroll, 1 when a region does not move) and `repro-products-loading.js`; README updated.
- `admin/lint-baseline.txt` 88 to 87 (the Products fetch effect no longer is an async setState shape): delta +0 against the new value.

## Products "stuck loading": REAL, but not for a healthy API

`repro-products-loading.js`, one-product shop (before = main `e8d3e821`, after = this branch):

| scenario (API) | before | after |
|---|---|---|
| healthy | product shown | product shown |
| `/collections` 12s slow | skeleton 12s then product | product immediately |
| `/collections` 500 | skeleton forever (65 pulse nodes at t=18s), error text "boom" | product shown |
| `/products` 500 | skeleton forever | "Could not load products." + Try again, no skeleton |
| `/products` 8s slow | skeleton 8s, then product | same (a real wait), card skeleton |

Cause (`admin/app/products/page.tsx`, before: `refresh` used `Promise.all([listProducts, listCollections])`, `products` only set after both
resolved, and the table rendered `visibleProducts === null` as a skeleton regardless of `error`). So: a one-product shop is NOT broken
on a healthy API (cannot reproduce that); any failure of EITHER request leaves the skeleton up forever, and a slow `/collections`
holds the table back. Fix: independent promise chains, stale-response guard (`latest` ref), `LoadFailed` with retry when `products` is null and `error` is set.
Same pattern fixed in Order History, Customers, Draft orders (list) and Draft order detail (a 404 there sat on a skeleton forever; the
harness's `loading?` for `/orders/draft-orders/[id]` is a fixture mismatch, it passes an ORDER id to a DRAFT route, which is exactly this path).
INFERRED (not fixed, not in my area): the same `x === null ? skeleton` shape exists on other list pages (grep `=== null ? (` with a Skeleton).

## Harness, before and after (u2-before / u2-after, admin, 85 routes x 3 viewports, `--no-shots`)

Document overflow (`scrollWidth - clientWidth`, px) at 360 / 390 / 430:

| route | before | after |
|---|---|---|
| /inventory | 115 / 86 / 45 | 0 / 0 / 0 |
| /products | 63 / 33 / 0 | 0 / 0 / 0 |
| /dashboard | 194 / 164 / 124 | 194 / 164 / 124 (U1: BranchBar + DateRangePicker) |
| /orders/external-delivery | 46 / 16 / 0 | 46 / 16 / 0 (U1: ReportsFilterBar) |
| /reports, /reports/attribution, /external-delivery, /margin, /prep-time, /product-sales | 46 / 16 / 0 each | unchanged (U1: ReportsFilterBar) |

Routes with document overflow: 22 before, 17 after (route x viewport pairs). The 17 remaining are all the ReportsFilterBar / DateRangePicker
group (U1's files); re-measure after rebasing on U1. No `overflow-x: hidden` on html/body anywhere.

Corrections to the coordinator's list: "clipped" at /products (12), /affiliate/codes (2), /reports/external-delivery (2) are `svg` internals
(`clippedBy: "svg"`: icon paths inside table cells that sit right of the viewport inside the horizontal scroller), not content cut off.
Orders, Order History, Customers had no document overflow: the work there was affordance and cards.

## Swipe (VERIFIED, `swipe-check.js`, 390x844 touch, control scrolled 0 to 302)

- Orders tab row: scrollWidth 721 / clientWidth 294, scrollLeft 0 to 318.
- Orders kanban: scrollWidth 1048 / clientWidth 294, 0 to 530 (two columns, snapped to column starts).
- Products tab row: 530 / 294, 0 to 236.
Active tab is centred on load (`after-orders-history-390.webp`). Container width 294 is still the `px-12` shell (U1); the kanban
columns are 85% of whatever the container is.

## Tests

New: `ScrollFade.test.tsx` (9), `CardList.test.tsx` (5), `products/page.test.tsx` (7: skeleton mirrors cards, one-product shop, tap to open,
selection and select-all, status chip without opening, loading not tied to collections, error + retry), draft detail (2), kanban snap/peek
(1), Tabs (2); customers test updated (each row is in the DOM twice in jsdom: card and table).
Injection proofs (revert, see fail, restore): Products `Promise.all` refresh back in (3 fail: collections fail, collections never
answers, products fail); `hasEndHidden=false` in ScrollFade (4 fail); card link removed (CardList + Products tap test fail);
`basis-[85%]` removed from the kanban column (1 fail); draft detail skeleton-on-error back (1 fail).
admin: `tsc --noEmit` clean, vitest 110 files / 738 tests pass, `next build` ok, lint baseline +0 (87), logical-properties check 0 swaps,
check-page-width and check-form-width clean.

## Not done / limits

- INFERRED only: RTL fade swap (`fadeEdges` unit-tested, never run in an RTL browser); the sticky-first-column shadow is physical (`6px 0`).
- Tables not converted to cards (Inventory ingredients, discounts, gift cards, templates, suppliers, POs, reports, users...) scroll inside
  their container with fade, sticky first column where useful; wide ones need a horizontal swipe to reach trailing columns/actions.
- Kanban column width is relative to the container, so the "about 85vw" figure only holds once U1 shrinks the shell padding.

## UPDATE after rebasing on main 50cfdcf0 (U1, U3, U4 merged)

- ScrollFade conflict (add/add): ONE component now, `className, startFade (default true), activeSelector, stickyFirst`. Base is the mask +
  data-attribute implementation; `startFade={false}` (and `stickyFirst`) set `data-no-start-fade`, and `.scroll-fade[data-fade-lo="1"]:not([data-no-start-fade])`
  is the only rule that paints the start fade, so a sticky start column is never blurred. U1's three call sites (settings layout, outlet editor, outlets Branches table) are unchanged.
  U1's tests are ported into ScrollFade.test.tsx (end fade only while hidden, negative scrollLeft RTL, content fits, startFade=false), none dropped.
  Difference from U1's version: the fade is a CSS mask on the scroller (no overlay spans, no `relative` wrapper, no React state), so `[data-fade]` spans no longer exist.
- reports/attribution/page.tsx: auto-merged, both intents kept (U1's date row wrap, my `stickyFirst` table).
- Settings containment re-run (VERIFIED, touch, 360/390/430, /settings/business/information, tax-classes, fulfilment/delivery, outlets, outlets/ID/edit):
  document overflow 0, scroller 501 wide in 328/358/398, sidebar offset 0 before and after a swipe, end fade on at rest (`data-fade-hi=1`), start fade suppressed
  (`data-no-start-fade=1`), swipe moves the pair (scrollLeft 173/143/103) and the end fade turns off at the end. The Branches table swipes 0 to 302 with its own fade.
- Harness, whole admin app (86 routes x 360/390/430, u2-after2 vs u2-before): routes failing 0 of 86; document overflow pairs 22 before, 0 after;
  no offenders, no loading time-outs. Per route px (360/390/430) before to after: /dashboard 194/164/124 to 0; /inventory 115/86/45 to 0; /products 63/33/0 to 0;
  /orders/external-delivery, /reports, /reports/attribution, /reports/external-delivery, /reports/margin, /reports/prep-time, /reports/product-sales 46/16/0 to 0.
  Every other admin route was 0 before and after.
- Tests: admin vitest 114 files / 754 tests pass, tsc clean, `next build` ok, lint baseline +0 (87, lowering from 88 kept), logical-properties 0 swaps, check-page-width and check-form-width clean.
- Swipe (VERIFIED, shell now 358 wide at 390): Orders tab row 721/358, 0 to 308; kanban 1265/358, 0 to 635; Products tab row 530/358, 0 to 172.
  After-screenshots re-taken on the merged build.
