# Google Shopping auto-listing — architecture plan

**Status:** PLAN ONLY. Nothing in this document is built. Do not start implementation
until Phase 0 (below) is signed off by Rafael.

**One-line pitch:** every Requital shop flips one toggle ("List on Google Shopping")
and its catalogue appears on Google Shopping free listings + Shopping ads, with the
merchant never opening Google Merchant Center. Requital owns one Merchant Center
advanced account (MCA); each shop is an API-created sub-account under it.

**Research currency:** Content API for Shopping was sunset 2026-08-18. Merchant API
v1 is GA and is the only path. All API references below are Merchant API v1
(`merchantapi.googleapis.com`). Sources are listed at the end.

---

## 0. Prerequisites — status and human action items

I cannot verify or create any of these. Each is a human (Rafael) action item and
**Phase 0 is a hard gate on all implementation.**

| # | Prerequisite | Status | Notes |
|---|---|---|---|
| P1 | Requital Google Cloud project, Merchant API enabled | ❓ unverified | Standard console step. |
| P2 | Requital-owned Merchant Center **advanced account** (MCA), not a personal Google account | ❓ unverified | Must be the "advanced account" type. Personal-account or basic-account MCAs cannot aggregate sub-accounts the way this design needs. |
| P3 | Service account created, **developer registration** done (`accounts.developerRegistration:registerGcp`), service account added as a **user with ADMIN** access on the MCA | ❓ unverified | Developer registration is a mandatory one-time link between the GCP project and the MCA. The authorizing identity must already have ADMIN on the MCA. Without this every API call 403s. |
| P4 | Sub-account quota increase requested (default cap **50** sub-accounts per MCA) | ❓ unverified — **treat as a blocker to note, not route around** | Google's own bar for granting the increase: consistently using ≥80% of the current product limit, real traffic/sales, product disapproval rate < ~20%. A brand-new MCA cannot meet that bar. Practical consequence: **launch is capped at ~50 live merchants** until Requital has enough volume for Google to approve more. See §8. |

**If any of P1–P4 is not confirmed done, that is the first action item for a human,
before any implementation phase begins.**

Two policy decisions (details in §11) are also Phase 0:

- **D1 — ToS acceptance model.**
- **D2 — sub-account disposition when a merchant leaves Requital.**

---

## 1. Account architecture (Accounts sub-API)

### 1.1 Sub-account creation

`accounts.createAndConfigure`
(`POST https://merchantapi.googleapis.com/accounts/v1/accounts:createAndConfigure`)

Request body shape:

```jsonc
{
  "account": {
    "accountName": "<shop name, lowercase, no punctuation>",
    "adultContent": false,
    "timeZone": { "id": "Asia/Dubai" },
    "languageCode": "en-AE"
  },
  "service": [
    { "accountAggregation": {}, "provider": "accounts/<MCA_ID>" }
  ]
  // "users": [] — omit. The service account is already admin via the MCA;
  // no merchant Google user is added (that is the whole point of the feature).
}
```

- At least one `service` entry must be `accountAggregation` for this to be a
  sub-account rather than a standalone account.
- Response returns `accounts/<SUB_ACCOUNT_ID>`. Store it on `shop`.
- Auth: **service-account JWT → OAuth2 access token**, scope
  `https://www.googleapis.com/auth/content`. No per-merchant OAuth anywhere in
  this feature.

### 1.2 Business info

Separate call, **after** creation: `accounts.updateBusinessInfo`
(patch `accounts/<SUB>/businessInfo`). Cannot be set inside `createAndConfigure`.

Populate from Requital data:

| Google field | Requital source |
|---|---|
| `address.regionCode` | `"AE"` (constant — single-market today) |
| `address.*` (street, locality, postal) | primary `outlet` address fields |
| `phone` | `outlet.phone` (fallback `outlet.whatsapp`) |
| `customerService.email` | shop contact email / `EMAIL_FROM_ADDRESS` |
| business name | `shop.displayName ?? shop.name` |

`address.regionCode` should be set first — it drives which ToS region applies.

### 1.3 Terms of Service

Flow (per `manage-tos-agreements` guide):

1. `accounts.termsOfServiceAgreementStates.retrieveForApplication` for the sub-account
   → tells us whether acceptance is required and the target `regionCode`.
2. If required: `termsOfService.retrieveLatest` with `kind = MERCHANT_CENTER`,
   `regionCode = AE` → returns the ToS `name` and a human-readable `fileUri`.
3. `termsOfService.accept` with that `name`, the sub-account id, and `regionCode`.

Key facts:

- Google's guidance: a provider should **not** silently accept on the merchant's
  behalf; it should **display** the ToS and record **explicit merchant consent**.
