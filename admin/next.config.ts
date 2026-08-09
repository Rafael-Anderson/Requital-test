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
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
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
  // Categories moved from its own top-level page into a tab under
  // Inventory — kept as a real redirect (not a client-side stub page) so
  // any bookmarked/shared /categories link still lands correctly.
  // /collections (the old curated-grouping model) was renamed to /templates
  // as part of the Phase C Categories→Collections/Collections→Templates
  // terminology swap — same reasoning, real redirect for old bookmarks.
  async redirects() {
    return [
      { source: "/categories", destination: "/inventory/categories", permanent: true },
      { source: "/collections", destination: "/templates", permanent: true },
      { source: "/collections/new", destination: "/templates/new", permanent: true },
      { source: "/collections/:id/edit", destination: "/templates/:id/edit", permanent: true },
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
