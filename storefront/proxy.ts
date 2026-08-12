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

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = request.headers.get("host") ?? "";
  const hostname = host.split(":")[0];

  // Local dev (and any *.local hostname) never went through Caddy's
  // domain-routing in the first place — keep the existing manual
  // /<shopSlug>/... path testing flow working exactly as before.
  if (!hostname || isLocalHost(hostname)) {
    return NextResponse.next();
  }

  let subdomain: string | null = null;
  try {
    const res = await fetch(
      `${API_URL}/domains/resolve?host=${encodeURIComponent(hostname)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as { subdomain?: string };
      subdomain = data.subdomain ?? null;
    }
  } catch {
    // Backend unreachable — fall through to the not-found page below rather
    // than letting an unresolved host hit app/page.tsx (which has no idea
    // what shop, if any, this request is for).
    subdomain = null;
  }

  if (!subdomain) {
    return NextResponse.rewrite(new URL("/store-not-found", request.url), {
      status: 404,
    });
  }

  return NextResponse.rewrite(new URL(`/${subdomain}${pathname}${search}`, request.url));
}

export const config = {
  matcher: [
    // Skip static assets, image optimization, and metadata files — none of
    // these are ever shop-specific, and resolving a host on every one of
    // them would be pure overhead. /store-not-found itself is also excluded
    // so the rewrite above doesn't get intercepted again on its own way in.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|store-not-found).*)",
  ],
};
