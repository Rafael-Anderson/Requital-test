# Wire the custom-domain resolver

**Status: DONE — wired end to end (Phases 1–6, 2026-08-31).** A merchant can
connect a custom domain, prove ownership via DNS-TXT, get an auto-issued cert,
and their storefront (incl. a persistent customer session) works on it. This
also **unblocks `docs/plans/google-shopping-listing.md` Phase 4b** (custom-domain
shops on Google Shopping) — its `<head>` `google-site-verification` injection now
works on a live custom domain with nothing extra. Per-phase notes in §5; §7 has
the running checklist. Everything below the "framing" is the original plan, kept
for context.

**One-line framing:** the *mechanism* for custom domains is already in the tree —
schema, resolver, Caddy routing, on-demand TLS `ask` endpoint. What is missing is
(1) any check that a saved domain is real and controlled by the shop, (2) a
merchant UI to set it up, (3) a working customer session on a custom domain
(cookies are `SameSite=Strict` and the storefront calls the API cross-*site*).
"Wire it" = close those three gaps safely.

---

## 1. What exists today (the "built but not wired" part)

### 1.1 Schema

`shop.domainType` (`'subdomain' | 'custom'`), `shop.customDomain`
(`VARCHAR`, nullable, **`UNIQUE`**), `shop.subdomain` (set once at signup,
immutable — the internal routing key). Migration `20260819...`-era columns per
CLAUDE.md's "Domains" section.

### 1.2 Backend — `backend/src/domains/`

| Endpoint | Auth | What it does today |
|---|---|---|
| `GET /domains/verify?domain=` | `@Public()` | Caddy on-demand-TLS `ask` hook. Returns 200 iff `DomainsService.isKnownDomain(domain)` — i.e. the host is `<sub>.requital.io` for a real shop **or** appears in `shop.customDomain`. **No check that DNS points at us or that the shop owns the domain.** |
| `GET /domains/resolve?host=` | `@Public()` | Backs `storefront/proxy.ts`. `resolveSubdomain(host)`: if host ends `.requital.io` → match `shop.subdomain`; else → `SELECT subdomain FROM shop WHERE customDomain = ? AND domainType = 'custom'`. Exact-match unique lookup. |
| `isCustomDomain(domain)` | — | Used by `main.ts` CORS `origin` fn as the third fallback (after the `ADMIN_ORIGINS` allowlist and the `*.requital.io` regex). |

`DomainsService` does a fresh DB query per call. No cache.

### 1.3 Storefront — `storefront/proxy.ts`

Runs on every non-static request. Local host (`isLocalHost`) → passthrough.
Otherwise `fetch(${API}/domains/resolve?host=<Host>)` → rewrite
`/<subdomain><path>` onto the existing `app/[shop]/...` tree. Unresolved →
`/store-not-found` with a real 404. Backend unreachable → same 404 path.
**This part genuinely works** for a domain that is already in the column.

### 1.4 Caddy — repo copy at `deploy/Caddyfile` (mirrors the live VPS file)

**Corrected against the live `/etc/caddy/Caddyfile` (read over SSH 2026-08-31)**
— CLAUDE.md previously described the `*.requital.io` wildcard as on-demand TLS;
it is not. Site blocks, in precedence order:

1. `requital.io`, `www.requital.io` — 301 redirect to `admin.requital.io`
2. `admin.requital.io` → :3001 (automatic HTTP-01 cert)
3. `api.requital.io` → :3000 (automatic HTTP-01 cert)
4. `*.requital.io` → :3002 — **one Cloudflare DNS-01 wildcard cert**
   (`tls { dns cloudflare {env.CLOUDFLARE_API_TOKEN} }`). Every subdomain shop
   rides this proactively-issued wildcard. **Not on-demand TLS.**
5. `https://` catch-all → :3002 — `tls { on_demand }`. The **only** block using
   on-demand TLS. This is what serves a connected custom domain.

Only block 5's on-demand TLS consults the `ask` hook
(`on_demand_tls { ask http://localhost:3000/domains/verify }` in the global
block). So the **routing + cert mechanism for an arbitrary custom domain is
already in place** — it just trusts `/domains/verify`, which trusts the raw
column. `CLOUDFLARE_API_TOKEN` lives in `/etc/caddy/caddy.env` (not in the repo).

### 1.5 Merchant-facing surface

