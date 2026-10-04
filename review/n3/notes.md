# N3: admin lists on a phone, stuck skeletons, pinned top bar

Branch `fix/admin-lists-mobile-completeness`. Admin only (no backend, storefront or migration change). Notes for the coordinator; delete before merge.

## 1. Measurement and verdicts

Method (`tools/responsive-audit/lists-reach.js`, new, plus `seed-lists.js` which fills every list with rows): at 360 and 390 (touch, `isMobile`), for every list page it records which column headers and row controls are inside the viewport at rest, then proves reachability two ways: a REAL touch swipe on the page's sideways scroller (control element first, the rule in `swipe-check.js`) and a scroll-into-view of every header and last-cell control through its own scrollers (innermost first, then the settings columns' outer scroller). The same script ran on the base build (c30da2c1, port 3213) and on this branch (3203), same fixture shop. Verdict rule: a row action outside the viewport at rest is swipe-dependent (reachable only after discovering a swipe), so an entity list with a primary action became a card list; a read-only numeric table keeps a `ScrollFade` with sticky first column.

Totals over all list pages (row actions outside the viewport at rest; everything is reachable by scrolling in both runs):

```
390x844 before {"pages":44,"actOff":18,"unreach":0,"over":0,"swipeNo":3} after {"pages":44,"actOff":0,"unreach":0,"over":0,"swipeNo":3}
360x780 before {"pages":44,"actOff":19,"unreach":0,"over":0,"swipeNo":3} after {"pages":44,"actOff":0,"unreach":0,"over":0,"swipeNo":3}
```

Every page at 390, base vs this branch (`NtMc` = visible tables / cards, `colsOff` = headers outside the viewport at rest, `actOff` = last-cell action controls outside the viewport at rest, `cardCtlOff` = card controls outside the viewport; the last column is items not reachable even by scrolling, 0 everywhere in both runs). The 360 table is in `tools/responsive-audit/out/lists-*/lists.md` (same picture: 19 off-screen actions before, 0 after).

