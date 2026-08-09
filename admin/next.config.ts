import type { NextConfig } from "next";

// Same backend origin the browser calls directly for every API request
// (lib/api.ts) — img-src/connect-src must include it or every product
// thumbnail and fetch() call breaks under the CSP below.
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// script-src needs 'unsafe-inline' for the dark-mode init script in
// app/layout.tsx's <head> (must run before paint, so it can't be an external
// bundle) and for Next's own inline hydration payloads — a nonce-based CSP
// would remove this but requires middleware this app deliberately doesn't
// have (see CLAUDE.md). style-src needs it for React's own inline `style`
// attributes used throughout components/ui. Tracked as a known, reviewed
// tradeoff, not an oversight — the other directives are still real
// restrictions (no object embeds, no framing, no foreign form targets).
// 'unsafe-eval' is dev-only — React dev mode needs eval() to reconstruct
// callstacks for its debugging features (never used in production builds),
// so it's added only when NODE_ENV isn't "production" rather than left out
// entirely (which breaks `next dev`) or left in always (which would be a
// real production CSP weakening for no reason).
const isDev = process.env.NODE_ENV !== "production";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // MapPickerLeaflet.tsx (outlet address entry) loads tiles directly from
  // CARTO's CDN in the browser — without this, the map picker renders a
  // grid of broken-image icons instead of a map.
  `img-src 'self' data: ${API_ORIGIN} https://*.basemaps.cartocdn.com`,
  `connect-src 'self' ${API_ORIGIN}`,
  "font-src 'self' data:",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  // Phase B app restructure: Products split out of Inventory (which is now
  // ingredients/stock-only), and Discounts/Gift Cards/Draft Orders/Abandoned
  // Carts moved under Products/Orders as tabs. Real redirects (not
  // client-side stub pages) so bookmarked/shared old links still land
  // correctly. No redirect for bare /inventory or /inventory/categories —
  // both remain real, live routes (repurposed to ingredient content), not
  // dead links, and a route can't redirect to itself while also serving
  // its own page.
  //
  // Phase C terminology swap (Categories→Collections, Collections→Templates)
  // layered on top: /products/categories is the real, live route for the
  // renamed Collections (no redirect needed, same "can't redirect to itself"
  // reasoning). Templates — Phase C's rename of the old curated-grouping
  // model — was briefly its own top-level /templates route before joining
  // this same Phase B reorganization as /products/templates (catalog-
  // adjacent, same tier as Discounts/Gift Cards); both /collections (the
  // pre-rename top-level curated-grouping route) and /templates redirect
  // straight to the final /products/templates location.
  //
  // UI polish batch: Failed Jobs moved from a top-level homepage tile into
  // Settings (an internal ops/debugging view, not a merchant-facing app) —
  // /jobs redirects to /settings/jobs.
  async redirects() {
    return [
      { source: "/categories", destination: "/inventory/categories", permanent: true },
      { source: "/inventory/new", destination: "/products/new", permanent: true },
      { source: "/inventory/:id/edit", destination: "/products/:id/edit", permanent: true },
      { source: "/inventory/ingredients", destination: "/inventory", permanent: true },
      { source: "/discounts", destination: "/products/discounts", permanent: true },
      { source: "/gift-cards", destination: "/products/gift-cards", permanent: true },
      { source: "/draft-orders", destination: "/orders/draft-orders", permanent: true },
      { source: "/draft-orders/new", destination: "/orders/draft-orders/new", permanent: true },
      { source: "/draft-orders/:id", destination: "/orders/draft-orders/:id", permanent: true },
      { source: "/abandoned-carts", destination: "/orders/abandoned-carts", permanent: true },
      { source: "/collections", destination: "/products/templates", permanent: true },
      { source: "/collections/new", destination: "/products/templates/new", permanent: true },
      { source: "/collections/:id/edit", destination: "/products/templates/:id/edit", permanent: true },
      { source: "/templates", destination: "/products/templates", permanent: true },
      { source: "/templates/new", destination: "/products/templates/new", permanent: true },
      { source: "/templates/:id/edit", destination: "/products/templates/:id/edit", permanent: true },
      { source: "/jobs", destination: "/settings/jobs", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
