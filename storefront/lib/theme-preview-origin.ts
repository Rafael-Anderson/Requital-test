// Origin allowlist for the live theme-builder preview's postMessage
// channel — mirrors backend/src/main.ts's own CORS allowlist shape (a
// dev-configurable origin plus a fixed production admin origin). No shared
// package between admin/storefront, same convention as every other
// cross-app constant in this codebase.
const DEV_ADMIN_ORIGIN = process.env.NEXT_PUBLIC_ADMIN_ORIGIN ?? "http://localhost:3001";
const PROD_ADMIN_ORIGIN = "https://admin.requital.io";

export function isTrustedAdminOrigin(origin: string): boolean {
  return origin === DEV_ADMIN_ORIGIN || origin === PROD_ADMIN_ORIGIN;
}