- However, **an advanced account's ToS acceptance for the `accountAggregation`
  service also applies to every client account with that service.** So technically
  one acceptance at the MCA level can cover all sub-accounts.
- `acceptedBy` on the recorded state can be the sub-account *or* the advanced
  account.
- **ToS `fileUri` links do not render in an iframe** — the consent UI must open it
  in a new tab.
- **Recommended model (D1):** per-merchant in-app consent. In the Marketing tab,
  show a step: "Google requires accepting the Merchant Center Terms of Service"
  + a link opening `fileUri` in a new tab + an explicit "I accept" checkbox/button.
  On confirm, **first** write a `googlemerchanttos` audit row
  (`shopId, userId, tosVersion, regionCode, acceptedAt, ip, userAgent`), **then**
  call `termsOfService.accept`. The DB write is a hard precondition of the API call
  succeeding path (same philosophy as `PlatformAdminService.impersonate`'s
  audit-log-before-return). This keeps proof of consent if Google ever asks.

---

## 2. Website verification & homepage claim per sub-account

### 2.1 The Homepage resource

- `accounts.updateHomepage` — set the homepage `uri`.
- `accounts.homepage.claim` — claim it; takes an `overwrite` flag (steal a claim
  from another account if this account can verify ownership).
- `accounts.homepage.unclaim`.
- A single URL can be claimed by **exactly one** account. MCA sub-accounts can
  *inherit* a parent claim for related domains, but the clean model here is:
  **each sub-account claims its own storefront URL.**
- Verification methods supported by Merchant Center: **DNS TXT record**,
  **HTML file upload**, **HTML meta tag** in `<head>`, Google Analytics / Tag
  Manager. The verification token is per-account.

### 2.2 Subdomain shops (`<sub>.requital.io`) — the common case

Requital controls both the `requital.io` DNS zone and the storefront HTML, so
verification is fully automatable. **Recommended: meta-tag injection.**

- Generate a `google-site-verification` token per shop (from the API's
  verification flow), store `shop.googleMerchantVerificationToken`.
