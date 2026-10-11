# T4: seed ShopProvider with the server-fetched shop (branch feat/ssr-shop-provider)

Storefront only, no migration, no backend change.

## What changed

- `app/[shop]/layout.tsx` (Server Component) already fetched shop + theme for metadata and the pre-paint CSS. It now also fetches the outlets (same parallel batch) and passes `initialData` (`lib/shop-initial-data.ts`, pure `buildShopInitialData`) to `ShopProvider`. `<ShopLayoutClient key={shopSlug}>` remounts on a shop change.
- `ShopProvider` starts from the seed (`loading=false`), so the server HTML and first client render carry the shop chrome and the theme-driven sections. It does not refetch what the server rendered a moment ago: the shop/outlets and theme effects are keyed (`shopKeyHeld`/`themeKeyHeld`), so they only fetch when the key differs from the seeded one (strict-mode safe). A theme-builder preview (`?preview=true`), a seed for another slug, or no seed take the original path unchanged (skeleton, own fetches, postMessage updates).
- Never seeded: an unpublished shop (its outlets/menu/products need a staff previewToken a layout cannot see), a failed theme or outlets fetch. Those render exactly as before.
- Things that could not run on a server and were fixed: DOMPurify (no DOM on the server; it crashed SSR) now has a server path, a tokenise-and-rebuild allowlist ported from the backend importer (`lib/sanitize-html-server.ts`, shared style allowlist in `lib/sanitize-style.ts`); lazy-`matchMedia` hooks became hydration-safe `useSyncExternalStore` (`lib/use-media-query.ts`; reduced-motion, min-width, hero, announcement rotation); portals in `CartDrawer`/`MobileNav` wait for `useIsClient`. `getThemeConfig` now reads an EMPTY 200 body (a shop with no published theme) as `null` instead of throwing, which the server needs to tell "no theme" from "failed" (found because the no-theme shop was silently not seeded).
- Classic / Grid-first legacy homepages need nothing but the shop, so they no longer wait for the products fetch (slideshow / featured-grid still do).
- `<noscript>` style in the shop layout: entrance animations start at opacity 0 until a script reveals them, so server-rendered sections would be invisible without JS.
- Lint baseline 33 to 32 (the hero and announcement hooks lost their set-state-in-effect shape).

## The 404 body: what is and is not possible (measured, premise correction)

The brief asks for the branded not-found content in the raw HTML of a 404. **That is not achievable with a thrown notFound() in Next 16.3, with or without this change.** A notFound() raised in the shell phase of the server render goes through Next's error-recovery path (`next/dist/server/app-render/app-render.js` around lines 2381 to 2440, `getErrorRSCPayload`, `ErrorApp`), which always answers the real status (404), the `<meta name="robots" content="noindex">` and its own bare `<html id="__next_error__">` shell; the not-found UI is then rendered by the client. Control experiment: a bare `app/exp404/page.tsx` that only calls `notFound()` (no ShopProvider, nothing of ours) produced the same bare body, with the root not-found text present only inside the `<title>` metadata. Fizz does not run error boundaries, so the branded page cannot appear in that response. Next's own docs say the same for a streamed response (200, noindex) and suggest `proxy` (rewrite with a 404 status) to get both; that needs an existence probe per product/collection/brand/policy URL in `proxy.ts`, which duplicates routing knowledge and adds a backend call per request, so it was not built. What a JS-less crawler gets on a 404 is the real status, noindex and the shop name in the title; what a visitor gets is the shop-chromed not-found page right after hydration (now without waiting for a shop fetch). `e2e/tests/soft-404.spec.ts` asserts exactly that and keeps the browser assertions of the branded text.

The hidden-children workaround (`SSR_STATUS_PARAMS`, `<div hidden>{children}</div>` while loading) is KEPT for the unseeded path: with the seed withheld AND the workaround removed, the soft-404 spec fails (injection-proven below), i.e. it still matters when the seed is missing (a failed theme/outlets fetch on a published shop). `not-found-gate.ts` is unchanged.

## What a no-JS crawler sees now

