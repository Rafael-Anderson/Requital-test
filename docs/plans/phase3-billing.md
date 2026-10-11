# Phase 3 billing design (PLT-1)

**Status:** DESIGN ONLY, 2026-10-12. No code, no migration, no branch other than this
document. Written against `main` at `7024a6d7`. It turns
`docs/plans/product-capability-audit.md` PLT-1 (section 2.13, "PLT-1, in detail"),
section 6-F, section 8 Phase 3 and decisions D1 to D5 (section 9.3) into something that
can be built in slices. Related audit items it touches: PLT-2 (limits), PLT-3 (plan
change), PLT-10 (revenue reporting), PLT-11 (done), ONB-12 (trial onboarding), N10
(billing and dunning notification, section 11), I18N-9 (TRN printing), OPS-16 (shop-level
export and purge).

**How to read the evidence.** `path:line` references are to `main` at the SHA above. A
statement about what the Requital code does is VERIFIED unless marked otherwise. Every
statement about **Stripe Billing behaviour** is **INFERRED** from general knowledge of the
Stripe API: nothing in this document could be checked against Stripe's live
documentation or a Stripe account, and every such statement must be confirmed in test mode
before it is relied on (section 18 lists them as a checklist). Statements about UAE or
other tax law are **INFERRED** and need an accountant, not an engineer (section 10).

---

## 0. Decisions already taken by the owner (fixed, not re-opened here)

| # | Decision | Where it bites in this design |
|---|---|---|
| F1 | Every existing merchant is grandfathered FREE on a named legacy plan | section 5 (representation, protection), section 19 (backfill) |
| F2 | Tiers by FEATURE, with a SOFT order-volume ceiling: warn and surface, never block checkout or lose orders | section 7 (gating), section 8 (metering and banners) |
| F3 | 14-day trial | section 4 (state machine) |
| F4 | Plan prices are in the shop's own currency | section 9 (price books) |
| F5 | Stripe Billing for the subscriptions | sections 9 to 12 |
| F6 | Suspension reuses the existing `shop.suspendedAt` mechanism | section 4.3, section 11 |

Everything else (tier names, prices, ceilings, which flag sits in which tier, card
up-front or not, grace lengths) is an owner question. Section 23 lists them with a proposed
default each. **Nothing in this document invents a price or a ceiling as fact;** the
numbers that appear are placeholders and are labelled as such.

---

## 1. What exists today, and the corrections it forces

### 1.1 Facts the design leans on

| Fact | Evidence |
|---|---|
| The entitlement hook is already reserved and returns "no opinion" | `backend/src/features/features.service.ts:24` (`planDefault`), called at `:146`. Comment at `:19-23` says it "must learn the plan layer at the same time" as `enabledShopIds()` |
| Precedence is override, then shop column, then plan, then registry default | `features.service.ts:32-41` (`resolveFlag`) |
| 10 registered keys, all `source: 'column'` today | `backend/src/features/feature-keys.ts:50-104` |
| Overrides are written only by platform staff, with an audit row in the same transaction | `features.service.ts:204-217` (`setOverride`), `platform-admin.controller.ts` routes `shops/:shopId/features/:key` |
| `shop.suspendedAt` is checked per request, at login, and on the public path | `auth/guards/auth.guard.ts:118`; `auth/auth.service.ts:215` (login) and `:256` (MFA second step); `public/public.service.ts:2454` (`resolveShop`) |
| Two more consumers of `suspendedAt` | `drivers/driver-app.service.ts:85` (driver login join), `url-redirects/url-redirects.service.ts:685` |
| Platform suspend and unsuspend are bare column writes, audited by a platform admin id | `platform-admin/platform-admin.service.ts:307-330` |
| An existing confinement pattern: a session may only call routes marked `@AllowPendingMfa` | `auth/guards/auth.guard.ts:131-147`, decorator imported at `:14` |
| The merchant-facing Stripe provider takes the merchant's own keys and falls back to `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | `payments/providers/stripe-payment.provider.ts:19` and `:33`; creates `new Stripe(key)` at `:41` with no pinned API version |
| Stripe webhook verification is the static, offline HMAC `Stripe.webhooks.constructEvent` | `stripe-payment.provider.ts:141` |
| Webhook idempotency is a unique key, catching duplicate-key and lock-conflict errors | `payments/payments.service.ts:366-372`; `database/mysql-errors.ts` |
| Raw body is on for the whole app | `main.ts:21` (`rawBody: true`) |
| Money rounding and minor units are keyed off one map; KWD, BHD, OMR are factor 1000 | `common/currency-minor-units.ts`; `shop/dto/update-shop.dto.ts:37` (`SUPPORTED_CURRENCIES`, all seven) |
| `PLATFORM_BASE_CURRENCY` is `USD` | `currency-rates/currency-rates.constants.ts:11` |
| The job queue is idempotent on a key; recurring sweeps use a CAS advisory lock | `jobs/jobs.service.ts:41-83`; `jobs/scheduler.service.ts:23` (`runLocked`) |
| Email goes through `sendEmail()` and a `send_email` job | `common/email.ts`; `jobs/jobs.types.ts` (`SendEmailJobPayload`) |
| Platform audit writes need a real `platformAdminId` (NOT NULL, FK) | `prisma/migrations/20260826110000_platform_admin_access/migration.sql:23-35`; `platform-admin/platform-audit-log.service.ts` |
| Orders are indexed by `(shopId, createdAt)` | `prisma/migrations/20260722175919_order_inventory_payments/migration.sql:32` |
| Convention: cancelled orders are excluded from the dashboard and the rollups | `analytics/analytics-rollup.service.ts:34` and `:92` |
| Signup captures `trn`, `country`, `countryCode` but not currency or timezone from the country | `auth/auth.service.ts:110-116`; CLAUDE.md "Gaps recorded by the 2026-10-02 audit" (1), (3) |
| Email verification already gates a short list of merchant actions | CLAUDE.md "Email verification gates four merchant actions"; `auth/guards/verified-email.guard.ts`; `shop/shop.controller.ts:18-19,65` |
| Settings IA reserves "Business > Plan & Billing" | audit section 14.4 tree and the absorption table (`product-capability-audit.md:5297`, `:5361`); `admin/lib/settings-registry.ts:6` says the group is absent until the feature lands |

### 1.2 Corrections to the audit's sketch (the premise changed in three places)