| route | before | after | unreachable after scroll (b/a) |
|---|---|---|---|
| /inventory | 1t/0c rows=3 colsOff=4/8 actOff=1/1 | 0t/3c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/2 | 0/0 |
| /inventory/categories | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0/0 |
| /inventory/movements | 1t/0c rows=10 colsOff=4/7 actOff=0/0 | 1t/0c rows=10 colsOff=4/7 actOff=0/0 | 0/0 |
| /inventory/suppliers | 1t/0c rows=2 colsOff=4/7 actOff=3/3 | 0t/2c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/2 | 0/0 |
| /inventory/purchase-orders | 1t/0c rows=2 colsOff=3/7 actOff=0/0 | 0t/2c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/1 | 0/0 |
| /inventory/suppliers/11 | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | - | 0/0 |
| /inventory/purchase-orders/11 | 1t/0c rows=2 colsOff=2/6 actOff=0/0 | - | 0/0 |
| /products | 0t/6c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/4 | 0t/6c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/4 | 0/0 |
| /products/brands | 1t/0c rows=2 colsOff=0/3 actOff=0/2 | 1t/0c rows=2 colsOff=0/3 actOff=0/2 | 0/0 |
| /products/categories | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0/0 |
| /products/discounts | 1t/0c rows=2 colsOff=5/8 actOff=1/1 | 0t/2c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/3 | 0/0 |
| /products/gift-cards | 1t/0c rows=2 colsOff=2/6 actOff=1/1 | 0t/2c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/1 | 0/0 |
| /products/templates | 1t/0c rows=2 colsOff=2/6 actOff=1/1 | 0t/2c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/2 | 0/0 |
| /orders/history | 0t/4c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/2 | 0t/4c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/2 | 0/0 |
| /orders/draft-orders | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0/0 |
| /orders/abandoned-carts | 1t/0c rows=2 colsOff=2/5 actOff=0/0 | 1t/0c rows=2 colsOff=2/5 actOff=0/0 | 0/0 |
| /orders/branch-status | 1t/0c rows=1 colsOff=1/5 actOff=0/1 | 0t/1c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/2 | 0/0 |
| /orders/external-delivery | 1t/0c rows=1 colsOff=3/7 actOff=0/0 | 0t/1c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/1 | 0/0 |
| /customers | 0t/4c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/2 | 0t/4c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/2 | 0/0 |
| /customers/newsletter | 1t/0c rows=3 colsOff=2/3 actOff=0/0 | 1t/0c rows=3 colsOff=2/3 actOff=0/0 | 0/0 |
| /customers/reviews | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0/0 |
| /affiliate | 1t/0c rows=2 colsOff=3/7 actOff=1/1 | 0t/2c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/1 | 0/0 |
| /affiliate/codes | 1t/0c rows=2 colsOff=5/9 actOff=1/1 | 0t/2c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=0/2 | 0/0 |
| /affiliate/orders | 1t/0c rows=0 colsOff=2/6 actOff=0/0 | 1t/0c rows=0 colsOff=2/6 actOff=0/0 | 0/0 |
| /bio-links | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0/0 |
| /activity-log | 1t/0c rows=15 colsOff=3/5 actOff=0/0 | 1t/0c rows=15 colsOff=3/5 actOff=0/0 | 0/0 |
| /settings/users | 2t/0c rows=3 colsOff=6/9 actOff=2/2 | 1t/3c rows=0 colsOff=2/4 actOff=0/0 cardCtlOff=2/2 | 0/0 |
| /settings/outlets | 1t/0c rows=1 colsOff=6/7 actOff=1/1 | 0t/1c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=2/2 | 0/0 |
| /settings/business/tax-classes | 1t/0c rows=3 colsOff=3/4 actOff=2/2 | 0t/3c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=2/2 | 0/0 |
| /settings/business/custom-fields | 1t/0c rows=1 colsOff=4/5 actOff=2/2 | 0t/1c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=2/2 | 0/0 |
| /settings/storefront/redirects | 1t/0c rows=1 colsOff=4/6 actOff=2/2 | 0t/1c rows=0 colsOff=0/0 actOff=0/0 cardCtlOff=3/3 | 0/0 |
| /settings/diagnostics | 2t/0c rows=0 colsOff=6/10 actOff=0/0 | 2t/0c rows=0 colsOff=6/10 actOff=0/0 | 0/0 |
| /settings/security | 1t/0c rows=4 colsOff=3/5 actOff=0/0 | 1t/0c rows=4 colsOff=3/5 actOff=0/0 | 0/0 |
| /integrations/webhooks | 1t/0c rows=0 colsOff=0/4 actOff=0/0 | 1t/0c rows=0 colsOff=0/4 actOff=0/0 | 0/0 |
| /reports | 1t/0c rows=4 colsOff=5/9 actOff=0/0 | 1t/0c rows=4 colsOff=5/9 actOff=0/0 | 0/0 |
| /reports/monthly | 1t/0c rows=4 colsOff=5/9 actOff=0/0 | 1t/0c rows=4 colsOff=5/9 actOff=0/0 | 0/0 |
| /reports/product-sales | 1t/0c rows=4 colsOff=2/6 actOff=0/0 | 1t/0c rows=4 colsOff=2/6 actOff=0/0 | 0/0 |
| /reports/inventory | 1t/0c rows=6 colsOff=2/6 actOff=0/0 | 1t/0c rows=6 colsOff=2/6 actOff=0/0 | 0/0 |
| /reports/margin | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0/0 |
| /reports/prep-time | 1t/0c rows=0 colsOff=3/8 actOff=0/0 | 1t/0c rows=0 colsOff=3/8 actOff=0/0 | 0/0 |
| /reports/attribution | 1t/0c rows=1 colsOff=1/5 actOff=0/0 | 1t/0c rows=1 colsOff=1/5 actOff=0/0 | 0/0 |
| /reports/external-delivery | 1t/0c rows=1 colsOff=5/9 actOff=0/0 | 1t/0c rows=1 colsOff=5/9 actOff=0/0 | 0/0 |
| /orders | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0/0 |
| /dashboard | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0t/0c rows=0 colsOff=0/0 actOff=0/0 | 0/0 |