- The storefront already emits a per-shop `<head>` via `generateMetadata` in
  `app/[shop]/layout.tsx`. Add the `<meta name="google-site-verification">` tag
  there, rendered only when the shop has a token **and** the feature is enabled
  (so it never appears on a shop that hasn't opted in).
- Homepage `uri` to set/claim = the shop's canonical storefront URL
  (`<sub>.requital.io`, the `storefrontUrlFor(shop)` form — **not** the bare
  `/[shop]` path).
- Claim with retry/backoff (meta-tag deploy + Google's fetch aren't instant).

DNS-TXT is the fallback if meta-tag verification proves flaky — Requital controls
the zone either way — but meta-tag needs no DNS automation and is per-shop by
construction.

### 2.3 Custom-domain shops

**In scope for v1 (decision D3). The external dependency is now cleared —**
`docs/plans/custom-domain-resolver.md` is **DONE** (Phases 1–6, 2026-08-31): a
custom domain can be connected, DNS-TXT-verified, cert-issued, and serves the
storefront (with a persistent customer session).

Custom-domain shops need **almost nothing extra** for Google verification: the
storefront controls its own `<head>` regardless of which host served the page, so
the same `<meta name="google-site-verification">` injection used for subdomain
shops (§2.1) works identically on a custom domain. The homepage `uri` set/claimed
is just the shop's `customDomain` instead of its `<sub>.requital.io`. No DNS
automation, no separate manual path.

**Ordering:** Phase 4b of this plan (§12) *was* gated on the resolver; that gate
is lifted. It can now ship as a straight follow-up to 4a with no cross-plan
blocker.

---

## 3. Product sync model

### 3.1 Resource split

- **`ProductInput`** — what we write (`productInputs.insert` / `patch` / `delete`).
- **`Product`** — read-only, Google's processed result after rules + supplemental
  sources + validation. Carries `productStatus` (see §6).
- Product identity is `contentLanguage ~ feedLabel ~ offerId`
  (e.g. `en~AE~12345`).

### 3.2 Data source

One **API primary data source** per sub-account: `dataSources.create`
(`primaryProductDataSource`). Pin `feedLabel = "AE"` and `contentLanguage = "en"`
(single-market, single-language today; SRS lists Arabic/RTL + multi-currency as
future). Store `shop.googleMerchantDataSourceId`. `productInputs.insert` references
it by `name` (`accounts/<SUB>/dataSources/<ID>`).

### 3.3 Push strategy — **real-time via the existing job queue** (recommended)

Reuse `job` table + `JobsService.enqueue` (idempotency-keyed, transaction-aware,
dead-letter + admin retry already built). **Do not build a second queue.**

New `JobType`s (add to `backend/src/jobs/jobs.types.ts` + a handler each):

| JobType | Trigger | Action |
|---|---|---|
| `google_merchant_sync_product` | product create/update, price change, status change (Available ↔ Draft/Archived), stock crossing 0 ↔ positive | map + `productInputs.insert` (upsert) or `productInputs.delete` if no longer eligible |
| `google_merchant_delete_product` | product hard-delete, or feature toggled off | `productInputs.delete` |
| `google_merchant_reconcile_shop` | scheduled sweep (see §3.4) | `products.list` for the sub-account, write status/issues into `googleproductsync` |
| `google_merchant_refresh_shop` | scheduled sweep | re-push every Available product not pushed in ~20 days |
| `google_merchant_provision_shop` | merchant flips toggle on | run the onboarding sequence (§7) step by step, each step idempotent |

Enqueue points in `ProductsService` (create/update/remove), the stock-movement
paths (reuse the exact 0→positive crossing hooks `notify-subscriptions` already
taps), and the order-confirm/cancel stock paths.

Real-time is right here because the queue infra already exists and merchants
expect stock/price changes to reach Google quickly. A scheduled batch feed would
be a second mechanism for no benefit.

### 3.4 Expiration — periodic full re-sync is **mandatory, not optional**

Products expire from Merchant Center **30 days after their last refresh**. Without
a refresh sweep, every listing silently dies at day 30.

- Add a scheduled sweep in `jobs/scheduler.service.ts` (same `@Interval` / cron
  pattern as the abandoned-cart recovery sweep). Rolling cadence: re-push any
  Available product whose `googleproductsync.lastPushedAt` is older than ~20 days
  (comfortable margin under 30). Spread the work — don't re-push a whole catalogue
  in one tick.
- Merchant API v1 has **no `custombatch`** equivalent — each `productInputs.insert`
  is one HTTP call. The sweep must respect per-project QPS quota; the job worker's
  serial-ish draining + backoff already helps, but the refresh sweep needs its own
  rate ceiling.

### 3.5 Toggle-off teardown

When a merchant disables the feature: enqueue `productInputs.delete` for every
offer so the catalogue leaves Google promptly (don't wait 30 days for expiry).
Keep or delete the sub-account per **D2**.

---

## 4. Data mapping — Requital product → Google attributes

| Google attribute | Required? | Requital source | Gap / decision |
|---|---|---|---|
| `offerId` | ✅ | `String(product.id)` | stable, unique, never reused |
| `title` | ✅ | `product.name` | — |
| `description` | ✅ | `product.description` → strip HTML; fallback `shortSummary`/`longSummary` | flag product if all empty |
| `link` | ✅ | `<storefrontUrl>/products/<slug>` | canonical subdomain URL |
| `imageLink` | ✅ | `resolveImageUrl(product.thumbnail)` (absolute) | flag product if missing |
| `additionalImageLinks` | rec | `productimage[]` (absolute, ordered) | — |
| `availability` | ✅ | derived: `in_stock` if any outlet's `outletstock` > 0 **or** `product.continueSellingOutOfStock`, else `out_of_stock`; `product.status != Available` ⇒ omit product entirely | Google online listings have **no outlet concept** — this is a single product-level rollup, not per-outlet |
| `price` | ✅ | `product.price` + `shop.currency` (`AED`) | — |
| `salePrice` | rec | when `compareAtPrice > price`: send `compareAtPrice` as `price` and `product.price` as `salePrice` | **verify `compareAtPrice` semantics in code before building** (it is the "was" / strikethrough price) |
| `brand` | rec (conditional identifier) | `brand.name` via `product.brandId` | nullable — many products have no brand |
| `gtin` | conditional | `product.barcode` / `productvariant.barcode` **if** it is a plausible 8/12/13/14-digit number; else omit | `barcode` is **free-text, unvalidated, usually empty** for florists/gift shops |
| `mpn` | conditional | — **no field exists** | not adding one in v1 |
| `identifierExists` | conditional | `false` when there is no `gtin` **and** not (`brand` + `mpn`) | **`false` is the normal/expected case here** — most bouquets and gifts have no manufacturer identifier. Not a defect. |
| `condition` | conditional | hardcode `"new"` | florist / gift-shop catalogue is always new |
| `googleProductCategory` | rec | — none | **omit in v1**, let Google auto-categorise (decision D5) |
| `productTypes` | rec | top-level `collection` path could map here | optional, low priority |
| `shipping` | conditional (or account-level) | `deliveryzone` flat fees / `outlet.deliveryRadiusKm` | **no distance/haversine math exists anywhere in the codebase.** Recommend **account-level** `accounts.shippingSettings` with one flat national rate from the shop's default zone, **not** per-product shipping (decision D6) |
| `contentLanguage` | ✅ | `"en"` | single-language today |
| `feedLabel` | ✅ | `"AE"` | — |

### Schema gaps — confirmed, none block v1

- **No `gtin`, `mpn`, `condition`, `google_product_category` fields.** `barcode`
  exists (product + variant) but is unvalidated free text. `brandId` is nullable.
- Handling: opportunistic `gtin` from `barcode`, `condition = "new"` constant,
  `identifierExists = false` as the common path, `googleProductCategory` omitted.
- **No new *required* product columns.** The only migration is additive `shop`
  columns + two new sync/audit tables (§9). A real validated `gtin` field is a
  possible fast-follow, not a launch dependency.

Build the mapper as a **pure function** (`google-merchant/product-mapping.ts`),
directly unit-tested against this table — same style as
`storefront/lib/payment-methods.ts` / `auto-discounts.ts`.

---

## 5. Currency / market

- Country of sale: **AE**. Currency: **AED**. Language: **en**.
- Free listings **and** Shopping ads are both available in the UAE as of 2026
  (free listings rolled out to international markets including UAE; Shopping ads
  campaigns are open to all UAE merchants).
- Requital is single-currency AED throughout already — no conversion layer needed.
- **No known blocker.** Standard UAE feed requirements apply (localised
  storefront, AED prices, valid contact info) — all satisfied by existing shop
  data.

---

## 6. Disapproval / error handling

- Processing is **asynchronous** on Google's side (minutes–hours). The
  `productInputs.insert` response does **not** carry approval status.
- Read status from the **`Product`** resource: `products.list` / `products.get`
  → `productStatus`:
  - `destinationStatuses[]` — per destination (`SHOPPING_ADS`, `FREE_LISTINGS`):
    approved / pending / disapproved, with country lists.
  - `itemLevelIssues[]` — `code`, `severity`/servability, `resolution`,
    `attribute`, `description`, `documentation` URL, `applicableCountries`.
- **Model:** the `google_merchant_reconcile_shop` sweep pulls `products.list`
  for each enabled sub-account and writes `approvalStatus` + `issues` (JSON) into
  `googleproductsync` keyed `[shopId, productId]`.
- **Admin UI:** the Marketing tab shows an aggregate ("12 products rejected by
  Google") and an expandable per-product list with Google's own reason text +
  the `documentation` link. A merchant must never get silence.
- **Optional later:** Merchant API has a Notifications sub-API
  (`accounts.notificationsubscriptions`) for product-status push instead of
  polling. Poll/reconcile is the safe v1 (decision D7).

---

## 7. Onboarding flow (what the merchant sees, step by step)

1. **Merchant** opens **Integrations → Marketing**, flips **"List on Google
   Shopping"** on. (Subdomain shops only in v1; custom-domain shops see a gated
   message — D3.)
2. **Backend** (`google_merchant_provision_shop` job): `accounts.createAndConfigure`
   a sub-account under the MCA with the `accountAggregation` service. Store
   `googleMerchantSubAccountId`. `shop.googleMerchantStatus = 'tos_pending'`.
3. **Backend:** `accounts.updateBusinessInfo` — region `AE`, address/phone from
   the primary outlet, business name from the shop.
4. **Frontend:** shows a **ToS step** — explanatory copy + a button opening the
   ToS `fileUri` in a new tab + an "I accept" checkbox. On confirm → backend
   writes the `googlemerchanttos` audit row, **then** calls `termsOfService.accept`
   for the sub-account. Status → `verifying`.
5. **Backend:** generate + store `googleMerchantVerificationToken`;
   `accounts.updateHomepage` with the canonical storefront URL; the storefront
   `<head>` begins emitting the `google-site-verification` meta tag for this shop;
   `accounts.homepage.claim` with retry/backoff. On success → status `active`.
6. **Backend:** `dataSources.create` (primary, `feedLabel = "AE"`,
   `contentLanguage = "en"`). Store `googleMerchantDataSourceId`.
7. **Backend:** enqueue an initial full sync — one `google_merchant_sync_product`
   job per Available product (idempotency-keyed).
8. **Reconciliation sweep** populates `googleproductsync`; the Marketing tab now
   shows per-product approval state and any rejections.
9. **Ongoing:** product / stock / price mutations enqueue incremental push jobs;
   the refresh sweep re-pushes anything older than ~20 days.

**Toggle off:** enqueue `productInputs.delete` for all offers; status →
`disabled`; sub-account kept or deleted per D2.

Every step 2–6 is individually idempotent and re-runnable — the provision job
checks "is this already done?" per step and resumes, so a mid-flow failure
(quota, transient 5xx, merchant closing the tab at the ToS step) just retries
from where it stopped.

---

## 8. Quota & capacity risk

- **Sub-account cap: 50 per MCA by default.** Past merchant #50, onboarding
  `createAndConfigure` starts failing until Google grants an increase — and
  Google's bar (≥80% product-limit usage, real sales, <20% disapproval) is a
  mature-account bar a fresh MCA can't clear. **Plan for a ~50-merchant launch
  ceiling** and file the increase request early (P4) so it's in the queue.
- **"MCA over capacity" — shared quota pool.** Items, data sources, and
  sub-accounts are pooled *across all sub-accounts under the one MCA*. As
  (merchant count × catalogue size) grows, aggregate item count can hit the MCA's
  pooled item quota even if no single shop is large.
- **Monitoring to build (Phase 7):** track (a) live sub-account count vs the
  granted sub-account quota, (b) total pushed item count vs the granted item
  quota. Alert at ~80% of either. Surface both on a platform-admin page.
- **Request-rate quota:** per-project QPS. Real-time push + reconcile + refresh
  sweeps all draw on it. No `custombatch` in v1 — every product is one call. The
  refresh sweep especially needs an explicit rate ceiling, not just "drain the
  queue."

---

## 9. Data model / migrations

One new timestamped migration folder (additive only; expand-only; update
`backend/src/db/types.ts` by hand alongside it).

### `shop` — new columns

```sql
ALTER TABLE `shop`
  ADD COLUMN `googleMerchantEnabled`           BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN `googleMerchantStatus`            VARCHAR(32)  NOT NULL DEFAULT 'disabled',
  -- disabled | provisioning | tos_pending | verifying | active | error
  ADD COLUMN `googleMerchantSubAccountId`      VARCHAR(32)  NULL,
  ADD COLUMN `googleMerchantDataSourceId`      VARCHAR(64)  NULL,
  ADD COLUMN `googleMerchantVerificationToken` VARCHAR(128) NULL,
  ADD COLUMN `googleMerchantHomepageClaimed`   BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN `googleMerchantLastError`         VARCHAR(512) NULL;
```

### `googlemerchanttos` — auditable consent record

```sql
CREATE TABLE `googlemerchanttos` (
  `id`         INTEGER      NOT NULL AUTO_INCREMENT,
  `shopId`     INTEGER      NOT NULL,
  `userId`     INTEGER      NOT NULL,
  `tosVersion` VARCHAR(128) NOT NULL,   -- the ToS resource `name`
  `regionCode` VARCHAR(8)   NOT NULL,
  `acceptedAt` DATETIME(3)  NOT NULL,
  `ip`         VARCHAR(64)  NULL,
  `userAgent`  VARCHAR(512) NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `Googlemerchanttos_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE
);
CREATE INDEX `Googlemerchanttos_shopId_idx` ON `googlemerchanttos`(`shopId`);
```

### `googleproductsync` — per-product push + approval state

```sql
CREATE TABLE `googleproductsync` (
  `shopId`         INTEGER      NOT NULL,
  `productId`      INTEGER      NOT NULL,
  `googleOfferId`  VARCHAR(128) NOT NULL,   -- contentLanguage~feedLabel~offerId
  `contentHash`    VARCHAR(64)  NULL,       -- hash of last-pushed mapped payload (skip no-op pushes)
  `lastPushedAt`   DATETIME(3)  NULL,
  `approvalStatus` VARCHAR(16)  NULL,       -- approved | pending | disapproved
  `issues`         JSON         NULL,       -- itemLevelIssues[] verbatim
  `updatedAt`      DATETIME(3)  NOT NULL,
  PRIMARY KEY (`shopId`, `productId`),
  CONSTRAINT `Googleproductsync_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE
);
```

No `webhookevent.source` change — Merchant API has no inbound webhook to this app
in v1 (§6). Add a `'google'` source only if the Notifications sub-API is adopted
later.

---

## 10. Admin UI + Backend module

### 10.1 Admin — new "Marketing" tab in the Integrations app

- `admin/components/IntegrationsTabs.tsx` → add
  `{ href: "/integrations/marketing", label: "Marketing" }`.
- New `admin/app/integrations/marketing/page.tsx` — follows the Slider
  `DeliveryIntegrationsPage` card pattern:
  - Header card: Google Shopping, status chip
    (Not connected / Pending ToS / Verifying domain / Active / Error), the
    "List on Google Shopping" `Toggle`.
  - When `tos_pending`: the ToS consent step (new-tab link + accept).
  - When `verifying` on a custom-domain shop: manual-instructions panel (D3).
  - When `active`: a summary (N products listed, N pending, N rejected) and an
    expandable rejected-products list with Google's reason + doc link, fed from
    `googleproductsync`.
- **No `SecretField`** on the merchant side — credentials are platform env vars,
  the merchant enters nothing. (SecretField only enters the picture if a
  platform-admin screen ever surfaces the service-account key, which it should
  not — that stays an env var / mounted file.)
- Admin-only, same `IntegrationsLayout` role gate + server-side `@Roles('admin')`.

### 10.2 Admin — platform-admin panel (support tooling)

Per-shop read-only panel under `app/platform/*`: sub-account id, ToS state, claim
state, data-source id, last reconcile time, item count, last error. Plus manual
actions mirroring `PATCH /platform-admin/shops/:shopId/slider-account-id` style:
"force full re-sync", "re-run provisioning", and (support edge case) "attach an
existing sub-account id".

### 10.3 Backend — new `google-merchant/` module

Mirrors the `PaymentProvider` / `SliderSettingsService` conventions.

| File | Responsibility |
|---|---|
| `google-merchant.module.ts` | wiring; imports `JobsModule`, `DatabaseModule` |
| `google-merchant.provider.ts` | thin REST wrapper over Merchant API v1 (accounts, businessInfo, termsOfService, homepage, dataSources, productInputs, products). Service-account JWT → access token (cached until expiry). Plain `fetch`, no gateway SDK — same as `resend-email.provider.ts` and the Slider provider. |
| `google-merchant-settings.service.ts` | per-shop state read/write; `resolveCredentials(shopId)` → `null` unless `googleMerchantEnabled` **and** platform env vars present (exact shape of `SliderSettingsService.resolveCredentials`) |
| `google-merchant-sync.service.ts` | `mapProduct()` call-through + enqueue helpers |
| `product-mapping.ts` | **pure**, unit-tested — the §4 table |
| `handlers/*.ts` | one per new `JobType` (§3.3), registered with `JobsWorkerService` |
| `google-merchant.controller.ts` | merchant endpoints: `GET /integrations/google-merchant` (status), `PATCH .../enabled`, `POST .../accept-tos`, `POST .../recheck-verification` |
| `dto/*.ts` | request DTOs |

**Platform credentials — env vars, not per-shop secrets** (Slider model):

```
GOOGLE_MERCHANT_MCA_ID          # advanced account id
GOOGLE_MERCHANT_SA_KEY          # service-account JSON (or a path to it)
GOOGLE_MERCHANT_ENV             # optional: prod | sandbox, if Google offers one
```

Document these in CLAUDE.md's backend `.env` section (same paragraph style as the
`SLIDER_*` note).

### 10.4 New npm dependency — **flagged**

- `google-auth-library` — for the service-account JWT → access-token exchange
  (signing a JWT with the SA private key by hand is possible but not worth it).
  This is the **only** new dependency. The Merchant API calls themselves are
  plain `fetch` against REST endpoints — no `@google-shopping/*` client libs.
- **Flag for approval before install.** If even this is unwanted, the JWT signing
  can be done with Node's built-in `crypto` (~30 lines) — uglier, no dep.

### 10.5 Storefront — one change

`app/[shop]/layout.tsx` `generateMetadata`: emit
`<meta name="google-site-verification" content={token}>` when the shop has a
`googleMerchantVerificationToken` and `googleMerchantEnabled`. Nothing else in the
storefront changes.

---

## 11. Open questions / decisions needed from Rafael

| ID | Question | Recommendation |
|---|---|---|
| **D1** | ToS model: rely on one MCA-level acceptance covering all aggregation sub-accounts, or per-merchant in-app consent + `termsOfService.accept` per sub-account? | **Per-merchant in-app consent.** Auditable, matches Google's "explicit merchant consent" guidance, small cost. |
| **D2** | When a merchant leaves Requital or disables the feature permanently: delete the sub-account (`accounts.delete`), leave it dormant, or hand ownership to the merchant's own Google account? | **Delete on account closure; keep dormant on a mere toggle-off.** Ownership hand-over needs the merchant to *have* a Google account — the thing the feature avoids — so offer it only on explicit request. |
| **D3** | Custom-domain shops in v1. | **DECIDED — in scope.** Custom-domain shops get Google Shopping listing. The custom-domain resolver dependency (`docs/plans/custom-domain-resolver.md`) is DONE as of 2026-08-31, so Phase 4b is unblocked. See §2.3. |
| **D4** | Sub-account quota: accept a ~50 live-merchant ceiling for launch and treat the increase as a fast-follow, or delay launch until the increase is granted? | **Accept the ceiling.** Google won't grant the increase before there's volume; blocking launch on it is circular. |
| **D5** | `google_product_category`: omit and rely on Google auto-categorisation for v1, or build a Collection→category map now? | **Omit in v1.** |
| **D6** | Shipping: account-level flat national rate derived from the shop's default delivery zone, or leave shipping unset? Does a same-day florist model even map to Google's shipping schema? | **Account-level flat rate from the default zone.** Per-product shipping needs distance math the codebase doesn't have. |
| **D7** | Product status: poll via `products.list` reconcile sweep, or adopt the Notifications sub-API? | **Poll for v1.** |
| ~~**D8**~~ | ~~Canonical homepage URL when a shop has both a subdomain and a custom domain.~~ | **MOOT — no such case.** A shop has exactly one live domain: `shop.domainType` is `'subdomain'` XOR `'custom'`, `subdomain` is the immutable internal routing key, and `customDomain` is cleared when a shop switches back to subdomain mode. The homepage `uri` is simply `storefrontUrlFor(shop)` — `<sub>.requital.io` or the `customDomain`, whichever `domainType` selects. Nothing to decide. |

---

## 12. Phasing (implementation happens in a later session, one phase per PR)

Each phase is independently shippable, CI-green, with tests. Adversarial
multi-tenant e2e matters more than usual here (new external integration, real
failure modes) — follow the `security-outlet-isolation` / `branch-roles` e2e
convention.

**External dependency — CLEARED (2026-08-31):** `docs/plans/custom-domain-resolver.md`
is done (Phases 1–6). Phase 4b below (custom-domain homepage claim) no longer has
a cross-plan blocker — it ships as a straight follow-up to 4a.

- **Phase 0 — human, blocking.** P1–P4 confirmed. D1–D7 decided (D3 already
  decided: in scope, sequenced behind the resolver; D8 dropped as moot). No code.
- **Phase 1 — module skeleton + auth + data model.** `google-merchant/` module,
  `GoogleMerchantProvider` auth (SA JWT → token, cached), `GoogleMerchantSettingsService`
  (state + `resolveCredentials` → null when env unset / toggle off), the migration
  (§9), env wiring, CLAUDE.md. Unit tests for creds resolution. **Nothing
  merchant-visible.** No live API calls.
- **Phase 2 — sub-account lifecycle.** `createAndConfigure`, `updateBusinessInfo`,
  delete/detach. Platform-admin read-only panel. e2e (against a Google test MCA
  or mocked HTTP): a shop can only ever touch its own sub-account;
  `subAccountId` is always re-derived from `ctx.shopId`, never taken from the
  request.
- **Phase 3 — ToS flow.** `googlemerchanttos` table, retrieve/accept endpoints,
  Marketing-tab consent step. Adversarial test: can't accept for another shop;
  the audit row is written before `accept` is called (hard precondition).
- **Phase 4 — homepage set + claim.**
  - **4a (subdomain shops):** verification-token storage, storefront `<head>`
    meta tag (only when enabled), `updateHomepage` + `claim` with retry/backoff.
    Test: meta tag renders per-shop and only when enabled. No external dependency.
  - **4b (custom-domain shops):** same code path, `uri` = `shop.customDomain`.
    **Unblocked** — `custom-domain-resolver.md` is done, so a connected custom
    domain genuinely serves the storefront and the injected `<head>` meta tag is
    reachable at that hostname, which is all `claim` needs. Ship 4b as a
    straight follow-up to 4a once that dependency
    clears; nothing else in this plan waits on it.
- **Phase 5 — product mapping + push.** Pure `product-mapping.ts` (unit-tested
  against §4), `productInputs.insert/patch/delete`, incremental push jobs wired
  into `ProductsService` + stock-crossing points, idempotency keys,
  `contentHash` no-op skip. Tests: every attribute, `identifierExists` logic,
  availability rollup, sale-price inversion.
- **Phase 6 — reconcile + refresh + rejection UI.** `products.list` → issues →
  `googleproductsync`; the 20-day rolling refresh sweep; the Marketing tab's
  rejected-products list. Tests: an expired-past-20-day product actually
  re-pushes; a disapproval surfaces in the shape the UI reads.
- **Phase 7 — teardown + capacity monitoring + docs.** Toggle-off delete-all,
  error-state surfacing, sub-account-count + item-count monitoring vs MCA quota
  (alert at 80%), platform-admin capacity page, `docs/runbook.md` entry.

---

## 13. Ready-to-implement checklist

### Confirmed by research + codebase reading

- [x] Merchant API v1 is GA and the only path (Content API sunset 2026-08-18).
- [x] `accounts.createAndConfigure` + `accountAggregation` service → MCA sub-accounts.
- [x] ToS: `retrieveForApplication` → `retrieveLatest` (`kind=MERCHANT_CENTER`,
      `regionCode=AE`) → `accept`; advanced-account acceptance can cover sub-accounts;
      `fileUri` must open outside an iframe.
- [x] Homepage resource: `updateHomepage` + `claim` (+ `overwrite`); one URL → one
      account; meta-tag / DNS-TXT / HTML-file verification. `<head>` meta-tag
      injection works for **both** subdomain and custom-domain shops (the
      storefront owns its `<head>` regardless of host).
- [x] **External dependency CLEARED (2026-08-31):** `docs/plans/custom-domain-resolver.md`
      is done — a connected custom domain serves the storefront, so Phase 4b is
      no longer blocked; it ships as a follow-up to 4a.
- [x] Products: `ProductInput` (write) vs `Product` (read); one API primary data
      source per sub-account; **30-day expiration ⇒ refresh sweep is mandatory**;
      no `custombatch` in v1.
- [x] Issues: `Product.productStatus.destinationStatuses` + `itemLevelIssues`,
      pull-only, async.
- [x] UAE: free listings + Shopping ads both available; `AE` / `AED` / `en`; no blocker.
- [x] Reuse the existing `job` table + `JobsService` for push + sweeps — no second queue.
- [x] Platform-env credential model (Slider-style); no per-shop secrets; no `SecretField` merchant-side.
- [x] Additive migration only: `shop` columns + `googlemerchanttos` + `googleproductsync`.
- [x] Product schema gaps (`gtin`/`mpn`/`condition`/`google_product_category` absent;
      `barcode` unvalidated; `brandId` nullable) are all handled by mapping logic —
      **no new required product fields, no blocker.**
- [x] One new npm dep: `google-auth-library` — ⚠️ needs approval before install
      (fallback: hand-rolled JWT with Node `crypto`).

### Needs a decision / action from Rafael

- [ ] 🔴 **P1–P4** all confirmed done (GCP project + Merchant API; advanced-account MCA;
      service account + developer registration + ADMIN on MCA; quota-increase request filed).
- [ ] 🔴 **D4** — accept the ~50 live-merchant launch ceiling (recommended) vs wait for the increase.
- [ ] **D1** — ToS model (recommend per-merchant in-app consent).
- [ ] **D2** — sub-account disposition on merchant churn (recommend delete on closure, dormant on toggle-off).
- [x] **D3** — DECIDED: custom-domain shops in scope; the `custom-domain-resolver.md` dependency is DONE, Phase 4b unblocked.
- [ ] **D5** — `google_product_category` now vs later (recommend later).
- [ ] **D6** — shipping representation (recommend account-level flat rate).
- [ ] **D7** — poll vs Notifications sub-API (recommend poll for v1).
- [x] ~~**D8**~~ — DROPPED as moot: a shop only ever has one live domain.
- [ ] Approve the `google-auth-library` dependency (or require the no-dep JWT path).

---

## Sources

- [Create a sub account — Merchant API](https://developers.google.com/merchant/api/samples/create-sub-account)
- [Create accounts — Merchant API](https://developers.google.com/merchant/api/guides/accounts/create-accounts)
- [Create and set up a merchant account — Merchant API](https://developers.google.com/merchant/api/guides/accounts/create-and-configure)
- [Method: accounts.createAndConfigure](https://developers.google.com/merchant/api/reference/rest/accounts_v1beta/accounts/createAndConfigure)
- [Overview of Accounts sub-API — Merchant API](https://developers.google.com/merchant/api/guides/accounts/overview)
- [Manage Merchant Center Terms of Service agreements — Merchant API](https://developers.google.com/merchant/api/guides/accounts/manage-tos-agreements)
- [Retrieve latest terms of service — Merchant API](https://developers.google.com/merchant/api/samples/retrieve-latest-termsofservice)
- [REST Resource: accounts.termsOfServiceAgreementStates](https://developers.google.com/merchant/api/reference/rest/accounts_v1beta/accounts.termsOfServiceAgreementStates)
- [Method: accounts.homepage.claim — Merchant API](https://developers.google.com/merchant/api/reference/rest/accounts_v1/accounts.homepage/claim)
- [The Merchant API introduces a dedicated Homepage resource](https://developers.google.com/merchant/api/guides/compatibility/homepage)
- [Add and manage products — Merchant API](https://developers.google.com/merchant/api/guides/products/add-manage)
- [Manage API data sources for product uploads — Merchant API](https://developers.google.com/merchant/api/guides/data-sources/api-sources)
- [List your products data and product issues — Merchant API](https://developers.google.com/merchant/api/guides/products/list-products-data-issues)
- [Authorize access to your Merchant Center account — Merchant API](https://developers.google.com/merchant/api/guides/authorization/access-your-account)
- [Register as a developer — Merchant API](https://developers.google.com/merchant/api/guides/quickstart/registration)
- [Quotas and limits — Merchant API](https://developers.google.com/merchant/api/guides/quotas-limits)
- [Understanding quotas in Google Merchant Center](https://support.google.com/merchants/answer/16564100)
- [Identifier exists [identifier_exists] — Merchant Center Help](https://support.google.com/merchants/answer/6324478)
- [Expiration date [expiration_date] — Merchant Center Help](https://support.google.com/merchants/answer/6324499)
- [Google Shopping available in the UAE (DataFeedWatch)](https://www.datafeedwatch.com/blog/google-shopping-available-in-united-arab-emirates)