1. **`planDefault()` cannot gate a column-backed flag as the code stands.** The audit and
   the code comment treat the plan as a layer between the merchant's column and the
   registry default. But `resolveFlag` returns the column the moment it is non-null
   (`features.service.ts:39`), and every registered key is column-backed and its column is
   `NOT NULL` (the comment at `feature-keys.ts:12-14` says as much: the default "is not a
   value any read path currently reaches"). So today a plan answer is **never consulted**
   for any of the 10 keys. A plan is an *entitlement ceiling*, the merchant's column is a
   *preference*; those are different relations and the current precedence only models the
   second. Section 7.1 specifies the change. `enabledShopIds()` resolves the same
   precedence in SQL (`features.service.ts:184-199`) and must change in the same commit,
   which `features.service.spec.ts` already asserts.
2. **A billing-suspended merchant cannot log in to pay.** `suspendedAt` produces a 403 at
   login (`auth.service.ts:215`) and on every request (`auth.guard.ts:118`), for every
   role. Reusing the column unchanged for non-payment would lock the one person who can
   fix it out of the one page that fixes it. Section 11.2 adds a *billing-locked*
   confinement beside the existing MFA one.
3. **`suspendedAt` has no reason, so payment could undo an abuse suspension.** Platform
   suspend (`platform-admin.service.ts:307`) and billing suspend would write the same
   column; a webhook that clears it on `invoice.paid` would also lift a platform admin's
   deliberate suspension of an abusive shop. Section 4.3 adds a reason and makes both
   directions compare-and-swap on it.

### 1.3 Two further observations about the current suspension (not billing's to fix, but billing makes them matter)

- **Suspension is not applied to background work.** Apart from the three consumers
  listed above, no cron sweep or job handler filters on `suspendedAt` (a repo-wide search
  of `backend/src` finds only auth, public, drivers, url-redirects and platform-admin).
  Abandoned-cart recovery, the low-stock digest and the daily rollup keep running for a
  suspended shop. For billing this is a cost and a fairness issue (Requital sends the
  suspended shop's customer emails). Proposal: sweeps that email customers skip suspended
  shops; payment webhooks, Slider webhooks and the reconciliation sweep **keep running**
  (a customer who paid before the suspension must still have the order marked paid).
  Flagged in the open questions.
- **Order tracking stays reachable** for a suspended shop: `lookupOrder` is token-based and
  un-slugged (`public.service.ts:1264`, comment at `:2467`). That is the right behaviour
  for a customer holding a paid order; it is stated here so nobody "completes" the
  suspension by closing it.

---

## 2. Two Stripe integrations, never one

The existing Stripe code is the **merchant's** gateway: a merchant's customer pays the
merchant. Billing is the opposite direction: the merchant pays **Requital**. They must
not share keys, clients, webhook routes or code paths.

| | Merchant gateway (exists) | Billing (this design) |
|---|---|---|
| Who pays whom | shopper pays merchant | merchant pays Requital |
| Keys | per-shop, encrypted (`PaymentSettingsService`), platform fallback `STRIPE_SECRET_KEY` | **new** `BILLING_STRIPE_SECRET_KEY`, `BILLING_STRIPE_WEBHOOK_SECRET`, `BILLING_STRIPE_PUBLISHABLE_KEY` (only if Elements is ever used; hosted Checkout needs none, INFERRED) |
| Webhook route | `POST /payments/webhook/stripe[/:shopId]` (`payments/payments.controller.ts:81`) | **new** `POST /billing/webhook`, own secret, own table |
| Client | `StripePaymentProvider.clientFor` (`stripe-payment.provider.ts:32-45`) | **new** `BillingStripeClient`, constructed once, **API version pinned** (the existing one is not, `:41`) |
| Code location | `payments/` | **new** `billing/` module; it must not import `payments/` |

**Trap to design out.** `STRIPE_SECRET_KEY` is documented as "platform fallback" for shops
without their own Stripe keys (`stripe-payment.provider.ts:27-30`) and is listed in
`PlatformAdminService.getSettingsStatus` (`platform-admin.service.ts:454`). If it points
at the same Stripe account billing uses, then (a) a merchant's checkout session would be
created on Requital's billing account, mixing shopper money with subscription revenue, and
(b) a shopper's `checkout.session.completed` would reach whichever endpoint is configured
for that account. **Recommendation: a separate Stripe account** (or at minimum a separate
restricted key plus a separate webhook endpoint) for billing, and a startup assertion in
`env-validation.ts` that `BILLING_STRIPE_SECRET_KEY !== STRIPE_SECRET_KEY` when both are
set. The billing module reads **only** the `BILLING_*` variables; a lint-style guardrail
in the spirit of `tools/check-storefront-url.js` (`tools/check-billing-keys.js`) fails
CI if `billing/` mentions `STRIPE_SECRET_KEY` or `payments/` mentions `BILLING_STRIPE`.

The Platform admin settings status list gains the three `BILLING_*` names
(configured / not configured only, never a value, as the existing comment requires at
`platform-admin.service.ts:448-452`).

---

## 3. Data model sketch

Table naming follows the codebase: lowercase singular, join tables with composite PKs,
hand-authored migration, `db/types.ts` updated by hand. Money columns are `DECIMAL`
with an explicit scale and a `currency` column beside every amount (never an implicit
shop currency; same discipline as A1). All FKs scoped by `shopId` where tenant-owned.
Column lists are a sketch, not final DDL.

```
plan                      platform-owned, no shopId
  id, code UNIQUE            'legacy_free' | 'tier1' | 'tier2' | 'tier3' (names TBD)
  name, status               'active' | 'retired'  (retired = no new subscribers)
  kind                       'legacy' | 'standard' | 'comp'
  isSelectable               legacy and comp are NOT (cannot be chosen by a merchant)
  orderSoftCeiling INT NULL  orders per month, NULL = no ceiling
  sortOrder, createdAt

planfeature               composite PK (planId, featureKey)
  planId, featureKey VARCHAR(64), entitled BOOLEAN
  -- featureKey validated in code against FEATURE_KEYS, not a DB enum

planprice                 one row per (plan, currency, interval, version)
  id, planId, currency CHAR(3), interval 'month'|'year',
  amount DECIMAL(12,3)       major units, rounded by the currency's minor-unit rule
  stripePriceId UNIQUE NULL  set when synced to Stripe
  active BOOLEAN, createdAt
  UNIQUE (planId, currency, interval) WHERE active   -> enforced in service (MySQL has no
                                                        partial unique index; same note as
                                                        taxclass.isDefault in CLAUDE.md)

billingcustomer           one per shop
  shopId UNIQUE FK, stripeCustomerId UNIQUE,
  billingEmail, legalName, taxId, taxIdType   -- copy of TRN etc. captured FOR BILLING
  billingCountryCode, currency CHAR(3)        -- frozen at first subscription (section 9.3)
  createdAt

shopsubscription          exactly one row per shop (the CURRENT one)
  shopId UNIQUE FK, planId FK,
  status   'trialing'|'active'|'past_due'|'suspended'|'cancelled'
  source   'legacy'|'stripe'|'comp'
  currency, interval, planPriceId FK NULL
  trialStartedAt, trialEndsAt,
  currentPeriodStart, currentPeriodEnd,
  cancelAtPeriodEnd BOOLEAN, cancelledAt,
  pastDueSince, graceEndsAt,
  pendingPlanId NULL, pendingPlanPriceId NULL   -- scheduled downgrade (section 12)
  stripeSubscriptionId UNIQUE NULL,
  stripeSyncedAt DATETIME(3) NULL                -- monotonic guard (section 13.3)
  version INT                                    -- CAS counter for every transition
  updatedAt

subscriptionevent         append-only history, the billing audit trail (section 14)
  id, shopId, fromStatus, toStatus, fromPlanId, toPlanId, reason VARCHAR(64),
  actorType 'merchant'|'platform_admin'|'stripe'|'system', actorId NULL,
  stripeEventId NULL, metadata JSON, createdAt

billingwebhookevent       delivery-idempotency table (section 13)
  stripeEventId UNIQUE, type, shopId NULL, receivedAt, processedAt NULL, result

platforminvoice           mirror of Stripe invoices, read-only to the merchant
  id, shopId, stripeInvoiceId UNIQUE, number, status,
  currency, subtotal, taxAmount, total, amountPaid, amountDue  (DECIMAL, with currency)
  periodStart, periodEnd, dueDate, paidAt, attemptCount, nextAttemptAt,
  hostedInvoiceUrl, invoicePdfUrl, createdAt, syncedAt

usagenotice               threshold-warning dedupe (section 8.3)
  PK (shopId, periodKey, level)   level 80|100|120, sentAt
  -- claimed with INSERT IGNORE exactly like the paymentreconciliation claim

shop (additive)
  suspensionReason VARCHAR(16) NULL   'platform' | 'billing' | 'cancelled'
```

Notes on choices:

- **No JSON `featuresJson`/`limitsJson` on `plan`** (the audit's sketch). A `planfeature`
  row per key keeps the registry the single list of keys and lets the platform page show
  a matrix; a JSON blob would drift from `FEATURE_KEYS` silently. The single numeric
  limit in v1 is a plain column.
- **One current subscription row per shop, history in `subscriptionevent`.** The audit's
  `shopsubscription` is kept, but we do not keep superseded subscription rows; the event
  table answers "what happened when" without a second source of truth for "what is true
  now".
- **`taxId` on `billingcustomer` is a copy, not a foreign reference to `shop.trn`.** A
  merchant's storefront TRN and the identity on a Requital tax invoice are different
  documents; editing one must not silently rewrite an issued invoice (the same argument
  `invoice.snapshotJson` made). `shop.trn` is captured at signup (`auth.service.ts:110`),
  never printed and not editable (CLAUDE.md gap 3, I18N-9), so billing needs its own
  editable field regardless.
- **`platforminvoice` amounts as `DECIMAL` plus currency**, converted from Stripe's integer
  minor units with `minorUnitFactor(currency)` (1000 for KWD/BHD/OMR). Never `/ 100`.
- Nothing in these tables holds a card number, token or secret. Stripe ids only (section
  17.1).

---

## 4. State machine

### 4.1 States and transitions

```
                 signup (post-cutover)
                        |
                        v
                  +-----------+  payment method added +
                  | trialing  |  plan chosen          v
                  +-----------+------------------> +--------+   period renews paid
                        |                          | active |<-------------------+
          trial ends,   |                          +--------+                    |
          no paid sub   |             invoice.payment_failed |                   |
                        v                                    v                   |
                  +-----------+  <-------------------- +-----------+  paid ------+
                  | past_due  |                        | past_due  |
                  +-----------+                        +-----------+
                        | graceEndsAt reached (still unpaid)
                        v
                  +-----------+   paid (any time)  --> back to active, INSTANTLY
                  | suspended |
                  +-----------+
                        | suspended + 16 days (default) still unpaid, or merchant cancels
                        v
                  +-----------+   re-subscribe --> trialing is NOT granted again; goes to active on payment
                  | cancelled |
                  +-----------+

  legacy: source='legacy', status='active', never leaves except by an explicit,
          acknowledged, one-way upgrade (section 5.3). No dunning, no trial, no Stripe.
```

Every transition is a **compare-and-swap on `(shopId, status, version)`**, in the same
house style as order status (`UPDATE ... WHERE shopId = ? AND status = <expected> AND
version = <expected>`, inspect `affectedRows`; the loser re-reads). A transition and its
`subscriptionevent` row are one transaction. Transitions are driven by exactly three
things: a verified Stripe webhook (section 13), a time-based sweep (section 11), and an
explicit authorised action (merchant or platform admin). Nothing infers state from the
clock inside a read path.

| From | To | Trigger | Side effects |
|---|---|---|---|
| (none) | `trialing` | signup transaction (`AuthService.signup`), post-cutover only | `trialEndsAt = createdAt + 14d`; trial entitlements (section 4.4); N10 "trial started" email |
| `trialing` | `active` | merchant adds a payment method and picks a plan; Stripe subscription becomes `active` (INFERRED event: `customer.subscription.updated`) | `trial_end` ends the trial early (INFERRED param) |
| `trialing` | `past_due` | `trialEndsAt` passed, no Stripe subscription in good standing (sweep) | `pastDueSince = trialEndsAt`, `graceEndsAt = trialEndsAt + 7d` (default; Q8) |
| `active` | `past_due` | `invoice.payment_failed` for the current subscription | `pastDueSince = now`, `graceEndsAt = now + 14d`; dunning stage 1 |
| `past_due` | `active` | `invoice.paid` / subscription `active` | clear `pastDueSince`/`graceEndsAt` |
| `past_due` | `suspended` | sweep: `graceEndsAt <= now` and still unpaid | `shop.suspendedAt` set with reason `billing` (4.3) |
| `suspended` | `active` | `invoice.paid` | clear billing suspension in the SAME transaction (11.4) |
| `suspended` | `cancelled` | sweep: suspended for 16 more days (Q8) | cancel the Stripe subscription (INFERRED API); data-retention clock starts (section 17.3) |
| `active`/`trialing`/`past_due` | `cancelled` | merchant cancels | `cancelAtPeriodEnd = true` first; becomes `cancelled` at period end |
| `cancelled` | `active` | merchant re-subscribes and pays | no second trial; reason `reactivated` |
| any | any | platform admin override (comp, extend trial, force) | audited, section 14 |

### 4.2 What each status means for the merchant

| Status | Admin | Storefront | Entitlements |
|---|---|---|---|
| `trialing` | full, banner with days left | online | trial tier (4.4) |
| `active` | full | online | the plan's |
| `past_due` | full, persistent banner with the amount, a Pay now button, and the date the store will go offline | **online** | the plan's (no features removed during grace) |
| `suspended` | admin role only, confined to billing (11.2); other roles told to ask the owner | **offline** (`resolveShop` 404, `public.service.ts:2454`) | n/a |
| `cancelled` | admin role only, confined to billing and data export | offline | n/a |

Putting entitlement removal in `past_due` was considered and rejected: it punishes the
merchant before the grace period ends and creates a third state of partial function that
is hard to explain. Grace is all-or-nothing: fully working until suspension.

### 4.3 Suspension reason and the compare-and-swap rule

Add `shop.suspensionReason` (nullable `VARCHAR(16)`: `platform`, `billing`, `cancelled`).
Migration backfills every currently suspended shop to `platform` (production may already
have some; they must never be auto-lifted by a payment). Then:

```
-- billing suspends (never overwrites a platform suspension)
UPDATE shop SET suspendedAt = ?, suspensionReason = 'billing'
 WHERE id = ? AND suspendedAt IS NULL;

-- payment lifts (only its own suspension)
UPDATE shop SET suspendedAt = NULL, suspensionReason = NULL
 WHERE id = ? AND suspensionReason = 'billing';
```

`PlatformAdminService.suspend` (`platform-admin.service.ts:307`) is changed to write
`suspensionReason = 'platform'` and to overwrite a billing suspension (a platform admin's
decision wins and then payment no longer lifts it). `unsuspend` (`:322`) clears either
reason, because a platform admin may deliberately comp a shop. Both stay audited.

### 4.4 The trial

- 14 days from shop creation (`shop.createdAt`), fixed length in v1.
- **Which features during the trial:** all features of the middle tier by default (Q4) so
  the merchant sees the product they would pay for, with the order soft ceiling of that
  tier. Not the top tier (a trial that loses features at conversion is a worse experience
  than one that gains none).
- **Card up front:** default **no** (Q3). It matches the Gulf SMB onboarding norm and the
  audit's ONB-12 framing; the cost is abuse (serial trials). Mitigations that already
  exist: email verification (STF-14), disposable-domain blocking, the signup throttle
  (OPS-10 in CLAUDE.md). One trial per `billingcustomer.taxId` / per verified email domain
  can be added later without a schema change.
- Trial reminders: day 7, day 11 (T-3), day 13 (T-1), day 14 (T0), through the N10
  channel (section 11.3).
- No trial extension by the merchant; a platform admin can extend (audited, section 14).

---

## 5. The legacy plan, and keeping it safe

### 5.1 Representation

- One `plan` row, `code = 'legacy_free'`, `kind = 'legacy'`, `isSelectable = 0`.
- **Entitlements: every registered key entitled, no order ceiling.** The point of
  grandfathering is that nothing a live merchant has today changes; gating anything for
  them would be a silent downgrade. (New keys registered later get an explicit
  `planfeature` row for legacy in the same migration as the key; see 7.3.)
- Every existing shop gets one `shopsubscription` row: `source = 'legacy'`,
  `status = 'active'`, `planId = legacy`, no Stripe ids, no period dates, no trial.
- No special-casing in feature code: the resolver asks "does this shop's plan entitle the
  key", and the legacy plan answers yes. That is the audit's requirement that
  grandfathering be "expressible in `shopsubscription` ... without special-casing it in
  code" (PLT-1 text, `product-capability-audit.md:1745-1750`).

### 5.2 Fail-open for a missing row

A shop with **no** `shopsubscription` row is treated as legacy for entitlement and as
never-billable for dunning. This covers the window between migrating and deploying (a
shop created by the old backend after the migration ran) and any bug. The resolver must
never lock a merchant out because a row is missing. A platform report lists shops with no
row, and the post-deploy backfill (section 19) closes them.

### 5.3 Protection from accidental downgrade

A legacy merchant must not lose their status by any ordinary action. Layered, so no
single mistake does it:

1. **No Stripe object exists for a legacy shop**, so no webhook, no sweep and no portal
   action can reach it. Every billing sweep selects `source = 'stripe'` only, and every
   webhook handler resolves the shop through `billingcustomer.stripeCustomerId` (a legacy
   shop has none).
2. **The service refuses.** `BillingService.changePlan` rejects `to = legacy` outright;
   `cancel` on a legacy subscription is a 409 (there is nothing to cancel); there is no
   "downgrade to free" button for anyone, because there is no free tier except legacy.
3. **Leaving legacy is a deliberate, one-way action:** a legacy admin who chooses a paid
   plan sees a modal stating that this ends the free legacy status permanently and cannot
   be reversed by cancelling, must tick an acknowledgement, and the request carries
   `acknowledgeLeavingLegacy: true`; the server 400s without it. The `subscriptionevent`
   row records `reason = 'left_legacy'`. (Q2: whether self-serve leaving is allowed at all,
   or only by a platform admin on request. Default: allowed, because a legacy merchant who
   wants a paid-only feature should be able to buy it.)
4. **Only two writers may set `planId = legacy`:** the migration backfill and a platform
   admin "restore legacy" action (typed shop name confirmation, audited). A unit test
   greps `backend/src` for writes of the legacy plan id outside those two files, in the
   spirit of `tools/check-feature-flags.js`.
5. **Plan retirement cannot orphan it.** Retiring a `standard` plan does not touch
   subscribers; the legacy plan is never `retired`.
6. **Currency, TRN or country edits do not touch it** (a change of `shop.currency` after
   the cutover affects new orders only, per the A6 rule in CLAUDE.md; it must not reprice
   or re-plan a subscription).

---

## 6. Entitlement resolution

### 6.1 The change to `FeaturesService`

Two concepts, kept apart:

- **Entitled(shop, key):** does the shop's current plan include the key. Source:
  `shopsubscription -> plan -> planfeature`. No row, or no `planfeature` row for the
  key, means entitled (fail-open, 5.2; and a key registered after the plan was authored
  must not silently turn off).
- **Preferred(shop, key):** the merchant's own switch (the column, or for table-backed keys
  the registry default).

New resolution:

```
effective = override                      if a shopfeatureoverride row exists   (platform wins, both ways)
          = entitled && preferred         otherwise
```

For a column-backed key this changes today's `column` result to `column AND entitled`.
For every shop on the legacy plan `entitled` is always true, so **the result is
byte-identical to today for every existing merchant**, which is what makes the change
safe to ship before any paid tier exists. `planDefault()` is replaced by an
`entitled()` lookup folded into the existing `load()` queries (a third small query, or a
join, in the same round trip; the per-request re-read is kept on purpose, so a plan
change or a payment takes effect on the next request, matching `AuthGuard`'s philosophy
at `auth.guard.ts:95-118`; no in-process cache).

`enabledShopIds()` (`features.service.ts:184`) gets the same logic in SQL via a LEFT JOIN
to `shopsubscription`/`planfeature` with a COALESCE-to-entitled, and
`features.service.spec.ts` (which asserts the two agree) is extended with a plan matrix.

`GET /shop` still echoes the merchant's own column and the public payload the effective
value, as CLAUDE.md "Feature flags" says. The platform page (`FeatureStatus`) gains
`entitled: boolean` and `entitledBy: 'plan' | 'default'` so staff can see why a flag is
off.

### 6.2 Consequences worth stating

- A downgrade **never rewrites the merchant's column**: they turned the feature on, the
  plan stopped entitling it, an upgrade restores it with no re-configuration.
- An override beats entitlement in both directions: a platform admin can comp one feature
  on a cheap plan, or force one off. Comp is therefore a `shopfeatureoverride` row plus a
  note (already audited, `setOverride` runs in the audit transaction), not a new mechanism.
- `tools/check-feature-flags.js` keeps its meaning: only the adapter reads a registry
  column. The new `entitled` read lives in the same adapter.

---

## 7. Feature gating strategy

### 7.1 Principle

Gate **capabilities that cost Requital money or that are a deliberate upsell**, never
anything that changes what a customer is charged or what an order does. That is the same
exclusion the registry already states (`feature-keys.ts:16-22`: money and tax booleans,
payment-method toggles, `published`, `disableStoreCart`, policy and state flags stay out
because "an override could change what is charged").

**Plan-gating must never flip a stock or money behaviour.** `auto_deduct_ingredient_stock`
changes how inventory is decremented (CLAUDE.md "Stock policy by path"); if a downgrade
turned it off, stock would silently stop being deducted and the ledger would drift. It is
entitled on every plan.

### 7.2 Proposed mapping of the current 10 flags (OWNER QUESTION, section 23 Q4)

Working tier names only: **T1 / T2 / T3**. "Why" is the reasoning, not a decision.

| Key | Today | T1 | T2 | T3 | Why |
|---|---|---|---|---|---|
| `notify_email` | order status emails | yes | yes | yes | table stakes; costs pennies on Resend |
| `low_stock_digest` | daily digest email | yes | yes | yes | table stakes |
| `auto_deduct_ingredient_stock` | stock policy | yes | yes | yes | **never gated** (7.1) |
| `product_image_zoom` | storefront cosmetic | yes | yes | yes | no cost, no upsell value |
| `collection_menu` | storefront cosmetic | yes | yes | yes | same |
| `whatsapp_floating_button` | storefront link-out | yes | yes | yes | a link, no cost to Requital |
| `abandoned_cart_recovery` | recovery emails | no | yes | yes | revenue-recovery upsell; email volume |
| `customer_survey` | post-delivery survey | no | yes | yes | feeds reviews; upsell |
| `notify_customers_whatsapp` | customer WhatsApp messages | no | no | yes | per-message cost on the merchant's own credentials, but support load is on Requital |
| `slider` | Slider on-demand courier | no | yes | yes | uses **Requital's partner key** (`delivery-providers`, CLAUDE.md "Slider on-demand delivery"), so it is a real platform cost |

### 7.3 Capabilities that are not flags today and should be registered *with their consumer* before they ship (candidates, not part of this build)

CLAUDE.md's rule is "a new feature gets a registry key together with its consumer". The
audit's section 6-F warns that shipping a large feature ungated is the expensive
direction. Candidates, each marked with the tier a plan owner would likely place it in:
multi-outlet beyond N outlets, purchase orders and suppliers (INV-1/2), custom domain,
analytics pixels and Meta CAPI (MKT-4), URL redirects import (ONB-4), the Shopify
importer (ONB-1), staff roles and branch roles (STF), 2FA enforcement, driver dispatch
(T2 batch), customer CRM and segments (S4), the future public API (PLT-4) and outbound
webhooks (PLT-5), B2B. **Not decided here**; they are listed so the owner sees the shape
of the gating surface. Each gets a `FEATURE_KEYS` entry (`source: 'table'`) and a
`planfeature` row for every plan, including legacy, in the migration that adds it.

### 7.4 Where gates are enforced

Server side only; the admin hides what the server would refuse. A gated endpoint answers
`403 { code: 'feature_not_in_plan', feature: '<key>' }` (stable code, same pattern as
`mfa_enrollment_required`, `auth.guard.ts:149-155`); the admin turns that into an upgrade
prompt. Cron sweeps that serve a gated feature use `enabledShopIds(key)` (already the
pattern for the low-stock digest and cart recovery), so an unentitled shop is skipped
without a per-shop call. The storefront never calls billing; it gets effective flags
through the existing public payload.

---

## 8. Order-volume metering and the soft ceiling

### 8.1 What is counted, and where

**Definition (default; Q5):** the number of `order` rows for the shop with
`status <> 'cancelled'` and `createdAt` inside the **calendar month in the shop's own
timezone** (`shop.timezone`, `db/types.ts:525`).

- *Why non-cancelled:* it matches the Dashboard and rollup convention
  (`analytics-rollup.service.ts:34,92`), and a merchant should not be counted for orders
  they cancelled. A later cancellation can lower a past month's count; that is acceptable
  for a soft measure and is stated in the UI.
- *Why creation time, not payment or delivery:* it is the only timestamp every order has
  immediately; pending, pay-on-delivery, draft-order-completed and phone orders all create
  an `order` row through the same table (`PublicService.createOrder`, `OrdersService.create`,
  draft complete via `create`), so one COUNT covers every path with nothing to remember at
  each create site.
- *Why a calendar month, not the Stripe billing period:* the merchant understands "orders
  this month"; the Stripe anchor drifts per shop and shifts on plan changes and trial
  conversion. The ceiling is a communication device, not a billing quantity (there is no
  metered billing in v1), so the simpler period wins. If metered overage billing is ever
  introduced the period would have to follow the invoice (Q5 notes this).
- *Time zone:* `shop.timezone` via the same `dateKeyInTimezone` helper the rollup uses.
  Known gap: signup does not derive timezone from country (CLAUDE.md gap 1), so a Saudi
  shop is on Dubai time until fixed, a one-hour skew at the month boundary. Acceptable for
  a soft ceiling; the fix is the existing open follow-up, not a billing dependency.

**Counting mechanism:** a live `SELECT COUNT(*) ... WHERE shopId = ? AND createdAt >= ? AND
createdAt < ? AND status <> 'cancelled'`, which uses `Order_shopId_createdAt_idx`
(`...order_inventory_payments/migration.sql:32`). Not `dailyshopmetrics.orders`: that is a
nightly rollup that lags to about 05:00 Dubai (`analytics-rollup.service.ts:67-71`) and
is per-outlet. It is used only for the history chart. **Nothing is added to the order
creation transaction.** A counter incremented at checkout would add a write to the hottest
path, and the nested-pool rule (CLAUDE.md F7; `tools/check-nested-pool.js`) forbids a
service call that touches the pool inside it. The soft ceiling can tolerate a count that
is minutes stale; checkout cannot tolerate a new failure mode.

### 8.2 Who computes it, and when

- `GET /billing/usage` (admin) computes live for the current month and returns
  `{ periodKey, used, ceiling, percent, level }` (cheap: one indexed COUNT).
- An hourly sweep under `runLocked('billing-usage-sweep', ...)` covers only shops whose
  plan has a non-NULL `orderSoftCeiling`, computes the count, and fires threshold notices
  (8.3). Shops on legacy (no ceiling) are skipped entirely.
- The top bar banner reads `/billing/usage` on admin load and every 5 minutes; no
  websocket (consistent with "deliberately polling" in CLAUDE.md for orders).

### 8.3 Soft-ceiling UX: warn and surface, never block

| Used / ceiling | Admin | Email (N10, once per level per month) |
|---|---|---|
| under 80% | usage meter on the Plan & Billing page only | none |
| 80% | amber banner "You have used 80% of this month's orders on the X plan" with an Upgrade link | yes, "approaching" |
| 100% | stronger banner "You have reached your plan's order volume. Orders keep coming in; nothing is blocked." plus Upgrade | yes, "reached" |
| 120% | persistent banner, also shown on the dashboard, plus a message to the account owner suggesting a plan review | yes, "well over" |

Hard rules:

1. **Never blocks anything.** No check in `PublicService.createOrder`, `OrdersService.create`
   or draft completion reads usage. A test asserts an order placed at 300% of ceiling
   succeeds and is not delayed (and that those create paths do not import the billing
   module, enforced by a small grep guardrail like the others).
2. **Never loses an order,** never disables the storefront, never degrades a response.
3. Banners are **admin-role only** (the people who can act). Branch and order-manager
   staff do not see them, so a cashier is not nagged about a plan.
4. Notices are deduplicated by `usagenotice (shopId, periodKey, level)` with a CAS claim
   (`INSERT IGNORE`, inspect affected rows) before the email job is enqueued with
   idempotency key `billing:usage:<shopId>:<periodKey>:<level>`. A retry cannot double-send.
5. The ceiling is shown in the platform admin shop page and PLT-10 reporting as a
   conversion signal ("shops over 120% for two months": the upgrade lead list).

This is PLT-2's **soft** half only; PLT-2's hard caps (products, staff, outlets, storage)
are explicitly out of scope because the owner chose a soft ceiling.

---

## 9. Price books and multi-currency (decision F4)

### 9.1 Model

A plan has one price per `(currency, interval)` in `planprice`. The platform sets the
amounts per currency explicitly (a price book), **not** a converted USD price: a flat
conversion produces ugly numbers and moves with FX. Exchange-rate tables
(`currencyrate`, base `USD`) are not used for billing at all. The set of billable
currencies is a subset of `SUPPORTED_CURRENCIES` (`update-shop.dto.ts:37`: AED, SAR, KWD,
QAR, BHD, OMR, USD) and is decided by what Stripe can actually present for the Requital
Stripe account's country (**INFERRED: Stripe supports a limited list of presentment
currencies and not all of the three-decimal Gulf currencies may be available for a given
account country; this is the most likely thing to constrain the design and must be
checked first, section 18 item 1**).

Fallback rule when a shop's currency has no price book entry: bill in `USD` (or `AED`,
Q7), shown clearly on the checkout page and the invoice. The merchant's storefront
currency is unaffected.