- `backend`: `GET /shop/domain` (`getDomainConfig`) + `PATCH /shop/domain`
  (`updateDomain`). `updateDomain` **only persists the string** (validates format
  via `isValidCustomDomain`, maps the unique-index conflict to 409). No
  verification, no DNS guidance, no status.
- `admin/lib/api.ts`: `getShopDomain()` / `updateShopDomain()` client fns +
  `storefrontUrlFor(shop)`.
- **These client fns were wired only into the signup wizard**
  (`useAccountSetupForm.ts` — the Business Info step's subdomain-vs-custom
  picker), with a stale code comment claiming a "Settings > Business Information"
  page existed. **Phase 3 (2026-08-31)** built the real page
  (`admin/app/settings/business/domain/`), added `verifyShopDomain()`, and made
  that comment accurate.
- Validators: `backend/src/shop/domain-validation.ts` (`isValidCustomDomain`),
  mirrored by hand in `admin/lib/validators.ts`. **Phase 1 (2026-08-31) tightened
  both** to reject the `requital.io` apex, any `.requital.io` host, and bare
  `RESERVED_SUBDOMAINS` labels.

### 1.6 Why it isn't wired

No single blocker — three unfinished edges:
- **No verification.** `updateDomain` trusts the input; `/domains/verify` trusts
  the column. Nothing proves the shop controls the domain or that it points here.
- **No merchant UX.** Nowhere to see "add this DNS record", verification status,
  or disconnect — outside the one-shot signup field.
- **Auth is broken on a custom domain** (see §2). This is the real reason no shop
  runs one with live traffic — a customer can't stay logged in.

---

## 2. The cookie-auth conflict — precise mechanism

### 2.1 The setup

The storefront browser bundle calls the API **directly**: `storefront/lib/api.ts`
uses `NEXT_PUBLIC_API_URL` (baked at build = `https://api.requital.io`), and
`authedFetch` sends `credentials: 'include'`. There is **no same-origin API proxy**
— every authenticated storefront request is a cross-origin browser call to
`api.requital.io`.

Customer session cookies (`backend/src/common/cookies.ts`):

```ts
sessionCookieOptions(path) => { httpOnly: true, secure: IS_PROD, sameSite: 'strict', path }
csrfCookieOptions(path)   => { httpOnly: true, secure: IS_PROD, sameSite: 'strict', path }
tieredCookieName(base)    => IS_PROD ? `__Host-${base}` : base
```

Set by `CustomerAuthController` for `req-customer-at` / `req-customer-rt` /
`req-customer-csrf`, Path-scoped to `/public/<shopSlug>`.

### 2.2 Same-site vs cross-site

- **`dff.requital.io` → `api.requital.io`:** cross-**origin**, same-**site**
  (both under the `requital.io` registrable domain). A `SameSite=Strict` cookie
  **is** sent. Works today.
- **`flowers.example.com` → `api.requital.io`:** cross-**site** (different
  registrable domains). A `SameSite=Strict` cookie is **never** attached — not on
  fetch/XHR, not even on top-level navigation.

### 2.3 What actually breaks

1. `POST https://api.requital.io/public/<slug>/auth/login` from
   `flowers.example.com`: the response `Set-Cookie` **may still be stored** (CORS
   `credentials: true` + a concrete allowed origin + `credentials:'include'`
   permits it, and `main.ts` CORS already allows a custom-domain origin via the
   `isCustomDomain` branch).
2. Every **subsequent** credentialed fetch from `flowers.example.com` to
   `api.requital.io` is cross-site → the `SameSite=Strict` `req-customer-at`
   cookie is **omitted**. `CustomerAuthGuard` re-reads the row every request,
   sees no token → **the customer is anonymous.** The cookie is sitting in the
   jar, just never sent. This is the "login doesn't persist" symptom.
3. The `req-customer-csrf` cookie (also Strict) is likewise never sent — but
   `customerCsrf` is configured `skipIfNoAccessCookie: true`, so CSRF is
   *skipped*, not *failed*. Net effect is "no session", not a visible 403.

### 2.4 `__Host-` prefix — a secondary constraint, not the primary blocker