Per page decisions:

| page | columns | primary actions | verdict (390) | action |
|---|---|---|---|---|
| Inventory > Ingredients | name, category, unit, stock, 4 icon actions | edit, adjust, transfer, delete | actions off screen | CardList (thumbnail, stock with low flag, menu with all four, tap edits) |
| Ingredient categories | name, actions | edit, delete | fits (2 columns) | unchanged |
| Movement history | 7 | none | read-only, 4 columns off, swipe ok | kept `ScrollFade` + sticky first |
| Suppliers | 7 | open, edit, archive, delete | 3 actions off | CardList (tap opens, menu keeps edit, archive or restore, delete) |
| Supplier detail items | 6 | edit, remove | raw `overflow-x-auto` without affordance | CardList below md, `ScrollFade` sticky on md+ |
| Purchase orders list | 7 | open | open link only in the sticky column | CardList (number, supplier, outlet, status, total, received) |
| Purchase order detail lines | 6 | none | raw scroller, no affordance, swipe failed at 360 | `ScrollFade` + sticky first |
| Products, Order history, Customers, Draft orders | | | already CardList (previous batch) | unchanged |
| Brands | 3 | edit, delete | fits | unchanged |
| Collections | tree list | edit, delete | fits | unchanged |
| Discounts | 8 | toggle active, edit, delete | action off | CardList (active chip, menu) |
| Gift cards | 6 | enable or disable | action off | CardList |
| Templates | 6 | edit, delete | action off | CardList |
| Abandoned carts | 5 | none | read-only | kept `ScrollFade` + sticky first |
| Branch status | 5 | two toggles | toggles off at 360 | CardList with both labelled toggles |
| External delivery | 7 | open order, track | row click, columns off | CardList (tap opens the order, Track link kept) |
| Newsletter, Reviews | 3 / cards | none | read-only / already cards | unchanged |
| Affiliates, Codes, Orders | 7 / 9 / 6 | edit, copy link, approve, block | actions off | CardList each (approve and block stay buttons on the card) |
| Bio links | row list | toggle, edit, delete | fits. FINDING: reorder is HTML5 drag and drop, which does nothing on touch | unchanged, follow-up (up and down buttons) |
| Activity log | 5 | none | read-only | kept `ScrollFade` + sticky first |
| Settings > Users (accounts, branch roles, assignments) | 5 / list / 4 | edit, reset 2FA, delete, unassign | actions off | accounts and assignments CardList; roles already a list |
| Settings > Outlets, Tax classes, Custom fields, Redirects (redirects and 404 report) | 7 / 4 / 5 / 6 / 5 | edit, delete, toggle | actions off | CardList each. In Settings the card sits in the two-column region (content min 340px, 245px visible at 390), so its right-hand menu needs the region's sideways swipe; measured reachable |
| Diagnostics (webhooks, failed jobs), Security sessions, Integrations > Webhooks | 4 to 6 | retry, dismiss, revoke | read-mostly | kept `ScrollFade`; session revoke is swipe-reachable (not converted) |
| Reports (general, monthly, product sales, inventory, margin, prep time, attribution, external delivery) | 5 to 9 numeric | none | numeric tables | kept `ScrollFade` + sticky first (swipe ok) |
| Orders kanban, Dashboard | not tables | | | untouched; swipe regression check in section 5 |
| Credit notes | not a page: a list inside Order > Invoice tab | issue, preview | INFERRED fits (plain list, no table); not measured, no credit note in the fixture | unchanged |
| Platform admin | out of scope | | | |