### 9.2 How it maps to Stripe Billing (all INFERRED)

- One Stripe **Product** per plan; one Stripe **Price** per `planprice` row (plan x
  currency x interval), with a `lookup_key` such as `plan:tier2:AED:month` so sync is
  idempotent. Alternative considered: one Price per plan carrying `currency_options`
  for each currency (INFERRED to exist). Rejected for v1 because one row per Price keeps
  `planprice.stripePriceId` one-to-one and makes a per-currency price change independent.
  Revisit if Stripe's per-currency tooling is clearly better.
- Prices are **immutable once used** (INFERRED: Stripe does not allow changing a price's
  amount; you create a new Price and archive the old). So `planprice` rows are append-only:
  a price change inserts a new row, marks the old `active = 0`, and existing subscribers
  stay on their old Price until moved (the platform page offers "migrate subscribers to the
  new price" as an explicit, audited bulk action; default is price-lock for existing
  subscribers).
- Minor units: `unit_amount = round(amount * minorUnitFactor(currency))` using
  `common/currency-minor-units.ts` (the same single map that the KWD end-to-end test pins).
  **INFERRED:** for three-decimal currencies Stripe requires the amount to be divisible
  by 10 (the final digit must be zero). So a KWD/BHD/OMR price book entry must be a
  multiple of 0.010; validate at write time in `PlanPriceService`, with a unit test over all
  seven currencies, and reject rather than round silently (a rounded price would disagree
  with the stored `amount`).
