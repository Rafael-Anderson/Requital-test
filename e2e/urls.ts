// Overridable via env so CI can pin explicit ports (see the "Port note" in
// the root CLAUDE.md — none of the 3 apps pin a port by default, so CI
// starts each with an explicit -p flag and passes the matching URLs here).
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
export const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'http://localhost:3001';
export const STOREFRONT_URL = process.env.E2E_STOREFRONT_URL ?? 'http://localhost:3002';
