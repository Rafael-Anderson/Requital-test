import type { NextConfig } from "next";

// Same backend origin the browser calls directly for every public API
// request (lib/api.ts) — img-src/connect-src must include it or every
// product thumbnail and fetch() call breaks under the CSP below.
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// script-src needs 'unsafe-inline' for Next's own inline hydration
// payloads — a nonce-based CSP would remove this but requires middleware
// this app deliberately doesn't have (tenant resolution is a path segment,
// not middleware-based domain routing — see CLAUDE.md). style-src needs it
// for shop-context.tsx's per-shop theme CSS custom properties, set directly
// on the root element. Tracked as a known, reviewed tradeoff, not an
// oversight — the other directives are still real restrictions.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // MapPickerLeaflet.tsx (checkout/account address entry) loads tiles
  // directly from CARTO's CDN in the browser — without this, the map
  // picker renders a grid of broken-image icons instead of a map.
  `img-src 'self' data: ${API_ORIGIN} https://*.basemaps.cartocdn.com`,
  `connect-src 'self' ${API_ORIGIN}`,
  "font-src 'self' data:",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
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
