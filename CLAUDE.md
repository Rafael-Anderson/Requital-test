# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Requital — a multi-tenant e-commerce "shop manager" SaaS (Salla/Zid/Dukan-style), built for UAE/Gulf florists and gift shops. Three independent apps in one repo:

- `backend/` — NestJS + Prisma + MySQL, shared by both frontends. Auth, products, categories, orders, outlets, dashboard/reporting, and payments (Stripe, strategy-pattern-ready for Telr/PayTabs/Tabby/Tamara) are implemented.
- `admin/` — Next.js Admin Panel (merchant-facing). Has a real UI: login/signup, sales dashboard, order management (kanban + history), inventory, category tree, outlet/branch management. See "Admin frontend" below.
- `storefront/` — Next.js Storefront (customer-facing, per-merchant branding). Still an untouched `create-next-app` scaffold — no app code written yet.

**Spec docs**: `BUILD_BRIEF.md` at the repo root is the entry point and points to `REQUITAL_SRS.md` as the full source-of-truth spec (Section 6 has the data model). The SRS is not currently present in the working tree — if it's missing, note that rather than guessing at requirements from memory. Per the build brief, the SRS also specifies things not yet built: i18n + Arabic/RTL, multi-currency, unlimited-depth attributes/variations, and a Customers module — the current implementation is a simpler, shipped-first version of that spec (single currency, no variations), not a divergence to "fix." Multi-outlet and the Kanban order pipeline, both listed in the SRS as future work, **have since been built** — see "Tenant isolation and outlet scoping" below; don't treat them as still-pending.

## Tenant isolation and outlet scoping

Every tenant-owned table carries `shopId`, and every query against one is scoped by it at the data-access layer — no code path may return one shop's data to another. This is no longer a hardcoded constant: real merchant auth exists, and every request derives `shopId` (and, for outlet-scoped resources, `outletId`) from the authenticated user, re-read from the DB on every request.

