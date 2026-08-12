// Shared between proxy.ts (deciding whether to rewrite a hostname-resolved
// request onto /[shop]/...) and any server component that needs to build an
// internal redirect matching whichever mode the CURRENT request arrived
// through (see ProductRoute's legacy-id redirect) — both must agree on
// exactly what counts as "local", or a redirect built in one context could
// end up prefixed wrong for the other.
export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".local");
}
