# N6a: storefront soft 404s (branch fix/storefront-soft-404)

Seed: shop `pw-e2e-1791129386799` (published, product `rose-bouquet`, collection `flowers`, a 301 from `/old-page` to `/products/rose-bouquet`), `n6a-unpub` (unpublished), `n6a-susp` (suspendedAt set). Backend `NODE_ENV=test` on 3111, storefront on 3311. Script: `scratchpad/n6a-curl.sh PORT SHOP` (curl -s -D - -o body, `-H 'Host: <sub>.requital.io'` for host mode, which works because proxy.ts only skips `isLocalHost` hostnames).

## 1. The bug, proven first (BEFORE, origin/main 24012e49)

### production build (`next build` + `next start`)
```
path: real home                    HTTP/1.1 200 OK         TTFB=0.048561 | robots=none | notfoundmarkers=0
path: missing under shop           HTTP/1.1 200 OK         TTFB=0.020776 | robots=none | notfoundmarkers=1
path: missing deep                 HTTP/1.1 200 OK         TTFB=0.029744 | robots=none | notfoundmarkers=1
path: missing product              HTTP/1.1 200 OK         TTFB=0.023071 | robots=none | notfoundmarkers=0
path: real product                 HTTP/1.1 200 OK         TTFB=0.036031 | robots=none | notfoundmarkers=0
path: missing collection           HTTP/1.1 200 OK         TTFB=0.050742 | robots=none | notfoundmarkers=0
path: real collection              HTTP/1.1 200 OK         TTFB=0.047818 | robots=none | notfoundmarkers=0
path: missing brand                HTTP/1.1 200 OK         TTFB=0.040931 | robots=none | notfoundmarkers=0
path: bad policy type              HTTP/1.1 200 OK         TTFB=0.038673 | robots=none | notfoundmarkers=0
path: unpublished policy           HTTP/1.1 200 OK         TTFB=0.026916 | robots=none | notfoundmarkers=0
path: unknown order id             HTTP/1.1 200 OK         TTFB=0.037088 | robots=none | notfoundmarkers=0
path: unknown shop                 HTTP/1.1 200 OK         TTFB=0.042245 | robots=none | notfoundmarkers=0
path: unknown shop deep            HTTP/1.1 200 OK         TTFB=0.052621 | robots=none | notfoundmarkers=0
path: unpublished shop             HTTP/1.1 200 OK         TTFB=0.081746 | robots=none | notfoundmarkers=0
path: suspended shop               HTTP/1.1 200 OK         TTFB=0.051240 | robots=none | notfoundmarkers=0
path: redirected (path mode, proxy skips) HTTP/1.1 200 OK         TTFB=0.017488 | robots=none | notfoundmarkers=1
host: real home                    HTTP/1.1 200 OK         TTFB=0.018554 | robots=none | notfoundmarkers=0
host: missing                      HTTP/1.1 200 OK         TTFB=0.021548 | robots=none | notfoundmarkers=1
host: missing product              HTTP/1.1 200 OK         TTFB=0.018759 | robots=none | notfoundmarkers=0
host: real product                 HTTP/1.1 200 OK         TTFB=0.029483 | robots=none | notfoundmarkers=0
host: redirected                   HTTP/1.1 500 Internal Server Error  TTFB=0.015878 | robots=none | notfoundmarkers=0
host: unknown host                 HTTP/1.1 404 Not Found  TTFB=0.015440 | robots=none | notfoundmarkers=1
host: unpublished                  HTTP/1.1 200 OK         TTFB=0.020476 | robots=none | notfoundmarkers=0
host: suspended                    HTTP/1.1 200 OK         TTFB=0.018577 | robots=none | notfoundmarkers=0
```
`next dev` was identical (every missing URL 200; `host: redirected` also 500).

## 2. Root cause (file:line, VERIFIED by experiment)

