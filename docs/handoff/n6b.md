# N6b: storefront home overflows a phone by a few px (dff, 4px at 390)

No production access, so this is a local reproduction. Everything below was measured on this branch's own
backend (:3112) and storefront (:3312), Chromium 1194 at 360/390/430 with `isMobile`. VERIFIED unless marked INFERRED.

## Root cause (VERIFIED locally; that it is dff's exact 4px is INFERRED)

`ScrollAnimatedWrapper` (every theme section's entrance) animates `translateX(var(--motion-entrance-distance))`
(slide-left/right) or `rotate(-2deg)` with `animation-fill-mode: forwards`. Chrome leaves
`documentElement.scrollWidth` at the value a MID-animation frame measured and never recomputes it, although
every element's final box is inside the viewport. So the page is permanently a few px wider than the device,
`measure.js` reports `offenders []` (no element's final rect passes the edge), and the value is not fixed: 395,
397, 398 on repeated loads of the same page. 394 on dff is one such frame.

Evidence, Atelier (seeded through the real API, `AUDIT_TEMPLATE=atelier`), 390px, production build, no fix:

```
scrollWidth over time (rAF poll, [ms since navigation, scrollWidth]):
[[63,451],[274,414],[318,402],[416,397],[447,395]]
elements' final rects: none past 390 (probe.js lists only position:fixed ones, which just follow the viewport)
reducedMotion=no-preference: 397,397,397,397,397,397,397,397, after-scroll 397
reducedMotion=reduce       : 390,390,390,390,390,390,390,390, after-scroll 390
animation:none on the one slide-left section -> scrollWidth 402 -> (others) 395: it follows the animation
hiding any large subtree (header, main, route announcer) -> 390 (a relayout recomputes it)
```

Why only 4px on dff: the stale value is the frame the last overflow update happened on, and it depends on the
shop's `motion.intensity` (entrance distance 0/12/24/48px, one level gentler below 640px) and which entrance a
section uses. `rotate-in` on a full-bleed section overflows by `H * sin(2deg) / 2` (a 230px tall section: 4px).

## Fix

`storefront/components/theme-sections/ScrollAnimatedWrapper.tsx`: the animated box now sits in an
`overflow-x-clip` parent. `clip` (not `hidden`) makes no scroll container, so sticky children and the y axis are
untouched; `html`/`body` are not touched. `entrance: none` still renders children bare (byte-identical).
Unit test added (`ScrollAnimatedWrapper.test.tsx`).

## What I tried that did NOT reproduce (VERIFIED, with the fix in place and also unfixed where noted)

Stress shops per template (12 collections with 90-char unbroken names and long Arabic names, 8 products with
the same names and prices of 12345.50 with a compare-at price, logo image, brands): 0 overflow at 360/390/430
on all four templates (`stress-after-dev` below). The cookie banner is present in all of these runs. Not tried:
custom header background, hero banner images with odd aspect ratios, long announcement text, scheme-banded
sections with a saved theme of a real shop. Treat dff as "the entrance mechanism above is the only offender I
found", not as proven to be dff's.

## Measurements

Harness: `home.js` (one `measurePage` + scrollWidth/clientWidth per template and width), `variant.js` (sets every
body section's `motion.entrance` through `PATCH /themes/:id` and republishes). Scripts live in the scratchpad.

### Before (production build, unfixed)

```
## atelier default (as seeded)
audit-1791129383034 / 360 scrollW 366 clientW 360 offenders [] docOverflow true
audit-1791129383034 / 390 scrollW 397 clientW 390 offenders [] docOverflow true
audit-1791129383034 / 430 scrollW 437 clientW 430 offenders [] docOverflow true
## atelier all sections entrance=slide-left
audit-1791129383034 / 390 scrollW 400 clientW 390 offenders [] docOverflow true
## atelier all sections entrance=slide-right
audit-1791129383034 / 390 scrollW 390 clientW 390 offenders [{"el":"div.theme-anim-slide-right \"Seasonal note
## atelier all sections entrance=rotate-in
audit-1791129383034 / 390 scrollW 417 clientW 390 offenders [] docOverflow true
## atelier all sections entrance=scale-in
audit-1791129383034 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## market default (as seeded)
audit-1791129383789 / 360 scrollW 376 clientW 360 offenders [] docOverflow true
audit-1791129383789 / 390 scrollW 405 clientW 390 offenders [] docOverflow true
audit-1791129383789 / 430 scrollW 445 clientW 430 offenders [] docOverflow true
## market all sections entrance=slide-left
audit-1791129383789 / 390 scrollW 405 clientW 390 offenders [] docOverflow true
## market all sections entrance=slide-right
audit-1791129383789 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## market all sections entrance=rotate-in
audit-1791129383789 / 390 scrollW 401 clientW 390 offenders [] docOverflow true
## market all sections entrance=scale-in
audit-1791129383789 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## bloom default (as seeded)
audit-1791129384358 / 360 scrollW 360 clientW 360 offenders [] docOverflow false
audit-1791129384358 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
audit-1791129384358 / 430 scrollW 430 clientW 430 offenders [] docOverflow false
## bloom all sections entrance=slide-left
audit-1791129384358 / 390 scrollW 438 clientW 390 offenders [{"el":"div.theme-anim-slide-left \"Rose Bouquet 4
## bloom all sections entrance=slide-right
audit-1791129384358 / 390 scrollW 390 clientW 390 offenders [{"el":"div.theme-anim-slide-right \"Rose Bouquet 
## bloom all sections entrance=rotate-in
audit-1791129384358 / 390 scrollW 406 clientW 390 offenders [{"el":"div.theme-anim-rotate-in \"Rose Bouquet 40
## bloom all sections entrance=scale-in
audit-1791129384358 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## heritage default (as seeded)
audit-1791129384930 / 360 scrollW 360 clientW 360 offenders [] docOverflow false
audit-1791129384930 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
audit-1791129384930 / 430 scrollW 430 clientW 430 offenders [] docOverflow false
## heritage all sections entrance=slide-left
audit-1791129384930 / 390 scrollW 402 clientW 390 offenders [{"el":"div.theme-anim-slide-left \"SEASONAL UPDAT
## heritage all sections entrance=slide-right
audit-1791129384930 / 390 scrollW 390 clientW 390 offenders [{"el":"div.theme-anim-slide-right \"SEASONAL UPDA
## heritage all sections entrance=rotate-in
audit-1791129384930 / 390 scrollW 395 clientW 390 offenders [{"el":"div.theme-anim-rotate-in \"SEASONAL UPDATE
## heritage all sections entrance=scale-in
audit-1791129384930 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
```

The "market default (as seeded)" block above ran after an earlier slide-left variant was left published, so read
only the atelier, bloom and heritage defaults and the per-entrance lines. Atelier as seeded is the real
reproduction: 366 / 397 / 437 at 360 / 390 / 430.

### After (production build, fixed)

```
## atelier default (as seeded)
audit-1791129383034 / 360 scrollW 360 clientW 360 offenders [] docOverflow false
audit-1791129383034 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
audit-1791129383034 / 430 scrollW 430 clientW 430 offenders [] docOverflow false
## atelier all sections entrance=slide-left
audit-1791129383034 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## atelier all sections entrance=slide-right
audit-1791129383034 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## atelier all sections entrance=rotate-in
audit-1791129383034 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## atelier all sections entrance=scale-in
audit-1791129383034 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## market default (as seeded)
audit-1791129383789 / 360 scrollW 360 clientW 360 offenders [] docOverflow false
audit-1791129383789 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
audit-1791129383789 / 430 scrollW 430 clientW 430 offenders [] docOverflow false
## market all sections entrance=slide-left
audit-1791129383789 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## market all sections entrance=slide-right
audit-1791129383789 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## market all sections entrance=rotate-in
audit-1791129383789 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## market all sections entrance=scale-in
audit-1791129383789 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## bloom default (as seeded)
audit-1791129384358 / 360 scrollW 360 clientW 360 offenders [] docOverflow false
audit-1791129384358 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
audit-1791129384358 / 430 scrollW 430 clientW 430 offenders [] docOverflow false
## bloom all sections entrance=slide-left
audit-1791129384358 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## bloom all sections entrance=slide-right
audit-1791129384358 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## bloom all sections entrance=rotate-in
audit-1791129384358 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## bloom all sections entrance=scale-in
audit-1791129384358 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## heritage default (as seeded)
audit-1791129384930 / 360 scrollW 360 clientW 360 offenders [] docOverflow false
audit-1791129384930 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
audit-1791129384930 / 430 scrollW 430 clientW 430 offenders [] docOverflow false
## heritage all sections entrance=slide-left
audit-1791129384930 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## heritage all sections entrance=slide-right
audit-1791129384930 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## heritage all sections entrance=rotate-in
audit-1791129384930 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## heritage all sections entrance=scale-in
audit-1791129384930 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
```

### After (`next dev`, fixed; CI uses dev)

```
## atelier default (as seeded)
audit-1791129383034 / 360 scrollW 360 clientW 360 offenders [] docOverflow false
audit-1791129383034 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
audit-1791129383034 / 430 scrollW 430 clientW 430 offenders [] docOverflow false
## atelier all sections entrance=slide-left
audit-1791129383034 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## atelier all sections entrance=slide-right
audit-1791129383034 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## atelier all sections entrance=rotate-in
audit-1791129383034 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## atelier all sections entrance=scale-in
audit-1791129383034 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## market default (as seeded)
audit-1791129383789 / 360 scrollW 360 clientW 360 offenders [] docOverflow false
audit-1791129383789 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
audit-1791129383789 / 430 scrollW 430 clientW 430 offenders [] docOverflow false
## market all sections entrance=slide-left
audit-1791129383789 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## market all sections entrance=slide-right
audit-1791129383789 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## market all sections entrance=rotate-in
audit-1791129383789 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## market all sections entrance=scale-in
audit-1791129383789 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## bloom default (as seeded)
audit-1791129384358 / 360 scrollW 360 clientW 360 offenders [] docOverflow false
audit-1791129384358 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
audit-1791129384358 / 430 scrollW 430 clientW 430 offenders [] docOverflow false
## bloom all sections entrance=slide-left
audit-1791129384358 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## bloom all sections entrance=slide-right
audit-1791129384358 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## bloom all sections entrance=rotate-in
audit-1791129384358 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## bloom all sections entrance=scale-in
audit-1791129384358 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## heritage default (as seeded)
audit-1791129384930 / 360 scrollW 360 clientW 360 offenders [] docOverflow false
audit-1791129384930 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
audit-1791129384930 / 430 scrollW 430 clientW 430 offenders [] docOverflow false
## heritage all sections entrance=slide-left
audit-1791129384930 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
## heritage all sections entrance=slide-right
node:internal/process/promises:394
    triggerUncaughtException(err, true /* fromPromise */);
    ^

page.waitForTimeout: Target page, context or browser has been closed
    at /tmp/claude-0/-home-user-Requital-test/d511f0d4-9f7d-5fa6-ac92-73a82e979e71/scratchpad/n6b/home.js:15:16 {
  log: []
}

Node.js v22.22.2
```

### Stress shops (long/Arabic names, 12 collections, `next dev`, fixed)

```
## stress atelier
audit-1791130055259 / 360 scrollW 360 clientW 360 offenders [] docOverflow false
audit-1791130055259 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
audit-1791130055259 / 430 scrollW 430 clientW 430 offenders [] docOverflow false
## stress market
audit-1791130056153 / 360 scrollW 360 clientW 360 offenders [] docOverflow false
audit-1791130056153 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
audit-1791130056153 / 430 scrollW 430 clientW 430 offenders [] docOverflow false
## stress bloom
audit-1791130056976 / 360 scrollW 360 clientW 360 offenders [] docOverflow false
audit-1791130056976 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
audit-1791130056976 / 430 scrollW 430 clientW 430 offenders [] docOverflow false
## stress heritage
audit-1791130057887 / 360 scrollW 360 clientW 360 offenders [] docOverflow false
audit-1791130057887 / 390 scrollW 390 clientW 390 offenders [] docOverflow false
audit-1791130057887 / 430 scrollW 430 clientW 430 offenders [] docOverflow false
```

## CI guard

`e2e/tests/responsive-overflow.spec.ts` gained "storefront home fits a 390px phone on every starter template":
for atelier, market, bloom and heritage it creates the template through `POST /themes {fromTemplate}`, publishes
it, loads the home at 390, waits for every finite animation to finish, asserts `scrollWidth <= clientWidth`,
scrolls through the page (below-the-fold entrances only run when reached) and asserts again. About 12s on
`next dev`, three consecutive passes with the fix:

```
  ✓  1 [chromium] › tests/responsive-overflow.spec.ts:117:5 › storefront home fits a 390px phone on every starter template (11.2s)
  ✓  1 [chromium] › tests/responsive-overflow.spec.ts:117:5 › storefront home fits a 390px phone on every starter template (11.4s)
  ✓  1 [chromium] › tests/responsive-overflow.spec.ts:117:5 › storefront home fits a 390px phone on every starter template (11.9s)
```

Injection proof (the wrapper reverted to origin/main, `next dev` hot-reloaded, `--retries=0`):

```
  ✘  1 [chromium] › tests/responsive-overflow.spec.ts:117:5 › storefront home fits a 390px phone on every starter template (2.3s)
    Error: storefront home, atelier, on load: document is 395px wide in a 390px viewport
    Expected: <= 390
    Received:    395
```

Restored afterwards (the passes above come after the restore).

## Gate results

storefront: tsc clean, vitest 106 files / 865 tests passed, lint baseline 33 (delta +0), logical-properties
`--check` 0 swaps, page-width guard clean, `next build` ok; e2e tsc clean.

## Known and not done

`measure.js` cannot see this class (final rects are in bounds). A `docOverflow` check (scrollWidth vs
clientWidth, which it already records) is what catches it, and the old audit's 0-failing result for the
templates came from cells measured after a scroll/reload that happened to land on 390; the stale value is
timing dependent (395/397/398), so it can pass by luck.
