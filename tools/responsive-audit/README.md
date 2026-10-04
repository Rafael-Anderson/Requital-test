# Responsive audit harness

Measures every admin and storefront page for horizontal overflow, header width, elements past the
viewport, genuine sideways scrollers and fixed elements, at 360x780, 390x844, 430x932, 768x1024 and
1440x900. Local servers and a freshly seeded DB only, never production.

## Run it

```bash
# backend (NODE_ENV=test is REQUIRED: the default 100 req/min per-IP throttle otherwise returns 429
# to the pages themselves and the audit measures error states), admin and storefront as production builds
NODE_ENV=test PORT=3000 node backend/dist/main.js          # DB migrated, any empty database
cd admin && NEXT_PUBLIC_API_URL=http://localhost:3000 npm run build && npx next start -p 3001
cd storefront && NEXT_PUBLIC_API_URL=http://localhost:3000 npm run build && npx next start -p 3002

node tools/responsive-audit/audit.js --label before            # all routes, all viewports, ~60 min
node tools/responsive-audit/audit.js --label x --viewports 390x844 --only /orders,/dashboard --no-shots
node tools/responsive-audit/diagnose.js --label before          # numbers for the Phase 0.3 symptoms
node tools/responsive-audit/diagnose2.js --label before         # slow-API settings, touch swipes, cookie banner
```

Override servers with `AUDIT_API_URL`, `AUDIT_ADMIN_URL`, `AUDIT_STOREFRONT_URL`; the browser with
`AUDIT_CHROME`; the seeded shop's editor mode with `AUDIT_MODE=simple` (default `advanced`).
Output goes to `tools/responsive-audit/out/<label>/` (`report.md`, `report.json`, `fixture.json`,
`shots/*.png` viewport screenshots, never full-page).

## Storefront templates, interaction states and the theme-builder preview (N4)

```bash
# one shop per starter template (published, with brands, a wide image logo and local placeholder images;
# AUDIT_UPLOADS_DIR writes them into the backend's uploads folder, which it serves at /uploads)
AUDIT_TEMPLATE=heritage AUDIT_IMAGE_BASE=http://localhost:3000/uploads AUDIT_UPLOADS_DIR=backend/uploads \
  node tools/responsive-audit/audit.js --label heritage --apps storefront
# add AUDIT_CART_LAYOUT=drawer to seed.js (prints the fixture) for the cart-drawer checks
node tools/responsive-audit/states.js --fixture out/<label>/fixture.json --label x     # focus ring + hover per Tab stop
node tools/responsive-audit/open-states.js --fixture drawer-fixture.json --label x      # mobile menu, search, bottom bar, cart drawer
node tools/responsive-audit/preview.js --fixture out/<label>/fixture.json --label x     # builder preview iframe (admin on AUDIT_ADMIN_URL)
```

`measure.js` now also reports `clippedPrimary` (a link, button, input, heading, price or image cut by an
`overflow: hidden|clip` ancestor), `obscuredPrimary` (covered by an unrelated fixed element in the upper half of the
viewport; the cookie banner and lower-half bars are excluded on purpose) and `overlapping` (two in-flow interactive boxes
that intersect). `states.js` judges a focus ring by pixel diff (focused vs blurred, and the contrast of the changed pixels),
so a ring that exists in CSS but cannot be seen counts as missing. `states.js` scrolls each control into view, which makes a
`shrink` header (Market) compact: its "Call us" hover "shift" is that scroll, not the hover.

## Gotchas (found the hard way)

- The backend's `ADMIN_ORIGINS` must include the audited admin origin (e.g. `http://localhost:3201`), or every
  page sits on /login and the audit reads "0 failing". Check a screenshot before trusting a clean run.
- Stopping an app by killing the `npx` pid leaves the old `next-server` alive, serving chunks from a deleted
  `.next` (500s). Stop a server by its port (`fuser -k PORT/tcp`), never with `pkill -f <pattern>` (the pattern
  matches your own shell).
- The harness logs in once per viewport; the login route is throttled per IP when the backend is not
  `NODE_ENV=test`.

## How to read a result

- `docOverflow` compares `documentElement.scrollWidth` with `documentElement.clientWidth`, NOT
  `window.innerWidth`. On a mobile page that overflows, Chrome zooms the visual viewport out to fit the
  content, so `innerWidth` grows to the content width while the layout viewport and the header keep the
  device width. That is exactly the "header stops partway with empty space beside it" symptom.
- `offenders` are topmost elements whose box extends past the layout viewport and that are NOT inside an
  `overflow-x: auto|scroll` ancestor. `clipped` are the same but inside an `overflow: hidden|clip`
  ancestor (content silently cut off). `scrollers` are the genuine sideways scroll containers.
- Wait rule: network idle AND no visible `.animate-pulse` / `[aria-busy]` / nprogress bar.

## Touch swipes

`swipe.js` drives a real touch drag through `Input.dispatchTouchEvent` in a context created with
`hasTouch` and `isMobile`, and reports `scrollLeft` before and after. `Input.synthesizeScrollGesture` was
tried first and did not move even a plain `overflow-x:auto` control in this headless build, so every
swipe test must include a control element that is known to scroll (see `diagnose2.js`).

## Swipe check (optional)

`swipe-check.js` runs `swipe.js` against a list of selectors on a phone-sized touch context, with the control
element first (exit 2 if the control does not scroll, i.e. the run is invalid; exit 1 if a region under test
does not move; 0 otherwise):

```bash
node tools/responsive-audit/swipe-check.js                      # built-in list (Orders tabs and kanban, Products tabs)
node tools/responsive-audit/swipe-check.js --url /orders --selectors 'a:has-text("Order History")|[data-scroll-fade].snap-x > div:nth-child(1)'
```

`repro-products-loading.js` loads /products on a one-product shop with a healthy, a slow and a failing API.

## Not covered

Routes that need data the seed does not create are listed under "Skipped" in `report.md`. Platform-admin
routes (`/platform/*`) need a separate login and are excluded.