The swipe check reports "NO" for three empty-state tables (affiliate orders, diagnostics, prep time): the fixture has no data row to swipe there; their headers are covered by the programmatic reach check (0 unreachable).

## 2. What was converted

CardList added to: ingredients, suppliers, supplier items, purchase orders, discounts, gift cards, templates, branch status, external delivery, affiliates, affiliate codes, affiliate orders, users (accounts, assignments), outlets, tax classes, custom fields, redirects (both tabs). Shared piece, no parallel primitive: `ui/CardList.tsx` gained `CardRowMenu` (the Products overflow menu as a component; items take an icon and `danger`). Tables stay for md and up (`hidden md:block` only once rows exist, so skeleton, error and empty states render once at every width). Selection checkboxes and bulk actions exist only on Products, Customers and Order history (unchanged).

## 3. Stuck-skeleton shape: every page found and its status

Found by grepping `Promise.all`, `=== null ? skeleton`, `!x ? Skeleton`, `getX().then(setX)` without a catch and `if (!loaded)` in `admin/app` and `admin/components`, then confirmed by a test that makes EVERY read reject (`app/load-failure.test.tsx`, 68 cases). Each fixed page ends in `LoadFailed` with Try again; Promise.all gates became independent chains with a stale-response guard (`latest` ref or `live` flag).

Independent chains (were Promise.all or one shared gate): affiliates (summary + list), discounts (discounts + products + collections), settings users (outlets + users, plus roles and assignments each), redirects (list + 404 report, separate errors), messaging (shop + credentials), margin report (summary + breakdown), general and monthly reports (summary + orders), dashboard (summary + daily + top products; it was one Promise.all and a whole-page error with no retry), simple dashboard (summary + top product), theme site settings (shop + theme), outlet delivery areas (zones + proposal), purchase-order line picker (ingredients + products), bio links (config card + list).

Gate fixed (a table or card skeleton stayed forever when the request failed): activity log, affiliate codes and orders, newsletter, reviews, customer detail, ingredients, ingredient categories, movement history, purchase orders, suppliers, supplier detail, purchase order detail, order detail, orders kanban, abandoned carts, branch status, external deliveries, edit product, brands, collections, gift cards, templates, edit template, tax classes, custom fields, outlets list, edit outlet, reports (inventory, product sales, prep time, attribution, external delivery), settings pages that returned `<SettingsContentSkeleton />` (information, online presence, policy pages, SEO, store configuration, money and tax, display, delivery, pickup, domain), integrations (delivery, analytics, payments), theme (overview, layout, colors), failed jobs and webhook panels, active sessions card, order and simple order detail modals, today card, outlet QR tab. New shared `SettingsLoadFailed` (in `SettingsContentSkeleton.tsx`, built on `LoadFailed`).

Unhandled rejections removed (a read with no catch): `OrderDatesCard` (found by the new test as a Vitest unhandled-rejection error), outlet delivery and pickup summaries, transfer-stock modal, draft order builder, affiliate code modal, inventory scan page.

Already fixed by the previous batch and untouched: Products, Order history, Customers, Draft orders, Draft order detail.

## 4. TopBar sticky on mobile: DONE, desktop byte-identical