In prod every customer cookie is `__Host-` prefixed → host-scoped to
`api.requital.io`, no `Domain` attribute possible. `SameSite` is the blocker;
`__Host-` just means the cookie is rigidly bound to `api.requital.io` and can
never be broadened to `flowers.example.com` by widening `Domain`. It matters only
for evaluating fixes: Option A (proxy) sidesteps it; Option B keeps `__Host-` on
`api.requital.io` and relaxes `SameSite` only.

### 2.5 Blast radius

**Customer tier only.** Staff (`admin.requital.io`) and platform admin
(`admin.requital.io/platform`) are never served from a custom domain — their
`SameSite=Strict` cookies are correct and untouched. The fix must be
customer-tier-only and ideally keyed on `DomainsService.isCustomDomain(origin)`
so subdomain shops keep `Strict`.

### 2.6 It is *not*

- Not CORS — `main.ts` already allows the custom-domain origin (`isCustomDomain`),
  with `credentials: true` and `exposedHeaders: ['X-CSRF-Token']`.
- Not JWT/host validation — `CustomerAuthGuard` validates the token signature +
  re-reads the customer row; it has no host assumption.
- Not CSP — no relevant directive here.
- Purely the cookie `SameSite` attribute on a cross-site request.

### 2.7 Fix options

> **DECIDED (CD1): Option A, applied to ALL storefront traffic.** Option B is
> recorded below for context only. See §6 and Phase 5.

**Option A — same-origin API proxy (chosen).**
The storefront calls a **relative** `/api/*` path; a `next.config` rewrite (or a
Caddy `reverse_proxy` in the storefront blocks) forwards `/api/*` →
`${NEXT_PUBLIC_API_URL}/*` server-side. From the browser's view every call is
**same-origin** with the storefront host (`flowers.example.com` or
`<sub>.requital.io`), so:
- `SameSite=Strict` is satisfied everywhere — no cookie-attribute change at all.
- The customer cookie can be set **first-party** on the storefront host.
- The storefront's cross-origin CORS surface to `api.requital.io` shrinks or
  disappears.
- Cost: storefront (Next server or Caddy) now carries API traffic — one proxy
  hop. At florist-shop scale, negligible. CLAUDE.md notes the storefront has no
  route handlers today; a `next.config` **rewrite** is declarative config, not a
  route handler, so it stays within the "no server actions/route handlers"
  convention. A Caddy `reverse_proxy` keeps it out of Next entirely.
- **Scope (CD1): all storefront traffic.** Every storefront→API call goes
  relative `/api/*` → rewrite, not just custom-domain ones. This removes the
  storefront's cross-origin relationship with `api.requital.io` completely, so
  `main.ts` CORS can drop the `*.requital.io` and `isCustomDomain` branches for
  storefront origins (admin keeps its `ADMIN_ORIGINS` entry). Trade-off: Phase 5
  now touches 100% of storefront traffic, so it must be regression-tested against
  a normal subdomain shop and the local/e2e bare-path flow, not only a
  custom-domain shop.

**Option B — `SameSite=None; Secure` carve-out for the customer tier on custom
domains. NOT CHOSEN — recorded for context.**
When issuing customer cookies for a request whose origin is a custom domain
(`DomainsService.isCustomDomain`), emit `sameSite: 'none', secure: true`. Cross-
site sending then works. Defence against the CSRF exposure `SameSite=None`
reintroduces still holds — the double-submit CSRF token lives **in memory** and
rides the `X-CSRF-Token` header (`common/csrf.ts`); an attacker page can't read
it, and `main.ts` CORS still refuses arbitrary origins so a cross-site response
body isn't readable anyway.
- Cost: two cookie shapes for one tier, keyed on a DB lookup — precisely the
  "one path forgets a check the other has" hazard CLAUDE.md's payment-toggle and
  cookie-migration notes warn about. Subtle to keep correct. Cheaper to build
  (a cookie-options branch, no proxy infra).

**Chosen: Option A, all storefront traffic (CD1).** Keeps `SameSite=Strict`
everywhere, adds no new auth shape, and simplifies the whole storefront↔API
origin story by removing the cross-origin relationship entirely.

---

## 3. What "wired" requires, end to end