```
$ curl -s -D - -o /dev/null http://localhost:3328/audit-1791480616824/nope
HTTP/1.1 404 Not Found
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
Content-Type: text/html; charset=utf-8

/nope -> 404 <meta name="robots" content="noindex"/> <title>Audit Shop 1791480616824</title>
/products/zzz -> 404 <meta name="robots" content="noindex"/> <title>Product</title>
/collections/zzz -> 404 <meta name="robots" content="noindex"/> <title>Collection</title>
/brands/99999 -> 404 <meta name="robots" content="noindex"/> <title>Brand</title>
/policies/terms -> 404 <meta name="robots" content="noindex"/> <title>Audit Shop 1791480616824</title>
unknown shop -> 404 <meta name="robots" content="noindex"/> <title>no-such-xyz</title>
real product -> 200 <title>Rose Bouquet</title> canonical: <link rel="canonical" href="https://audit-1791480616824.requital.io/products/rose-bouquet"/>
  og/ld+json: og:image og:title og:type og:url  ld+json blocks: 6
```

Home page, raw HTML, scripts/styles/templates stripped (production build, seeded shops, one per starter template plus a shop with no theme):

```
=== none
-- old (origin/main, measured earlier on the same shops: 13.7-14.1 KB, h1 [], 0 visible-text chars, the loading skeleton)
-- new
title: Audit Shop 1791480615916
h1: ['Audit Shop 1791480615916']
bytes: 21484  visible-text chars: 97
text: Audit Shop 1791480615916 Shop now © 2026 Audit Shop 1791480615916 . All Rights Reserved Card Cash
=== atelier
-- old (origin/main, measured earlier on the same shops: 13.7-14.1 KB, h1 [], 0 visible-text chars, the loading skeleton)
-- new
title: Audit Shop 1791480616824
h1: ['Flowers for the occasions that matter']
bytes: 33141  visible-text chars: 327
text: Flowers for the occasions that matter Enquire A studio practice. Seasonal stems, considered arrangements, and a small number of weddings and events each year. Every arrangement is made to order in our studio. Seasonal notes Occasional letters on what is in sea
=== market
-- old (origin/main, measured earlier on the same shops: 13.7-14.1 KB, h1 [], 0 visible-text chars, the loading skeleton)
-- new
title: Audit Shop 1791480617744
h1: ['Fresh flowers for every occasion']
bytes: 40236  visible-text chars: 248
text: Call us Home Shop Search Cart Account © 2026 Audit Shop 1791480617744. All Rights Reserved Fresh flowers for every occasion Shop now Secure checkout Order tracking Stay in the loop Sign up for news and updates from the shop. Email address Subscribe
=== bloom
-- old (origin/main, measured earlier on the same shops: 13.7-14.1 KB, h1 [], 0 visible-text chars, the loading skeleton)
-- new
title: Audit Shop 1791480618639
h1: ['Gifting made joyful']
bytes: 34958  visible-text chars: 311
text: Gifting made joyful Start a gift Pick it. Personalise it. We deliver it. Three steps to a gift they will remember. Secure checkout Order tracking Stay in touch News about new gifts and seasonal arrivals. Subscribe Ready to send something joyful? Start a gift ©
=== heritage
-- old (origin/main, measured earlier on the same shops: 13.7-14.1 KB, h1 [], 0 visible-text chars, the loading skeleton)
-- new
title: Audit Shop 1791480619497
h1: ['Traditional florists, delivered with care']
bytes: 41427  visible-text chars: 537
text: Call us Shop All arrangements Occasions Sympathy Weddings Company Our story Contact Corporate accounts © 2026 Audit Shop 1791480619497. All Rights Reserved Card Cash Traditional florists, delivered with care Shop the collection Hand-tied by our florists Order 
```

Pages that stay skeleton-until-client (their data is fetched in effects by design): product detail body, collection product grid, brand listing, cart, checkout, account, orders, bio, policies content, product-grid / brands / product-tabs sections inside a themed home. Their chrome (header, menu bar, footer, announcement bar) and static sections are server-rendered, and the metadata/JSON-LD of product and collection pages was already server-side (generateMetadata) and is unchanged.