- **`AuthGuard`** (`backend/src/auth/guards/auth.guard.ts`) verifies the JWT, then re-fetches the user from the DB (not trusting token claims for role/outlet) and attaches a `TenantContext` (`backend/src/common/tenant-context.ts`: `{ userId, shopId, role: 'admin' | 'branch', outletId: number | null }`) to the request, injectable via the `@CurrentUser()` decorator. Re-reading on every request means a role change, outlet reassignment, or account deletion takes effect immediately rather than waiting out the 7-day token lifetime.
- **`RolesGuard`** + `@Roles('admin')` gates admin-only endpoints (outlet CRUD, branch-user creation). Both guards are wired as `APP_GUARD` providers in `AuthModule`; routes are protected by default and opt out with `@Public()`.
- **Two roles**: `admin` (full shop access, all outlets, aggregated dashboard) and `branch` (scoped to exactly one outlet, `outletId` is never null). Signing up always creates a Shop + a default Outlet + an Admin user in one `$transaction` (`AuthService.signup`). Only admins can create branch accounts, each pinned to one outlet.
- **`resolveOutletFilter(ctx, requestedOutletId?)`** (`backend/src/common/outlet-scope.ts`) is the single shared helper encoding the branch-override rule: a `branch` user's `ctx.outletId` always wins regardless of what the request asked for; an `admin` gets the requested outlet or `undefined` (no filter = all outlets). Every outlet-scoped read/write (orders, stock, dashboard) routes through this helper — do not hand-roll the branch/admin distinction elsewhere. `outlets.service.ts` has a documented gotcha: don't build the `where` clause as `{ id, shopId, ...(role==='branch' && { id: ctx.outletId }) }` — the spread silently overwrites the requested `id` last, turning "reject mismatched outlet" into "silently substitute my own outlet." Check `id !== ctx.outletId` explicitly instead.
- **Catalog vs. stock split**: Products/Categories stay shop-scoped (one shared catalog across all of a shop's outlets). Stock does not — `product.stockQuantity`/`lowStockThreshold` were removed from `Product` entirely and moved to the `outletstock` join table (composite PK `[outletId, productId]`). `trackInventory` (whether a product is stock-tracked at all) stays on `Product` since it's a catalog-level policy, not a per-outlet count. `GET /products` returns `stockQuantity: null` (not `0`) when no outlet is resolved (e.g. an admin viewing "all branches" without picking one) — that's distinct from a genuine zero-stock outlet.
- **Orders are outlet-scoped**: `order.outletId` is a required FK. On create, a branch user's `outletId` is always forced server-side to `ctx.outletId` — any `outletId` they supply in the body is silently ignored, never honored. Admins may specify one.
- **Security regression suite**: `backend/test/security-outlet-isolation.e2e-spec.ts` is the living proof this holds — it spoofs `outletId`/order ids across outlets and across shops (branch user, admin, and cross-tenant) on every outlet-scoped endpoint and asserts each either silently re-scopes or 404s, never leaks. Run it (`npm run test:e2e -- security-outlet-isolation`) after touching any tenant- or outlet-scoped query path; it already caught one real bug (the `outlets.service.ts` spread-overwrite above) that reasoning-only review missed.

## Next.js version warning

`admin/AGENTS.md` and `storefront/AGENTS.md` (referenced from each app's `CLAUDE.md` via `@AGENTS.md`) warn that this is Next 16, which has breaking API/convention changes from what training data assumes — read `node_modules/next/dist/docs/` before writing Next.js code in either app. Confirmed in practice: route `params`/`searchParams` are `Promise`s that must be `await`ed in Server Components; client components should use the `useParams()`/`useSearchParams()` hooks instead of destructuring props.

## Commands

### backend/ (NestJS)

```bash
npm run start:dev        # dev server with watch mode, http://localhost:3000 (see port note below)
npm run build             # nest build
npm run lint               # eslint --fix
npm run test                # jest, all unit tests (*.spec.ts, colocated with source)
npm run test -- app.controller     # run a single spec by filename match
npm run test:watch
npm run test:e2e            # jest against test/*.e2e-spec.ts (real AppModule + real dev MySQL DB, not mocked)
npm run test:e2e -- security-outlet-isolation   # run a single e2e spec by filename match
```

Prisma — this project's `prisma migrate dev` cannot run in a non-interactive shell (it refuses with "Prisma Migrate has detected that the environment is non-interactive"). Migrations here are hand-authored instead:

```bash
npx prisma generate                          # regenerate client after schema.prisma changes
npx prisma migrate deploy                    # applies any pending migration folders
npx prisma db seed                            # run prisma/seed.ts
npx prisma studio                             # browse local data
```

Make the timestamped folder under `prisma/migrations/` by hand and write `migration.sql` yourself (expand/contract for anything that backfills: add nullable column → backfill via `UPDATE ... JOIN` → tighten to `NOT NULL` → add FK/index). `migrate deploy` picks up any folder containing a `migration.sql`.

**Never pass the primary `DATABASE_URL` as `--shadow-database-url` to `prisma migrate diff`** — Prisma resets whatever database that URL points to as part of its shadow-db workflow. This has happened before in this project (recovered via `prisma migrate resolve --applied` re-baselining against the existing table structure); treat the shadow-db flag as write-destructive to its target, full stop.

`backend/.env` holds `DATABASE_URL` (MySQL), `JWT_SECRET`, `ADMIN_ORIGINS` (comma-separated CORS allowlist for the admin frontend's origin(s)), plus `PAYMENT_PROVIDER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STOREFRONT_URL` (used to build payment-link URLs). There is no `.env.example`. **Percent-encode special characters in the DB password** (e.g. `#` → `%23`, `@` → `%40`) — an unescaped character silently breaks the connection string. e2e specs `import 'dotenv/config'` at the top of the file since `main.ts`'s bootstrap (which would otherwise load env vars) never runs under Jest.

`prisma/seed.ts` creates a dev admin login: `admin@test-shop.com` / `dev-password-123`, plus a "Main Branch" outlet.

### admin/ and storefront/ (Next.js)

```bash
npm run dev      # next dev
npm run build    # next build
npm run lint      # eslint
```

`admin/.env.local` sets `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:3000`) — the browser calls the NestJS backend directly, client-side, rather than through Next.js API routes.

**Port note**: none of the three apps pin a port. If you start backend first it takes 3000; whichever Next app starts next auto-increments to the next free port (typically admin → 3001, storefront → 3002), but simultaneous startup is a race — Next's dev server binds faster than Nest's, so starting them all at once can leave backend crashing with `EADDRINUSE` after a Next app grabs 3000 first. Start backend, wait for it to actually respond, then start the Next apps.

## Backend architecture

- **PrismaModule** (`src/prisma/`) is `@Global()` — `PrismaService` is injectable anywhere without re-importing the module.
- **Feature modules** follow the standard Nest triad: `<feature>.module.ts` / `.controller.ts` / `.service.ts`, with request/response shapes in `dto/`. Modules: `auth/` (signup/login/me/branch-user management), `outlets/` (outlet CRUD, admin-only mutations), `products/`, `categories/`, `orders/`, `dashboard/` (read-only reporting), `payments/`.
- **Validation**: a global `ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true, transform: true`) is set in `main.ts`. DTOs must use `class-validator`/`class-transformer` decorators — unvalidated fields are silently stripped, not passed through. Type-only imports referenced in a decorated class member must use `import type` (or a namespace import) — plain imports fail the build under `isolatedModules` + `emitDecoratorMetadata`.
- **Auth mechanism**: hand-rolled JWT via `@nestjs/jwt` (no Passport — one guard reading `Authorization: Bearer <token>` is simpler than a strategy layer for a single auth method) and `bcryptjs` (pure JS, not native `bcrypt`, to avoid node-gyp compilation on Windows dev machines). Every route is protected by default via guards registered as `APP_GUARD`; use `@Public()` to opt a route out (signup, login, the payment checkout/webhook endpoints) and `@Roles('admin')` to further restrict one. See "Tenant isolation and outlet scoping" above for the `TenantContext`/`resolveOutletFilter` pattern every feature module routes through.
- **Prisma model naming**: model names in `schema.prisma` are lowercase singular (`product`, `order`, `orderitem`, `outletstock`, `paymenttransaction`, ...) rather than the more common PascalCase Nest/Prisma convention, with no `@@map` reconciling them to the DB's differently-cased table names. This only works because local MySQL is case-insensitive for identifiers (Windows default) — keep new models consistent with the existing lowercase style, but be aware this could break on a case-sensitive MySQL host.
- **Many-to-many relations** (Product↔Category, Product↔Tag) use explicit join models (`productcategory`, `producttag`) with composite `@@id`, not Prisma's implicit many-to-many — follow this pattern for future join tables so cascade behavior and indexes stay explicit. `outletstock` (composite PK `[outletId, productId]`) follows the same style.
- **Order status transitions are compare-and-swap, not read-then-write.** `OrdersService.updateStatus`/`.cancel` re-check the row's status inside the same `$transaction` via `updateMany({ where: { id, status: <expected>, outletId: order.outletId } })` and inspect `result.count` — this is load-bearing, not incidental style. A plain `findOne` then `update` has a real race: two concurrent "confirm" calls on the same order would both read `pending` and both decrement stock. The CAS pattern means only one write can match per transition; the loser gets a `ConflictException` (409) instead of silently double-applying a stock change. The `outletId` in the `where` clause is defense-in-depth on top of the outlet-scope check already done in `findOne`. Follow this pattern for any future status-driven side effect (stock, payment, notifications) — don't revert to a plain `update`.
- **Stock is decremented on `pending → confirmed`, not on order creation** (so an abandoned cart never holds stock hostage), and restored on cancellation from any status where it was already decremented. `OrdersService.adjustStockForOrder` upserts into `outletstock` keyed by `[outletId, productId]`, not `product.stockQuantity` (removed — see "Tenant isolation and outlet scoping").
- **Payments use a strategy pattern**: `payments/payment-provider.interface.ts` defines `PaymentProvider` (`createCheckoutSession`, `parseWebhookEvent`); `payments/providers/stripe-payment.provider.ts` is the only implementation so far. `PaymentsModule` picks the provider via a factory keyed on `process.env.PAYMENT_PROVIDER`. Adding Telr/PayTabs/Tabby/Tamara means a new file under `providers/` plus a `case` in that factory — `PaymentsService` and the controllers never reference a gateway SDK directly. The Stripe client itself is constructed lazily (on first use, not in the constructor) so a shop without Stripe keys configured doesn't crash the whole app at boot.
- **Webhook idempotency**: `paymenttransaction` has a `@@unique([gateway, gatewayReference])` constraint, and the idempotency key is the gateway's *event* id (Stripe's `event.id`), not the object the event is about (a checkout session id can't tell two different events about the same session apart). `PaymentsService.handleWebhook` relies on that unique constraint failing — catching both Prisma `P2002` (duplicate key, the common case) and `P2034` (write conflict/deadlock, observed under truly concurrent duplicate delivery) as "already processed, no-op." Don't replace this with a `findFirst`-then-`create` check — that's exactly the TOCTOU race this design avoids.
- **Raw body for webhooks**: `main.ts` passes `{ rawBody: true }` to `NestFactory.create`; the webhook controller reads `req.rawBody` (typed via `RawBodyRequest<Request>` from `@nestjs/common`) because Stripe signature verification needs the exact unparsed bytes, not the JSON-parsed body.
- **Dashboard date math is UAE-local (UTC+4), not server-local or UTC.** `DashboardService` computes "today"/"this week"/"this month" boundaries by shifting into a hardcoded +4h offset before truncating — UAE doesn't observe DST, so this is a stable constant, not a shortcut that will drift. The 30-day daily revenue series and top-products query use raw parameterized `$queryRaw`/`Prisma.sql` (`DATE(DATE_ADD(createdAt, INTERVAL 4 HOUR))`, plus a conditional `AND outletId = ${outletId}` fragment via `Prisma.sql`/`Prisma.empty`) rather than Prisma's `groupBy`, which can't group by a derived/truncated expression.
- **CORS** is an explicit allowlist (`ADMIN_ORIGINS` env var, comma-split) passed to `app.enableCors({ origin })` in `main.ts` — not `app.enableCors()` wide-open. Auth is JWT-header-based (`Authorization: Bearer`), so `credentials: true` is not needed.

## Admin frontend (`admin/`)

- Plain `fetch` wrapper in `lib/api.ts` (`apiFetch<T>`) calling the backend directly from the browser via `NEXT_PUBLIC_API_URL` — no server actions/route handlers, no data-fetching library (no SWR/React Query). Every page is a client component (`"use client"`) that fetches in `useEffect` and re-fetches after mutations by calling the same `refresh()` closure. The orders list additionally polls every 20s (`POLL_INTERVAL_MS` in `app/orders/page.tsx`) for near-real-time updates — deliberately polling, not a websocket/SSE channel. `apiFetch` attaches `Authorization: Bearer <token>` from `localStorage` (via `getToken()`/`setToken()`/`clearToken()`, SSR-safe behind `typeof window` guards) and clears the token on any `401`.
- **Auth/routing**: `lib/auth-context.tsx` (`AuthProvider`/`useAuth()`) hydrates the current user from `api.me()` on mount if a token exists. `components/RequireAuth.tsx` gates the whole app (wrapped in `app/layout.tsx`, inside `AuthProvider`/`OutletFilterProvider`) — redirects unauthenticated users to `/login`, and redirects authenticated users away from `/login`/`/signup`.
- **Outlet filtering**: `lib/outlet-context.tsx` (`OutletFilterProvider`/`useOutletFilter()`) fetches the outlet list once a user is known; `selectedOutletId` defaults to `null` ("all branches") for admins and is force-pinned to `user.outletId` for branch users, with `setSelectedOutletId` a no-op for branch role. This is UX-only belt-and-suspenders — the real enforcement is server-side (`resolveOutletFilter`) and does not depend on this frontend behaving correctly. `components/OutletSwitcher.tsx` renders `null` entirely for non-admins (hidden, not just disabled/filtered), per the project's explicit requirement that branch users never even see a switcher. Orders (kanban + history), Inventory, and the Dashboard all read `selectedOutletId` and pass it through to their API calls.
- **`/outlets`** (`app/outlets/page.tsx`) is the outlet + branch-account management page: client-side redirects non-admins away (`useEffect` checking `user.role !== 'admin'`), which is UX-only — every mutating endpoint it calls is independently `@Roles('admin')`-gated server-side.
- Shared response/DTO shapes live in `lib/types.ts` and must be kept in sync with the backend DTOs by hand (no generated client).
- **`components/ui/`** is a small local design-system: `Table`/`THead`/`TBody`/`TH`/`TR`/`TD`, `StatCard`, `Skeleton`/`TableSkeleton`/`CardSkeleton`, `Button`, `Input`, `Textarea`, `Checkbox`, `EmptyState`, and a `Toast`/`useToast` context (`ToastProvider` wraps the app in `layout.tsx`; call `useToast()` from any client component instead of `alert()`). `StatusBadge` (order/payment status pill) lives at `components/StatusBadge.tsx`, not under `ui/`, for historical reasons.
- Several of these primitives were adapted from specific 21st.dev community components (translated from shadcn/Tremor CSS-variable classes to this project's plain Tailwind palette, since there's no shadcn theme installed here) — each carries a comment at the top of its file with the source URL and author for attribution. Check those comments before assuming a pattern is original.
- Page transitions and toast entrances are CSS-only (`page-transition` / `toast-enter` keyframe classes in `app/globals.css`), no animation library. `page-transition` is applied per-page (on each page's own root element), not on the shared `<main>` in `layout.tsx` — `layout.tsx` never remounts on navigation, so a class placed there would only ever play once. There is no persistent sidebar — each page starts with a `BackHome` link back to a home tile-grid; follow this pattern for new pages rather than adding nav chrome.
- Known pre-existing lint gap: `npm run lint` flags `react-hooks/set-state-in-effect` on the `useEffect(() => { refresh(); }, [refresh])` fetch-on-mount pattern used across the data pages. `next build` does not fail on it. Not yet fixed — flagged here rather than fixed silently in an unrelated change, since resolving it means restructuring the fetch pattern across every page.