| Piece | Today | Needed |
|---|---|---|
| **Merchant DNS instructions** | none (one signup field) | Settings → Domain page: the exact records to add (a `_requital-verify` TXT + the CNAME/A target), live status, "Verify now", "Disconnect". Wire the existing `getShopDomain`/`updateShopDomain` client fns. |
| **Ownership proof** | none | Per-claim token in `_requital-verify.<domain>` TXT; backend `dns.resolveTxt` check; domain stays `pending` until seen. Defuses unique-column squatting and is the mechanism Google verification reuses later. |
| **"Points at us" check** | implicit only (ACME fails if traffic doesn't reach the box) | `/domains/verify` (the Caddy `ask`) gates on `customDomainStatus = 'verified'`, so Caddy never even attempts ACME for an unblessed host. Optionally a pre-connect A/CNAME resolution check for a clearer merchant error. |
| **TLS for arbitrary domains** | Caddy on-demand TLS + `ask` (mechanism present) | Tighten: `ask` verified-gated (above); `on_demand_tls` `rate_limit`/`burst`; document ACME failure backoff; optional cert pre-warm on the `verified` transition. |
| **Resolver routing by Host** | works (`resolveSubdomain` handles custom domains) | Restrict matching to `verified` domains. Add a short-TTL cache (per-request DB hit on all storefront traffic today). Graceful degradation when `/domains/resolve` fails. |
| **Auth on a custom domain** | broken (§2) | Option A same-origin proxy (recommended). |
| **Caddyfile** | only on the VPS | Bring into the repo (`deploy/Caddyfile`) or fully document in `docs/runbook.md` — it's load-bearing for this feature. |

---

## 4. Multi-tenancy safety & abuse surface

1. **Unique-`customDomain` squatting.** The column is `UNIQUE` and `updateDomain`
   claims it immediately. Shop A can save a competitor's (or any) domain and 409
   shop B out of ever connecting it. **Mitigation:** a claim is `pending` and does
   not hold the *verified* namespace; global uniqueness is enforced only on
   `verified`. Losing/expired `pending` claims auto-release after a TTL. (→ CD2 —
   needs a status column + status-scoped uniqueness; MySQL has no partial unique
   index, so either a side table for pending claims or a generated-column trick.)
2. **`*.requital.io` / apex / reserved labels as a "custom" domain.**
   `isValidCustomDomain` currently accepts `evil.requital.io`. `resolveSubdomain`
   checks the `.requital.io` suffix branch first (so it can't *hijack* an
   existing subdomain), but this should never be allowed to enter the custom
   column at all. **Mitigation:** reject any host ending in the platform root
   domain, the apex itself, and the `RESERVED_SUBDOMAINS` labels — in
   `isValidCustomDomain` and the mirrored `admin/lib/validators.ts`. Cheap;
   Phase 1.
3. **On-demand TLS issuance abuse.** If `ask` blesses anything in the column, a
   squatted domain makes Caddy hammer ACME for a domain the attacker doesn't
   control → Let's Encrypt rate-limit burn (per-registered-domain + failed-
   validation limits) for the whole VPS, cert-store bloat. **Mitigation:** `ask`
   strictly gated on `verified`; `on_demand_tls { rate_limit, burst }`; backoff
   on repeated ACME failure for one host.
4. **Stale-DNS domain takeover.** A disconnects `flowers.example.com` but leaves
   DNS pointed here; B claims it. If B genuinely controls the DNS now (A's
   registration lapsed, B bought it) and passes TXT — legitimate transfer. The
   danger is B claiming **without** re-verifying and the resolver serving B on
   A's still-pointed domain. **Mitigation:** every connect *and re-connect*
   requires a fresh TXT verification; disconnect immediately flips status so both
   `ask` and `resolveSubdomain` stop honouring the host; rotate the per-claim
   token on disconnect so a lingering old TXT can't re-verify someone else's
   re-claim.
5. **Host → wrong-shop render.** The storefront renders whatever
   `resolveSubdomain(Host)` returns. Exact-match unique lookup on `verified`
   rows → deterministic. The API is always called with an explicit
   `/public/<shopSlug>` (the real subdomain), so even a mis-resolve can't cross
   tenant data on the API side — but it would render the wrong storefront.
   Uniqueness + rule 2 + verified-only matching keeps it tight. **Add an e2e** in
   the spirit of `security-outlet-isolation`: two shops + one domain; assert it
   resolves only to its verified owner, and a disconnected domain 404s.