`TopBar` is `sticky top-0 z-30 md:static md:top-auto md:z-auto` (class test `TopBar.test.tsx`). Measured with `tools/responsive-audit/topbar-check.js` on three pages at 1440, 768 and 390, before and after: 1440 and 768 are identical (computed position `static`, top `auto`, z-index `auto`; the bar scrolls away: rect top 0, then -500 or -449); at 390 the bar is `sticky` and its rect top stays 0 after scrolling 500. Things that had to change so nothing else broke (found with 390 screenshots, scrolled):
- `--topbar-h` is published by `TopBar` only while it is sticky (removed from md up and on unmount) and the product wizard's sticky stepper uses `top-[var(--topbar-h,0px)]` (otherwise it would sit under the bar). Verified: stepper offset 70px.
- Modals opened from inside the settings columns rendered BELOW the pinned bar and had their right edge masked by the scroller's edge fade (the Modal sat inside a masked `ScrollFade`, a stacking context). `ui/Modal` now renders through `createPortal` into `document.body` (test `Modal.test.tsx`). Verified at 390 scrolled: the overlay dims the bar and nothing is masked. This also fixes the existing edge mask on modals in Settings.
- Banners (country, new order) sit below the bar in flow and scroll away; the new-order toast is `fixed z-[100]` and the command palette `z-[100]`, both still above the bar. Row menus inside the settings columns open fully (visible and hit-testable, checked for users, outlets and tax classes).

## 5. Harness results (admin, 86 routes x 360/390/430)

| run | failing routes (document overflow, header width, offenders) | routes with a loading timeout |
|---|---|---|
| before (c30da2c1) | 0 of 86 | 0 |
| after (mid-work build) | 0 of 86 | 0 |
| after-final (final code) | 0 of 86 (258 route-viewport runs, 0 loading timeouts) | |

The baseline was already 0 failing, so the bar (0) is kept. `swipe-check.js` on this branch: Orders tab row PASS (0 to 307), kanban PASS (0 to 320), Products tab row PASS (0 to 172); the base build is identical.

Harness changes (all in `tools/responsive-audit/`): `seed.js` POSTed discounts to `/discounts` (404, the route is `/shop/discounts`), so no earlier run had a discount; fixed, and `call/jar/optional` exported. New: `seed-lists.js`, `lists-reach.js`, `topbar-check.js`, `shots-compare.js`.

## 6. Verification

- admin `tsc --noEmit` clean; `node tools/check-lint-baseline.js admin`: delta +0 against 56. The baseline file is lowered 87 to 56 (fetch-on-mount effects that called a state-setting async `refresh()` are now promise chains the rule does not flag). Dated note for CLAUDE.md: "lowered 87 to 56 on 2026-10-04 (N3): list and settings pages load through promise chains with a stale-response guard instead of `useEffect(() => { refresh(); }, [refresh])` over an async setter".
- vitest (all): 120 files, 845 tests passing, no unhandled errors. New: `load-failure.test.tsx` (68), `independent-loads.test.tsx` (12), `phone-card-lists.test.tsx` (6), `TopBar.test.tsx` (2), `Modal.test.tsx` (1). `settings/storefront/redirects/page.test.tsx` now addresses the table, because the card list duplicates its text in jsdom.
- `logical-properties-codemod --check`, `check-page-width`, `check-form-width`: pass. No em dashes in added copy. `npm run build` (admin) passes.
- Injection proofs (original file restored from c30da2c1, test fails for the stated reason, then restored): discounts, affiliates, settings users, margin report, general report, dashboard (each: the section the healthy request feeds never rendered), ingredients, SEO settings, payments integration, order detail, order detail modal (each: no "Could not load" error, skeleton forever), Modal (rendered inside the caller's subtree), TopBar (no sticky classes). 13 in total.
- Screenshots: `docs/handoff/n3-shots/` (WebP, at most 150KB), `before-*` from the base build and `after-*` from this branch at 390x844 and 1440x900 for every converted page, plus `*-FAILING-*` (every read aborted at 390: stuck skeleton before, error with Try again after) for discounts, suppliers, SEO, payments, margin report, dashboard.

## 7. Not done and follow-ups

- Bio links reorder is drag and drop only (no touch). Needs up and down buttons.
- Security sessions and Diagnostics keep tables (read-mostly); revoke and retry are swipe-reachable.
- Settings cards need the settings region's sideways swipe to reach their menu at 390 (the two-column design is the previous batch's decision).