- `BillingService` never multiplies by 100.

### 9.3 Billing currency is frozen per customer

`billingcustomer.currency` is set at first subscription and does not follow
`shop.currency` afterwards (the A1/A6 principle that money rows record their own currency
and a shop currency change applies to NEW things only). **INFERRED:** a Stripe Customer is
locked to one currency once it has a priced subscription or invoice, so a currency change
needs a new Customer. Therefore: changing billing currency is a *platform admin* action in
v1 (cancel at period end, create a new `billingcustomer`/subscription in the new currency,
audited) and the merchant UI simply says "billed in KWD; contact support to change".

---

## 10. Tax on the subscription itself (INFERRED; needs an accountant)

Requital is the supplier of a SaaS service to the merchant. Everything in this section is
**INFERRED** UAE/GCC VAT understanding, not legal advice, and is the second thing (after
currency availability) that must be settled before invoices are issued.

- **Is Requital VAT-registered, and under what TRN?** Owner question (Q9). If yes, a UAE
  merchant is charged **5% VAT** on the subscription (INFERRED: electronically supplied
  services to a UAE recipient are standard rated). Prices are held **tax-exclusive** in the
  price book (B2B norm; a merchant's accountant expects net plus VAT) with the 5% added as
  a tax line (default; Q9 asks inclusive vs exclusive).
- **Non-UAE GCC merchants (KSA, KW, QA, BH, OM):** the supply is cross-border; treatment
  (zero-rated export of services, reverse charge on the recipient, or local registration
  by Requital) depends on the recipient's status and country and on whether Requital is
  registered there. KSA is already known to be the heavy case (ZATCA, audit D7/D8). **The
  design makes the tax treatment data, not code:** `billingcustomer.billingCountryCode` and
  `taxId` drive a rate selection (`tax_rates` on the Stripe subscription, INFERRED, or
  Stripe Tax if it supports the countries involved, INFERRED), and the default for any
  country the owner has not signed off is "price shown, no tax added, flagged on the
  platform page as `tax_treatment_unreviewed`", not a guessed rate. A shop in an
  unreviewed country can trial but not be charged until the platform admin marks the
  country reviewed (a one-row `billingcountry` config, or a settings flag, in the
  implementation).
- **Tax invoice requirements.** A UAE tax invoice carries the supplier name and TRN, the
  customer name and TRN where applicable, a sequential number, date, the "Tax Invoice"
  label, amounts excluding VAT, VAT per line and total (INFERRED list). Stripe invoices
  can display the account's tax IDs and the customer's tax ID (**INFERRED**, including a
  UAE TRN type), and Stripe numbers invoices sequentially (INFERRED). Whether Stripe's PDF
  satisfies the FTA's tax-invoice content and the Arabic/bilingual question is **not
  verified**; the safe design is that `platforminvoice` mirrors the totals and links to the
  Stripe-hosted PDF, and that Requital can later render its own compliant document from
  the mirrored data (the in-house invoice renderer pattern, `invoices/`, is a precedent)
  without a model change.
- **Merchant TRN capture.** Billing needs the merchant's TRN (UAE) on the invoice; today
  `shop.trn` is write-once at signup and printed nowhere (CLAUDE.md gap 3). The billing
  checkout form collects `legalName`, `billingEmail`, `billingCountryCode`, `taxId`, and
  seeds the field from `shop.trn` when present. This overlaps I18N-9 (make `shop.trn`
  editable and print it on the merchant's own invoices); build them together or accept two
  fields briefly.
- **E-invoicing.** UAE e-invoicing (audit D8 recommends export first, ASP later) is out of
  scope; the invoice mirror's export is the hook for it.

---

## 11. Dunning, suspension, and instant reversal

### 11.1 Who runs retries

Stripe Billing runs the payment retries and invoice state (**INFERRED:** "Smart Retries" /
a retry schedule configurable in the Stripe dashboard, and subscription status moves
`active -> past_due -> unpaid/canceled` according to the account's settings). Requital
owns **merchant communication** and **the decision to suspend**, so that we are not
dependent on Stripe's emails being enabled, localised or sent to the right address, and
so the suspension date is ours, not Stripe's. The Stripe dashboard retry window must be
configured to be **no longer** than our `graceEndsAt` (a checklist item, section 19 phase
2); Stripe is not told to cancel before we suspend (Stripe's "cancel after retries
exhausted" setting should be off or set longer than our timeline, INFERRED).

### 11.2 The billing-locked confinement (so the merchant can pay)

The decisive mechanism, mirroring the 2FA one (`auth.guard.ts:131-147`):

- `AuthService.login` (`:215`) and the MFA second step (`:256`) currently 403 any suspended
  shop. Change: if `shop.suspensionReason` is `billing` or `cancelled` **and** the user's
  role is `admin`, allow login and issue the normal session; for every other role (or
  `platform` suspensions) keep the 403.
- `AuthGuard` (`:118`) currently 403s every request for a suspended shop. Change: for a
  `billing`/`cancelled` suspension with role `admin`, allow **only** routes marked
  `@AllowBillingLocked()` (default deny, evaluated on every request exactly like
  `@AllowPendingMfa`, so a session open at the moment of suspension is confined at once).
  Everything else answers `403 { code: 'billing_locked' }`.
- `@AllowBillingLocked` routes: `GET /auth/me`, `GET /billing/*` reads, the checkout and
  portal session creators, `POST /billing/retry-payment`, `GET /billing/invoices`, logout,
  and (for `cancelled`) the shop data export (OPS-16). Nothing else, notably no order,
  product or settings route.
- The admin app routes a confined user to the Plan & Billing page with a full-page
  explanation (what happened, amount due, one Pay button). Non-admin staff see "Your store
  is offline because of an unpaid subscription. Ask your account owner."
- **Second path that needs no login:** the dunning emails carry the Stripe **hosted invoice
  URL** (`hosted_invoice_url`, INFERRED field) so the owner can pay from a phone without
  signing in at all. This is also the answer when the owner has lost their password or 2FA.

Impersonation: an impersonation token (`imp` claim, `auth.guard.ts:115-145`) is treated as
the admin it impersonates for confinement, but cannot start a checkout, change plan or
cancel (section 16).

### 11.3 Timeline (defaults; Q8)

`T0` = first `invoice.payment_failed` (or `trialEndsAt` for a no-card trial).

| When | Status | Merchant sees | Message (N10, email always; WhatsApp where an outlet number exists) |
|---|---|---|---|
| T0 | `past_due` | banner, Pay now | "Payment failed. Update your card." (Stripe retries start, INFERRED) |
| T0+3d | `past_due` | same | reminder; amount and offline date |
| T0+7d | `past_due` | same | reminder; **WhatsApp** to the outlet number via the platform account |
| T0+11d | `past_due` | same, red | "Your store goes offline in 3 days" |
| T0+14d (`graceEndsAt`) | `suspended` | login confined to billing | "Your store is offline. Pay now to restore it immediately." |
| T0+21d | `suspended` | same | final-notice style reminder |
| T0+30d | `cancelled` | login confined to billing and export | "Subscription cancelled. Your data is kept until DATE." |

No-card trial expiry uses a shorter grace (T0+7d suspension) because nothing was ever
paid; the same stage mechanics apply with the dates scaled.

Each stage is sent at most once, by a sweep under `runLocked('billing-dunning-sweep', ...)`
that selects `shopsubscription` rows in `past_due`/`suspended` with `source = 'stripe'`
(or a no-card trial), computes the due stage from `pastDueSince`, and enqueues a
`send_email` job with idempotency key
`billing:dunning:<shopId>:<invoiceId or trial>:<stage>`; the unique job key is the dedupe,
so a sweep that runs twice or on two PM2 instances cannot double-send. Emails use
`sendEmail()` via the existing job type (`jobs.types.ts`), which stubs when no key is set.
The platform WhatsApp alert job (`send_merchant_whatsapp_alert`) carries a required
`orderId` today (`jobs.types.ts`), so dunning WhatsApp needs a generalised payload or a
new job type; flagged as a build task, not designed here. N10 is **not disableable** per
the audit (`product-capability-audit.md:4438`).

### 11.4 Instant reversal on payment

The path from "money received" to "storefront back online" is one webhook and one
transaction, with no cache anywhere on the way:

1. `invoice.paid` (or the subscription going `active`) arrives and is verified (13.1).
2. The handler **re-fetches the subscription from Stripe outside any transaction**
   (network call, so it must not hold a pooled connection: the nested-pool rule), then
   opens one transaction:
   a. CAS `shopsubscription` `suspended -> active` (or `past_due -> active`) on `version`;
   b. `UPDATE shop SET suspendedAt = NULL, suspensionReason = NULL WHERE id = ? AND
      suspensionReason = 'billing'` (4.3; a platform suspension is untouched);
   c. insert the `subscriptionevent` row and mirror the invoice.
3. Effect: `AuthGuard` re-reads `suspendedAt` on every request (`auth.guard.ts:95-118`)
   and `resolveShop` re-reads the shop row on every public call (`public.service.ts:2454`;
   both uncached). The only places a stale value could linger are caches that do not
   exist today; the storefront app must be checked for any Next fetch cache on the shop
   endpoint (INFERRED to be uncached by default in Next 16; verify at build time, section
   18).
4. A **manual "I paid, restore now" path**: `POST /billing/refresh` (admin, allowed while
   locked) re-fetches the subscription from Stripe and applies the same transition, so a
   merchant is not stranded if a webhook is late. It is rate-limited and idempotent.
5. Reversal never depends on a sweep. The reconciliation sweep (13.4) is the safety net,
   not the mechanism.

---

## 12. Plan changes, proration, interval changes

All plan changes go through our `BillingService.changePlan`, never the Stripe Customer
Portal's own plan switcher (the portal is configured for **payment method and invoice
history only**, INFERRED to be configurable that way). Two live paths for plan change is
the same drift risk as the payment-provider toggle-bypass lesson in CLAUDE.md.

| Change | Rule | Stripe (INFERRED) |
|---|---|---|
| Upgrade (higher tier, same currency and interval) | immediate; entitlements switch when Stripe confirms the update; prorated charge for the remainder of the period, invoiced now | `subscriptions.update` with `proration_behavior: 'always_invoice'` |
| Downgrade | at **period end**, never mid-period; `pendingPlanId` recorded and shown in the UI; no refund of the current period | subscription schedule or a stored `pendingPlanId` applied on the renewal event; scheduled change preferred so Stripe, not our cron, performs it |
| Monthly to annual | immediate, prorated credit for the unused month | as upgrade |
| Annual to monthly | at period end | as downgrade |
| During trial | choosing a plan with a card ends the trial now and bills immediately (default; Q10 asks whether to bill at trial end instead) | `trial_end: 'now'` |
| Currency | not self-serve (9.3) | n/a |
| Cancel | `cancelAtPeriodEnd`; features stay until period end; undo allowed until then | `cancel_at_period_end: true` |
| Reactivate | after `cancelled`: new payment, no second trial | new subscription |
| Entitlement removal on downgrade | the downgrade modal lists the features that will switch off and reminds that settings are kept (6.2) | n/a |

The change request carries an **idempotency key** from the client and uses Stripe's
idempotency header (INFERRED) so a double-click cannot double-charge a prorated upgrade.
Every request is validated server side: `to` plan must be `active` and `isSelectable`, a
price must exist for the customer's frozen currency and interval, and the caller must be
the shop's `admin`.

---

## 13. Webhook handling and idempotency

### 13.1 Endpoint

`POST /billing/webhook`, `@Public()` (no staff session), raw body (already globally on,
`main.ts:21`), verified with `Stripe.webhooks.constructEvent(raw, signatureHeader,
BILLING_STRIPE_WEBHOOK_SECRET)`, the same offline HMAC verification the existing provider
uses (`stripe-payment.provider.ts:141`). A failed signature is a 400 with no side effects.
No staff cookie travels with a Stripe delivery, so the global staff CSRF middleware skips
it (`skipIfNoAccessCookie`, `common/csrf.ts:60-75`); an explicit entry in
`skipCsrfProtection`'s list is still added so the exemption is documented rather than
accidental (the existing `/auth/login/mfa` precedent in CLAUDE.md).

### 13.2 Events handled (INFERRED names; confirm in test mode)

`checkout.session.completed` (mode subscription), `customer.subscription.created|updated|
deleted`, `customer.subscription.trial_will_end`, `invoice.created|finalized|paid|
payment_failed|payment_action_required|voided`, and `customer.updated` only to mirror the
billing email. Everything else is acknowledged and ignored.

### 13.3 Idempotency, ordering and tenancy

- **Delivery idempotency:** `billingwebhookevent.stripeEventId` is a UNIQUE key. The
  handler inserts first inside the processing transaction and treats `isDuplicateKeyError`
  or `isLockConflict` as "already processed, return 200", exactly the shape at
  `payments.service.ts:366-372` (and for the same reason: a `findFirst`-then-insert would
  reopen the TOCTOU race). A crash before commit rolls the insert back, so Stripe's retry
  reprocesses.
- **Out-of-order and replayed events** (INFERRED: Stripe does not guarantee order):
  **never apply state from the event payload.** For every relevant event, fetch the current
  subscription and latest invoice from Stripe (outside any transaction), then apply the
  *current* truth guarded by `shopsubscription.version` (CAS) and a monotonic
  `stripeSyncedAt` so an older event arriving late cannot move the row backwards. The event
  is a *trigger to reconcile*, not a source of values. This also makes replays harmless.
- **Tenant resolution:** map the event to a shop **only** through
  `billingcustomer.stripeCustomerId` (looked up in our DB). `metadata.shopId` set at
  creation is a cross-check, never the authority. An event whose customer is unknown is
  recorded in `billingwebhookevent` with `shopId NULL` and a `result = 'unmatched'` and
  alerts the error webhook; it changes nothing.
- **Money from the event is never trusted blindly:** invoice amounts are mirrored from the
  fetched invoice object and converted with `minorUnitFactor`, and a mirrored total of a
  different currency than `billingcustomer.currency` raises an alert instead of being stored.
- **No pool use inside the transaction** except through its `conn`
  (`tools/check-nested-pool.js` must pass); Stripe calls happen before the transaction opens.
- **Respond fast:** the handler does the minimum before returning 2xx. If reconciliation
  proves slow, the event can be recorded then processed by a job (`jobs.service.enqueue`
  idempotent on the Stripe event id), the pattern the Slider webhook uses
  (CLAUDE.md "Slider on-demand delivery").
- Diagnostics: the existing `webhookevent` log (`webhook-log/`) gets a `source = 'billing'`
  entry when a shop is resolved, so the Settings > Diagnostics view and the platform
  webhook log show billing deliveries beside the others; `WebhookLogService.log` already
  swallows its own errors.

### 13.4 Reconciliation sweep

A daily `runLocked('billing-reconcile-sweep', ...)` compares every `source = 'stripe'`
subscription with Stripe's current state (at most N per tick, newest-checked-last, with a
claim row, the pattern of `PaymentReconciliationService`) and repairs drift, including a
lost `invoice.paid` while a shop sits suspended. A shop that has been `suspended` for more
than a day gets re-checked every tick regardless, because a stuck suspension is the
costliest failure mode (a paying customer offline).

---

## 14. Platform admin tier

A platform admin needs these, all in the existing tier (`platform-admin/`,
`PlatformAdminGuard` 404-on-failure, platform CSRF, every mutation audited via
`PlatformAuditLogService.log(..., conn)` inside the change's transaction, as
`setOverride` does):

| Need | Surface |
|---|---|
| See plan, status, trial end, period, `cancelAtPeriodEnd`, billing currency, last invoice, dunning stage, usage versus ceiling | new "Billing" section on `/platform/shops/[shopId]` (beside the existing Feature flags section), and columns plus a status filter on `/platform/shops` |
| Invoices and payment status | read-only list from `platforminvoice` with links to the hosted invoice |
| **Comp account** | set `source = 'comp'`, choose a plan, optional end date and a mandatory note; no Stripe object; entitlements from the plan; never dunned. Distinct from legacy so reporting can tell "free by promise" from "free by gift" |
| Extend trial | days (capped), reason mandatory |
| Change plan or interval for a shop | audited; for Stripe-backed shops it goes through `BillingService` so Stripe stays the source of truth |
| Per-feature override | **exists** (`shops/:shopId/features/:key`); comp of a single feature |
| Restore legacy | typed-name confirmation, audited (5.3 item 4) |
| Force-lift or force-apply billing suspension | uses the 4.3 CAS rules and the existing suspend/unsuspend audit actions |
| Change billing currency | 9.3 |
| "Shops with no subscription row", "shops with unreviewed tax country", "shops over 120% for 2 months", "past due list" | list endpoints (also PLT-10 inputs) |
| Price book and plan editor | create plan, edit `planfeature` matrix, add a `planprice` row and sync to Stripe, retire a plan; all audited |
| Revenue views | MRR, churn, ARPU, trial conversion (PLT-10), computed from `shopsubscription`/`subscriptionevent`/`platforminvoice` |

**Audit trail for non-human actors.** `platformauditlogentry.platformAdminId` is NOT NULL
with a foreign key (migration `20260826110000_platform_admin_access`), so a Stripe-driven
or sweep-driven transition cannot be written there. That is why `subscriptionevent` exists
with `actorType`. Platform-admin-initiated changes write **both** (the platform audit row
for the existing audit-log page, and a `subscriptionevent` for the per-shop timeline). The
merchant's own staff-action log (`auditlog`, `audit-log/`) records merchant plan/billing
changes with the existing `AuditLogService.log` (which swallows its own errors by design,
so the *authoritative* record for money is `subscriptionevent`, written inside the
transaction).

---

## 15. Admin (merchant) surface

- **Settings > Business > Plan & Billing** (`/settings/business/plan-billing`), per the
  audit's IA tree (`product-capability-audit.md:5297`). Registered in
  `admin/lib/settings-registry.ts` (without a registry entry the page is unreachable, and
  `settings-registry.test.ts` fails). Inside `settings/layout.tsx`'s admin-only gate. Page
  through `PageShell`; `Card` sections: current plan and status, usage meter (8.3), plan
  picker with the downgrade/legacy modals, payment method and invoices (hosted portal
  link), billing details (legal name, email, country, TRN, 9/10). Independent promise
  chains with `LoadFailed`, per the N3 convention in CLAUDE.md. No em dashes.
- **Banners** (trial days left, past due, usage) in the admin shell for the admin role only.
- **Locked mode** page (11.2) rendered by `RequireAuth` when `/auth/me` reports
  `billingLocked`.
- The signup wizard needs no billing step in v1 (no card up front); the Review step gains
  one line ("14-day free trial").

---

## 16. Security

| Concern | Rule |
|---|---|
| **Who can change plan, start checkout, cancel, edit billing details** | `@Roles('admin')` only. Not delegable through `branchrole` (billing is not in `common/permissions.ts`'s vocabulary, and branch/order_manager/viewer cannot reach the controller at all) |
| Email verification | gate `checkout`, `changePlan`, `cancel` with `VerifiedEmailGuard` + `@RequiresVerifiedEmail({ action: 'billing' })`, the fifth gated action in the list in CLAUDE.md; reads and "pay an overdue invoice" are not gated (never block paying) |
| 2FA | no new factor. If the admin is enrolled in TOTP, **cancel** and **change of billing email/tax ID** require a fresh code (the same "needs a code" rule the 2FA disable path uses). Q11 asks whether plan changes should too; default no |
| CSRF | standard staff-tier CSRF covers every `/billing/*` mutation (cookie present). The webhook is the only exemption (13.1) |
| Impersonation | an impersonation token cannot create a checkout, change plan, cancel, edit billing details or open the portal (same posture as "cannot enrol, disable, regenerate, reset, change policy or revoke sessions", CLAUDE.md Staff authentication hardening) |
| Tenant isolation | every billing query scoped by `shopId` derived from `TenantContext`, never a body or URL parameter; `billingcustomer`/`shopsubscription` resolved by the caller's shop; a cross-tenant e2e spec per endpoint (spoof another shop's `stripeCustomerId`, invoice id, plan id) |
| Open redirect | Checkout/portal `success_url`, `cancel_url` and `return_url` are built server side from `ADMIN_URL`, never from client input |
| Secrets | `BILLING_*` keys only in env, never logged, never returned (status endpoint reports configured/not), never in a job payload or error, checked by `env-validation.ts` for format |
| Card data | none touches Requital (hosted Checkout and portal, INFERRED); we store Stripe ids and display brand/last4 fetched on demand or mirrored, never PAN |
| Replay/forgery | signature verification, event-id uniqueness, authority from our own `stripeCustomerId` mapping (13.3) |
| Rate limits | `/billing/*` mutations throttled per IP like `signupHourly`; the checkout creator also per shop to stop session spam. Note the throttler is in-memory per process (CLAUDE.md), acceptable on the single VPS |
| Audit | merchant actions via `AuditLogService`, authoritative record via `subscriptionevent` in the transaction, platform actions via `PlatformAuditLogService` in the transaction (a failed audit write fails the action) |
| `/security-review` | billing is money plus auth plus tenancy: the coordinator's independent review applies, as for the other money batches |

---

## 17. Data lifecycle, PDPL and retention on cancellation

1. **Roles.** The merchant is the data controller of their customers' personal data;
   Requital is the processor. Requital is the controller of the *merchant's* own account
   and billing data. (INFERRED legal framing; the existing PDPL work in `customer-account/`
   and GLF-18 assume the same.)
2. **What billing stores about the merchant:** billing email, legal name, billing country,
   tax ID, Stripe ids, invoice mirror. Nothing on the merchant's shoppers.
3. **On cancellation:** the shop goes offline (`suspensionReason = 'cancelled'`), the
   admin keeps access to billing and **a full data export** (OPS-16, a dependency: shop-level
   export does not exist yet, only customer-level; Phase 3 should not ship cancel-with-purge
   without it). Retention window before purge: default **90 days** after `cancelled` (Q12),
   announced in the cancellation email, with reactivation restoring everything inside the
   window.
4. **Purge** (OPS-16) deletes or anonymises shop-owned rows by the existing anonymisation
   approach (`customer-account` anonymise, `JSON_REMOVE` of attribution). **Records that tax
   law requires Requital's merchants to keep (orders, invoices) are a legal question** (the
   UAE requirement for multi-year retention of tax records is INFERRED; Q12). Default
   proposal: anonymise personal data but keep order and invoice financial rows for the
   statutory period.
5. **Billing records survive the shop.** `platforminvoice` and `subscriptionevent` must
   outlive a purged shop for Requital's own tax records (5-year-style retention, INFERRED):
   their FKs to `shop` therefore must not `ON DELETE CASCADE`; they use `ON DELETE
   RESTRICT` (purge deletes everything else and leaves a tombstone `shop` row, or the
   columns are denormalised with `shopId` as a plain number and the legal name). Decide at
   migration time; flagged because the default MySQL cascade habit in this codebase
   (`dailyshopmetrics`, `shopfeatureoverride` are all `CASCADE`) would silently destroy
   invoice history.
6. **Stripe holds its own copies** of the customer and invoices; a purge must also delete
   or redact the Stripe Customer where law allows, or document why not (INFERRED API:
   customer delete exists but retains invoices).

---

## 18. Stripe Billing claims to verify before building (all INFERRED)

Run these in **test mode** against the real Requital billing Stripe account before the
first line of production billing code. Each is a statement made above that this document
could not check offline.

1. Which presentment/settlement currencies the billing account can use for subscriptions
   (AED, SAR, QAR, USD, and especially KWD/BHD/OMR). Decides the price book (9.1).
2. Three-decimal currencies: the "amount must be divisible by 10" rule and how it shows on
   invoices (9.2).
3. A Customer is currency-locked once it has a priced subscription or invoice (9.3).
4. Prices are immutable in amount; `lookup_key` exists and is unique; archive semantics.
5. `currency_options` on a Price versus one Price per currency (9.2).
6. Hosted Checkout in subscription mode; the Customer Portal restricted to payment method
   and invoices only; `hosted_invoice_url` present on open invoices.
7. Event names and ordering (13.2, 13.3); `customer.subscription.trial_will_end` timing.
8. Proration parameter behaviour (`always_invoice`, `create_prorations`), `trial_end: 'now'`,
   `cancel_at_period_end`, subscription schedules for end-of-period downgrade.
9. Smart Retries schedule configuration, and the setting that governs cancel/unpaid after
   retries are exhausted; that Stripe's own customer emails can be turned off.
10. Stripe Tax coverage and UAE `ae_trn` tax-id type; manual `tax_rates` on a subscription;
    whether Stripe's invoice PDF satisfies UAE tax-invoice content (10).
11. API idempotency-key behaviour on subscription updates.
12. Whether the account's country affects which payment methods (cards only; local Gulf
    methods are out of scope) are offered.