6. **`/domains/resolve` + `/domains/verify` are unauthenticated** (they must be —
   Caddy and storefront SSR call them tokenless). Read-only, parameterised SQL,
   host-string input — no injection surface. Add rate limiting (hit on every TLS
   handshake / storefront request). `verify` is a yes/no oracle for "is this a
   connected domain", which is already public information (you can just visit the
   domain), so that's acceptable.
7. **Verification-token exposure.** The `_requital-verify` token only proves DNS
   control and is low-value; still, scope it per claim and rotate on disconnect
   (rule 4).

---

## 5. Phasing

Ordered, independently shippable, CI-green with tests. Adversarial multi-tenant
e2e per the `security-outlet-isolation` / `branch-roles` convention.

- **Phase 1 — validation hardening + data model. ✅ DONE 2026-08-31.**
  Migration `20260831120000_custom_domain_verification` adds dormant
  `shop.customDomainStatus` / `customDomainVerifyToken` / `customDomainVerifiedAt`
  (`backend/src/db/types.ts` updated by hand). `isValidCustomDomain` +
  `admin/lib/validators.ts`'s `validateCustomDomain` now reject the `requital.io`
  apex, any `.requital.io` host, and bare `RESERVED_SUBDOMAINS` labels
  (cross-reference comments in both). `deploy/Caddyfile` + `deploy/README.md`
  capture the live VPS file. No behaviour change for any existing shop. Validator
  tests extended in both copies.

- **Phase 2 — ownership verification (backend). ✅ DONE 2026-08-31. ← unblocks
  Google Shopping D3 / Phase 4b.**
  - Migration `20260831130000_custom_domain_verify_uniqueness`: adds
    `customDomainClaimedAt` / `customDomainLastCheckedAt` + the DB-generated
    `customDomainVerifiedKey` (`= customDomain` while verified, else `NULL`);
    drops `Shop_customDomain_key`, adds a plain `Shop_customDomain_idx` + the
    verified-only `Shop_customDomainVerifiedKey_key` unique + a sweep index.
    **CD2 mechanism = the generated column** (MySQL has no partial unique index).
  - `PATCH /shop/domain` starts/restarts a `pending` claim with a fresh
    `customDomainVerifyToken`; 409s only if another shop already **verified**
    that exact domain. Disconnect nulls every `customDomain*` field (token
    rotation, CD2 rule 4). `GET /shop/domain` now returns `status` +
    `verification: {recordName, recordValue}`.
  - `POST /shop/domain/verify` (throttled 10/min) → `CustomDomainVerificationService.verifyClaim`
    (`shop/`): `dns.resolveTxt('_requital-verify.<domain>')` via an injectable
    `DnsResolver` (e2e-overridable), exact-match against the token, CAS flip to
    `verified` (generated-key unique index arbitrates a cross-shop race → loser
    `failed` + 409). DNS lookup is outside any transaction.
  - **Recheck cadence (as proposed, signed off):** `@Cron` every 5 min →
    `runLocked('custom-domain-verify-sweep', 120, …)`; per claim, backoff by
    claim age — `<1h` every 5 min, `1–6h` every 30 min, `6–48h` every 60 min,
    `>48h` → `failed`.
  - `GET /domains/verify` (now throttled 60/min) + `GET /domains/resolve` both
    match a custom domain **only when `customDomainStatus = 'verified'`**, via a
    single added clause in `DomainsService.resolveSubdomain`. `/domains/resolve`
    left unthrottled deliberately (see §4 rule 6 note — Phase 6).
  - Adversarial e2e (`backend/test/custom-domain-verification.e2e-spec.ts`):
    verify-without-TXT never verifies (check hits DNS); two shops race → both
    claim, first-to-prove wins, loser → `failed`+409; disconnect stops
    resolve/cert *immediately* + nulls the token; a stale TXT can't re-verify a
    different shop; endpoints stay `@Public()`, injection-safe, `/domains/verify`
    throttles a burst. Plus `custom-domain-verification.service.spec.ts` units.
  - **⚠️ Flagged fast-follow:** the migration grandfathers the one real live
    custom domain, **`irmain.com`** (prod shop id 7, "Irmain Perfums",
    published), straight to `customDomainStatus = 'verified'` by exact-string
    match, to avoid a storefront outage on the deploy that turns verification
    on. It has **never actually passed the DNS-TXT check**. Put it through the
    real flow (`GET /shop/domain` → add `_requital-verify.irmain.com` TXT →
    `POST /shop/domain/verify`) at the next opportunity so it's trusted on proof
    of control, not on the operator's say-so. Prod's other two
    `domainType='custom'` rows (`arabianrentals.com`, `irmain.online`, both
    unpublished) and the ~128 `*.example.com` e2e leftovers get no backfill —
    they become `NULL`/unverified, the intended default.