- NOT a loading.tsx or Suspense boundary: there is no `loading.tsx` anywhere in `storefront/app`, and the same 200 came back for a Googlebot UA (blocking metadata).
- `storefront/lib/shop-context.tsx:453,537` `ShopProvider` starts with `loading = true` and fetches the shop in an effect, so the server render is always the `loading` branch.
- `storefront/app/[shop]/ShopLayoutClient.tsx` (`Body`, was line ~125): `if (loading) return <StorefrontLoadingSkeleton />;` renders only the skeleton and DROPS `children`. The server HTML of every storefront page (real or missing) is therefore the same skeleton.
- Next sets the HTTP status from the server HTML render (`next/dist/server/app-render/app-render.js:2382`, `renderToStream` shell-error catch: `isHTTPAccessFallbackError(err) -> res.statusCode = 404`). The catch-all `app/[shop]/[...rest]/page.tsx` does throw `notFound()`, and it is in the RSC payload (`E{"digest":"NEXT_HTTP_ERROR_FALLBACK;404"}` row), but the HTML render never renders that child, so it never sees the error: 200, no noindex. The client only discovers the 404 after hydration.
- Experiment: `return <><StorefrontLoadingSkeleton />{children}</>` made `/<shop>/nope` return 404 + `<meta name="robots" content="noindex">` immediately.
- Same mechanism for products, collections, brands, policies (client pages that fetch after hydration, so they could never set a status) and for an unknown shop (`app/[shop]/layout.tsx` swallowed the 404 from `getShop` in a bare catch).
- A `notFound()` thrown from a nested layout or `generateMetadata` does not help on its own either, for the same reason (tried: 200).

## 3. Fix (least invasive correct design)

1. `ShopLayoutClient.Body`: while loading, ALSO render `children` inside `<div hidden>` on routes whose params are in `SSR_STATUS_PARAMS` (`rest`, `slug`, `brandId`, `type`), so the server render sees the route's `notFound()`. Every other route is byte-identical (skeleton only).
2. `lib/not-found-gate.ts` `notFoundIfMissing(shopSlug, probe)`: called by the server layouts of `products/[slug]`, `collections/[slug]`, `brands/[brandId]` and a new `policies/[type]/layout.tsx`. A definite 404 from the probe on a PUBLISHED shop throws `notFound()`; any other error fails open. The probe is the same GET the layout/generateMetadata already makes (Next dedupes), so no extra backend round trip. Those layouts wrap `children` in `components/RenderWhenShopLoaded` so the client page does not run (no shop yet, no duplicate fetches) during the hidden pre-load render.
3. `app/[shop]/layout.tsx`: a definite 404 from `getShop` calls `notFound()` (unknown slug). New `app/not-found.tsx` shows `StorefrontErrorState variant="not-found"` with noindex. Backend unreachable still falls through to the client error state.
4. `NotFoundContent`: does not report to the 404 log while `loading` (the hidden pre-load copy), so each path is logged once.
5. `lib/policy-slugs.ts`: the slug-to-type map, shared by the policy page and its layout.
6. `app/store-not-found/page.tsx`: noindex metadata (proxy rewrite for an unknown host).
7. `proxy.ts` (a separate bug found on the way, needed for the "redirected URLs 301" requirement): see "Other findings".

Rejected alternatives:
- Do the checks in `proxy.ts` (what the Next docs suggest): needs a hand-kept route table (drift means a real page 404s) plus a second serial backend call per entity request that cannot reuse the layout's fetch; caching positives only would still be a new moving part.
- Server-render the whole shop (pass the shop to `ShopProvider` as initial data so `loading` is false at SSR): the proper long-term fix, but it SSRs ~25 client pages that were only ever mounted after the shop loaded; hydration and `window` risk, out of scope.
- Render `children` hidden on EVERY route while loading: SSRs every client page with `shop = null` and mounts it twice (duplicate fetches).
- Parallel route slot / route group with its own layout: the slot catch-all matches every URL; the group means moving every route directory.

## 4. AFTER (same shop, same script)

