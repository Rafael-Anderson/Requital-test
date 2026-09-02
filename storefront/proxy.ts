import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isLocalHost } from "./lib/is-local-host";

// Runs on every real navigation (see matcher below) before the app/[shop]/...
// route tree ever sees the request. Requital's own tenant resolution is a
// path segment (/<shopSlug>/..., see app/page.tsx's own comment) — this
// file is what makes a request that arrives by *hostname* instead
// (Caddy's *.requital.io wildcard, or a merchant's connected custom domain,
// both routed to this app on :3002 — see CLAUDE.md's "Domains" section)
// land on that same route tree, by rewriting the path to prepend the
// resolved shop slug. Every existing /<shopSlug>/... page, layout, and data
// fetch is completely unaware this happened.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Last-known-good host -> subdomain, used ONLY when the resolve call fails
// (backend restart / blip). A wrong 404 for a real shop is worse than briefly
// stale-but-correct routing; the backend also owns a 30s fresh cache, so this
// only kicks in when it's actually unreachable. A genuinely-removed domain
// stops resolving here once GRACE_MS passes or the backend recovers and
// returns null. docs/plans/custom-domain-resolver.md Phase 6.
const GRACE_MS = 5 * 60 * 1000;
const lastGood = new Map<string, { subdomain: string; at: number }>();

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

  let subdomain: string | null = null;
  let backendReached = false;
  try {
    const res = await fetch(
      `${API_URL}/domains/resolve?host=${encodeURIComponent(hostname)}`,
    );
    backendReached = true;
    if (res.ok) {
      const data = (await res.json()) as { subdomain?: string };
      subdomain = data.subdomain ?? null;
    }
    // res not ok (404) => genuinely unknown host; leave subdomain null.
  } catch {
    // Backend unreachable — see the last-known-good fallback below.
    subdomain = null;
  }

  if (subdomain) {
    lastGood.set(hostname, { subdomain, at: Date.now() });
  } else if (!backendReached) {
    // Only when the backend couldn't be reached — a real 404 from it means the
    // host is genuinely unknown and must not be served from a stale entry.
    const cached = lastGood.get(hostname);
    if (cached && Date.now() - cached.at < GRACE_MS) {
      console.warn(
        `[proxy] /domains/resolve unreachable for "${hostname}" — serving last-known-good subdomain "${cached.subdomain}"`,
      );
      subdomain = cached.subdomain;
    } else {
      console.warn(
        `[proxy] /domains/resolve unreachable for "${hostname}" and no fresh last-known-good — 404`,
      );
    }
  }

  if (!subdomain) {
    return NextResponse.rewrite(new URL("/store-not-found", request.url), {
      status: 404,
    });
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