13. Pinning an API version on the billing client (the SDK major in `backend/package.json:50`
    is `stripe ^22.3.2`; pin the version explicitly and record it).
14. Next 16 does not cache the storefront shop fetch in a way that delays un-suspension
    (11.4 item 3); a Requital check, not a Stripe one.

---

## 19. Rollout plan (phases, migration order, deploy order)

Migrations follow the repo's rules: hand-authored plain SQL, additive, expand/contract for
anything backfilled, replayed from an empty database in CI, timestamp folder after the
current tail. A table must be created in a folder timestamped **before** any folder that
references it (CLAUDE.md migration-ordering gotcha). `db/types.ts` updated by hand. Each
phase ships behind no merchant-visible change until phase 4.

| Phase | Content | Merchant-visible? | Migration | Notes |
|---|---|---|---|---|
| **0. Decisions and Stripe spike** | owner answers section 23; section 18 checklist in Stripe test mode; accountant answers section 10 | no | none | gating phase |
| **1. Data model and entitlement layer** | `plan`, `planfeature`, `planprice`, `shopsubscription`, `subscriptionevent`; `shop.suspensionReason`; seed legacy plan and its `planfeature` rows (every key entitled); **backfill every existing shop to a legacy `shopsubscription`**; `FeaturesService` entitlement change (6.1) incl. `enabledShopIds()` and spec matrix; platform page shows plan and `entitled`; the platform suspend/unsuspend reason change (4.3) | no (byte-identical because everyone is legacy; proven by a before/after flag matrix over all shops) | tables folder, then backfill folder, then `suspensionReason`+backfill folder, strictly in that order | deploy order: migrate, backend. The fail-open (5.2) covers the gap |
| **2. Billing core, platform only** | `billingcustomer`, `billingwebhookevent`, `platforminvoice`, `usagenotice`; `BillingStripeClient`; webhook endpoint; reconcile sweep; price sync; platform-admin plan/price editor, comp, trial extend; env guardrail; **Stripe dashboard retry/cancel settings aligned to the timeline (11.1)** | platform admin only | one folder | exercised with comp and test-mode shops only; `BILLING_*` env set on the VPS (owner approval needed to create credentials on production, CLAUDE.md VPS deploy rule) |
| **3. Merchant billing surface and metering** | Plan & Billing page; checkout and portal sessions; plan-change rules (12); usage endpoint, hourly sweep, banners and notices (8); billing-locked confinement (11.2) behind a kill-switch flag | admin only, visible to **trial and test shops** | none expected | the locked-mode change touches `AuthGuard` and login: needs the coordinator's security review and an injection-proven test |
| **4. Trial for new signups** | signup transaction creates a trialing subscription, trial reminders, dunning sweep, N10 emails, WhatsApp dunning | new merchants | none | only now do new shops stop being legacy; ONB-12 lands here |
| **5. Live charging** | tax country sign-off, first real price book, enable the dunning suspension sweep in production | yes | none | start with the suspension stage disabled for one billing cycle (emails only), then enable |
| **6. Reporting and hard edges** | PLT-10 revenue views; OPS-16 export dependency for cancel/purge; sweeps skip suspended shops (1.3) | platform | maybe | |