- **Phase 3 — merchant UI. ✅ DONE 2026-08-31.**
  - `admin/app/settings/business/domain/page.tsx` (+ `loading.tsx`,
    `page.test.tsx`), added to `BusinessSettingsSubNav`. `PageShell variant="form"`,
    five states keyed off `GET /shop/domain`'s `status`: subdomain-only
    (Connect form), pending/verifying (the `_requital-verify` TXT record with
    per-field copy buttons + "Verify now" → `POST /shop/domain/verify` + a 15s
    poll while in-flight, stopping on verified/failed), verified (Disconnect
    behind a confirm `Modal`), failed (Retry = `PATCH {type:'custom'}` with the
    same domain → fresh token, UI notes the value changes), 409 → "This domain
    is connected to another account" inline.
  - `verifyShopDomain()` added to `admin/lib/api.ts`; `ShopDomainConfig` +
    `status`/`verification` + new `VerifyDomainResult` in `admin/lib/types.ts`
    (were stale after Phase 2's backend-only change).
  - **Contract gap accepted:** `getDomainConfig` doesn't return
    `customDomainClaimedAt`, so no elapsed-time counter — a static "DNS can take
    a few minutes to a few hours" hint instead (matches "don't assume
    client-side state"). Adding `claimedAt` to the response is a possible
    backend follow-up, deliberately not done in the UI-only phase.
  - Signup (`AccountSetup.tsx` / `useAccountSetupForm.ts`): unchanged behaviour
    (still only *starts* the claim), but now deep-links to
    `/settings/business/domain` after account creation for the custom case (CD7),
    and the stale "set it later in Settings > Business Information" comment now
    points at the real page.

- **Phase 4 — TLS hardening + cert lifecycle. ✅ DONE 2026-08-31 (docs only).**
  Caddy 2.7 **removed** `on_demand_tls { rate_limit / burst }` — the box runs
  2.11, and adding those directives fails `caddy validate`. Caddy's current
  design puts all on-demand gating on the `ask` endpoint, which Phase 2 already
  `verified`-gated + Phase 2 gave a 60/min throttle: **that is the abuse
  resistance**, nothing to add to `deploy/Caddyfile`. `deploy/README.md` now
  documents this + Caddy's built-in ACME failure backoff (in-memory negative
  cache, ~1 min; cleared by `systemctl reload caddy`) + why no cert pre-warm
  (one cold handshake once per 90 days isn't worth new failure modes).
  `docs/runbook.md` has a 5-step "custom domain connected but no cert" triage.
  `caddy validate` on the VPS: `Valid configuration` (no Caddyfile change).

- **Phase 5 — the auth fix (§2.7). ✅ DONE 2026-08-31. CD1 = Option A, ALL
  storefront traffic.** `storefront/next.config.ts` rewrites `/api/:path*` →
  `${NEXT_PUBLIC_API_URL}`; `storefront/lib/api.ts`'s `apiBase()` returns `/api`
  in the browser (SSR/RSC + `<img>` stay absolute); `proxy.ts` skips `/api/`;
  CSP `connect-src` tightened to `'self'` as a forcing function.
  - **Plus a bug found in passing:** the customer cookie was `__Host-...;
    Path=/public/<slug>` in prod — `__Host-` mandates `Path=/`, so every browser
    silently dropped it. **Customer sessions had never actually persisted in
    prod, on any shop.** Fixed alongside: `common/cookies.ts` gains
    `pathScopedCookieName` (`__Secure-` — Secure-only, any Path) for the
    customer access/refresh/CSRF cookies and the staff refresh cookie;
    `__Host-` stays for the `Path=/` cookies (staff/platform access). `isProd()`
    is now a function so a test can exercise the prod shapes.
  - `main.ts` CORS `isCustomDomain` branch: **kept with a comment** (now a safety
    net for non-storefront cross-origin callers, no longer load-bearing).
  - Coverage: `cookies.spec.ts` (prefix logic per NODE_ENV), a new
    `test/custom-domain-cookie.e2e-spec.ts` running with `NODE_ENV=production`
    (real `Set-Cookie` shapes: customer `__Secure-` + Path + round-trip + a
    CSRF'd mutation + CSRF-missing→403; staff `__Host-` access / `__Secure-`
    refresh + refresh round-trips; platform unchanged), `storefront/lib/api.test.ts`
    unchanged (substring URL asserts survive `/api`). The true cross-*site*
    custom-domain case can't be faked locally — `deploy/README.md` has a
    post-deploy verification step on `irmain.com` + a subdomain shop.

- **Phase 6 — resolver resilience + cleanup. ✅ DONE 2026-08-31.**
  - `DomainsService.resolveSubdomain`: 30s in-memory TTL cache (positive +
    negative), FIFO-capped at 1000, `invalidate(host)` called by
    `ShopService.updateDomain` (connect/disconnect) and
    `CustomDomainVerificationService.verifyClaim` (verified/failed) so a state
    change lands on the very next request. A 60s `@Interval` logs cache
    hit/miss/hitRate/size (guarded off under `NODE_ENV=test`).
  - `storefront/proxy.ts`: on `/domains/resolve` *unreachable* (not a real 404),
    serve a last-known-good `host → subdomain` if <5 min old, `console.warn` the
    fallback; a real 404 from the backend still 404s (never served stale).
  - `CustomDomainVerificationService`: `logger.info` per verify outcome
    (`{shopId, domain, result, trigger}`) + a per-sweep summary.
  - Regression test (`custom-domain-verification.e2e-spec.ts`): resolve a domain
    *before* it verifies (populating the cache with the 404), verify, then
    `GET /domains/resolve` **immediately** returns the shop — proves invalidation,
    not just "first read after verify is fresh".

**Google Shopping reuse:** Phases 2–3 build a "add a DNS record → we poll to
confirm → status flips to verified" flow, its backend polling job, and the admin
UI surface. Google Merchant Center's own site verification is the **same
mechanic** with a different token (its `google-site-verification` DNS TXT or
`<meta>` tag). And once Phase 2 + Phase 5 make a custom domain genuinely live,
the `<meta name="google-site-verification">` `<head>` injection already planned
for subdomain shops in `google-shopping-listing.md` §2.1 works unchanged on the
custom domain — so that plan's Phase 4b becomes near-trivial once this doc's
Phase 2 lands.

---

## 6. Decisions (CD1–CD7 — all locked)

| ID | Question | **Decision** |
|---|---|---|
| **CD1** | Auth fix approach. | **Option A same-origin proxy, applied to ALL storefront traffic.** Storefront calls a relative `/api/*`; a `next.config` rewrite forwards to `${NEXT_PUBLIC_API_URL}`. This deletes the storefront's cross-origin CORS surface to `api.requital.io` entirely. `SameSite=Strict` cookies then work on every storefront host with no cookie-attribute change. See Phase 5 for the widened blast radius. |
| **CD2** | Uniqueness for unverified claims. | **Global uniqueness enforced only on `verified` status.** An unverified/`pending` claim does **not** block another shop from claiming the same domain — first to verify wins. Needs `customDomainStatus` + status-scoped uniqueness (no partial unique index in MySQL → side table or generated-column approach, settled in Phase 2). |
| **CD3** | DNS target told to merchants. | **CNAME to `cname.requital.io`.** That is the record merchants are instructed to create, so the VPS IP can change without every merchant re-editing DNS. A record to the VPS IP is the **documented apex fallback only** (for registrars without ALIAS/ANAME/CNAME-flattening). |
| **CD4** | Apex vs subdomain custom domains. | **Support both.** `shop.example.com` and bare `example.com`. The `_requital-verify` TXT is required in both cases. Docs must state that apex domains need registrar ALIAS/ANAME or CNAME-flattening to point at `cname.requital.io` (or use the A-record fallback). |
| **CD5** | Cert lifecycle. | **Caddy on-demand TLS, `ask`-gated on `verified` status only.** No explicit managed-domain list, no Caddy reload per connect. Phase 4 adds `on_demand_tls` rate limiting + ACME-failure backoff. |
| **CD6** | Caddyfile into the repo. | **Yes — `deploy/Caddyfile`.** Captured verbatim from the VPS in Phase 1, no redesign. Deploy mechanism for changes documented alongside it. |
| **CD7** | Where custom-domain connect lives. | **New Settings → Domain page** for the connect/verify flow (DNS records, status, Verify now, Disconnect). The **signup wizard keeps** the subdomain-vs-custom choice, but for "custom" it captures intent and **deep-links to Settings → Domain** post-signup for the actual connect/verify loop (which doesn't fit the linear signup flow). |

---

## 7. Ready-to-implement checklist

### Confirmed by codebase reading

- [x] Schema (`domainType` / `customDomain UNIQUE` / immutable `subdomain`), the
      `domains/` module, `proxy.ts` routing, and Caddy on-demand TLS + `ask` all
      exist. Routing works for a domain already in the column.
- [x] `/domains/verify` and `updateDomain` do **no** ownership/pointing check —
      they trust the raw `customDomain` column.
- [x] No post-signup merchant UI for custom domains (`getShopDomain` /
      `updateShopDomain` are wired only into the signup wizard).
- [x] `isValidCustomDomain` (both copies) rejects `*.requital.io`, the apex, and
      reserved labels as of Phase 1 (2026-08-31).
- [x] Cookie-auth conflict is **`SameSite=Strict` on a cross-site
      storefront→`api.requital.io` call**, customer tier only; staff/platform
      unaffected. CORS already permits the custom-domain origin.
- [x] The Caddyfile — captured to `deploy/Caddyfile` + `deploy/README.md` in
      Phase 1 (2026-08-31). The `*.requital.io` wildcard uses a Cloudflare DNS-01
      wildcard cert, not on-demand TLS (only the `https://` catch-all does).
- [x] `resolveSubdomain` already handles the custom-domain case; per-request DB
      hit, no cache.

### Decisions — all locked (see §6)

- [x] **CD1** — Option A same-origin proxy, **all** storefront traffic (deletes the cross-origin CORS surface).
- [x] **CD2** — global uniqueness only on `verified`; unverified claims don't block.
- [x] **CD3** — CNAME to `cname.requital.io`; A record is the apex fallback only.
- [x] **CD4** — support apex + subdomain; document ALIAS/ANAME/CNAME-flattening for apex.
- [x] **CD5** — on-demand TLS, `ask`-gated on `verified` only.
- [x] **CD6** — Caddyfile → `deploy/Caddyfile`, verbatim from the VPS.
- [x] **CD7** — connect/verify in a new Settings → Domain page; signup keeps the choice, deep-links post-signup.

### Progress

- [x] **Phase 1** (2026-08-31) — validation hardening, groundwork columns, `deploy/Caddyfile`.
- [x] **Phase 2** (2026-08-31) — DNS-TXT ownership verification (generated-column CD2 mechanism, `verifyClaim` + `@Cron` sweep, `/domains/{verify,resolve}` gated on `verified`, adversarial e2e). `irmain.com` grandfathered as `verified` — flagged fast-follow, see §5.
- [x] **Phase 3** (2026-08-31) — merchant Settings → Domain UI (`admin/app/settings/business/domain/`, 5 states + 15s poll + signup deep-link). Contract gap accepted: no `claimedAt` in the API response, so a static propagation hint instead of an elapsed timer.
- [x] **Phase 4** (2026-08-31) — docs only: `on_demand_tls { rate_limit }` was removed in Caddy 2.7, the `ask`-gate + endpoint throttle are the mechanism. `deploy/README.md` + `docs/runbook.md` triage.
- [x] **Phase 5** (2026-08-31) — same-origin `/api/*` proxy + the `__Host-`→`__Secure-` customer-cookie fix (customer sessions never persisted in prod before this). `custom-domain-cookie.e2e-spec.ts` covers customer + staff-access + staff-refresh + platform.
- [x] **Phase 6** (2026-08-31) — `resolveSubdomain` 30s TTL cache (invalidated on connect/disconnect/verify) + stale-on-unreachable routing in `proxy.ts` + structured verify/cache logging. Stale-cache regression test added.

**→ The whole custom-domain feature is now wired end to end.**

### Still needs Rafael

- [ ] Put `irmain.com` through the real DNS-TXT verification flow (fast-follow from Phase 2's grandfather).
- [ ] After the deploy carrying Phases 4–6: run the `deploy/README.md` "Post-deploy check: custom-domain customer sessions" step on `irmain.com` + a subdomain shop.
