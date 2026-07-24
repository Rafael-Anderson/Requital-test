# Requital — Build Brief (Claude Code Entry Point)

> Read this first, then `REQUITAL_SRS.md` for the full spec. This file is the "where to start" pointer; the SRS is the source of truth.

## What this is
Multi-tenant ecommerce SaaS ("shop manager", like Salla/Zid/Dukan). Two separate Next.js frontends (Admin Panel, Storefront) + one shared NestJS/Prisma/MySQL backend. Every record scoped by `shop_id`.

## Repo state (verified)
- `backend/` (NestJS), `admin/` (Next.js), `storefront/` (Next.js) all scaffolded and pushed.
- MySQL running locally: `localhost:3306`, database `shop_manager`.
- Prisma initialized and connected; `prisma db pull` succeeded, 8 models already in `schema.prisma`.

## THE non-negotiable rule
**Tenant isolation by `shop_id`.** Every query on a tenant-owned table must be scoped by `shop_id` at the data-access layer. No code path may return one shop's data to another. Build a tenant-scoped access pattern from the start, even while Phase 1 is hardcoded to one shop.

## Important: this SRS changed key things from earlier assumptions
1. **Separate top-level domains per merchant** (`merchantname.com`), NOT subdomains of a shared platform domain. Affects storefront tenant-resolution.
2. **i18n + multi-currency are launch scope, not deferred.** English default + **Arabic with full RTL** at launch. **AED default** currency, others selectable. Externalize ALL UI strings and make money currency-aware from day one — retrofitting later is painful.
3. **Order pipeline:** New → Scheduled / In Preparation → In Route → Ready (Kanban; accept-then-route by fulfilment day). See FR-6.1.
4. **Rich catalogue:** unlimited-depth nested categories (self-referencing `parent_category_id`), product↔category many-to-many, reusable Attributes/AttributeValues → per-variation pricing.
5. **Multi-outlet:** one business, many outlets; orders attribute to an outlet.
6. **Large Customers module** (corporate credit, loyalty, encrypted document attachments, comms logs) — not Phase 1, but shapes the schema.

## Payments
Stripe + Nomod. Nomod bundles cards + Tabby + Tamara + Apple Pay + Google Pay in ONE integration (not four). Never store raw card data — gateways handle capture/tokenization. Credentials are tenant-scoped and stored encrypted.

## PHASE 1 — start here (ignore all advanced modules for now)
1. `cd backend && npx prisma generate`; confirm the Prisma client connects to MySQL.
2. Build the **Product** module in NestJS: controller, service, DTOs, tenant-scoped Prisma access.
3. Endpoints: `GET /products`, `GET /products/:id`, `POST /products`, `PATCH /products/:id`, `DELETE /products/:id`.
4. **Hardcode `shop_id = 1`** for now (merchant onboarding is Phase 2) — but route every query through the tenant-scoped pattern so Phase 2 is a small change.
5. Seed one shop (`shop_id = 1`) + a couple of categories/products for testing.
6. Test every endpoint (Postman/Thunder Client) before building any UI.

## Phase order after that
Multi-tenancy + merchant registration → categories/attributes/variations → orders (Kanban) → customers → theme/storefront → payments (Stripe + Nomod) → reports → i18n/RTL polish.

## Data model (SRS §6 — grow into this, don't build it all at once)
`Shop`, `User`, `Category` (tree), `Product`, `ProductCategory` (join), `Attribute`, `AttributeValue`, `ProductVariation`, `Outlet`, `Order`, `OrderItem`, `Delivery`, `Customer`, `CustomerAttachment`, `CustomerCommunicationLog`, `SiteSettings/Theme`, `Slider`, `PaymentGatewayConfig`. Every table carries `shop_id`.

## Open questions — do NOT invent answers
Several items are flagged pending in SRS §9. None block Phase 1. If you hit one (e.g. the "tax vs tags" product field FR-4.2, password/session policy, storefront-vs-admin customer reconciliation), leave a clear `// TODO: confirm with client` rather than guessing.