### production build
```
path: real home                    HTTP/1.1 200 OK         TTFB=0.038045 | robots=none | notfoundmarkers=0
path: missing under shop           HTTP/1.1 404 Not Found  TTFB=0.021480 | robots=<meta name="robots" content="noindex"/> | notfoundmarkers=1
path: missing deep                 HTTP/1.1 404 Not Found  TTFB=0.025663 | robots=<meta name="robots" content="noindex"/> | notfoundmarkers=1
path: missing product              HTTP/1.1 404 Not Found  TTFB=0.045025 | robots=<meta name="robots" content="noindex"/> | notfoundmarkers=1
path: real product                 HTTP/1.1 200 OK         TTFB=0.048170 | robots=none | notfoundmarkers=0
path: missing collection           HTTP/1.1 404 Not Found  TTFB=0.029573 | robots=<meta name="robots" content="noindex"/> | notfoundmarkers=1
path: real collection              HTTP/1.1 200 OK         TTFB=0.071327 | robots=none | notfoundmarkers=0
path: missing brand                HTTP/1.1 404 Not Found  TTFB=0.045623 | robots=<meta name="robots" content="noindex"/> | notfoundmarkers=1
path: bad policy type              HTTP/1.1 404 Not Found  TTFB=0.051404 | robots=<meta name="robots" content="noindex"/> | notfoundmarkers=1
path: unpublished policy           HTTP/1.1 404 Not Found  TTFB=0.034758 | robots=<meta name="robots" content="noindex"/> | notfoundmarkers=1
path: unknown order id             HTTP/1.1 200 OK         TTFB=0.083814 | robots=none | notfoundmarkers=0
path: unknown shop                 HTTP/1.1 404 Not Found  TTFB=0.013928 | robots=<meta name="robots" content="noindex"/> | notfoundmarkers=1
path: unknown shop deep            HTTP/1.1 404 Not Found  TTFB=0.040542 | robots=<meta name="robots" content="noindex"/> | notfoundmarkers=1
path: unpublished shop             HTTP/1.1 200 OK         TTFB=0.037273 | robots=none | notfoundmarkers=0
path: suspended shop               HTTP/1.1 404 Not Found  TTFB=0.013724 | robots=<meta name="robots" content="noindex"/> | notfoundmarkers=1
path: redirected (path mode, proxy skips) HTTP/1.1 404 Not Found  TTFB=0.030926 | robots=<meta name="robots" content="noindex"/> | notfoundmarkers=1
host: real home                    HTTP/1.1 200 OK         TTFB=0.027930 | robots=none | notfoundmarkers=0
host: missing                      HTTP/1.1 404 Not Found  TTFB=0.029886 | robots=<meta name="robots" content="noindex"/> | notfoundmarkers=1
host: missing product              HTTP/1.1 404 Not Found  TTFB=0.027403 | robots=<meta name="robots" content="noindex"/> | notfoundmarkers=1
host: real product                 HTTP/1.1 200 OK         TTFB=0.034498 | robots=none | notfoundmarkers=0
host: redirected                   HTTP/1.1 301 Moved Permanently location: /products/rose-bouquet TTFB=0.004118 | robots=none | notfoundmarkers=0
host: unknown host                 HTTP/1.1 404 Not Found  TTFB=0.009701 | robots=none | notfoundmarkers=1
host: unpublished                  HTTP/1.1 200 OK         TTFB=0.023369 | robots=none | notfoundmarkers=0
host: suspended                    HTTP/1.1 404 Not Found  TTFB=0.021760 | robots=<meta name="robots" content="noindex"/> | notfoundmarkers=1
```
`next dev` AFTER (13 spec cases pass, and an earlier run of the full script showed the same statuses).

### In a real browser (VERIFIED, `scratchpad/n6a-browser.js`, dev server)
```
/pw-e2e-.../nope 404 h1 ["Page not found"] header true robots noindex, 404-log reports 1
/pw-e2e-.../products/no-such 404 h1 ["Page not found"] header true robots noindex, reports 1
/pw-e2e-.../products/rose-bouquet 200 h1 ["Rose Bouquet"], no robots meta, reports 0
/pw-e2e-.../collections/flowers 200 h1 ["Flowers"]
/no-such-shop 404 h1 ["Store not found"] robots noindex
client nav (router.push) to a missing product -> not-found with shop header; then to a real product -> renders it
```
IMPORTANT nuance (VERIFIED): the 404 body is NOT the branded HTML. Next answers a not-found raised in the server render with the 404 status, the noindex meta and a bare error shell (`<html id="__next_error__">`); the branded UI is rendered by the client after hydration (this is standard Next behaviour, Fizz has no error boundaries). So `request.get` can assert status + noindex, and the branded body is asserted in a real browser in the same spec.