## TTFB and HTML size (production build, median of 15 interleaved requests, backend NODE_ENV=test, localhost, ms and bytes; old = origin/main on :3338, new = this branch on :3328)

```
shop      path                      TTFB_old  TTFB_new bytes_old bytes_new status
none      /                             47.5      46.8     13732     14150 200
none      /products/rose-bouquet        58.0      61.1     17611     18029 200
none      /collections/flowers          38.9      57.5     16756     17174 200
none      /nope                         38.1      36.4     10778     12186 404
atelier   /                             25.9      31.1     14052     33142 200
atelier   /products/rose-bouquet        36.4      40.6     18057     32989 200
atelier   /collections/flowers          38.8      43.6     17076     32724 200
atelier   /nope                         34.4      41.4     12085     24052 404
heritage  /                             26.6      36.6     14048     41428 200
heritage  /products/rose-bouquet        49.1      57.8     18053     37855 200
heritage  /collections/flowers          36.7      47.3     17072     37590 200
heritage  /nope                         34.5      37.5     10942     26032 404
```

About +5 to +10 ms of TTFB on themed shops (the server now renders the chrome and sections, and fetches outlets in parallel with the shop and theme), HTML +15 to +25 KB uncompressed (the shop, theme and outlets also travel once in the flight payload). Caddy compresses it.

## Caching and freshness

Every fetch the layout makes is the plain uncached GET it always was; Next only memoizes identical GETs inside one render pass (layout, generateMetadata and `notFoundIfMissing`'s probe share one `getShop`). The response is `Cache-Control: private, no-cache, no-store`, so nothing is shared between visitors and a shop or published-theme edit shows on the next request, the same freshness the client's own fetch had. An unpublished shop is never seeded and its pages get no new public payload. The client no longer repeats the fetches on mount, so the API sees fewer calls per page view from the browser and the same number from the storefront server.

## Verification

- storefront: tsc clean, `node tools/check-lint-baseline.js storefront` delta +0 (baseline lowered to 32), vitest 111 files / 914 tests pass (new: shop-initial-data, shop-context.seed, sanitize-html-server incl. a fuzz and hostile corpus parsed with jsdom, use-media-query, getThemeConfig), `npm run build` ok, logical-properties / page-width / form-width checks clean.
- Hydration: a Playwright pass against `next dev` (React reports mismatches there) over 5 shops (4 templates and no theme) x 7 URLs (home, product, collection, missing path, missing product, cart, account login) + a preview URL, at 1280 and 390 px, with and without prefers-reduced-motion: 0 hydration warnings, 0 page errors (the dev-only "eval() is not supported" CSP message is ignored).
- e2e against my ports (backend in CI mode, `next dev` for both apps): soft-404 16/16 (3 new cases), responsive-overflow 3/3, customer-checkout, auto-discount-pricing, merchant-onboarding, password-reset pass. Production build: soft-404 16/16, responsive-overflow storefront cases, customer-checkout, auto-discount pass.
- **order-kanban fails on this branch AND is independent of it** (admin and backend are untouched here): the board now shows the shop-scoped order number (`#1`) while the spec waits for `#<global order id>` (`#31`). Not fixed here; it needs the spec to use the order number.
- Injection proofs: (a) layout passes `initialData={undefined}`: the new "home page carries the shop name" case and the "published theme renders its sections" case FAIL (body is the skeleton, no text, no h1); (b) seed withheld and the hidden-children workaround disabled: soft-404 "missing URL #0" FAILS (so the workaround stays); both restored.

## VERIFIED vs INFERRED

VERIFIED: everything above that cites a measurement or test. INFERRED: strict-mode behaviour in React dev beyond what the unit test covers; a preview session restored from sessionStorage on a non-preview URL briefly shows the published theme before its draft fetch (the keys differ, so it refetches with the token, same as before); real iOS/Safari hydration timing.

## Production steps

None. No env var, no migration, deploy storefront only.