**Cutover guard (the one irreversible line).** Phase 1's backfill assigns legacy to every
shop that exists at migration time. Phase 4 is the first code that gives a *new* shop a
trial. Between them, a shop created by the old backend has no row and is treated as legacy
(5.2); a post-deploy idempotent `INSERT ... SELECT ... WHERE NOT EXISTS` run once at
the phase 4 deploy gives those few shops legacy rows, bounded by `shop.createdAt <
BILLING_CUTOVER_AT` (an explicit timestamp recorded in the runbook, not inferred), so
"who counts as an existing merchant" is a recorded fact. Production has real merchants
(CLAUDE.md names `irmain.com`); the pre-flight is to export the shop list with
`COUNT(*)` plus the `BIT_XOR` checksum method in the CLAUDE.md deploy section before and
after the backfill and require identical flag matrices.

---

## 20. Test plan

Each behaviour change is **injection-proven** (revert, watch the named test fail for the
stated reason, restore), per the batch rules.

**Unit**
- `resolveFlag`/entitlement matrix: (override on/off/none) x (column on/off) x (entitled
  yes/no/no-row) for column-backed and table-backed keys; legacy shop byte-identical to
  today's results for all 10 keys.
- State machine: every legal transition, every illegal one rejected, CAS loser re-reads;
  `suspended` reason rules (platform wins, billing never lifts platform).
