# U1 hand-off: admin shell, settings, dashboard (branch fix/admin-shell-responsive)

Admin only. No backend, storefront or migration changes.

## Shared primitive for U2

`admin/components/ui/ScrollFade.tsx` (named exactly `ScrollFade`): `<ScrollFade className? startFade?>children</ScrollFade>`.
A real `overflow-x-auto` scroller wrapped in `relative`, with an edge fade (`from-background` gradient,
logical `start-0`/`end-0`, `rtl:` flips the direction, `Math.abs(scrollLeft)` so RTL works) on each edge that
still has hidden content, driven by scroll + ResizeObserver, so a region that fits shows no fade.
`startFade={false}` is for a region whose first column is `sticky start-0` (the settings sidebar).
`className` goes on the scroller (put `rounded-2xl border ...` there for a table card). I did NOT touch
`components/ui/Table.tsx` (U2's area, shared by every list); to give a table the affordance, put a plain
`<table className="min-w-[...]">` with `THead/TBody/TH/TR/TD` inside a `ScrollFade` as `settings/outlets/page.tsx` does.
Also new: `components/SettingsContentSkeleton.tsx` (aria-busy cards skeleton for a settings content column).

## What changed

- `AppChrome` main: `px-12` -> `px-4 md:px-12`; `TopBar`: `px-10` -> `px-4 md:px-10`. Both unchanged from md (768) up.
- Dashboard / reports overflow root cause (diagnosis b confirmed): `BranchBar` right group, `DateRangePicker`,
  `ReportsFilterBar`'s date group and `/reports/attribution`'s own date group now `flex-wrap min-w-0 max-w-full`
  with `min-w-0` on the date inputs. (Attribution has its own copy of the date row; found by the after-run.)
- `settings/layout.tsx`: two columns at every width. Below sm the pair sits in a `ScrollFade` (own sideways scroller,
  row `min-w-[501px]` = 145 sidebar + 16 gap + 340 content), sidebar `w-[145px] sticky start-0 z-10 bg-background`,
  content `min-w-[340px]`; from sm up `sm:min-w-0`, sidebar 220px, nothing scrolls. `SettingsNav`: 13px labels
  truncating with `title`, group labels truncate, external arrows `size-3` and `shrink-0`.
- Outlet editor (`settings/outlets/[outletId]/edit`, `OutletEditSidebar`): same rule (145px sticky sidebar, 340px
  content, own `ScrollFade`).
- Blank content (diagnosis c): the layout no longer returns `null` while auth resolves. It renders the chrome
  (back button, title, sidebar) and `SettingsContentSkeleton` in the content column, never the page itself (nothing
  mounts or fetches before the user is known to be an admin; test pins it). The "Loading..." text or bare skeleton
  of information, online-presence, seo, store-configuration, money-tax, display, policy-pages, domain and
  `ShopDeliverySettingsForm` (fulfilment/delivery) is now `SettingsContentSkeleton`.
- Outlets list: the Branches table is in a `ScrollFade` with `min-w-[640px] whitespace-nowrap`, every column reachable.

## Offender counts (harness, same seed shape, my servers, production builds)

Before = my own run of main (matches the coordinator's baseline), after = this branch.
Routes measured: /dashboard, /reports/*, /orders/external-delivery, /settings/* and the outlet editor (33 routes).

| viewport | routes with document overflow before | after | worst before (px) |
|---|---|---|---|
| 360 | 8 (dashboard +194, 7 report/ext-delivery pages +46) | 0 | +194 |
| 390 | 8 (dashboard +164, 7 pages +16) | 0 | +164 |
| 430 | 1 (dashboard +124) | 0 | +124 |

Header width equals the viewport on every measured route (custom check, 360/390/430). 768 and 1440 viewport
screenshots are pixel-identical to main for money-tax, seo, tax-classes, diagnostics, prep-time, dashboard and
(1440) outlets (0.00% differing pixels); `settings-outlets` at 768 differs 0.79% and `business/information` at 768
4.55%, both inferred to be seed data text (shop name/subdomain differ per seed), not layout.

Settings containment check (`/tmp` script, not committed): at 360/390/430 on every /settings/* route and the five
outlet-editor tabs: document overflow 0, sidebar 145px at x=16, content column 340px, 0 elements extending past the
content column outside a nested scroller, sidebar stays at offset 0 after scrolling the region 150px (sticky works).

## Premise corrections

- The coordinator's "clipped" counts on tax-classes (8), outlets (4), security (4), users (4) are `svg > path`
  elements (the harness reports an svg's own `overflow:hidden` as a clip). They are the edit/delete icons of table
  action columns that sit past the viewport inside the table's own scroller, i.e. reachable, not cut off. No fix
  needed beyond the new ScrollFade affordance on the outlets table; the other tables belong to the shared `Table`.
- The first before/after harness runs passed everything because my backend's `ADMIN_ORIGINS` did not include my admin
  port (pages sat on /login) and a stale `next start` survived `kill $(pid of npx)`. Both caught and rerun.
  Worth adding to the harness README: set `ADMIN_ORIGINS` for the harness backend, and kill the `next-server` pid.
- The brief says the header should be "sticky". `TopBar` is not sticky on main and is not made sticky here (that
  would change desktop scrolling); only the settings sidebar is sticky, at `start-0` inside its scroller. Vertical
  stickiness of that sidebar is not possible inside an `overflow-x` scroller (it becomes the sticky container), so the
  sidebar scrolls away vertically with the page on phones.

## Tests (admin)

New: `ScrollFade.test.tsx`, `DateRangePicker.test.tsx`, `AppChrome.test.tsx`, additions to `settings/layout.test.tsx`
(chrome + skeleton while loading, signed-out renders nothing, two-column class assertions, three pages show a skeleton)
and `ReportsFilterBar.test.tsx`. Injection-proven (revert, see failure, restore): layout returning null while loading;
stacked `flex-col` layout; DateRangePicker without `flex-wrap`; AppChrome `px-12`; ReportsFilterBar without wrap;
ScrollFade end-fade never shown; money-tax page without its skeleton.

## Screenshots

`docs/handoff/u1-shots/` WebP, `<screen>-<390x844|1440x900>-<before|after>.webp`. Before images are the coordinator's
baseline run (its seed, outlet id 10), after are mine (outlet id 9).
