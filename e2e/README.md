# Playwright browser E2E (Phase 9)

Critical-path browser tests spanning all three apps (backend :3000, admin
:3001, storefront :3002) — a foundation, not full coverage. See the 4 spec
files in `tests/` for exactly what's covered.

## Running locally

1. Start all three apps first, each on its expected port (backend must be
   up before the Next apps — see the root CLAUDE.md's "Port note"):
   ```
   # backend/
   npm run start:dev
   # admin/
   npx next dev -p 3001
   # storefront/
   npx next dev -p 3002
   ```
2. `cd e2e && npm install && npx playwright install --with-deps chromium`
   (one-time)
3. `npm test`

Override the default ports/hosts via `E2E_API_URL` / `E2E_ADMIN_URL` /
`E2E_STOREFRONT_URL` if needed (see `urls.ts`).

## How seeding works

`global-setup.ts` runs once before every spec, calling `seed.ts`'s
`seedShop()` against the real backend API (signup, a category, a simple
product, a variant product with 2 variants, the outlet signup already
creates, and a customer + one pending order via a real guest checkout) and
writes the result to `.tmp/seed-state.json`. Each spec file reads it back
via `state.ts`'s `readSeedState()` — a file, not an in-memory export,
because Playwright runs each spec file in its own worker process.

Every run gets a fresh shop (subdomain suffixed with the run's own
timestamp) so repeated runs against the same long-lived dev database never
collide on a unique subdomain/SKU/email — the fixture *shape* is
deterministic, not the exact ids.

Tests run serially (`fullyParallel: false`, `workers: 1`) on purpose: the
kanban spec advances the one seeded order's status, so racing specs against
shared fixture state would be a self-inflicted flake to chase, not a real one.

## What's covered vs. not

Per spec file:
- `merchant-onboarding.spec.ts` — signup wizard (all 4 steps) → lands
  authenticated → creates a product in Simple mode → switches to Advanced
  mode → creates a second product there → publishes the shop.
- `customer-checkout.spec.ts` — browse → PDP → select a variant → add to
  cart → checkout (pickup + cash on pickup) → order confirmation.
- `order-kanban.spec.ts` — logs in, finds the seeded order on the kanban,
  advances pending → confirmed via its own button (this board is
  button-driven, not drag-and-drop), opens the detail modal.
- `password-reset.spec.ts` — forgot-password → dev reset link (via a direct
  API call, same as the backend's own e2e suite's dev-link pattern — no real
  inbox) → reset → auto-redirect to /login → logs in with the new password.

Not covered (deliberate, foundation-only per the task): draft orders,
returns/refunds, discounts, gift cards, affiliate flows, theme editor,
CSV import/export, scan-to-stock, any BNPL/card payment gateway (only cash
on pickup is exercised — it needs no external gateway interaction).

## Known findings from building this (not fixed here, out of scope)

- The signup wizard's "Welcome, {name}!" success modal is effectively
  unreachable: `handleCreateAccount` sets `user` in `AuthContext`
  synchronously with `setSuccessOpen(true)`, and `RequireAuth`'s
  guest-only-path redirect (`/signup` → `/`) reacts to that same `user`
  update — the redirect won every time this was tested locally, unmounting
  the modal before it could ever be observed (by a real user or this spec).
  See `merchant-onboarding.spec.ts`'s own comment.
- `CheckoutSinglePage.tsx`'s Name/Phone fields render a `<label>` next to an
  `<input>` with no `htmlFor`/`id` pairing — a real accessibility gap
  (`getByLabel` can't find them; `customer-checkout.spec.ts` works around it
  with a text-anchored locator instead).
- A freshly-navigated route's file input can be selected via
  `setInputFiles` before it's actually attached to the DOM (Turbopack
  compiles routes on demand) — silently no-ops the file selection instead
  of erroring or waiting. Worked around with an explicit
  `waitFor({ state: 'attached' })` before every `setInputFiles` call in
  `merchant-onboarding.spec.ts`; worth the same treatment anywhere else in
  this app that uploads a file right after a fresh navigation.
