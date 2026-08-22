import type { NextConfig } from "next";

// Same backend origin the browser calls directly for every public API
// request (lib/api.ts) — img-src/connect-src must include it or every
// product thumbnail and fetch() call breaks under the CSP below.
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Mirrors lib/theme-preview-origin.ts's isTrustedAdminOrigin allowlist by
// hand (next.config.ts is loaded outside the app's normal module graph, so
// importing that file directly isn't safe here) — the only origins allowed
// to load this app inside an iframe, for the theme builder's live preview
// (admin/components/theme-builder/PreviewFrame.tsx). Every other origin,
// including this app's own storefront pages embedding each other
// cross-shop, stays blocked.
const DEV_ADMIN_ORIGIN = process.env.NEXT_PUBLIC_ADMIN_ORIGIN ?? "http://localhost:3001";
const PROD_ADMIN_ORIGIN = "https://admin.requital.io";

// script-src needs 'unsafe-inline' for Next's own inline hydration
// payloads — a nonce-based CSP would remove this but requires middleware
// this app deliberately doesn't have (tenant resolution is a path segment,
// not middleware-based domain routing — see CLAUDE.md). style-src needs it
// for shop-context.tsx's per-shop theme CSS custom properties, set directly
// on the root element. Tracked as a known, reviewed tradeoff, not an
// oversight — the other directives are still real restrictions.
const CSP = [
  "default-src 'self'",
  // https://maps.googleapis.com loads the Maps JS API script itself
  // (MapPicker.tsx, checkout/account address entry) — Google's own
  // documented CSP recipe for embedding the JS API.
  "script-src 'self' 'unsafe-inline' https://maps.googleapis.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // Map tiles/marker icons come from Google's domains; Roboto is the font
  // Google Maps' own UI (Autocomplete dropdown, etc.) requests.
  `img-src 'self' data: ${API_ORIGIN} https://maps.googleapis.com https://maps.gstatic.com`,
  `connect-src 'self' ${API_ORIGIN} https://maps.googleapis.com`,
  "font-src 'self' data: https://fonts.gstatic.com",
  "object-src 'none'",
  // 'self' covers this app embedding its own pages; the two admin origins
  // are what actually make the theme builder's preview iframe renderable —
  // without them the browser silently refuses to paint anything inside a
  // cross-origin iframe (blank box, no console error), regardless of
  // whether the iframe's own src resolves correctly.
  `frame-ancestors 'self' ${DEV_ADMIN_ORIGIN} ${PROD_ADMIN_ORIGIN}`,
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
          // No X-Frame-Options — it can only express DENY/SAMEORIGIN (no
          // allowlist), and CSP's frame-ancestors above already supersedes
          // it in every current browser when both are present. Framing
          // control lives entirely in frame-ancestors now.
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
