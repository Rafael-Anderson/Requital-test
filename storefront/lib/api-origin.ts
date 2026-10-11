// Which origin the storefront SERVER uses to reach the backend.
//
// NEXT_PUBLIC_API_URL is the PUBLIC API origin (https://api.requital.io in
// production): it is inlined into the browser bundle for `<img src>` URLs
// (resolveImageUrl) and must stay public. A server-side hop to that same
// origin leaves the VPS and re-enters Caddy, which overwrites X-Forwarded-For
// with the VPS's own address, so every storefront API call would share one
// throttle bucket and every shopper session would record the VPS address.
// INTERNAL_API_URL is the backend's local origin (http://127.0.0.1:3000) for the
// hops the Next server itself makes: the `/api/*` rewrite, SSR/RSC fetches and
// proxy.ts. Unset or blank means "same as NEXT_PUBLIC_API_URL", so dev, CI and
// e2e (which set only NEXT_PUBLIC_API_URL) behave exactly as before.
//
// Pure and import-free on purpose: next.config.ts imports it, and it is loaded
// outside the app's normal module graph.

export function resolveInternalApiOrigin(
  internal: string | undefined,
  publicUrl: string,
): string {
  const raw = internal?.trim();
  if (!raw) return publicUrl;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("INTERNAL_API_URL must be an absolute http(s) URL");
  }
  // Fail loudly: a typo here would silently send every storefront API call
  // somewhere else. No path, query or credentials either: callers append paths.
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "INTERNAL_API_URL must be an origin only, like http://127.0.0.1:3000",
    );
  }
  return url.origin;
}