- `PlanPriceService`: all seven currencies, the 0.010 rule for KWD/BHD/OMR, no `* 100`.
- Dunning stage calculator from `pastDueSince`; usage level calculator (79/80/99/100/119/120).
- Order count window in the shop's timezone across month boundary and a DST-free zone.

**E2E (real DB; Stripe stubbed, no real calls)**
- Webhook: bad signature 400; duplicate event no-op; two concurrent identical deliveries
  (the `isLockConflict` case); out-of-order events do not move state backwards; unknown
  customer recorded and ignored.
- Payment lifts a billing suspension **and the storefront and admin come back on the very
  next request**; the same payment does **not** lift a platform suspension.
- Billing-locked admin can reach only `@AllowBillingLocked` routes; non-admin roles and
  other tenants cannot; an already-open session is confined at once.
- Soft ceiling: an order at 300% of ceiling is created normally; notices fire once per
  level per month; banners appear for admin only.
- Legacy: cannot be downgraded, cancelled or webhook-touched; leaving needs the
  acknowledgement; only the two permitted writers can set the legacy plan.
- Tenant isolation: for each `/billing/*` endpoint, spoofed `shopId`, another shop's
  invoice/customer/plan ids return 404 or re-scope.
- Impersonation token cannot mutate billing.
- KWD end to end: a KWD price book entry flows to the Stripe stub as the right integer and
  the mirrored invoice returns the third decimal (extend the `kwd-end-to-end` approach).