### Behaviour that is intentionally unchanged
- Real pages 200 (home, product, collection, policy that exists), unpublished shop 200 (ComingSoon is a client state, theme-builder preview needs it), redirect 301 (host mode), unknown host 404 (proxy rewrite, unchanged).
- TTFB (30 samples, localhost backend, production builds, median / p90): home 24 / 38 ms before, 15 / 19 ms after; product 28 / 39 before, 25 / 33 after; collection 24 / 33 before, 24 / 34 after. No measurable regression; the gate adds no second fetch (INFERRED for a remote backend: the SSR shell now waits for the layout's existing fetch on the four gated routes, which previously only the RSC stream waited for).

### Behaviour that changed (premise corrections, please read)
- **Suspended shops now return 404 (were 200).** The API answers a suspended shop and an unknown shop with the identical 404 on purpose (`/public/n6a-susp` 404), so the storefront cannot tell them apart. Keeping 200 for suspended is not possible without a backend change. Visible content was already "unavailable" client side; now the status and noindex match.
- Unwritten policy pages (valid type, shop has not written it) are now a real 404 with the generic "Page not found" copy instead of "This shop hasn't published this page yet" (the page still has that state as its client fallback).
- Missing products/collections/brands/policies now appear in the merchant's 404 report (ONB-4), because they render `NotFoundContent`.
- Product/collection pages for an unpublished shop are NOT gated (previewToken is invisible to a layout).

## 5. Tests and injection proofs

- `e2e/tests/soft-404.spec.ts` (13 cases, `request.get` plus 2 browser cases, seeds its own shop; `seedShop()` now also returns the signup `session` so it can create the 301 without spending a login on the per-IP throttle): passes on a production build and on `next dev` against my ports (3111/3311). I did not run the other specs or the full suite.
- `storefront/lib/not-found-gate.test.ts` (5 cases).
- Injection (dev server, CI mode): `{false && <div hidden>..}` in Body -> `missing URL #0 Expected 404 Received 200`; `if (false && missing ...) notFound()` -> `#2 (unknown product) Expected 404 Received 200`; proxy `Location: hit.location` -> `Expected 301 Received 500`; layout `if (false) notFound()` -> unknown shop `Expected 404 Received 200`; unit: dropping the `published` check fails 2 of 5. All restored.
- storefront: tsc clean, lint delta +0 (33), vitest 107 files / 869 tests before the last small edits (the new file's 5 pass after), `next build` ok, logical-properties and page-width guardrails clean. e2e `tsc` clean. No backend change.

## 6. Other findings

1. **BUG, fixed: every ONB-4 redirect returned 500.** `proxy.ts` built `new NextResponse(null, { headers: { Location: <relative path> } })`; Next's middleware adapter runs `new URL(location)` on it (`next/dist/server/web/adapter.js:382`) and throws `ERR_INVALID_URL`. Dev and prod. Fix: resolve against `request.url` first (Next relativises it again for the same host, the client still sees `Location: /products/rose-bouquet`). Covered by the spec.
2. Path mode (`/<shop>/old-page` on localhost) does not apply redirects by design, so it now 404s like any missing path.
3. Still soft 200 (left on purpose): `orders/[id]` (post-checkout page driven by sessionStorage, no server notion of existence), `orders/track`, `survey`, `cart/recover`, `pay`, `unsubscribe-notify` (token query strings on per-customer URLs, not linked or crawlable), `account/*` (login gated). Per-shop `sitemap.xml` for an unknown shop already 404s.
4. The server HTML of every storefront page is still only a skeleton (no content for crawlers without JS); this fix gives the right status and noindex, not SSR content. Passing the shop into `ShopProvider` as initial data is the real follow-up.
5. A 404 response now carries two noindex metas on `/store-not-found` (proxy rewrite status plus my metadata); harmless.
6. Not verified: the Playwright `webServer`/CI path itself (I ran my own spec only), a real iOS/Safari run, behaviour behind Caddy (INFERRED: `request.url` host comes from the Host header Caddy preserves).
