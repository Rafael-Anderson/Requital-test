import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isLocalHost } from "./lib/is-local-host";
import { createRedirectStore } from "./lib/redirect-map";
import { resolveInternalApiOrigin } from "./lib/api-origin";
import { createHostResolver } from "./lib/host-resolver";
import { clientIpFromForwardedFor, internalAuthHeaders } from "./lib/internal-auth";

// Runs on every real navigation (see matcher below) before the app/[shop]/...
// route tree ever sees the request. Requital's own tenant resolution is a
// path segment (/<shopSlug>/..., see app/page.tsx's own comment) — this
// file is what makes a request that arrives by *hostname* instead
// (Caddy's *.requital.io wildcard, or a merchant's connected custom domain,
// both routed to this app on :3002 — see CLAUDE.md's "Domains" section)
// land on that same route tree, by rewriting the path to prepend the
// resolved shop slug. Every existing /<shopSlug>/... page, layout, and data
// fetch is completely unaware this happened.
// Server-to-backend calls (domain resolve, redirect map) use the local origin
// when INTERNAL_API_URL is set, else the public one (lib/api-origin.ts).
const API_URL = resolveInternalApiOrigin(
  process.env.INTERNAL_API_URL,
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
);

// host -> subdomain, with a short positive cache and last-known-good fallback
// (lib/host-resolver.ts). Only a backend 404 means "unknown host".
const hosts = createHostResolver({ apiUrl: API_URL, headersFor: (url, ip) => internalAuthHeaders("GET", url, ip) });

// ONB-4 URL redirects: a per-shop cached map, matched in-process (see
// lib/redirect-map.ts for why this is not a backend call per request).
const redirects = createRedirectStore({ apiUrl: API_URL, headersFor: (m, url) => internalAuthHeaders(m, url) });

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = request.headers.get("host") ?? "";
  const hostname = host.split(":")[0];

  // `/api/*` is the same-origin backend proxy (next.config rewrites, Phase 5).
  // Middleware runs before rewrites — without this, a hostname-resolved
  // `/api/public/x` would get prepended with the shop slug and never reach the
  // rewrite. The matcher below also excludes it; this is belt-and-braces.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Local dev (and any *.local hostname) never went through Caddy's
  // domain-routing in the first place — keep the existing manual
  // /<shopSlug>/... path testing flow working exactly as before.
  if (!hostname || isLocalHost(hostname)) {
    return NextResponse.next();
  }

  const resolved = await hosts.resolve(hostname, clientIpFromForwardedFor(request.headers.get("x-forwarded-for")));
  if (resolved.kind === "unavailable") {
    // The backend could not say (throttled, down, slow): a temporary condition,
    // never a "this store does not exist" 404 that crawlers and CDNs would keep.
    return new NextResponse("Service temporarily unavailable", {
      status: 503,
      headers: { "Retry-After": resolved.retryAfter, "Cache-Control": "no-store" },
    });
  }
  if (resolved.kind === "unknown") {
    return NextResponse.rewrite(new URL("/store-not-found", request.url), {
      status: 404,
    });
  }
  const subdomain = resolved.subdomain;

  // Old-URL redirects (ONB-4), before the page tree can 404 on them. Only for
  // page reads, never the home page, and never allowed to break the request:
  // any failure inside the store already resolves to "no redirect".
  if ((request.method === "GET" || request.method === "HEAD") && pathname !== "/") {
    const hit = await redirects.lookup(subdomain, pathname, search).catch(() => null);
    if (hit) {
      // Next's middleware adapter runs `new URL(Location)` on a response and a
      // bare relative path throws (a 500 in dev and prod), so resolve it against
      // the request first. When it lands on the request's own host Next turns it
      // back into a relative Location, so the client still sees a relative one.
      // 301s are cached by browsers for an hour, not forever, so a mistaken
      // redirect heals soon after it is fixed.
      return new NextResponse(null, {
        status: hit.status,
        headers: {
          Location: new URL(hit.location, request.url).toString(),
          "Cache-Control": hit.status === 301 ? "public, max-age=3600" : "no-store",
        },
      });
    }
  }

  return NextResponse.rewrite(
    new URL(`/${subdomain}${pathname}${search}`, request.url),
  );
}

export const config = {
  matcher: [
    // Skip static assets, image optimization, and metadata files — none of
    // these are ever shop-specific, and resolving a host on every one of
    // them would be pure overhead. /store-not-found itself is also excluded
    // so the rewrite above doesn't get intercepted again on its own way in.
    // `api/` is the same-origin backend proxy (next.config rewrites) — it must
    // reach the rewrite untouched, not be prefixed with a shop slug.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|store-not-found|api/).*)",
  ],
};