- Guardrails run in `guardrails` CI: `check-nested-pool.js`, `check-outlet-scoping.js`,
  `check-feature-flags.js`, new `check-billing-keys.js`; lint delta +0 on all three apps.

**Manual / pre-live (Stripe test mode)**: the section 18 checklist, one full trial to paid
to failed-payment to suspended to paid-and-restored run on the `testadmin` standing
smoke-test shop, timed against the real Stripe retry schedule.

---

## 21. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Stripe cannot present the Gulf currencies on the billing account | price book infeasible as designed | check first (18.1); fallback USD or AED billing with clear labelling |
| Locked-mode change to `AuthGuard`/login has a hole | a suspended shop gets more access than intended, or a payer stays locked | default-deny route allowlist, injection-proven tests, security review, kill-switch flag in phase 3 |
| A late/lost webhook leaves a payer suspended | paying merchant offline | refresh endpoint (11.4), daily reconcile, tighter re-check for suspended shops |
| Platform suspend and billing suspend collide | abuse shop reactivated by a payment | reason column and CAS rules (4.3) |
| Plan gating flips a stock/money behaviour | silent data drift | `auto_deduct_ingredient_stock` never gated (7.1); registry exclusion list unchanged |
| Backfill mislabels a real merchant as a trialist | merchant locked out after 14 days | phase ordering, fail-open on missing row, flag-matrix before/after proof, recorded cutover instant |
| Suspending a storefront strands shoppers who paid | third-party harm | long grace (14 days), tracking stays reachable (1.3), payment webhooks keep processing |
| Tax treatment wrong for a market | compliance exposure | tax country sign-off gate (10), no charging for unreviewed countries |
| Invoice history destroyed by shop purge cascade | legal/tax record loss | `RESTRICT`/tombstone (17.5) |
| Dunning emails miss the owner (bounce, wrong address) | surprise suspension | WhatsApp stage, hosted-invoice link, billing email separate from login email, platform "past due" list for manual outreach |
| Two PM2 instances double-send or double-suspend | duplicate emails | `runLocked` plus idempotent job keys plus CAS (13, 11.3) |
| Soft ceiling mistaken for a hard one | merchant fear, churn | copy states plainly nothing is blocked (8.3); never enforced in create paths |
| Scope creep into PLT-2 hard caps, PLT-9 partners, metered overage | XL project grows | explicitly out of scope; ceiling is communicative only |
| Stripe API change or SDK upgrade | breakage | pinned API version, stubbed contract tests, reconcile sweep |

---

## 22. Out of scope (stated so it is not assumed)

Hard limits on products, staff, outlets, storage or API calls (PLT-2 hard half); metered
or overage billing; usage-based Stripe prices; coupons and promotion codes for Requital's
own plans; partner/agency billing (PLT-9); per-seat pricing; in-app card collection with
Elements; a Requital-issued compliant tax invoice renderer (hook provided, 10); ZATCA or
UAE e-invoicing integration (D7/D8); a free tier other than legacy; dunning by SMS;
customer-tier or storefront-visible billing anything.

---

## 23. OPEN QUESTIONS FOR THE OWNER

Each is concrete and answerable; the proposed default is what this design assumes if no
answer comes.

1. **Tiers and prices.** How many paid tiers, what names, and what monthly/annual price in
   each billable currency? *Default:* three tiers (working names T1/T2/T3), annual =
   10 x monthly, price book entered by the platform admin in phase 2; nothing is built with
   a price baked in.
2. **May a legacy merchant leave legacy by themselves?** *Default:* yes, self-serve, one-way
   (acknowledgement required, cannot return to legacy), because a legacy merchant who wants
   a tier-only feature should be able to buy it. Alternative: only via a platform admin.
3. **Card up front for the 14-day trial?** *Default:* no card; trial ends into `past_due`
   with a 7-day grace, then suspension.
4. **Which flags go in which tier, and what does the trial include?** *Default:* the 7.2
   table (T1 gets notify_email, low-stock digest, stock deduction, cosmetics; T2 adds cart
   recovery, survey, Slider; T3 adds customer WhatsApp); trial = the T2 feature set.
5. **What counts toward the order soft ceiling, and over what period?** *Default:* all
   non-cancelled `order` rows by creation date in the shop's timezone, calendar month.
   Placeholder ceilings for T1/T2/T3: 300 / 2,000 / 10,000 orders per month (invented to
   make the UX concrete; replace with real numbers).
6. **Does anything at 120% change behaviour beyond messaging** (for example a mandatory
   plan-review banner after two consecutive months)? *Default:* no, messaging only, forever.
7. **Billing currency when the shop's currency is not in the price book or not supported
   by the Stripe account** (and is billing in `AED` or `USD` the fallback)? *Default:* USD,
   clearly labelled; revisit after the Stripe spike (18.1).
8. **Dunning and suspension timings.** *Default:* grace 14 days after the first failed
   payment (7 days for an unpaid no-card trial); suspend at grace end; cancel 16 days after
   suspension (day 30); reminders at T0, +3, +7 (with WhatsApp), +11, +14, +21, +30.
9. **Tax on the subscription.** Is Requital VAT-registered (and under which TRN), are
   prices tax-exclusive with 5% added for UAE merchants, and what is the intended treatment
   for KSA/KW/QA/BH/OM merchants? *Default:* tax-exclusive prices, 5% added for UAE
   billing country, **no charge to any other country until you and your accountant sign
   that country off** (such shops can trial but not be billed).
10. **Choosing a plan during a trial: bill now (ending the trial) or at trial end?**
    *Default:* bill now and end the trial, simplest to explain and reconcile.
11. **Step-up authentication for billing changes.** Cancel and billing-identity edits need
    a fresh TOTP code when enrolled (default yes); should plan changes too? *Default:* no.
12. **Retention after cancellation.** How long is a cancelled shop's data kept before
    purge, and which financial records must be kept for how long? *Default:* 90 days, then
    anonymise personal data and retain order/invoice financial rows for the statutory
    period; Requital's own billing records kept at least five years. Needs your lawyer.
13. **Separate Stripe account for billing?** *Default:* yes, a separate account (or at least
    a separate restricted key and webhook endpoint), never `STRIPE_SECRET_KEY`.
14. **Should sweeps that email shoppers (cart recovery, digests) stop for suspended
    shops?** *Default:* yes; payment and courier webhooks keep running.
15. **Comp accounts.** Who may create one, is an end date mandatory, and are they included
    in revenue reporting as zero? *Default:* platform admins only, note mandatory, end date
    optional, reported separately from legacy.
16. **Billing contact.** Is the billing email the owner's login email by default, with a
    separate editable billing email and a second recipient for dunning? *Default:* defaults
    to the admin's login email, editable, one extra recipient allowed.
17. **Who sees banners and receives billing email when there are several admins?**
    *Default:* every user with role `admin`; billing email goes to the billing contact only.
18. **Annual plans in v1?** *Default:* yes in the data model, shipped monthly-only first if
    the Stripe spike shows any complication with annual proration.
