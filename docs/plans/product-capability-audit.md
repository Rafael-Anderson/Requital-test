# Product capability audit and expansion plan — the whole application

**Status:** planning, **six decisions locked 2026-09-10** (§9.1). No code written, no
branch, no PR. This document is the deliverable.

> **Decisions applied — read §9 first.** §8 (phasing) and §9 (decision record) were
> revised on 2026-09-10 after D20, D13, D6, §6-E, D15 and D12 were locked. **§9 is
> authoritative.** §2–§5 are the pre-decision invention pass and are deliberately left
> intact, with in-place **DECIDED** / **DROPPED** banners where a locked decision changed
> an item's disposition — the same convention `theme-templates-and-motion.md` used when
> §6.5 was frozen rather than deleted. If §2–§5 and §9 disagree, §9 wins.
> §10–§14 are new work created by the decisions.

**Scope:** the entire product, not the theme builder.
`docs/plans/theme-templates-and-motion.md` covers presentation and has been worked
to close-out; this document deliberately gives that area almost no space and spends
its length on everything else, because the imbalance between "storefront
presentation" and "everything else" is itself one of the findings.

**Reading order.** §1 is context: a compact, code-derived inventory, deliberately
kept short. §2–§5 are the deliverable — the invention pass, and the bulk of the
document. §6 (architecturally blocked) and §7 (debt and correctness risk) are the
constraints anything in §2–§5 has to be built against. §8 sequences it. §9 is the
decision record — six locked, the rest still yours. §10 re-justifies every
vertical-flavoured proposal against general retail (D20). §11–§13 are the build-outs of
D15, D13 and D12. §14 is a settings information-architecture audit added in the same
round.

**Method.** §1 was derived by reading `backend/src/*` (every module, every
controller, the larger services in full), `backend/prisma/migrations/` (all 94
folders by name plus the load-bearing ones in full), `backend/src/db/types.ts`,
`admin/app/*`, `storefront/app/*` and `storefront/lib/*` — not from `CLAUDE.md` or
the plan docs, which were read first for orientation and cross-checked afterwards.
Where the docs and the code disagree, §1 says so and the code wins. §2–§5 are
generative: competitor draws are labelled with their source, and §5 is the set that
is deliberately not traceable to one.

**Snapshot point:** `main` at `393018d` (2026-09-08). Three PRs landed while this audit
was being written: #119 featured collections, #120 earliest-delivery / same-day cutoff,
#121 TipTap rich text. §1 was re-checked against HEAD afterwards. Worth noting for its
own sake: all three are storefront-presentation work, which is the imbalance this
document was commissioned to surface, observed live over the days it took to write.

**Annotation key**, used on every proposal in §2–§5:

| Field | Values |
|---|---|
| **Effort** | **S** ≈ ≤1 day · **M** ≈ 2–5 days · **L** ≈ 1–3 weeks · **XL** ≈ a month or more, or its own engagement |
| **Type** | `feature` (merchant- or shopper-visible surface) · `integration` (third party) · `infra` (platform capability, invisible to a merchant) |
| **Class** | `TABLE STAKES` (a competitor the merchant is evaluating has it) · `DIFFERENTIATOR` (few or none do) · `MOONSHOT` (unproven, high variance) |
| **Ship** | **YES** (I would build it) · **LATER** (real, but not now) · **NO** (in the document because it belongs in the space, not because I would build it) |

Effort estimates assume the current architecture, unless the "Depends" column names
a §6 blocker — in which case the estimate is for the work *after* that blocker is
cleared.

---
---

# PASS 1 — INVENTORY

*Context, not the deliverable. What the product actually does today, derived from
the code and the schema. Compact on purpose; §2 is where the length goes.*

## 1.0 Shape of the thing

Three apps, one repo, sharing nothing but HTTP. NestJS backend (`backend/`, 50 Nest
modules across 51 source directories, raw `mysql2`, no ORM), Next 16 admin (`admin/`,
74 pages including a separate `/platform/*` staff tier), Next 16 storefront
(`storefront/`, 24 pages, tenant resolved as a `/[shop]/...` path segment with
hostname traffic rewritten onto it by `proxy.ts`). MySQL 8, one shared database, every
tenant table carrying `shopId`. Deployed to one Hostinger VPS behind Caddy + PM2. 96
hand-authored migrations. ~22,000 lines of backend service code, of which one file
(`products.service.ts`) is 3,865.

Three independent auth tiers with genuinely separate JWT secrets and cookie names:
staff, customer, platform-admin. All three are httpOnly `SameSite=Strict` cookies
with per-tier double-submit CSRF. Four staff roles (`admin`, `branch`,
`order_manager`, `viewer`) plus a per-`(user, outlet)` `branchrole` override that can
only intersect downward. This is the most mature subsystem in the product.

**The shape that matters for everything below:** the data model is
UAE-single-country, AED-single-currency, English-single-language,
one-outlet-per-order, and has no platform billing layer at all. Each of those is
load-bearing in §6.

## 1.1 Catalog and merchandising

**Exists.** `product` with 41 columns — pricing (`price`, `compareAtPrice`,
`costPrice`), `sku`/`barcode`, `status`, `slug`, meta title/description, physical
attributes (`weight`, `weightUnit`, `dimensions` as a free string), `vendor`,
`productType`, `brandId` (FK to a real `brand` table, added 2026-08-29).
Unlimited-depth `collection` taxonomy tree with cycle guards and drag-reorder.
`template` — a second, orthogonal grouping concept: `MANUAL` / `RULE_BASED`
(collection/tag/price/age conditions evaluated live) / `COLLECTION_GROUP`. `tag` +
`producttag`. Per-product ordered child lists: `productimage`, `productattribute`
(name/value spec rows), `productfaq`, and `additionalInfo` (a JSON array of titled
accordion blocks). Options and variants via `productoption` / `productoptionvalue` /
`productvariant`, capped at **three** option axes (`optionValue1Id`,
`optionValue2Id`, `optionValue3Id` — hard columns, not a join table). Variant
generation is a cartesian product with id-preserving reconciliation behind
`PUT /products/:id/options`. Gift-card products (`isGiftCard`, denominations JSON)
are a product flag, distinct from the real `giftcard` ledger. `isCheckoutAddon`
flags a product for the checkout upsell popup. CSV import with a preview/confirm
two-step. Product duplication. Bulk status, bulk delete, bulk price.
Simple/Advanced editor modes. `isNew` + `newUntil` (added 2026-09-08) drive a "New"
badge, with the expiry compared as a wall-clock date key in the shop's timezone via a
pure, unit-tested `product-is-new.ts` — a small, cleanly built piece of merchandising
metadata and, notably, the first product column added purely for storefront display.

**Half-built.** `product.chargeTax` is a stored, editable, API-exposed boolean that
**nothing reads** — `computeOrderTotals` applies the shop-wide `taxRate` to the whole
goods subtotal regardless (`backend/src/public/order-pricing.ts:5`). A merchant who
un-ticks "charge tax" on a zero-rated item gets tax charged on it anyway. That is a
correctness bug, not just a dead control; see §7.

**Missing outright.** No metafields or custom fields of any kind. No product media
beyond images (no video, no 3D, no PDF spec sheet). No digital or downloadable
products. No product bundles or kits as a sellable concept (`productingredient` BoM
is close but is a stock-consumption model, not a bundle). No merchant-curated
cross-sell (`RelatedProducts.tsx` exists; `/products/slug/:slug/related` is
collection-derived). No per-channel or per-outlet pricing. No price lists. No
scheduled publish/unpublish. No product reviews or customer Q&A (`productfaq` is
merchant-authored). No media library — every upload is a one-shot field, nothing is
browsable or reusable.

## 1.2 Inventory, purchasing, suppliers, multi-location

**Exists.** Real multi-location stock: `outletstock` (composite PK
`[outletId, productId]`) and `outletvariantstock`. `product.stockQuantity`
deliberately does not exist. `trackInventory` and `continueSellingOutOfStock` are
catalog-level policy. `stockmovement` is a full append-only audit trail (`type`,
`reason`, `delta`, `outletId`, `toOutletId`, `actorUserId`, `scanBatchId`) covering
manual adjust, inter-outlet transfer, order consumption, cancellation restock, return
restock, CSV import and scan-to-stock. Per-`(outlet, product)` low-stock thresholds
and a daily 8am low-stock digest email.

**A genuine differentiator already built, and under-marketed:** `ingredients/` +
`productingredient` is a real bill of materials. Raw materials are tracked with their
own per-outlet stock (`outletingredientstock`), never sold, carry `costPerUnit` and a
free-text `supplier`, and a product declares `quantityPerUnit` of each. Confirming an
order consumes ingredient stock; editing a confirmed order's quantities adjusts by
delta rather than recomputing; an increase into negative ingredient stock surfaces
`ingredientStockWarnings` rather than blocking the save. For a florist that is
exactly right — a bouquet *is* a BoM.

**Also already built and under-marketed:** `scan/` is OCR-driven stock-in. A merchant
photographs a supplier delivery note, `tesseract.js` extracts the text,
`ocr-parser.ts` heuristically parses line items, `fuzzy-match.ts` suggests catalog
matches, the merchant confirms, and stock lands with a `scanbatch` audit row.
Configurable include/exclude keywords and unmatched-row behaviour. No competitor at
this price point does this.

**Missing outright.** **There is no supplier entity.** `ingredient.supplier` is a
free-text string and `product.vendor` is another one; neither is a row. There are no
purchase orders, no receiving against a PO, no supplier lead times, no reorder points
beyond a low-stock email, no landed cost, no stock valuation (FIFO / weighted average
/ standard), no cycle counting or stocktake workflow, no adjustment approvals, no
bins or locations within an outlet, no lot/batch or expiry tracking (real for a
florist — flowers perish), no serial numbers, no consignment, and no manufacturing or
work-order concept above the BoM.

## 1.3 Orders, fulfilment, returns, exchanges

**Exists.** `order` is outlet-scoped (`outletId` required), carries a denormalised
customer snapshot, `emirate`/`area`, delivery date and time slot, `receiverMessage`
(gifting), `channel`, `orderType`, `paymentMethod`, and money columns (`deliveryFee`,
`taxAmount`, `discountAmount`, `giftCardAmount`, `total`). The status machine is a
strict linear chain — `pending → confirmed → preparing → out_for_delivery →
delivered`, plus `cancelled` from any non-terminal state — enforced by
`isValidStatusTransition` and applied as compare-and-swap inside a transaction
(`updateMany({ where: { id, status: expected, outletId } })` plus a row-count check),
which is what makes concurrent "confirm" safe. Stock decrements on
`pending → confirmed` for admin-created orders and *at creation* for the `storefront`
and `draft_order` channels (`IMMEDIATE_STOCK_RESERVATION_CHANNELS`). Item editing
only while `pending` or `confirmed`. `ordernote` staff thread. `orderitem.note`
customer-typed per-line note. Order history endpoint. Bulk status update.
`trackingToken` for public lookup. `cashCollectedAt`/`cashCollectedBy` for COD
reconciliation, satisfied automatically by Slider's `delivered` webhook. Draft orders
as quotes/manual invoices that become real orders, reusing the payment-link generator
for "send invoice". `invoice` + `invoicecounter` with a per-`(shopId, type)` sequence
and an idempotent `(orderId, type)` unique — served as styled HTML for browser
Print-to-PDF, no PDF library. Returns with per-line and running-total caps, provider
refund with manual fallback, optional restock. Post-purchase survey on its own token.

**Half-built.** `shop.customerConfirmationRequired`, `shop.allowPreOrders`,
`shop.asapDeliveryEnabled` and `shop.deliveryCalendarEnabled` are all persisted,
admin-editable toggles with **zero backend or storefront consumers**.

**Missing outright.** No partial fulfilment, no split shipments, no multi-package
orders. **An order belongs to exactly one outlet**, so a cart spanning stock in two
branches has no representation. No exchanges (a return is a refund; swapping an item
means refund plus a new order). No editing after `preparing`. No backorders or
pre-orders despite the toggle. No merchant-side order tags or saved views. No
fulfilment SLA or promise-date tracking. No packing slip beyond the invoice document
type. No customer-initiated returns portal. No RMA numbers or return labels. No order
archiving — every list query scans the full history.

## 1.4 Payments, checkout, subscriptions, B2B

**Exists.** A real strategy pattern: a `PaymentProvider` interface,
`payments/providers/` with one file per gateway, a `PaymentProviderRegistry`
registering implemented ones at boot, per-shop credentials resolved by
`PaymentSettingsService.resolveCredentials` (AES-encrypted at rest via
`common/crypto.ts`) with a platform env-var fallback. **Live:** Stripe, Tabby,
Tamara, PayPal. **Structural stubs that throw:** Telr, PayTabs, Nomod — each
`createCheckoutSession` throws `PaymentProviderNotConfiguredException` and each
`parseWebhookEvent` logs and ignores. Webhook idempotency is enforced by a unique
constraint on `(gateway, gatewayReference)` and the *insert failing*, deliberately not
a check-then-insert. BNPL webhooks can advance the order's own status through the same
CAS state machine, but only while it is still `pending`. Refunds use
`providerChargeReference`, not the event id. `webhookevent` is a cross-provider
arrival log. Payment links (`/pay/:token`) with expiry. Checkout supports delivery and
pickup with independently toggled per-method payment options, and
`resolvePaymentMethods` checks the active card processor is genuinely enabled before
offering "online card". Tax is shop-level `taxRate` + `taxInclusive`. Gift cards are a
real ledger with CAS balance updates inside the order transaction. Discounts:
`PERCENTAGE` / `FIXED_AMOUNT` / `FREE_SHIPPING`, scoped `ALL_PRODUCTS` /
`SPECIFIC_PRODUCTS` / `SPECIFIC_COLLECTIONS`, `code` or `auto` kind, usage limits
global and per-customer, date windows, atomic redemption claim at order creation, and
eight distinct rejection reasons surfaced to the shopper.

**Half-built — and this one is a live defect, not a scope boundary.** Auto-apply
discounts drive **display pricing only**. `GET /public/:shopSlug/discounts/auto` feeds
the storefront's `computeAutoDiscountedPrice`, which mirrors the backend's amount math
client-side for the product card and PDP — but `PublicService.createOrder` never
consults `listActiveAutoDiscounts`. A shopper sees a discounted price on the card and
is charged the undiscounted one unless a code is typed. `CLAUDE.md` records this as a
"deliberate scope boundary"; from a merchant's and a shopper's point of view it is a
pricing bug with a consumer-protection edge.

**Missing outright.** No subscriptions or recurring orders of any kind. No B2B: no
company or account entity, no net terms, no credit limits, no PO-number field, no
tax-exempt customers, no per-customer or per-group price lists, no quote approval flow
(draft orders are the nearest thing and they are staff-only). No saved cards, no
vaulting, no one-click. No Apple Pay or Google Pay wallet buttons. No partial payments
or deposits. No split tender. No manual capture or void. No 3DS step-up handling
beyond whatever the gateway hosts. No multi-currency at any layer (§6). No cart
recovery beyond one email. No checkout extensibility.

## 1.5 Customers, segmentation, loyalty, CRM

**Exists.** `customer`, upserted by `[shopId, phone]` with a duplicate-key race
fallback, shared by storefront checkout and the admin CRM. Order count and lifetime
value computed live (cancelled excluded), never stored. Addresses are a JSON array on
the row, not a table. `wishlist` is a JSON array of product ids. A fully separate
customer auth stack (`customer-auth/`) with its own JWT secret, refresh-token family
rotation, lockout counters, and "register" meaning "set a password on the row guest
checkout already created". Customer account pages: profile, orders, order detail,
invoice download, addresses CRUD, wishlist. UAE PDPL self-service —
`GET /account/export` (rate-limited once per 24h) and a two-step deletion that
**anonymises** rather than hard-deletes, clearing `passwordHash` to revoke every
outstanding token instantly.

**Missing outright.** No segmentation of any kind — no saved segments, no customer
tags, no RFM, no filters beyond a name/phone search. No loyalty or points. No store
credit (gift cards are the only balance concept, and they cannot be issued as credit
outside a purchase or a return). No customer groups or tiers. No communication log
(the SRS specifies one; it does not exist). No customer attachments (also specified,
also absent). No notes on a customer. No merge-duplicates. No consent or
marketing-preference tracking beyond newsletter opt-in. `customer.birthday` is
captured and `shop.birthdayDiscountEnabled` is a toggle — **neither is read by
anything.**

## 1.6 Marketing, campaigns, messaging, SEO

**Exists.** `abandonedcart` captures name and phone before order completion, upserted
on `[shopId, customerPhone]`, swept by a 10-minute cron, CAS-claimed row by row, with
a recovery email carrying a `recoverToken` and a `/cart/recover` landing page.
`notifysubscription` back-in-stock, idempotent per
`(shopId, productId, variantId, email)`, soft-limited 3/hour/email/shop, firing from
every real 0→positive stock crossing except CSV import and scan-to-stock (a deliberate
cut). `newslettersubscriber` capture from the storefront newsletter section.
`affiliate` / `affiliatecode` / `affiliateorder` — referral codes with
`commissionType`/`commissionValue`, attributed order tracking, and a payout *summary*.
`biolink` — a link-in-bio page builder with five target types and its own page config.
WhatsApp on two independent rails: a platform-owned Business account alerting the
*merchant's outlet* on every new order (queued through the job queue), and a per-shop
bring-your-own-credentials `WhatsAppProvider` for customer-facing messages, gated on
`shop.notifyCustomersWhatsapp`. Email is platform-level through one Resend key and one
verified domain, sending as generic `Requital <noreply@requital.io>`. Per-shop SEO
settings (meta title/description, OG image, keywords), a real per-shop dynamic sitemap
and `robots.ts`.

**Missing outright.** **There is no campaign tool.** Newsletter subscribers are
write-only — no admin page lists them, no export, no way to send them anything. There
is no email builder, no broadcast, no automation or flow engine, and no segmentation
to send to. Abandoned cart is one email with no sequence, no delay tuning beyond
`abandonedCartWindowMinutes`, no WhatsApp variant, no discount injection. **There is
no analytics or pixel integration whatsoever** — no GA4, no Meta Pixel, no TikTok, no
Snap, no Conversions API, no server-side tracking. `CookieConsentBanner.tsx` persists
a choice and gates nothing, because there is nothing to gate. No JSON-LD structured
data anywhere (flagged in `docs/audit-2026-08.md` §1.5, still open). No canonical
URLs, no Twitter cards. No Google Merchant Center or Shopping feed (planned in detail
in `docs/plans/google-shopping-listing.md`, **explicitly not built**, gated on four
unverified human prerequisites). No blog. No landing-page builder outside the theme
sections. No reviews to feed rich snippets. No customer-driven referral program (the
affiliate module is merchant-recruited).

## 1.7 Shipping, delivery, dispatch

**Exists.** Per-outlet `deliveryRadiusKm` plus lat/lng, and named flat-fee
`deliveryzone` rows with an optional per-zone map centre and radius. Delivery and
pickup hours are configured separately with independent slot gaps, preparation times
and same-day/next-day toggles. Time slots are generated client-side by `lib/slots.ts`
and **re-validated authoritatively server-side** by `PublicService.assertValidTimeSlot`
against a hand-mirrored `backend/src/public/time-slots.ts` — one membership check that
covers format, business hours and the same-day cutoff together. `externaldelivery` logs
a courier handoff. `delivery-providers/` is a real Slider integration: quote, dispatch,
cancel; one platform partner key with each merchant a customer account under it
(`shop.sliderAccountId`, settable only by a platform admin); a shared unauthenticated
webhook that does the minimum before responding 2xx and enqueues the rest; driver name,
phone, lat/lng and a tracking URL on the delivery row; and hard caps enforced *before*
dispatch (COD over AED 350, card-on-delivery over AED 500, 35km on a bike) checked
against a fresh re-quote rather than a client-supplied distance.
`shop.sameDayCutoffTime` (added 2026-09-08) is a validated `HH:MM` shop-level cutoff
backing an earliest-delivery estimate on the collection page and product card,
deliberately shop-level rather than outlet-level since neither surface has a resolved
outlet.

**Missing outright.** **No distance calculation exists anywhere in the codebase.** The
per-zone lat/lng/radius is captured, persisted, and never used; zone matching is a
case-insensitive string compare of the zone's free-text `name` against the customer's
`area`, falling back to `emirate` (`order-pricing.ts:matchDeliveryZone`). A zone named
"Dubai Marina" does not match a customer whose area is "dubai marina " with a trailing
space, and a customer 40km outside the radius pays the same fee as one next door. No
weight- or dimension-based rates despite `product.weight` and `dimensions` existing. No
carrier rate shopping. No shipping profiles (per-product shipping rules). No
free-shipping threshold as a shipping rule (only as a discount type). No label
printing, no manifests, no tracking-number ingestion for anything but Slider. No route
optimisation or multi-stop batching for a merchant's own drivers. No driver app and no
driver identity — there is no `driver` entity, only a denormalised name and phone from
Slider's webhook. No delivery capacity or slot-quota management (a merchant can be sold
200 same-day slots for a two-van operation). No proof of delivery — no photo, no
signature, no OTP.

## 1.8 Analytics and reporting

**Exists.** `dashboard/` — revenue and order count for a window, order status
breakdown, new-versus-returning by first-order date on `customerPhone`, channel
breakdown, per-outlet breakdown, a daily revenue series, and top products. Date maths
is hardcoded UAE-local UTC+4 (stable — the UAE has no DST). `reports/` — a General
Report (raw audit view, **includes** cancelled orders), a Monthly report, a Product
Sales report (**excludes** cancelled, matching Dashboard), and an External Delivery
report. No dedicated reporting tables; everything queries `order`/`orderitem` directly.

**Missing outright.** No cohort analysis, no retention curves, no LTV modelling, no
funnel — there is no session or pageview data at all, because there is no analytics
layer (§1.6). No conversion rate, because the denominator does not exist. No
attribution beyond the affiliate module's own code matching. No forecasting or demand
planning. No inventory analytics (sell-through, days of cover, dead stock, ABC). **No
margin or profitability reporting at all, despite `product.costPrice` and
`ingredient.costPerUnit` both existing and being populated** — the data to compute
gross margin is in the database and nothing computes it. No scheduled or emailed
reports. No custom report builder. No export beyond four client-side CSV buttons that
serialise whatever rows the page has already loaded.

## 1.9 Multi-currency, multi-language, RTL, tax and e-invoicing

**Exists.** `shop.currency` with seven options offered in the admin (AED, SAR, KWD,
QAR, BHD, OMR, USD). `shop.defaultLanguage`. `shop.timezone`. `shop.trn` (tax
registration number) as a plain column. `outlet.nameAr`. Shop-level `taxRate` plus
`taxInclusive`, with the inclusive case correctly backing tax *out* of the subtotal
rather than adding it on top.

**And that is the whole of it.** Every one of those is close to decorative:

- **Currency.** `order` has no currency column. `PayPalPaymentProvider` hardcodes
  `currency_code: 'AED'` (`paypal-payment.provider.ts:252`).
  `storefront/lib/currency.ts` has exactly one entry in its symbol map.
  `CurrencySymbol.tsx` renders a hand-drawn SVG Dirham glyph for `AED` and falls
  through to the raw code string for anything else. A merchant who picks SAR gets
  Saudi Riyal orders priced in a column that means AED everywhere downstream.
- **Language.** There is **no i18n library in any of the three apps** — no
  `next-intl`, no `i18next`, no `react-intl`, nothing. Every string is a hardcoded
  English literal. There is not a single `dir="rtl"` in the storefront. There are no
  translation tables for product names, descriptions, collection names or policy
  pages. `defaultLanguage` selects nothing.
- **Tax.** One flat rate on the goods subtotal, never on delivery, ignoring
  `product.chargeTax`. No tax classes, no zero-rated or exempt categories, no reverse
  charge, no per-emirate or per-country rules, no place-of-supply logic.
- **E-invoicing.** `shop.trn` is printed on the invoice HTML and nothing more. There
  is no UAE FTA e-invoicing (the Peppol-based phased mandate), no ZATCA Phase 2
  integration for Saudi, no QR code, no invoice hash chain, no cryptographic stamp,
  no XML.

**`EMIRATES` is a hardcoded seven-element const in `backend/src/orders/constants.ts`
and `order.emirate` is a required column.** The product is structurally UAE-only at
the order level regardless of what the currency dropdown offers.

## 1.10 Staff, roles, permissions, audit

**Exists.** Four roles plus the `branchrole`/`useroutletrole` intersection override,
and it is genuinely well built — `resolveEffectivePermissions` returns `null` when no
override exists (callers fall through to plain role logic), and returns
`intersection(basePermissionsFor(role), branchrole.permissions)` when one does, so it
is structurally incapable of granting. Wired into orders, products, dashboard,
ingredients, payments, search, delivery-zones and outlets. Staff invite flow with
email. `auditlog` append-only staff-action log whose writer swallows its own errors so
a broken audit insert never fails the real operation. `platformauditlogentry` for
Requital staff, whose writer is the opposite — impersonation *awaits* the log write and
fails the whole request if it fails.

**Missing outright.** `ALL_PERMISSIONS` has ten entries, and `branchrole` is
outlet-scoped only — there is no shop-wide custom role. Discounts, settings, theme,
customers, reports, draft orders and integrations have no permission granularity at
all: you are `admin` or you cannot touch them. No approval workflows — a discount, a
refund, a price change and a stock write-off all go straight through. No two-person
rule on anything. No session list or remote sign-out. No 2FA or MFA on any of the three
tiers. No SSO. No IP allowlisting. No password policy beyond length. No audit-log
retention policy or export.

## 1.11 Onboarding and migration

**Exists.** A four-step signup wizard (Personal → Business → Location & Setup →
Review) creating Shop + default Outlet + admin User in one transaction, optionally
starting a custom-domain claim. `GET /shop/publish-readiness`. Product and ingredient
CSV import with preview/confirm. `RESERVED_SUBDOMAINS`. A real custom-domain flow: DNS
TXT ownership verification with CAS state transitions, a 5-minute recheck sweep with
5m→30m→60m backoff and a 48h failure cut-off, a verified-only uniqueness index via a
DB-generated column, and Caddy on-demand TLS gated on a `/domains/verify` ask endpoint.

**Missing outright.** No importer for Shopify, Salla, Zid, WooCommerce or BigCommerce.
The CSV importer uses Requital's own column format, so a merchant migrating from
Shopify must hand-map every column. No customer import. No order-history import. **No
URL redirect map import** — a migrated merchant's Google rankings die on day one. No
image import by URL. No "migrate my store" service surface at all. Note also
`CLAUDE.md`'s flagged fast-follow: `irmain.com`, a real live merchant, was
grandfathered straight to `verified` in the verification migration and **has never
actually passed the DNS-TXT check**.

## 1.12 The platform layer

**Exists.** A genuinely separate tier: `platformadmin` rows (not `user` rows), no
signup route, CLI seeding only, its own JWT secret, and a guard that returns 404 on
every failure path so a scan cannot distinguish "no route" from "not authorised". Shop
list and detail; suspend/unsuspend enforced at two independent choke points
(login-after-correct-password, and the per-request `AuthGuard` re-fetch, plus
`PublicService.resolveShop` for the storefront half); impersonation minting a
short-lived non-refreshable merchant token with an `imp` claim, the audit write a hard
precondition of returning it; cross-shop webhook log and audit log; Slider account-id
assignment and test dispatch.

**Missing outright — and this is the largest single gap in the product.** There is
**no billing.** No plan, no tier, no price, no subscription, no invoice to the
merchant, no payment method on file, no dunning, no trial, no usage metering, and no
limits of any kind — products, orders, staff, storage, API calls and outlets are all
unbounded. No upgrade or downgrade path, no proration, no revenue reporting for
Requital itself. A merchant signs up and uses the platform indefinitely unless someone
manually suspends them.

There is also no app or extension model, no public API for merchants, no API keys, no
outbound webhooks (**the "Webhooks" tab in Integrations is a read-only *inbound*
diagnostics log — the name is actively misleading**), no OAuth, no developer
documentation, no sandbox, no partner tier, and no theme marketplace.

## 1.13 Operational maturity

**Exists.** Structured JSON logging to stdout with request id, shopId and a redaction
regex covering passwords, tokens, secrets and card fields, plus a CI guardrail that
fails on a raw `console.log` in `backend/src`. `/health` (liveness, zero dependencies)
and `/health/ready` (a real `SELECT 1`), both deliberately leaking nothing about the
deployment. A pluggable error-tracking provider resolving to a generic HTTP webhook
when `ERROR_TRACKING_WEBHOOK_URL` is set, else a logging no-op. `@nestjs/throttler`
globally at 100/min/IP, 5/min on credential endpoints, 20–30/min on public storefront
POSTs. A DB-backed job queue (`job` table, 5s poller, 10 jobs per tick, idempotency
key, attempts/maxAttempts/nextAttemptAt/lastError) with three job types and a
failed-jobs admin page. `scheduledjoblock` plus `runLocked` so crons are safe against
multiple processes. Helmet security headers. A pluggable storage provider (local or
S3-compatible) with magic-byte MIME sniffing, filename safety checks and generated
thumbnail/medium variants. `tools/backup-db.sh` (mysqldump, `--single-transaction`,
password via `MYSQL_PWD`). Four required CI jobs plus three custom guardrail scripts
(outlet-scoping grep, no-console-log, form-width) and a lint-baseline mechanism. 53
backend unit specs, 68 e2e specs against a real MySQL, and 4 cross-app Playwright
paths.

**Missing outright.** No metrics, no APM, no distributed tracing, no dashboards, no
uptime monitoring, no alerting — an error webhook is the entire alerting story. No log
aggregation or retention (PM2 files on one box). **Backups are a script, not a
schedule** — the runbook explicitly says "run this on a schedule" and nothing does. No
off-host backup storage, no restore drill, no stated RPO or RTO. **Single VPS, single
MySQL, no replica, no failover, no CDN in front of the storefront, no read scaling.**
No staging environment. No blue/green or canary deploy — deploys are manual (`scp` a
Caddyfile, `pm2 restart`). No query performance monitoring, and `GET
/platform-admin/shops` has no pagination, which has already crashed a verification
script against the dev DB's ~26,000 leftover shop rows. No per-tenant resource limits
or noisy-neighbour protection. No abuse handling beyond IP throttling — and open
self-signup with no email-verification gate means an attacker can create unbounded
shops.

**Also still open from `docs/audit-2026-08.md`:** email verification exists but blocks
nothing except change-password. An unverified account has full access to everything
else.

## 1.14 Content

`policypage` — five fixed legal types, one row per type per shop, rendered with a real
"not published" state, and footer links only for types that have content. `biolink`
pages. Theme sections carrying rich content blocks. **No blog. No arbitrary CMS pages.
No media library. No page-level SEO for anything but products and the shop root. No
content scheduling. No content versioning** — the theme has draft/published; nothing
else does.

## 1.15 Mobile

Nothing. The storefront is responsive and has a real `MobileNav` with four modes; the
admin is responsive to a degree. There is no PWA manifest, no service worker, no
offline capability, no push notifications, no merchant app, no customer app, and no
barcode-scanning surface on a phone — the scan-to-stock flow is a file upload, not a
camera capture.

## 1.16 AI

`tesseract.js` OCR in `scan/`. That is the entire AI surface, and it is classical CV,
not a model call. There is no LLM anywhere in the product.

## 1.17 Inventory summary — the honest read

The product has an unusually strong **operations spine** for its age: real
multi-outlet stock with a full movement ledger, a real bill of materials, CAS-safe
order transitions, a real job queue, a real payment strategy layer with encrypted
per-tenant credentials, three genuinely separated auth tiers, a permission
intersection model that cannot escalate, a real custom-domain flow with on-demand TLS,
and a theme system more capable than most of its regional competitors'.

It has almost no **commercial layer**: no billing, no marketing, no analytics, no
segmentation, no campaigns, no B2B, no subscriptions, no supplier or purchasing side,
no margin reporting, and no internationalisation despite the schema advertising seven
currencies and a language setting.

The distance between those two sentences is what the rest of this document is about.
---
---

# PASS 2 — THE EXPANSION CATALOG

*This is the deliverable. Proposals first, filtering second. Cheap and expensive both
belong here. Every item is annotated; the **Ship** column is my recommendation, not a
decision, and §8 sequences the YES set.*

Each domain gets: a one-paragraph read of what is actually missing, an enumerated
table, and then prose treatment for the entries that need more than a row. Item IDs
(`CAT-1`, `INV-7`, …) are stable and referenced from §8.

---

## 2.1 Catalog and merchandising

**The read.** The catalog is unusually rich on *presentation* attributes (FAQs,
attributes, additional-info accordions, three variant axes, brands, two orthogonal
grouping systems) and unusually poor on *commercial* attributes. There is nowhere to
put a fact about a product that Requital's engineers did not anticipate — no
metafields — which is the single thing most limiting for a florist/gifting merchant
base, where the interesting product facts are things like stem count, vase included,
occasion, colour family, seasonality, and care instructions. It is also the thing that
unblocks the most downstream work: feeds, filters, personalisation, ERP mapping,
and the app model all want a generic extension point.

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **CAT-1** | **Metafields / custom fields** on product, variant, collection, customer, order, outlet | **L** | infra | DIFFERENTIATOR | none | new `metafielddefinition` + `metafieldvalue` tables, every entity's response DTO, ProductForm, theme section bindings, public API | **YES** |
| CAT-2 | Product media beyond images: video (hosted URL + upload), PDF spec sheet, 3D/GLB | M | feature | TABLE STAKES | storage provider (exists) | `productimage` → generalised `productmedia`, ProductGallery, storage sniffing | **YES** |
| CAT-3 | Digital / downloadable products (licence keys, PDFs, gift certificates as files) | M | feature | TABLE STAKES | order fulfilment split | `product.productType`, order fulfilment, a signed-download endpoint | LATER |
| CAT-4 | **Product bundles / kits** as a sellable SKU with component pricing and component stock | L | feature | DIFFERENTIATOR | BoM (exists) | new `productbundle` or a `product.kind` discriminator, cart, stock decrement, returns | **YES** |
| CAT-5 | Merchant-curated cross-sell / upsell slots per product ("frequently bought with") | S | feature | TABLE STAKES | none | `productrelated` join, PDP, cart | **YES** |
| CAT-6 | Per-outlet catalog availability (product available at branch A, not branch B) | M | feature | TABLE STAKES | none | new `outletproduct` join or a null-stock convention, public product query, PDP | **YES** |
| CAT-7 | Per-outlet / per-channel pricing | M | feature | DIFFERENTIATOR | §6 money model | `outletproductprice`, every price read site | LATER |
| CAT-8 | Price lists (a named set of overrides applied to a customer group) | L | feature | DIFFERENTIATOR | CUS-4 groups, §6 | `pricelist` + `pricelistitem`, cart pricing, B2B | LATER |
| CAT-9 | Scheduled publish / unpublish, and scheduled price change | S | feature | TABLE STAKES | job queue (exists) | `product.publishAt`/`unpublishAt`, a sweep job | **YES** |
| CAT-10 | Product reviews with photo, moderation queue, and verified-purchase badge | L | feature | TABLE STAKES | none | new `productreview` + moderation UI + storefront section + JSON-LD | **YES** |
| CAT-11 | Customer Q&A on the PDP (distinct from merchant FAQs) | M | feature | DIFFERENTIATOR | CAT-10 moderation | `productquestion`/`productanswer`, PDP | LATER |
| CAT-12 | **Media library** — browse, search, tag, reuse and delete every uploaded asset | M | feature | TABLE STAKES | storage (exists) | new `mediaasset` table backfilled from existing urls, an admin picker replacing every upload field | **YES** |
| CAT-13 | Variant axes beyond 3 (the `optionValue1/2/3Id` column cap) | M | infra | TABLE STAKES | §6-A | `productvariant` → `productvariantoptionvalue` join, variant generator, every variant read | LATER |
| CAT-14 | Variant images plural (a variant currently points at one `imageId`) | S | feature | TABLE STAKES | CAT-2 | `productvariantimage` join, ProductGallery | **YES** |
| CAT-15 | Swatch metadata on option values (hex, image, pattern) so colour pickers render | S | feature | TABLE STAKES | none | `productoptionvalue.swatch*`, the already-dead `swatches.*` theme category gets its first consumer | **YES** |
| CAT-16 | Barcode generation + printable shelf/price labels | S | feature | DIFFERENTIATOR | none | a label-render endpoint (HTML print, same pattern as invoices) | LATER |
| CAT-17 | Product-level SEO beyond meta title/description: canonical, JSON-LD Product+Offer+AggregateRating, OG per product | S | feature | TABLE STAKES | CAT-10 for ratings | storefront PDP head, `lib/seo.ts` | **YES** |
| CAT-18 | Collection-level rich content (hero, description blocks, custom sort) | S | feature | TABLE STAKES | none | `collection.description` exists; add blocks + `sortOrder` | **YES** |
| CAT-19 | Saved product filters / smart lists in the admin (low margin, no image, no description, never sold) | S | feature | DIFFERENTIATOR | ANL-6 margin | products list query params + a saved-view table | **YES** |
| CAT-20 | Catalog health score — a per-shop checklist scoring image count, description length, SEO fields, missing cost price | S | feature | DIFFERENTIATOR | none | a computed endpoint + a dashboard card | **YES** |
| CAT-21 | Product import/export round-trip in Shopify's own CSV column format | M | feature | TABLE STAKES | ONB-1 | importer column mapper | **YES** |
| CAT-22 | Localised product content (name/description per language) | L | feature | TABLE STAKES | §6-C i18n | `producttranslation`, every product read | LATER |
| CAT-23 | Product taxonomy mapping (Google product category, Salla/Zid category codes) | S | feature | TABLE STAKES | CAT-1 metafields would carry it | a taxonomy picker, feed generation | LATER |
| CAT-24 | Care instructions / occasion / seasonality as first-class fields | S | feature | DIFFERENTIATOR | CAT-1 | metafield definitions shipped as a preset | **ABSORBED (D20)** — becomes pack content under CAT-1, not a separate item (§10.1) |
| CAT-25 | Composite "build your own bouquet" configurator (pick stems, wrap, vase, card) | L | feature | DIFFERENTIATOR | CAT-4, BoM | a configurator section + cart line composition | LATER |

### CAT-1 — Metafields, in detail

This is the highest-leverage single item in the whole catalog domain and it is the
one I would build first, because six other proposals in this document degrade to
"hardcode another column" without it.

Shape: two tables. `metafielddefinition` (`shopId`, `ownerType` enum, `namespace`,
`key`, `name`, `type` enum — `text` / `multiline` / `number` / `boolean` / `date` /
`json` / `single_select` / `multi_select` / `file` / `reference`, `validationJson`,
`displayOrder`, `visibleOnStorefront`) and `metafieldvalue` (`shopId`, `ownerType`,
`ownerId`, `definitionId`, `value` JSON) with a composite unique on
`(ownerType, ownerId, definitionId)`.

Fit with the existing codebase: it is exactly the batch-load-then-assemble pattern
`loadProductsWithRelations` already uses — one `WHERE ownerId IN (...)` query plus a
JS `Map` grouping step, appended to the existing relation loader. It needs no new
query shape and no ORM feature the raw-`mysql2` layer lacks.

What it unblocks: CAT-23 (taxonomy codes), CAT-24 (florist fields), the Google
Shopping feed's attribute gaps (`docs/plans/google-shopping-listing.md` §4 names
several), storefront filtering by arbitrary attributes, the ERP mapping in §4, and
the app model in §2.13 — an "app" with nowhere to store its own data is not an app.

The one thing to be careful of: `assertValidThemeConfig`'s top-level allow-list and
the theme system's shape-change-means-reset convention do *not* apply here — metafield
values are relational rows, not theme JSON — so this does not inherit that constraint.
But the storefront-visible subset does need a stable public DTO shape, because a theme
section binding to `product.metafields.custom.stem_count` is a contract.

Ship it with a **preset pack**: on shop creation, seed a florist/gifting definition
set (stem count, colour family, occasion, vase included, care instructions, fragrance,
lifespan in days). A merchant who never opens the metafields page still gets the
benefit, and the preset doubles as the documentation.

### CAT-4 — Bundles, in detail

`productingredient` already models "this sellable thing consumes N of that
non-sellable thing". A bundle is the sibling relation: "this sellable thing consumes N
of that *sellable* thing", where the components remain independently purchasable and
independently stocked. The stock decrement path in `OrdersService.adjustStockForOrder`
already handles a fan-out (it does exactly this for ingredients), so the mechanism
exists; what is missing is the sellable-component relation and the pricing model.

Three pricing modes worth supporting, because a gifting merchant uses all three:
fixed bundle price, sum-of-components, and sum-minus-percentage. Availability is
`min(floor(componentStock / quantityPerBundle))` across components — the same shape as
the ingredient availability computation.

The genuinely hard part is returns: returning a bundle must restock its components,
and returning *part* of a bundle has no answer. My recommendation is to make bundles
atomic for returns in v1 (all-or-nothing) and say so in the UI, rather than build a
partial-bundle return model nobody asked for.

---

## 2.2 Inventory, purchasing, suppliers, multi-location

**The read.** This is the domain where the product is closest to being genuinely
differentiated and furthest from finishing the thought. There is a movement ledger, a
BoM, multi-outlet stock and OCR stock-in — and no supplier, no purchase order, no
valuation, and no expiry. For a florist, expiry is not a nice-to-have: perishable
stock with a 5–10 day life is the defining constraint of the business, and nothing in
the schema models it. The merchant base this product was built for is being served by
an inventory module that cannot answer "what dies on Thursday".

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **INV-1** | **Supplier as a first-class entity** (contacts, terms, lead time, currency, min order, per-supplier SKU + cost) | **M** | feature | TABLE STAKES | none | new `supplier`, `supplierproduct`; `ingredient.supplier` and `product.vendor` migrate to FKs | **YES** |
| **INV-2** | **Purchase orders** — draft → sent → partially received → received → closed, with per-line receiving | **L** | feature | TABLE STAKES | INV-1 | new `purchaseorder`/`purchaseorderitem`, stock-in through the existing `stockmovement` ledger | **YES** |
| INV-3 | Receive-against-PO from the existing OCR scan flow (match the delivery note to an open PO) | M | feature | DIFFERENTIATOR | INV-2, scan (exists) | `scan.service` matching layer, PO reconciliation | **YES** |
| **INV-4** | **Lot / batch tracking with expiry**, FEFO allocation, expiring-soon report, auto-markdown trigger | **L** | feature | DIFFERENTIATOR | none | new `stocklot`, allocation in `adjustStockForOrder`, a sweep job, dashboard card | **YES** |
| INV-5 | Reorder points and suggested-PO generation (per outlet, from velocity + lead time) | M | feature | DIFFERENTIATOR | INV-1, INV-2 | a computed endpoint + an admin surface | **YES** |
| INV-6 | Stock valuation — weighted average cost, with a valuation-at-date report | L | infra | TABLE STAKES | INV-2 for real receipt costs | `stockmovement.unitCost`, a valuation query | LATER |
| INV-7 | Stocktake / cycle count workflow — count sheet, blind count, variance report, approved posting | M | feature | TABLE STAKES | none | new `stocktake`/`stocktakeline`, posting through `stockmovement` | **YES** |
| INV-8 | Bins / locations within an outlet | M | feature | — | none | `outletstock` gains a `binId` dimension (composite PK change — non-trivial) | NO |
| INV-9 | Stock reservation with TTL for in-progress carts | M | infra | DIFFERENTIATOR | none | a `stockreservation` table, a sweep job, checkout | LATER |
| INV-10 | Negative-stock policy per product (block / warn / allow), replacing the current always-allow | S | feature | TABLE STAKES | none | `product.negativeStockPolicy`, `adjustStockForOrder` | **YES** |
| INV-11 | Wastage / shrinkage recording with reason codes and a wastage report | S | feature | DIFFERENTIATOR | none | `stockmovement.reason` exists; add a UI, reason vocabulary and a report | **YES** |
| INV-12 | Multi-level BoM (a sub-assembly that is itself made of ingredients) | M | feature | DIFFERENTIATOR | recursion guard | `productingredient` recursion, consumption fan-out | LATER |
| INV-13 | Manufacturing / assembly orders — build N of a made item, consume components, produce stock | L | feature | DIFFERENTIATOR | INV-12 | new `assemblyorder`, stock movements both ways | LATER |
| INV-14 | Inter-outlet transfer requests with approval and in-transit state | M | feature | TABLE STAKES | none | transfer exists as immediate; add `transferorder` with statuses | **YES** |
| INV-15 | Consignment / sale-or-return stock (a supplier owns it until sold) | M | feature | — | INV-1 | ownership flag on stock rows, settlement report | NO |
| INV-16 | Serial number tracking | M | feature | — | none | a serial table | NO |
| INV-17 | Barcode-scanner input mode on the stock pages (keyboard-wedge and camera) | S | feature | TABLE STAKES | MOB-3 for camera | an input handler + a scan endpoint | **YES** |
| INV-18 | Supplier price-change alerting (received unit cost differs from last by >X%) | S | feature | DIFFERENTIATOR | INV-2 | a check on PO receipt + a notification | **YES** |
| INV-19 | Landed cost allocation (freight, duty, handling spread across a PO's lines) | M | feature | DIFFERENTIATOR | INV-2, INV-6 | PO cost lines, valuation | LATER |
| INV-20 | Dead-stock and slow-mover report (no movement in N days, capital tied up) | S | feature | TABLE STAKES | none | one query over `stockmovement` + `outletstock` | **YES** |
| INV-21 | Ingredient substitution rules ("if no white roses, use cream") surfaced at fulfilment | M | feature | DIFFERENTIATOR | none | `ingredientsubstitute`, fulfilment UI | LATER |
| INV-22 | Per-outlet stock visibility on the storefront ("in stock at Marina, 2 left") | S | feature | DIFFERENTIATOR | CAT-6 | public product DTO, PDP | **YES** |

### INV-4 — Lot tracking and expiry, in detail

Florists and gift shops buy perishable stock. The current model has one integer per
`(outlet, product)`, which cannot express "40 stems, 10 arriving today and 30 arriving
Thursday, all dying within a week". The consequences today are that a merchant cannot
answer what to discount, what to prioritise in fulfilment, or what their real wastage
is — and `ingredient.costPerUnit` is therefore a fiction the moment two deliveries land
at different prices.

Shape: `stocklot` (`shopId`, `outletId`, `productId` **or** `ingredientId`, `lotCode`,
`receivedAt`, `expiresAt`, `quantityReceived`, `quantityRemaining`, `unitCost`,
`purchaseOrderId` nullable, `supplierId` nullable). `outletstock.stockQuantity` stays
as the fast denormalised total — do not remove it; make it the sum, maintained inside
the same transaction, so every existing read path keeps working unchanged. That is the
key design decision: this is additive, and a shop that never enables lot tracking sees
byte-identical behaviour, matching the convention the theme engagement established.

Allocation is FEFO (first-expiring-first-out) rather than FIFO — correct for
perishables and a genuine differentiator, since most SMB inventory systems only do
FIFO. Consumption in `adjustStockForOrder` walks lots in `expiresAt` order.

The payoff features fall out almost free once the table exists: an
expiring-within-N-days dashboard card, an auto-markdown rule (a discount that
activates on lots expiring in ≤2 days — this is where `discount.discountType = 'auto'`
finally earns its keep), a real wastage report, and true weighted-average cost.

### INV-2 — Purchase orders, in detail

Odoo's purchasing module in miniature. The state machine is `draft → sent → partially
received → received → closed`, plus `cancelled`, and it should be implemented with the
exact same compare-and-swap discipline `OrdersService.updateStatus` uses, because
receiving is a stock-mutating transition and concurrent receipt from two staff is a
real scenario in a shop with a back-of-house.

Receiving posts through the existing `stockmovement` ledger with a new
`type: 'purchase_receipt'` and — if INV-4 ships — creates a `stocklot`. That is the
part that makes this worth building rather than telling merchants to use a
spreadsheet: it closes the loop between what you paid, what you have, and what it is
worth, which is the loop no Salla/Zid-class competitor closes at all.

The merchant-visible payoff is a "what do I need to order this week" screen driven by
INV-5, which is the thing a florist actually does every Sunday night.

---

## 2.3 Orders, fulfilment, returns, exchanges

**The read.** The order state machine is well engineered and narrow. It models one
outlet, one shipment, one linear path, no partial anything. The gaps that matter most
are not exotic: split fulfilment, exchanges, and a customer-facing returns portal are
all things a merchant will ask for in the first year, and the first of those is a
schema change (§6-B). Separately, four persisted toggles in Store Configuration
promise order behaviour that does not exist, which is worse than not having the
feature.

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **ORD-1** | **Fulfilments as a first-class entity** — split an order across outlets/shipments, each with its own status and tracking | **L** | infra | TABLE STAKES | §6-B | new `fulfilment`/`fulfilmentitem`, order status derivation, admin order detail, storefront tracking | **YES** |
| ORD-2 | Exchanges — return line A, issue line B, price-difference settled as charge or credit | M | feature | TABLE STAKES | CUS-6 store credit | `orderreturn` gains an exchange mode, a linked replacement order | **YES** |
| ORD-3 | **Customer-facing returns portal** — request from the account page, merchant approves, RMA issued | M | feature | TABLE STAKES | ORD-2 | `orderreturn.status`, a customer endpoint, an admin queue | **YES** |
| ORD-4 | Order tags + saved views (a merchant's own workflow buckets on top of the status machine) | S | feature | TABLE STAKES | none | `ordertag` join, list filters, a saved-view table | **YES** |
| ORD-5 | Wire the four dead toggles: pre-orders, ASAP delivery, delivery calendar, customer confirmation | M | feature | TABLE STAKES | INV-9 for pre-order stock | `PublicService.createOrder`, checkout, status machine | **YES** |
| ORD-6 | Order timeline — one merged, filterable event stream (status, payment, notes, emails, webhooks, staff actions) | M | feature | TABLE STAKES | none | a union query over `auditlog`/`ordernote`/`paymenttransaction`/`webhookevent` | **YES** |
| ORD-7 | Editable orders after `preparing` with an explicit "changes after prep started" audit reason | S | feature | — | none | `EDITABLE_ORDER_STATUSES` + a confirm step | LATER |
| ORD-8 | Order archiving / cold storage after N months, keeping list queries bounded | M | infra | — | none | an `order.archivedAt` filter or a partition strategy | LATER |
| ORD-9 | Draft-order → customer-approvable quote (send a link, customer accepts, converts) | S | feature | DIFFERENTIATOR | none | a public quote-accept endpoint on the existing draft-order token pattern | **YES** |
| ORD-10 | Recurring / standing orders (weekly office flowers) | L | feature | DIFFERENTIATOR | PAY-4 subscriptions | a schedule entity, a generation job | **YES** |
| ORD-11 | Gift orders as a real concept — recipient distinct from buyer, gift message, hide prices on the packing slip, scheduled reveal | S | feature | DIFFERENTIATOR | none | `order.receiverMessage` exists; add recipient fields, invoice/packing-slip variants | **YES** |
| ORD-12 | Fulfilment run sheet — a printable/mobile per-driver, per-slot pick and pack list | M | feature | DIFFERENTIATOR | SHP-5 routing | a grouped query + a print view | **YES** |
| ORD-13 | Order-level and line-level custom fields | S | feature | — | CAT-1 | metafields on order/orderitem | **YES** |
| ORD-14 | Duplicate-order detection (same customer, same total, within N minutes) with a merchant prompt | S | feature | DIFFERENTIATOR | none | a check in `createOrder` + an admin flag | **YES** |
| ORD-15 | Fraud signals — velocity, mismatched geo, disposable email, first-order high value, COD risk score | M | feature | DIFFERENTIATOR | ANL analytics | a scoring service + an order badge | LATER |
| ORD-16 | Partial refunds by line without a return record (a goodwill discount after the fact) | S | feature | TABLE STAKES | none | `orderreturn` with a `goodwill` reason, or a separate adjustment row | **YES** |
| ORD-17 | Order splitting/merging by staff | M | feature | — | ORD-1 | fulfilment model | LATER |
| ORD-18 | Delivery failure / re-attempt states in the status machine | S | feature | TABLE STAKES | none | `ORDER_STATUSES` + `isValidStatusTransition` | **YES** |
| ORD-19 | Capacity-aware order acceptance (refuse a slot once N orders are booked into it) | M | feature | DIFFERENTIATOR | SHP-3 slot quotas | slot validation | **YES** |
| ORD-20 | Bulk order actions beyond status: bulk print, bulk assign driver, bulk export, bulk message | S | feature | TABLE STAKES | none | orders list | **YES** |

### ORD-1 — Fulfilments, in detail

`order.outletId` being `NOT NULL` is the single most consequential schema decision in
the product, and it is the one thing that would need to change to unlock a whole
family of features: split shipment, ship-from-store routing, marketplace-style
multi-vendor, and any "we're out of it here, send it from the other branch" flow.

The migration path is a genuine expand/contract and needs care, because `outletId` is
read from `order` in dozens of places and is the axis `resolveOutletFilter` and every
branch-role check operate on:

1. Add `fulfilment` (`orderId`, `outletId`, `status`, `trackingNumber`, `carrier`,
   `shippedAt`, `deliveredAt`) and `fulfilmentitem` (`fulfilmentId`, `orderItemId`,
   `quantity`).
2. Backfill exactly one `fulfilment` per existing order, carrying the order's own
   `outletId` and status. Every existing order becomes a single-fulfilment order.
3. Keep `order.outletId` as the *primary* fulfilment's outlet for the whole transition,
   so `resolveOutletFilter`, the branch-role checks and every existing query keep
   working unchanged.
4. Derive `order.status` from its fulfilments (all delivered ⇒ delivered; any in
   transit ⇒ out_for_delivery; …) rather than setting it directly, and move the CAS
   discipline down to the fulfilment row.
5. Only once every consumer reads fulfilments does `order.outletId` become
   advisory/denormalised.

This is an L, arguably an XL, and it should not be attempted in the same phase as
anything else that touches orders. It is on the YES list because ORD-2, ORD-12,
SHP-5 and the whole ship-from-store story sit behind it — but it is a phase of its
own.

### ORD-5 — The four dead toggles, in detail

`allowPreOrders`, `asapDeliveryEnabled`, `deliveryCalendarEnabled` and
`customerConfirmationRequired` are all persisted, admin-editable, and read by nothing.
Three of the four are not under the "Coming Soon" card that honestly labels
`dynamicThemeBuilderEnabled` — they sit in the normal settings body, indistinguishable
from working toggles. A merchant who ticks "Allow pre-orders" and then takes an
out-of-stock order has been actively misled by the product.

The honest options are (a) build them, (b) move them under the Coming Soon card, or
(c) delete them. The `CLAUDE.md` convention already says a functional-looking toggle
must not sit under Coming Soon copy — the inverse rule is what is missing, and it
should be stated: *a non-functional toggle must not sit outside it.* Doing (b) is an
S and should happen regardless of whether (a) ever does. **Decided (§9.3 D21):**
Phase 0 hides all four. Whether ASAP delivery specifically gets built stays open.

Substantively, each is small once decided:

- **ASAP delivery** — a "deliver now" option that skips slot selection, gated on the
  outlet being open, and dispatching to Slider immediately. Ties directly into the
  existing Slider integration and is the most valuable of the four.
- **Delivery calendar** — a month view at checkout instead of a date field, showing
  capacity per day. Needs SHP-3.
- **Pre-orders** — sell below zero with a promised availability date. Needs INV-10's
  policy field and a way to communicate the date.
- **Customer confirmation required** — an order lands as `pending` and the customer
  gets a link to confirm before it advances. Fine as-is; the machine already has
  `pending`.
---

## 2.4 Payments, checkout, subscriptions, B2B

**The read.** The payments layer is the best-architected part of the backend and the
thinnest in coverage. The strategy pattern, the encrypted per-shop credentials, the
insert-fails-means-already-processed idempotency and the mandatory in-provider
configuration guard are all genuinely good. What is missing is breadth (wallets,
saved cards, three dead gateway stubs), depth (deposits, split tender, capture/void)
and two entire product categories that the architecture is ready for and does not
have: subscriptions and B2B.

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **PAY-1** | **Apple Pay / Google Pay** wallet buttons on the PDP and checkout (via Stripe Payment Request, and Tabby/Tamara equivalents) | **M** | integration | TABLE STAKES | Stripe (exists), domain verification per custom domain | checkout, a domain-association file served per custom domain | **YES** |
| PAY-2 | Saved cards / vaulting with a customer payment-methods page and one-click reorder | M | feature | TABLE STAKES | customer auth (exists) | `customerpaymentmethod`, Stripe SetupIntent, checkout | **YES** |
| PAY-3 | Finish or delete the three stub gateways (Telr, PayTabs, Nomod) | M each | integration | TABLE STAKES | none | one provider file each + webhook parsing | **YES** (see below) |
| **PAY-4** | **Subscriptions / recurring orders** — plan, schedule, dunning, pause/skip, customer self-management | **XL** | feature | DIFFERENTIATOR | PAY-2 vaulting, job queue (exists) | new `subscription`/`subscriptionitem`/`subscriptioncycle`, order generation job, customer account, admin | **YES** |
| **PAY-5** | **B2B: company accounts, net terms, credit limits, PO numbers, tax exemption, per-company price list** | **XL** | feature | DIFFERENTIATOR | CUS-4 groups, CAT-8 price lists | new `company`/`companycontact`/`creditterm`, checkout branching, invoicing, AR ageing | **YES** |
| PAY-6 | Deposits and partial payments (pay 30% now, balance on delivery) | M | feature | DIFFERENTIATOR | none | `order` payment schedule, payment links, status | **YES** |
| PAY-7 | Split tender (part gift card, part card, part cash) | M | feature | TABLE STAKES | none | order payment allocation table | **YES** |
| PAY-8 | Manual capture / void / partial capture on authorised payments | S | integration | TABLE STAKES | provider interface | `PaymentProvider` gains `capture`/`void` | **YES** |
| PAY-9 | Payment retry and dunning for failed recurring charges | M | infra | TABLE STAKES | PAY-4 | job queue, email sequence | **YES** |
| PAY-10 | Checkout as a configurable multi-step vs one-page flow, with field-level config | M | feature | TABLE STAKES | none | checkout components, shop settings | LATER |
| PAY-11 | Express/accelerated checkout from the PDP (buy now with wallet, skip cart) | S | feature | TABLE STAKES | PAY-1 | PDP, checkout | **YES** |
| PAY-12 | Address autocomplete at checkout (Google Places, already loaded for maps) | S | integration | TABLE STAKES | Maps key (exists) | checkout address field | **YES** |
| PAY-13 | Order-level tips / driver tips | S | feature | DIFFERENTIATOR | none | an order money column, checkout, driver payout report | **YES** |
| PAY-14 | Surcharges (COD fee, card fee, packaging fee) as configurable line items | S | feature | TABLE STAKES | none | `computeOrderTotals`, checkout display | **YES** |
| PAY-15 | Checkout extensibility — a merchant-defined custom field set at checkout | S | feature | DIFFERENTIATOR | CAT-1 | checkout form config, order metafields | **YES** |
| PAY-16 | Payment reconciliation report (gateway settlement vs orders vs refunds) | M | feature | TABLE STAKES | none | `paymenttransaction` reporting | **YES** |
| PAY-17 | Chargeback / dispute ingestion from Stripe webhooks with an admin queue | M | integration | TABLE STAKES | none | webhook handling, a dispute table | LATER |
| PAY-18 | Multi-currency presentment and settlement | XL | infra | TABLE STAKES | §6-D | every money column, every price read, every provider | LATER |
| PAY-19 | Cash drawer / till reconciliation per outlet per shift | M | feature | DIFFERENTIATOR | POS (§5) | a shift entity, cash movements | LATER |
| PAY-20 | Instalment plans offered by the merchant itself (not a BNPL provider) | M | feature | DIFFERENTIATOR | PAY-6 | payment schedule, dunning | LATER |

### PAY-3 — The three stubs, in detail

`TelrPaymentProvider`, `PayTabsPaymentProvider` and `NomodPaymentProvider` each throw
`PaymentProviderNotConfiguredException` from `createCheckoutSession` and log-and-ignore
in `parseWebhookEvent`. Telr and PayTabs are surfaced in the admin as explicitly
disabled "Coming soon" rows, which is honest. Nomod is not surfaced at all.

This matters more than it looks, because the original `BUILD_BRIEF.md` picked Nomod
specifically: *"Nomod bundles cards + Tabby + Tamara + Apple Pay + Google Pay in ONE
integration (not four)."* That was the plan, and what got built instead is four
separate integrations — three of them real, one of them (Apple/Google Pay) absent
entirely. The Nomod stub is the fossil of an abandoned decision, and it should either
be revived (which would deliver PAY-1 for free and is the cheapest path to wallets) or
deleted. Leaving a third stub in `payments/providers/` that no UI references is pure
carrying cost.

Telr and PayTabs are the two most commonly requested gateways by UAE merchants after
Stripe, and PayTabs in particular is the default for merchants who bank locally. Each
is a normal hosted-redirect integration: a create-session POST, a redirect, a signed
callback. Neither is more than an M.

**Recommendation:** build PayTabs (highest regional demand), build or revive Nomod
specifically as the wallets path, and delete Telr's stub until a merchant asks.

### PAY-4 — Subscriptions, in detail

Recurring orders are the single largest revenue-per-merchant lever available to this
product, and the merchant base is unusually well suited to it: weekly office flowers,
monthly gift boxes, event retainers, and standing corporate accounts are all normal in
this segment, and every one of them is currently a WhatsApp reminder and a manual
draft order.

The build has four parts, and they are separable:

1. **The schedule.** `subscription` (`shopId`, `customerId`, `outletId`, `status`,
   `interval`, `intervalCount`, `nextRunAt`, `pausedUntil`, `paymentMethodId`,
   `deliveryAddressJson`, `slotPreference`) plus `subscriptionitem` mirroring
   `orderitem`. A daily job claims due subscriptions with the same CAS pattern the
   abandoned-cart sweep already uses and generates a normal `order` with
   `channel: 'subscription'`.
2. **The money.** Needs PAY-2 vaulting, because charging a saved card off-session is
   the whole mechanism. Stripe off-session PaymentIntents; Tabby and Tamara do not
   support recurring, so subscriptions are card-or-COD only, which is fine.
3. **Dunning.** PAY-9. A failed charge retries on a schedule, emails the customer,
   and eventually pauses the subscription rather than silently skipping.
4. **Self-management.** A customer account page to skip a delivery, change the date,
   swap an item, change the address, and cancel. This is what determines whether the
   feature retains or churns, and it is the part most likely to get cut for time. Do
   not cut it.

Recharge's lesson worth stealing: make "skip this delivery" a one-click action in the
*reminder email*, not only in the account page. The reminder-before-charge email is
also the compliance-safe pattern and the single biggest reducer of dispute rate.

### PAY-5 — B2B, in detail

A florist's corporate accounts are a real and high-value segment — hotels, offices,
event planners, funeral homes — and today the product serves them with draft orders
and a WhatsApp thread. Shopify only shipped B2B on Plus; Salla and Zid have very
little. This is a genuine differentiator in the region.

Minimum viable shape:

- `company` (`shopId`, `name`, `trn`, `creditLimit`, `paymentTermsDays`,
  `taxExempt`, `priceListId`, `status`) and `companycontact` linking existing
  `customer` rows to a company with a role (`buyer` / `approver` / `admin`).
- A logged-in company contact sees company pricing, can check out **on account**
  (no payment collected, order created `unpaid` with a due date), and must supply a
  PO number if the company requires one.
- Credit limit enforced at order creation against outstanding unpaid balance — a CAS
  check inside the order transaction, exactly like discount redemption claiming.
- An AR ageing report (current / 30 / 60 / 90) and a statement-of-account PDF, both of
  which are just queries over `order` once `paymentTermsDays` exists.
- Approval flow (buyer submits, approver releases) is the part I would defer to v2.

The tax-exemption flag is where B2B and §2.9's tax work meet, and it is a good reason
to do the tax-class work (I18N-5) before or alongside this.

---

## 2.5 Customers, segmentation, loyalty, CRM

**The read.** There is a customer table, a customer login, and a list page. There is
no CRM. Everything a merchant would do with customer data — segment it, tag it, remember
a conversation, reward repeat purchase, win back a lapser, wish someone happy birthday
— is absent, and two of those (`customer.birthday`, `shop.birthdayDiscountEnabled`)
are half-present in a way that is worse than absent. This domain has the best
effort-to-value ratio in the entire document: the data is already there and almost
nothing reads it.

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **CUS-1** | **Customer segments** — saved, named, rule-based (RFM, spend, recency, product bought, area, tag, has-account), evaluated live | **M** | feature | TABLE STAKES | none | new `customersegment` with a rule JSON, a query compiler, admin UI | **YES** |
| CUS-2 | Customer tags (manual + auto-applied by segment membership) | S | feature | TABLE STAKES | CUS-1 | `customertag` join | **YES** |
| CUS-3 | Customer notes and an internal timeline | S | feature | TABLE STAKES | none | `customernote`, customer detail page | **YES** |
| CUS-4 | Customer groups / tiers with group-level pricing and shipping | M | feature | DIFFERENTIATOR | CAT-8 | `customergroup`, pricing resolution | LATER |
| **CUS-5** | **Loyalty — points earn/burn, tiers, birthday bonus, referral bonus** | **L** | feature | DIFFERENTIATOR | CUS-6 ledger | new `loyaltyaccount`/`loyaltytransaction`, checkout redemption, storefront widget, admin config | **YES** |
| **CUS-6** | **Store credit** as a real ledger (issue, refund-to-credit, expire, redeem at checkout) | **M** | infra | TABLE STAKES | none | generalise `giftcard` or a sibling `storecredit` table; checkout redemption path already exists | **YES** |
| CUS-7 | Wire `customer.birthday` + `birthdayDiscountEnabled`: a scheduled birthday voucher | S | feature | DIFFERENTIATOR | MKT-1 campaigns or a plain email | a sweep job, an auto-generated single-use discount | **YES** |
| CUS-8 | Communication log — every email, WhatsApp, SMS and note against the customer, in one thread | M | feature | TABLE STAKES | MKT-3 | a `communication` table written by every send path | **YES** |
| CUS-9 | Customer attachments (documents, trade licence, contract) with encryption at rest | M | feature | — | storage (exists), `common/crypto.ts` | an attachment table, an encrypted-blob path | LATER |
| CUS-10 | Merge duplicate customers (same person, two phone numbers) | S | feature | TABLE STAKES | none | a merge transaction repointing orders/carts/wishlists | **YES** |
| CUS-11 | Marketing consent tracking with a per-channel opt-in/opt-out and timestamp | S | infra | TABLE STAKES | PDPL/GDPR posture | `customerconsent`, every send path checks it | **YES** |
| CUS-12 | Customer lifetime value and predicted next-order date, stored not computed | M | feature | DIFFERENTIATOR | ANL-1 | a nightly rollup table | **YES** |
| CUS-13 | Win-back automation for lapsed customers (no order in N days for their own cadence) | M | feature | DIFFERENTIATOR | CUS-1, MKT-2 | segment + flow | **YES** |
| CUS-14 | Recipient book — a buyer's saved list of recipients with addresses and occasion dates | **S** | feature | DIFFERENTIATOR | none | a `recipient` table (or addresses JSON extended), checkout picker | **YES** |
| CUS-15 | Occasion reminders — "Sarah's birthday is in 10 days, order again?" | S | feature | DIFFERENTIATOR | CUS-14 | a sweep job, an email/WhatsApp | **YES** |
| CUS-16 | Customer-facing order reordering ("buy this again") | S | feature | TABLE STAKES | none | account orders page, cart prefill | **YES** |
| CUS-17 | Customer support inbox — inbound WhatsApp/email threaded against the customer and order | L | feature | DIFFERENTIATOR | CUS-8, WhatsApp inbound webhook | a conversation model, an agent UI | LATER |
| CUS-18 | Customer accounts required/optional/invite-only mode | S | feature | TABLE STAKES | none | `shop` setting, storefront gating | **YES** |
| CUS-19 | Guest-to-account conversion prompt after checkout | S | feature | TABLE STAKES | none | order confirmation page | **YES** |
| CUS-20 | Per-customer delivery preferences (never ring the bell, leave with concierge) | S | feature | DIFFERENTIATOR | none | an address JSON field, order carry-through | **YES** |

### CUS-14 / CUS-15 — The recipient book, in detail

This is the highest-value small feature in the document for this specific merchant
base, and I have not seen it done well by any competitor.

A gifting purchase has two people: a buyer and a recipient. The current model has one
— the order carries a single customer snapshot plus a `receiverMessage` string. The
buyer's own addresses JSON is where a recipient's address ends up, which means a
customer who sends flowers to their mother, their assistant and three clients has five
"addresses" in their own address book with no names attached to them.

Model it properly: `recipient` (`customerId`, `name`, `phone`, `relationship`,
`addressJson`, `notes` — "allergic to lilies", "concierge desk after 6pm") plus
`recipientoccasion` (`recipientId`, `label`, `date`, `recurring`). Checkout gets a
recipient picker instead of an address picker. Order gains `recipientId`.

Then CUS-15 falls out for free and is the retention mechanic this product does not
have: a sweep job finds occasions N days out, sends the buyer a message with a
one-click reorder of what they sent last time, prefilled to the same recipient. That
is a repeat-purchase engine built out of data the merchant already has, and it is
exactly the kind of thing that is obvious for a florist and invisible to a generic
e-commerce platform.

Pair it with `orderitem` history so the message can say *"last year you sent Fatima the
white peony bouquet"* — which requires nothing new.

### CUS-5 / CUS-6 — Loyalty and store credit, in detail

Build the ledger first (CUS-6) and the loyalty program on top of it (CUS-5), not the
other way around. The reason: the `giftcard` module already implements exactly the
mechanics a credit ledger needs — CAS balance updates inside the order transaction,
a redemption join table, and a refund-to-balance path in returns. A `storecredit`
table is that same code with a different owner (`customerId` instead of a code) and no
expiry-by-default.

Once credit exists, three things become trivial that are currently impossible:
refund-to-credit instead of to card (which merchants strongly prefer and which
improves retention), goodwill credit from support, and loyalty points redemption
(points convert to credit at a configured rate; the checkout path is already built).

Loyalty program shape, kept deliberately small: earn X points per currency unit on
delivered orders (not on placement — that is the anti-abuse rule most SMB loyalty
programs get wrong), bonus multipliers per collection or per tier, points expire after
N months, tiers derived from trailing-12-month spend. Skip: gamification, badges,
punch cards, and anything requiring a separate app.

---

## 2.6 Marketing, campaigns, messaging, SEO

**The read.** This is the emptiest domain relative to competitor expectation, and it
contains the single most damaging absence in the product: **there is no analytics or
pixel integration at all.** A merchant running Meta or TikTok ads — which in this
segment in this region is most of them — cannot measure a single conversion. They
cannot build a lookalike audience, cannot retarget, cannot report ROAS, and will
therefore leave for a platform that lets them, regardless of how good the theme
builder is. Everything else in this table is secondary to MKT-4.

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **MKT-4** | **Analytics + pixel layer** — GA4, Meta Pixel + Conversions API, TikTok, Snap, Google Ads; standard e-commerce events; consent-gated | **M** | integration | TABLE STAKES | CookieConsentBanner (exists, gates nothing) | a per-shop integrations config, a storefront event emitter, a server-side CAPI sender through the job queue | **YES — first** |
| **MKT-1** | **Campaigns** — a list/segment, an email or WhatsApp template, a send, and a per-send report | **L** | feature | TABLE STAKES | CUS-1 segments, per-shop sending domain | new `campaign`/`campaignrecipient`, a batched send job, an editor | **YES** |
| **MKT-2** | **Automation flows** — trigger → delay → condition → action, for welcome, abandoned cart, post-purchase, win-back, birthday, back-in-stock | **L** | infra | DIFFERENTIATOR | MKT-1, job queue (exists) | a flow definition table, a step-execution job, an admin builder | **YES** |
| MKT-3 | Per-shop sending identity — verified sending domain per merchant, so email arrives as the merchant, not `noreply@requital.io` | M | integration | TABLE STAKES | Resend domains API | `common/email.ts`, a domain-verification flow mirroring the custom-domain one | **YES** |
| MKT-5 | Abandoned-cart upgrade: a 3-message sequence across email + WhatsApp, with an optional escalating discount | S | feature | TABLE STAKES | MKT-2 | the existing sweep becomes a flow trigger | **YES** |
| ~~MKT-6~~ | ~~**WhatsApp as a real marketing channel** — template management, opt-in capture, broadcast, click tracking~~ | L | integration | — | — | — | **DROPPED (D15)** — customer-facing. MKT-1 campaigns are email-only as a result. |
| MKT-7 | Newsletter subscriber management: list, search, export, unsubscribe, and a send target | S | feature | TABLE STAKES | MKT-1 | an admin page over the existing table | **YES** |
| MKT-8 | JSON-LD structured data — Product, Offer, AggregateRating, BreadcrumbList, Organization, LocalBusiness, FAQPage | S | feature | TABLE STAKES | CAT-10 for ratings | storefront head components | **YES** |
| MKT-9 | Canonical URLs, Twitter cards, per-page OG images, `hreflang` once i18n lands | S | feature | TABLE STAKES | none | `lib/seo.ts` | **YES** |
| MKT-10 | Google Merchant Center auto-listing | XL | integration | DIFFERENTIATOR | four unverified human prerequisites — see `docs/plans/google-shopping-listing.md` §0 | a new `google-merchant/` module | LATER |
| MKT-11 | Meta / TikTok / Snap catalog feeds (a plain XML/CSV feed URL per shop) | S | integration | TABLE STAKES | CAT-1 for attribute coverage | a public feed endpoint | **YES** |
| MKT-12 | Blog / articles with categories, author, scheduling and SEO | M | feature | TABLE STAKES | CNT-1 | new `article` model + theme sections + routes | **YES** |
| MKT-13 | Landing-page builder — arbitrary theme-section pages at merchant-chosen URLs | M | feature | TABLE STAKES | theme sections (exist) | a `page` model reusing `ThemeConfig` section rendering | **YES** |
| MKT-14 | UTM capture and first/last-touch attribution stored on the order | S | infra | TABLE STAKES | MKT-4 | cart context, `order` attribution columns | **YES** |
| MKT-15 | Customer referral program (shopper-to-shopper, distinct from the merchant-recruited affiliate module) | M | feature | TABLE STAKES | CUS-6 credit | referral codes, reward issuance | **YES** |
| MKT-16 | Affiliate payouts — actually pay affiliates, not just report what is owed | M | feature | TABLE STAKES | none | a payout ledger, a status machine, an export for bank transfer | **YES** |
| MKT-17 | Popups / banners with targeting rules (exit intent, first visit, cart value, segment) | M | feature | TABLE STAKES | CUS-1 | a theme-adjacent popup system | LATER |
| MKT-18 | SMS channel (Unifonic / Twilio) as a peer to email and WhatsApp | M | integration | TABLE STAKES | MKT-1 | a provider interface mirroring `PaymentProvider` | LATER |
| MKT-19 | A/B testing on theme sections, prices or subject lines | L | feature | MOONSHOT | MKT-4 | a variant assignment mechanism | NO |
| MKT-20 | Post-purchase upsell offer (one-click add after payment, before confirmation) | M | feature | DIFFERENTIATOR | PAY-2 vaulting | an order-append path, confirmation page | LATER |
| MKT-21 | Review request automation N days after delivery, feeding CAT-10 | S | feature | TABLE STAKES | CAT-10, MKT-2 | a flow trigger | **YES** |
| MKT-22 | Google Business Profile sync (hours, address, photos per outlet) | M | integration | DIFFERENTIATOR | none | a GBP API integration per outlet | LATER |
| MKT-23 | Social proof widgets ("12 people bought this today") driven by real order data | S | feature | DIFFERENTIATOR | none | a public aggregate endpoint + a theme section | **YES** |

### MKT-4 — The analytics layer, in detail, and why it is first

Everything in this document is optional except this. A merchant cannot run a paid
acquisition channel on a platform that does not fire a purchase event, and paid social
is how this merchant segment acquires customers. The absence is not a feature gap, it
is a reason to churn.

What it needs, concretely:

1. **A per-shop integrations config.** `shopanalytics` (or metafields) holding GA4
   measurement id, Meta pixel id + CAPI access token, TikTok pixel id, Snap pixel id,
   Google Ads conversion id. Encrypted where a token is involved, reusing
   `common/crypto.ts`.
2. **A storefront event emitter.** One module (`lib/analytics.ts`) exposing
   `track(event, payload)` with the standard e-commerce vocabulary: `view_item`,
   `view_item_list`, `select_item`, `add_to_cart`, `remove_from_cart`,
   `begin_checkout`, `add_payment_info`, `purchase`, `search`, `sign_up`. Each
   provider script is loaded lazily and only after consent.
3. **Consent gating that actually works.** `CookieConsentBanner.tsx` currently
   persists a choice and gates nothing. It becomes the switch: no consent, no
   client-side pixel. This is also the PDPL/GDPR-correct posture and it is already
   half-built.
4. **Server-side conversion via the job queue.** Meta's Conversions API and Google's
   equivalent both want a server-side `purchase` event with an event id matching the
   browser event for deduplication. This is a perfect fit for the existing DB-backed
   job queue: `PublicService.createOrder` enqueues one `send_conversion_event` job,
   the worker posts it, retries are free. Server-side is what makes the numbers
   survive iOS tracking prevention, and it is the part that makes this a
   differentiator rather than table stakes — most Salla/Zid-class platforms only do
   the browser pixel.

Effort is genuinely an M because the hard parts (job queue, consent banner, encrypted
credentials, per-shop settings pattern) all already exist.

### MKT-1 / MKT-2 / MKT-3 — The campaign stack, in detail

Order matters: **MKT-3 before MKT-1.** Sending a merchant's marketing campaign from
`noreply@requital.io` is a deliverability disaster and a brand one — every merchant's
marketing email shares one domain reputation, so one merchant's bad list poisons every
other merchant's transactional mail. Per-shop verified sending domains are not a nicety;
they are the thing that keeps order confirmations landing in inboxes once marketing
volume exists.

Resend supports programmatic domain creation and DNS record issuance, and the merchant
UX is a near-copy of the custom-domain flow already built in
`docs/plans/custom-domain-resolver.md` Phase 2/3 — show the records, poll for
verification, back off, fail after 48h. Reuse that shape wholesale rather than
inventing a second one.

For MKT-1, the send itself is a fan-out job: one `campaign` row, N `campaignrecipient`
rows claimed in batches by the existing worker, with per-recipient status so a partial
failure is visible and resumable. The existing `job` table's idempotency key covers
double-send.

For MKT-2, resist building a general-purpose workflow engine. Klaviyo's flow builder is
a decade of work. What is actually needed is a small, fixed set of triggers (order
placed, order delivered, cart abandoned, back in stock, birthday, segment entered, N
days since last order) with a linear step list (wait / send / condition / tag) stored
as JSON and executed by one job per pending step. That covers ~90% of real SMB usage
and is an L, not an XL. The five *preset* flows shipped enabled-by-default matter more
than the builder.

### MKT-16 — Affiliate payouts, in detail

The affiliate module computes what is owed and stops. A merchant then pays affiliates
by bank transfer and tracks it in a spreadsheet — which means the module's data goes
stale immediately and the "payout summary" number is wrong from the first payment.

The missing piece is small: a `affiliatepayout` row (`affiliateId`, `periodStart`,
`periodEnd`, `amount`, `status`, `reference`, `paidAt`) and a
`affiliateorder.payoutId` back-reference, so an order is either unpaid or attached to
exactly one payout. Then "mark as paid" with a reference, an export in bank-transfer
format, and an affiliate-facing statement. That is an M and it makes an already-built
module actually usable.
---

## 2.7 Discounts, promotions, gift cards, bundles

**The read.** The discount engine is competent for its three types and its scoping
model is reusable. The two problems are that the most modern feature in it
(auto-apply) does not actually apply at checkout, and that the type vocabulary stops
exactly where the interesting promotions start: there is no BXGY, no tiered/volume
discount, no free-gift, and no stacking policy.

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **DSC-1** | **Finish auto-apply: redeem it at order creation, not just display it** | **S** | feature | TABLE STAKES | none | `PublicService.createOrder` consults `listActiveAutoDiscounts` | **YES — first** |
| DSC-2 | Buy X get Y (same or different product, N free or % off) | M | feature | TABLE STAKES | none | a discount rule shape, cart evaluation, order line allocation | **YES** |
| DSC-3 | Tiered / volume discounts (spend 200 save 10%, spend 500 save 20%) | S | feature | TABLE STAKES | none | discount tiers table, cart evaluation | **YES** |
| DSC-4 | Free-gift promotions (add a product at 0 when a condition is met) | S | feature | TABLE STAKES | DSC-2 machinery | cart injection, stock decrement | **YES** |
| DSC-5 | Stacking policy — which discounts combine, precedence, and a "best for the customer" resolver | M | infra | TABLE STAKES | DSC-2/3 | a single cart-pricing evaluator replacing the current per-discount math in two places | **YES** |
| DSC-6 | Bulk unique code generation (10,000 single-use codes for a print campaign) | S | feature | TABLE STAKES | none | a code batch table, generation, export | **YES** |
| DSC-7 | Customer-segment-scoped discounts ("VIPs only", "first order only", "lapsed customers") | S | feature | TABLE STAKES | CUS-1 | discount eligibility check | **YES** |
| DSC-8 | Schedule discounts in advance with an auto-activate/deactivate sweep | S | feature | TABLE STAKES | none | `startsAt`/`endsAt` exist; add the sweep + a UI calendar | **YES** |
| DSC-9 | Shipping discounts beyond free (rate override, capped discount, zone-specific) | S | feature | TABLE STAKES | SHP-1 | discount type extension | **YES** |
| DSC-10 | Discount performance report (redemptions, revenue attributed, margin impact) | S | feature | TABLE STAKES | ANL-6 margin | a query over `discountredemption` | **YES** |
| DSC-11 | Gift cards sellable as a physical product with a scheduled delivery date and a designed email | S | feature | TABLE STAKES | none | gift-card product flow, an email template, a send job | **YES** |
| DSC-12 | Gift-card balance check page and balance-remaining email after use | S | feature | TABLE STAKES | none | a public endpoint + storefront page | **YES** |
| DSC-13 | Discount abuse guards — one per customer, per device, per phone, velocity limits | S | infra | TABLE STAKES | none | redemption checks | **YES** |
| DSC-14 | Merchant-scriptable pricing (a safe expression language for custom discount logic) | XL | infra | MOONSHOT | app model | a sandboxed evaluator | NO |
| DSC-15 | Auto-markdown rules driven by expiry (INV-4) or age of stock | M | feature | DIFFERENTIATOR | INV-4 | a rule engine on top of `discount.discountType = 'auto'` | **YES** |
| DSC-16 | Price-per-unit display and multi-buy pricing on the PDP | S | feature | TABLE STAKES | DSC-3 | PDP price block | LATER |

### DSC-1 — In detail, because it is a live defect

`GET /public/:shopSlug/discounts/auto` exists. `storefront/lib/auto-discounts.ts`'s
`computeAutoDiscountedPrice` mirrors the backend's amount math and picks the single
best matching discount. Product cards and the PDP render the discounted price.
`PublicService.createOrder` charges the undiscounted one.

`CLAUDE.md` documents this as a deliberate scope boundary, and as an engineering
statement it is accurate — the work genuinely was scoped to display. As a product
statement it is a shopper being shown one price and charged another, which in the UAE
is a consumer-protection issue under the Consumer Protection Law's price-display
provisions, not merely a bug.

The fix is small and localised: `createOrder` already has a `discountCode`-provided
branch that resolves, validates and atomically claims a discount. The auto branch is
the same call with `listActiveAutoDiscounts` supplying the candidate set and the same
best-match selection the storefront already implements. The one design question is
whether an auto discount and a typed code can both apply — which is DSC-5, and which
needs an answer before this ships. My recommendation: in v1, a typed code replaces the
auto discount if it is worth more, and the customer is told which applied.

This is an S and it should be the first thing built out of this entire document.

### DSC-5 — One cart-pricing evaluator, in detail

Right now discount math lives in three places: `DiscountsService` (validation and
claiming), `storefront/lib/auto-discounts.ts` (client-side display), and
`PublicService.createOrder` (order totals). Adding BXGY, tiers and free gifts to three
copies is how a platform ends up with a checkout that charges the wrong amount.

Before DSC-2/3/4, extract one pure `evaluateCart(lines, context, discounts)` function
returning per-line and order-level allocations, in the same spirit as
`backend/src/public/time-slots.ts` being hand-mirrored for the slot check — except
this one should be a single module the backend owns and the storefront imports the
*results* of, via a `POST /public/:shopSlug/cart/price` endpoint, rather than a second
hand-mirrored copy. Client-side optimistic pricing stays for the product card (where
there is no cart), but the cart and checkout should both read the server's number.

That endpoint is also what PAY-14 surcharges, DSC-9 shipping discounts, tax classes
and B2B price lists all need, so it is the load-bearing refactor of this domain.

---

## 2.8 Shipping, delivery routing, dispatch

**The read.** There is real courier integration and real slot validation, sitting on
top of a fee model that is a case-insensitive string comparison. The captured
lat/lng/radius data on every delivery zone is the strongest signal in the codebase of
an intention that was never finished: the map picker exists, the circle overlay exists,
the columns exist, and no line of code computes a distance. For a same-day local
delivery business this is the difference between a working fee model and a guess.

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **SHP-1** | **Distance-based delivery fees** — use the already-captured zone lat/lng/radius; haversine first, road distance later | **S** | feature | TABLE STAKES | none | `order-pricing.ts`, checkout, a `common/geo.ts` haversine (a `geo.ts` already exists) | **YES — early** |
| SHP-2 | Polygon delivery zones (draw on the map) instead of circles | M | feature | DIFFERENTIATOR | SHP-1 | zone geometry JSON, point-in-polygon, the admin map | **YES** |
| SHP-3 | Slot capacity / quotas — N orders per slot per outlet, sold out when full | M | feature | DIFFERENTIATOR | none | a slot-capacity config, a count check in `assertValidTimeSlot`, checkout display | **YES** |
| SHP-4 | Weight- and dimension-based rates (the data exists on `product`) | S | feature | TABLE STAKES | none | a rate table, `computeOrderTotals` | **YES** |
| **SHP-5** | **Driver dispatch for a merchant's own drivers** — driver identity, assignment, run sheet, live status, proof of delivery | **L** | feature | DIFFERENTIATOR | ORD-1 helps but not required | new `driver`/`deliveryrun`, a mobile web view, a public tracking page | **YES** |
| SHP-6 | Route optimisation / multi-stop sequencing for a run | M | feature | DIFFERENTIATOR | SHP-5 | a solver (OSRM or a greedy nearest-neighbour heuristic first) | LATER |
| SHP-7 | Proof of delivery — photo, signature, or OTP, attached to the order | S | feature | DIFFERENTIATOR | SHP-5, storage (exists) | driver view, order detail | **YES** |
| SHP-8 | Shipping profiles — per-product shipping rules (this item ships free, that one is oversize) | M | feature | TABLE STAKES | none | a profile table, rate resolution | LATER |
| SHP-9 | Additional courier integrations (Careem Express, Talabat, Aramex, Fetchr, SMSA, Naqel, Quiqup, Lyve) behind the existing provider interface | M each | integration | TABLE STAKES | the interface exists | one provider file each | **YES** (pick 2) |
| SHP-10 | Rate shopping — quote all enabled couriers, present the cheapest or let the merchant choose | M | infra | DIFFERENTIATOR | SHP-9 | a multi-quote path | **YES** |
| SHP-11 | Label printing and manifest generation | M | integration | TABLE STAKES | SHP-9 | carrier label APIs, a print view | LATER |
| SHP-12 | Tracking-number ingestion and a unified tracking page for any carrier | S | feature | TABLE STAKES | none | `externaldelivery` gains a tracking number, the storefront tracking page | **YES** |
| SHP-13 | Pickup points / lockers | M | integration | — | none | a location type on the order | NO |
| SHP-14 | Delivery blackout dates and per-outlet holiday calendars | S | feature | TABLE STAKES | none | a calendar table, slot generation | **YES** |
| SHP-15 | Live ETA on the storefront tracking page, driven by driver lat/lng | S | feature | DIFFERENTIATOR | SHP-5 or Slider (exists) | tracking page, a polling endpoint | **YES** |
| SHP-16 | Free-shipping-threshold progress bar in the cart | S | feature | TABLE STAKES | SHP-1 | cart component | **YES** |
| SHP-17 | Address validation / normalisation for UAE addresses (Makani numbers, building names) | M | integration | DIFFERENTIATOR | Maps (exists) | checkout, address book | LATER |
| SHP-18 | Ship-from-store routing — pick the outlet with stock closest to the customer | M | infra | DIFFERENTIATOR | ORD-1, SHP-1 | order creation outlet selection | **YES** |

### SHP-1 — In detail, because it is nearly free

`common/geo.ts` already exists with a spec file. `deliveryzone` already has `lat`,
`lng`, `radiusKm`. Checkout already collects a customer lat/lng via the shared
`MapPicker` and the Nominatim proxy. The admin already renders a draggable pin and a
sized circle. Everything is in place except the twenty lines that compute a haversine
distance and compare it to the radius.

What that unlocks immediately: correct zone selection instead of a string compare
(which today silently falls back to an emirate-level zone on any name mismatch,
meaning a merchant with per-area fees is charging the wrong fee routinely);
out-of-range rejection at checkout instead of a failed delivery; and a distance band
fee model (first 5km flat, then per-km), which is what every merchant in this segment
actually wants.

Do haversine first and road distance never, unless a merchant complains — Dubai's
straight-line-to-road-distance ratio is high because of the creek and the highways,
but a per-km band tuned to that is cheaper and more predictable than a Distance Matrix
API bill on every checkout render.

### SHP-5 — Driver dispatch, in detail

The Slider integration solved "hand this to a courier". It did not solve the more
common case for this merchant base, which is a shop with two vans and three drivers.
Today those merchants coordinate by WhatsApp and a printed list, and the platform
knows nothing about it — which means every delivery-related report, ETA and proof of
delivery is missing for the majority of their orders.

Shape:

- `driver` (`shopId`, `outletId`, `name`, `phone`, `vehicleType`, `active`) — a real
  entity, not a `user`, because drivers do not need admin access. Authentication is a
  magic link to a phone number, not a password.
- `deliveryrun` (`shopId`, `outletId`, `driverId`, `date`, `slot`, `status`) with
  ordered `deliveryrunstop` rows pointing at orders.
- A mobile-web driver view (no app store, no build pipeline — a PWA route on the
  storefront domain or a `/driver` route on the admin) showing today's run, one stop
  at a time, with navigate / call customer / mark delivered / capture proof.
- Every status change writes to the order's timeline and fires the customer
  notification that already exists for `out_for_delivery` and `delivered`.
- COD collection per stop, reconciled against the existing `cashCollectedAt` /
  `cashCollectedBy` columns — which currently only Slider satisfies.

This is the feature that turns Requital from "a shop website" into "how the shop
runs", and it is the strongest argument in the document for why a merchant would not
just use Shopify plus a courier app.

---

## 2.9 Analytics, reporting, forecasting

**The read.** Reporting is four fixed reports over raw order tables. The most
valuable single number a retail merchant needs — gross margin — is computable from
data already in the database (`product.costPrice`, `ingredient.costPerUnit`,
`orderitem.priceAtPurchase`) and is computed nowhere. Everything downstream of that
(profitability by product, by collection, by channel, by customer) is therefore also
absent.

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **ANL-6** | **Margin and profitability reporting** — per order, product, collection, channel, customer, outlet | **M** | feature | TABLE STAKES | `costPrice` exists; INV-6 improves accuracy | `orderitem.unitCost` captured at order time, report queries | **YES — early** |
| ANL-1 | A nightly rollup layer (`dailyshopmetrics`, `dailyproductmetrics`, `customermetrics`) so dashboards stop scanning `order` | M | infra | TABLE STAKES | none | new rollup tables, a cron job, dashboard/report reads | **YES** |
| ANL-2 | Cohort retention (by first-order month, by acquisition channel) | M | feature | TABLE STAKES | ANL-1 | a cohort query + a heatmap UI | **YES** |
| ANL-3 | Conversion funnel and session analytics | M | feature | TABLE STAKES | MKT-4 | event ingestion or GA4 embed | **YES** |
| ANL-4 | Custom report builder (pick dimensions, measures, filters; save; schedule) | L | feature | DIFFERENTIATOR | ANL-1 | a query builder over the rollups | LATER |
| ANL-5 | Scheduled report emails (daily sales summary at close, weekly digest) | S | feature | TABLE STAKES | job queue (exists) | a schedule table + a render + send | **YES** |
| ANL-7 | Demand forecasting per product per outlet (seasonality + trend), feeding INV-5 reorder suggestions | L | feature | DIFFERENTIATOR | ANL-1 | a forecasting job; simple exponential smoothing before anything fancier | **YES** |
| ANL-8 | Inventory analytics — sell-through, days of cover, dead stock, ABC classification | S | feature | TABLE STAKES | ANL-1 | queries | **YES** |
| ANL-9 | Real-time "today" dashboard (live orders, revenue, slots filling, staff activity) | S | feature | DIFFERENTIATOR | none | polling over existing queries | **YES** |
| ANL-10 | Benchmarking — anonymised comparison against similar shops on the platform | M | feature | DIFFERENTIATOR | ANL-1, **§13.1 ToS revision live (D12)** | a cross-tenant aggregate with a hard k-floor of 10 | **YES** |
| ANL-11 | Export any report to CSV/XLSX server-side (the current four buttons serialise loaded rows only) | S | feature | TABLE STAKES | none | streaming export endpoints | **YES** |
| ANL-12 | Attribution beyond affiliate — first/last touch from UTM, per-channel ROAS | M | feature | TABLE STAKES | MKT-14, MKT-4 | order attribution columns, a report | **YES** |
| ANL-13 | Anomaly alerts (revenue down 40% day-on-day, a product suddenly out of stock, refund spike) | M | feature | DIFFERENTIATOR | ANL-1 | a detection job + notifications | **YES** |
| ANL-14 | Staff productivity reporting (orders processed, prep time, per-user) | S | feature | DIFFERENTIATOR | `auditlog` exists | queries over `auditlog` + status timestamps | LATER |
| ANL-15 | Basket analysis / frequently-bought-together, feeding CAT-5 | M | feature | DIFFERENTIATOR | ANL-1 | a co-occurrence job | **YES** |
| ANL-16 | P&L view — revenue minus COGS minus delivery cost minus gateway fees minus discounts | M | feature | DIFFERENTIATOR | ANL-6, PAY-16 | a report combining existing data | **YES** |

### ANL-6 — Margin, in detail

The one change that makes this possible and must happen before any of it:
**`orderitem` needs a `unitCost` column captured at order time.** Reading
`product.costPrice` at report time is wrong — it reports today's cost against last
month's sale, and it silently changes historical reports whenever a merchant edits a
cost. Capture it at order creation, the same way `priceAtPurchase` already is, and the
whole domain becomes a set of ordinary queries.

For an ingredient-backed product, `unitCost` is `sum(quantityPerUnit × costPerUnit)`
over its BoM — which `consumeForOrderItems` already computes the quantity half of. For
a plain product it is `product.costPrice`. For a bundle (CAT-4) it is the sum of
component costs.

Then: gross margin per line, per order, per product, per collection, per channel. Add
delivery cost (real, from `externaldelivery.price` for Slider or a per-run cost from
SHP-5) and gateway fees (from `paymenttransaction`, once PAY-16 captures them) and
ANL-16's P&L is the same query with two more subtractions.

The merchant-facing framing that makes this land: a "you are losing money on these
products" list. Every retail merchant has three or four SKUs they sell at a loss after
delivery cost and do not know it.

### ANL-1 — Rollups, in detail

Every dashboard and report query today scans `order` and `orderitem` directly with no
supporting aggregate. That is fine at the current merchant count and will not be at
10x, particularly because there is no archiving (ORD-8) and no partition strategy, so
the scanned range only grows.

Three tables, written by one nightly job plus an incremental catch-up:
`dailyshopmetrics` (`shopId`, `outletId`, `date`, orders, revenue, cogs, discount,
delivery, tax, new customers, returning customers), `dailyproductmetrics` (`shopId`,
`productId`, `outletId`, `date`, units, revenue, cogs, views once MKT-4 lands), and
`customermetrics` (`shopId`, `customerId`, first order, last order, order count, LTV,
predicted next order).

This is unglamorous and it is the prerequisite for ANL-2, ANL-7, ANL-8, ANL-10,
ANL-13, ANL-15, CUS-12 and CUS-13. It should be built once, early, and never thought
about again.
---

## 2.10 Multi-currency, multi-language, RTL, tax and e-invoicing

**The read.** The SRS named i18n + Arabic RTL and multi-currency as **launch scope**,
and the exact warning it gave — *"externalize ALL UI strings and make money
currency-aware from day one, retrofitting later is painful"* — is now the situation.
There is no i18n library, no RTL, no translation tables, no order currency column, and
a hardcoded UAE emirate list on a required order field. Everything in this section is
therefore either a §6 blocker or downstream of one. It is also, for a Gulf platform,
the single biggest addressable-market limiter in the document.

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **I18N-1** | **UI string externalisation + Arabic locale + full RTL** across storefront then admin | **XL** | infra | TABLE STAKES | §6-C | every component in both Next apps, `globals.css` logical properties, theme CSS vars | **YES** |
| **I18N-2** | **Content translation** — per-locale product name/description, collection, policy page, theme section text | **L** | feature | TABLE STAKES | I18N-1 | translation tables, every public read, an admin translation editor | **YES** |
| I18N-3 | Locale switcher on the storefront with `hreflang`, per-locale sitemaps and locale-prefixed URLs | M | feature | TABLE STAKES | I18N-1/2 | routing, SEO | **YES** |
| **I18N-4** | **Multi-currency** — order currency column, per-shop base currency, presentment currencies with rates, **per-currency minor units (KWD/BHD/OMR are three-decimal)** | **XL** | infra | TABLE STAKES | §6-D | every money column, every provider, every display | **DECIDED (D6): true multi-currency, committed. Moves to Phase 2a.** |
| **I18N-5** | **Tax classes + per-product tax behaviour** (wire `product.chargeTax`, add zero-rated/exempt, tax on delivery toggle) | **M** | infra | TABLE STAKES | none | `computeOrderTotals`, product form, invoice | **YES — early** |
| I18N-6 | Multi-country address model replacing the hardcoded `EMIRATES` const | M | infra | TABLE STAKES | §6-E | `order.emirate`, checkout, zones, reports | **YES** |
| **I18N-7** | **UAE FTA e-invoicing** (Peppol-based, phased mandate) — structured invoice, accredited service provider, archive | **XL** | integration | TABLE STAKES (becoming mandatory) | I18N-5, INV-6 | invoices module, a new ASP integration | **YES** (see §9) |
| I18N-8 | ZATCA Phase 2 e-invoicing for Saudi (QR, hash chain, cryptographic stamp, clearance) | XL | integration | TABLE STAKES for KSA | I18N-4, I18N-6 | invoices module | LATER |
| I18N-9 | Proper VAT invoice format — TRN, tax breakdown by rate, sequential numbering, Arabic bilingual | S | feature | TABLE STAKES | I18N-5 | invoice HTML template | **YES** |
| I18N-10 | Credit notes as a distinct, sequentially numbered document (a refund is not an invoice) | S | feature | TABLE STAKES | none | `invoice.type`, returns | **YES** |
| I18N-11 | Per-outlet timezone (today it is per-shop) | S | infra | — | none | slot generation, dashboard date maths | LATER |
| I18N-12 | Hijri calendar display alongside Gregorian | S | feature | DIFFERENTIATOR | none | date formatting utilities | **YES** |
| I18N-13 | Arabic-aware search (normalise alef/hamza/taa marbuta, strip diacritics) in both search modules | S | infra | DIFFERENTIATOR | none | `storefront-search`, `search` normalisation (`common/normalize.ts` exists) | **YES** |
| I18N-14 | Arabic OCR in the scan module (`tesseract.js` is loaded with `'eng'` only) | S | integration | DIFFERENTIATOR | none | one-line worker language change + parser tolerance | **YES** |
| I18N-15 | Arabic-first font stack and typographic scale in the theme system | S | feature | TABLE STAKES | I18N-1 | theme typography pairings | **YES** |

### I18N-1 — RTL, in detail, and why it is not just a `dir` attribute

The storefront has ~90 components, a hand-built design-token layer with
`--motion-*` travel distances, `--theme-round-*` radii, a stagger system with
`:nth-child` rules, and a header/footer preset model with `rows[]` arrangements.
Every one of those has a directional assumption.

The realistic plan, in the order that actually works:

1. **Logical properties sweep first.** Replace `ml-*`/`mr-*`/`pl-*`/`pr-*`/`left-*`/
   `right-*`/`text-left`/`text-right` with their logical equivalents
   (`ms-*`/`me-*`/`ps-*`/`pe-*`/`start-*`/`end-*`/`text-start`/`text-end`) across
   both Next apps. Tailwind v4 supports these natively. This is mechanical, testable,
   and produces zero visual change in LTR — which makes it exactly the kind of
   byte-identical-no-op change the theme engagement's convention 2 already
   establishes as the working standard here.
2. **Directional motion tokens.** `--motion-slide-distance` and every `translateX`
   in `globals.css` and the entrance-animation classes need a sign flip under RTL.
   One `[dir="rtl"]` block that negates the X-axis tokens covers most of it.
3. **The string extraction.** `next-intl` is the right choice for Next 16 App Router.
   It is one new dependency per app and it is worth it — the alternative is a
   hand-rolled dictionary that will be reinvented worse.
4. **Admin last.** Merchant staff in this segment are overwhelmingly comfortable in
   English; shoppers are not. Storefront Arabic is a revenue feature, admin Arabic is
   a sales feature. Sequence accordingly.
5. **The em-dash rule** in `CLAUDE.md` applies to English copy. Arabic copy needs its
   own review pass — still open (§9.3), because it needs a native reviewer, not an
   engineering decision.

Note the one thing already right: `outlet.nameAr` exists, which means somebody
anticipated this. It is currently the only Arabic-aware column in the schema.

### I18N-5 — Tax classes, in detail

The smallest high-value item in this section, and it fixes a live correctness bug.

Today: one shop-level `taxRate`, applied to the entire goods subtotal, never to
delivery, ignoring `product.chargeTax` entirely. A UAE merchant selling anything
zero-rated or exempt (some food items, certain healthcare and education goods, exports)
overcharges VAT and files a wrong return.

Shape: `taxclass` (`shopId`, `name`, `rate`, `type` — `standard` / `zero` / `exempt` /
`out_of_scope`), `product.taxClassId` nullable defaulting to the shop's standard class,
and `shop.taxOnDelivery` boolean. `computeOrderTotals` becomes a per-line computation
grouped by class, returning a breakdown rather than one number. `orderitem` gains
`taxRate` and `taxAmount` captured at order time, which is also what I18N-9's proper
VAT invoice needs and what I18N-7's e-invoicing will require.

`product.chargeTax` maps cleanly onto this: unticked ⇒ the zero/exempt class. So the
dead column becomes the migration source rather than being deleted.

### I18N-7 — UAE e-invoicing, in detail

This is on the YES list not because merchants want it but because it is becoming
mandatory. The UAE's FTA e-invoicing programme is Peppol-based (a five-corner model),
requires an Accredited Service Provider, and phases in by taxpayer size. Any platform
issuing tax invoices on behalf of UAE merchants will need to either integrate an ASP
or hand merchants a compliant export.

What the current invoice module lacks for this, concretely: structured line-level tax
(I18N-5), a stable seller/buyer identification scheme, a document-type distinction
between invoice and credit note (I18N-10), an immutable archive of issued documents
(today `invoice` regenerates HTML from live order data at request time — **the invoice
is not a snapshot**, so editing an order changes its already-issued invoice), and an
integration point for an ASP.

The "invoice is not a snapshot" issue is worth calling out separately in §7. It is a
correctness problem today, independent of e-invoicing: an order edited after the
invoice was emailed will serve a different document at the same invoice number.

**This one needs a business decision (§9):** integrate an ASP directly, or ship a
compliant export and let merchants use their own accountant's ASP. The first is a
differentiator and a real cost; the second is a week of work and covers the obligation.

---

## 2.11 Staff, roles, permissions, audit, approvals

**The read.** The permission architecture is better than the permission *coverage*.
The intersection model is genuinely sound and cannot escalate; it just governs ten
permissions across eight modules, outlet-scoped only, with everything else being
admin-or-nothing. For a shop with more than a handful of staff — which is the segment
the multi-outlet work was built for — that is the binding constraint.

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **STF-1** | **Expand `ALL_PERMISSIONS` to full module coverage** and support shop-wide custom roles, not just per-outlet overrides | **M** | infra | TABLE STAKES | none | `permissions.ts`, `branchrole` generalised to `role`, every controller's `@Roles` | **YES** |
| STF-2 | Approval workflows — refunds over X, discounts over Y%, stock write-offs, price changes | M | feature | DIFFERENTIATOR | STF-1 | an `approvalrequest` entity, a gate in the relevant services | **YES** |
| **STF-3** | **2FA (TOTP) on staff and platform-admin tiers**, enforceable per shop | **M** | infra | TABLE STAKES | none | auth service, login flow, a recovery-code path | **YES** |
| STF-4 | Active session list with remote revoke, per tier | S | infra | TABLE STAKES | `refreshtoken` exists | an account-security page, a revoke endpoint | **YES** |
| STF-5 | Password policy, breach-list check, and forced rotation on compromise | S | infra | TABLE STAKES | none | auth service | **YES** |
| STF-6 | SSO (Google Workspace / Microsoft) for merchant staff | M | integration | — | none | an OIDC path alongside password auth | LATER |
| STF-7 | Audit-log export, retention policy, and search across a wider action vocabulary | S | feature | TABLE STAKES | none | `auditlog` querying, an export endpoint | **YES** |
| STF-8 | Field-level audit diffing on the entities that matter (price, stock, discount, settings) | S | infra | TABLE STAKES | `auditlog.before`/`after` exist | more call sites writing to the existing shape | **YES** |
| STF-9 | Staff scheduling / shifts per outlet | M | feature | DIFFERENTIATOR | POS/§4 HR | a shift entity | LATER |
| STF-10 | Staff commission on sales (per user, per outlet, per product) | M | feature | DIFFERENTIATOR | ANL-6 | attribution on orders, a payout report | LATER |
| STF-11 | IP allowlist / device trust for admin access | S | infra | — | none | `AuthGuard` | NO |
| STF-12 | An "act as" read-only staff preview (see the admin as a `branch` user sees it) | S | feature | DIFFERENTIATOR | none | a scoped context override | LATER |
| STF-13 | Onboarding checklist and in-app guidance for new staff | S | feature | TABLE STAKES | none | an admin surface | **YES** |
| STF-14 | Enforce email verification before privileged actions (currently blocks only change-password) | S | infra | TABLE STAKES | none | `AuthGuard` or per-route decorator | **YES** |

### STF-1 — In detail

`branchrole` was built for a real, narrow need: restrict a staff member at one outlet.
It works, it is safe, and the intersection guarantee is the right design. The
limitation is structural: `useroutletrole` is keyed on `(userId, outletId)`, so there
is no way to express "this person can manage discounts across the whole shop but
cannot see reports".

The generalisation is small because the safety property is preserved by keeping the
intersection: add a nullable `outletId` to the assignment (NULL meaning shop-wide),
and keep `resolveEffectivePermissions` intersecting against `basePermissionsFor(role)`.
A shop-wide override then restricts globally rather than at one outlet, and the
"structurally incapable of granting" property is unchanged.

The larger half is coverage: `ALL_PERMISSIONS` needs entries for discounts, customers,
reports, settings, theme, draft orders, integrations, invoices, returns, gift cards,
affiliates and staff management — roughly 30 permissions rather than 10 — and every
corresponding controller needs `assertPermission` at the same call sites `@Roles`
currently guards. The existing e2e pattern in `branch-roles.e2e-spec.ts` (adversarial
escalation attempts) is the template to extend, and it should be extended in the same
PR, not after.

---

## 2.12 Merchant onboarding and migration

**The read.** Signup is a polished wizard. Migration does not exist. For a platform
competing against incumbents, migration *is* acquisition — every merchant Requital
wins is a merchant leaving Shopify, Salla, Zid or WooCommerce, and today that move
means re-entering a catalog by hand and losing every inbound link.

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **ONB-1** | **Shopify importer** — products, variants, images by URL, collections, customers, orders, redirects | **L** | integration | TABLE STAKES | CAT-1 for unmapped fields | a new import module, the job queue for long-running work | **YES** |
| ONB-2 | Salla and Zid importers | M each | integration | TABLE STAKES | ONB-1's framework | per-platform mappers | **YES** |
| ONB-3 | WooCommerce importer (REST API or a WXR file) | M | integration | TABLE STAKES | ONB-1's framework | a mapper | LATER |
| **ONB-4** | **URL redirect map** — import old URLs, 301 them, so SEO survives the move | **S** | infra | TABLE STAKES | none | a `urlredirect` table, `proxy.ts` lookup | **YES** |
| ONB-5 | Image import by URL (fetch, sniff, resize, store) as a shared importer primitive | S | infra | TABLE STAKES | storage (exists) | a job type | **YES** |
| ONB-6 | Import dry-run with a diff report before committing | S | feature | TABLE STAKES | ONB-1 | the existing preview/confirm pattern generalised | **YES** |
| ONB-7 | Guided setup checklist with real completion detection (products added, payment connected, domain verified, theme published, policies written) | S | feature | TABLE STAKES | `publish-readiness` exists | expand it into a real checklist UI | **YES** |
| ONB-8 | Demo/sample data a merchant can install and then wipe | S | feature | TABLE STAKES | seed script exists | a per-shop seed + a clean teardown | **YES** |
| ONB-9 | Migration concierge tooling for Requital staff (run an import on a merchant's behalf from the platform admin) | S | feature | DIFFERENTIATOR | ONB-1 | a platform-admin surface | **YES** |
| ONB-10 | Export everything — a merchant's full data as a portable archive | M | infra | TABLE STAKES | none | streaming exports per entity | **YES** |
| ONB-11 | Theme migration assistance (screenshot a merchant's old store, propose a starter template) | M | feature | MOONSHOT | AI-4 | vision model + theme templates | LATER |
| ONB-12 | Trial-to-paid onboarding flow | S | feature | TABLE STAKES | PLT-1 billing | billing | **YES** |

### ONB-4 — Redirects, in detail, and why it is an S that punches far above its weight

A merchant with three years of Google rankings moves to Requital and every product URL
404s. Their organic traffic — usually their cheapest channel — goes to zero for weeks
or permanently. This is the single most common reason a platform migration is judged a
failure by the merchant, and it costs almost nothing to prevent.

`urlredirect` (`shopId`, `fromPath`, `toPath`, `statusCode`, `hits`, `lastHitAt`).
`storefront/proxy.ts` already runs on every request and already does a backend lookup
with a 30s cache for domain resolution — the redirect lookup rides the same path with
the same cache shape. The importer populates it from the source platform's handles;
the merchant can also upload a CSV or add entries by hand.

Add the reverse too: a 404 log, so a merchant can see which missing URLs are actually
being requested and create redirects for them. That is another S and it turns a
one-time migration tool into an ongoing SEO feature.

---

## 2.13 The platform layer — billing, plans, limits, apps, API

**The read.** This is the biggest gap in the product by commercial impact. There is a
multi-tenant SaaS with live paying-in-principle merchants and no mechanism to charge
any of them, no plan structure, no limits, no metering, and no way for anyone outside
the Requital team to build anything on it. Every item here is infrastructure, and the
first one is not optional if this is a business.

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **PLT-1** | **Billing** — plans, subscriptions, trials, proration, invoices, payment method on file, dunning, suspension on non-payment | **XL** | infra | TABLE STAKES | Stripe (exists), PAY-2 vaulting patterns | new `plan`/`shopsubscription`/`platforminvoice`, a billing module, an admin billing page, platform-admin revenue views | **YES — foundational** |
| **PLT-2** | **Plan limits and metering** — products, orders/month, staff, outlets, storage, API calls, with soft warnings and hard caps | **M** | infra | TABLE STAKES | PLT-1 | a limits service consulted at each create path, a usage rollup | **YES** |
| PLT-3 | Self-serve plan upgrade/downgrade with immediate effect and correct proration | M | feature | TABLE STAKES | PLT-1 | billing | **YES** |
| **PLT-4** | **Public REST API for merchants** with scoped API keys, rate limits per key, and versioning | **L** | infra | TABLE STAKES | STF-1 permissions | an `apikey` table, a key guard alongside `AuthGuard`, per-key throttling, docs | **YES** |
| **PLT-5** | **Outbound webhooks** — merchant-registered endpoints, signed payloads, retries with backoff, a delivery log, replay | **M** | infra | TABLE STAKES | job queue (exists) | a `webhooksubscription` table, an event emitter at every domain mutation, a delivery job | **YES** |
| PLT-6 | Rename the Integrations "Webhooks" tab, which today shows *inbound* diagnostics under a name every merchant reads as *outbound* | S | feature | TABLE STAKES | none | one admin label | **YES — now** |
| PLT-7 | App/extension model — OAuth install, scoped tokens, an app-defined settings surface, app metafields | XL | infra | MOONSHOT | PLT-4, CAT-1 | an app registry, OAuth server, admin embedding | LATER |
| PLT-8 | Theme marketplace / third-party theme submission | L | infra | MOONSHOT | PLT-7 | a theme package format, review pipeline | NO |
| PLT-9 | Partner / agency tier — one login managing many merchant shops, agency billing | M | feature | DIFFERENTIATOR | PLT-1 | a `partner` entity above shop, a shop switcher | **YES** |
| PLT-10 | Platform-side revenue and cohort reporting (MRR, churn, ARPU, activation) | M | feature | TABLE STAKES | PLT-1 | platform-admin analytics | **YES** |
| PLT-11 | Feature flags per shop / per plan, replacing the ad-hoc `shop.xEnabled` boolean pattern | S | infra | TABLE STAKES | none | a flags table + a resolver; migrate the existing booleans onto it | **YES** |
| PLT-12 | Sandbox/test mode per shop (test payments, test orders, no real emails) | M | infra | TABLE STAKES | PLT-4 | a mode flag threaded through payments and notifications | LATER |
| PLT-13 | Developer documentation site and an OpenAPI spec generated from the Nest DTOs | S | infra | TABLE STAKES | PLT-4 | `@nestjs/swagger` decorators | **YES** |
| PLT-14 | Platform status page and incident communication | S | infra | TABLE STAKES | OPS monitoring | a public status endpoint | **YES** |
| PLT-15 | Merchant-facing changelog and in-app release notes | S | feature | TABLE STAKES | none | a static content surface | **YES** |
| PLT-16 | Pagination on `GET /platform-admin/shops` and every other unbounded platform list | S | infra | TABLE STAKES | none | the platform-admin service | **YES — now** |

### PLT-1 — Billing, in detail

The mechanics are the least interesting part; the decisions are the hard part, and
they belong in §9. Mechanically:

- `plan` (`code`, `name`, `monthlyPrice`, `annualPrice`, `currency`, `limitsJson`,
  `featuresJson`, `active`) — platform-owned, not per-shop.
- `shopsubscription` (`shopId`, `planId`, `status`, `trialEndsAt`,
  `currentPeriodStart/End`, `stripeCustomerId`, `stripeSubscriptionId`,
  `cancelAtPeriodEnd`).
- Stripe Billing does the heavy lifting — subscriptions, proration, invoices, dunning,
  hosted payment-method collection, and the customer portal. Do not build an invoicing
  engine; the platform already integrates Stripe and this is exactly what Stripe
  Billing is for. The webhook handling pattern (`paymenttransaction` unique-constraint
  idempotency) transfers directly.
- Suspension on non-payment reuses the existing `shop.suspendedAt` mechanism, which is
  already enforced at three choke points and already has a merchant-facing story. That
  is a genuine piece of luck: the hardest part of billing enforcement is already built
  for a different reason.

Two things worth getting right at the start because they are painful later: **usage
must be metered from day one even if nothing is charged for it** (order count per
month per shop is a rollup ANL-1 is building anyway), and **grandfathering must be a
first-class concept** — the existing live merchants cannot be moved onto a paid plan
retroactively without a decision, so `shopsubscription` needs to express "legacy, free,
indefinite" without special-casing it in code.

### PLT-4 / PLT-5 — API and webhooks, in detail

These two are a pair and should ship together, because a public API without webhooks
forces every integrator to poll, and webhooks without an API give them nothing to do
with the notification.

**API keys.** `apikey` (`shopId`, `name`, `hashedKey`, `scopes` JSON, `lastUsedAt`,
`expiresAt`, `revokedAt`) — hashed with the same `common/token-hash.ts` used for
refresh tokens. A second guard alongside `AuthGuard` resolving a key to a
`TenantContext` with `role: 'api'` and the key's scopes, running through the *same*
`resolveOutletFilter` and permission machinery. That is the important design point:
the API must not be a second authorisation path (the codebase's own
"payment provider toggle-bypass" lesson, generalised) — it must resolve to the same
`TenantContext` shape every existing guard already produces.

**Webhooks.** Event emission at every domain mutation is the invasive part. The cheap
version that is right for this codebase: emit from the same places `AuditLogService.log`
is already called, since those are already the meaningful state-change points. A
`webhookdelivery` row per attempt, signed with an HMAC of the body plus a timestamp,
retried by the existing job queue with exponential backoff, with a delivery log and a
manual replay in the admin.

Ship a small, honest event set first — `order/created`, `order/updated`,
`order/fulfilled`, `order/cancelled`, `product/created`, `product/updated`,
`inventory/changed`, `customer/created` — rather than a comprehensive one nobody
consumes.

---

## 2.14 Operational maturity

**The read.** For a single-VPS deployment this is better instrumented than most, and
it has exactly the gaps a single-VPS deployment always has: one machine, one database,
no replica, no scheduled backup, no monitoring, and a manual deploy. The live-merchant
count makes each of those a real risk rather than a theoretical one.

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **OPS-1** | **Scheduled, verified, off-host backups** with a documented restore drill | **S** | infra | TABLE STAKES | `tools/backup-db.sh` exists | a cron + object storage + a restore test | **YES — now** |
| **OPS-2** | **Uptime and error alerting** that reaches a human (the error webhook currently reaches nothing defined) | **S** | infra | TABLE STAKES | error-tracking provider (exists) | point it at Sentry or a paging tool | **YES — now** |
| OPS-3 | Metrics and dashboards (request rate, p95 latency, error rate, job queue depth and age, DB connections) | M | infra | TABLE STAKES | none | a metrics endpoint + a collector | **YES** |
| OPS-4 | A staging environment mirroring production | M | infra | TABLE STAKES | none | infra | **YES** |
| OPS-5 | Automated deploys (CI → build → migrate → restart → health check → rollback on failure) | M | infra | TABLE STAKES | OPS-4 | a workflow | **YES** |
| OPS-6 | MySQL read replica and connection-pool tuning | M | infra | TABLE STAKES | infra | `DatabaseService` read/write split | LATER |
| OPS-7 | CDN in front of the storefront and uploaded media | S | infra | TABLE STAKES | S3 provider (exists) | Cloudflare in front of Caddy; media to a CDN origin | **YES** |
| OPS-8 | Slow-query logging and an index review pass | S | infra | TABLE STAKES | none | MySQL config + a review | **YES** |
| OPS-9 | Per-tenant rate limits and quotas (today throttling is per-IP only) | M | infra | TABLE STAKES | PLT-2 | the throttler guard keyed on shopId | **YES** |
| OPS-10 | Abuse handling on open signup — email verification gate, disposable-domain blocking, signup velocity limits | S | infra | TABLE STAKES | STF-14 | signup path | **YES** |
| OPS-11 | Job queue observability — depth, age, failure rate, dead-letter review, and alerting on backlog | S | infra | TABLE STAKES | jobs (exists) | the existing failed-jobs page extended | **YES** |
| OPS-12 | Data retention and purge jobs (abandoned carts, webhook events, audit logs, expired tokens) | S | infra | TABLE STAKES | none | sweep jobs | **YES** |
| OPS-13 | Multi-process / horizontal scaling readiness review (the job worker and crons already lock; confirm the rest) | S | infra | TABLE STAKES | none | an audit + `scheduledjoblock` coverage | **YES** |
| OPS-14 | Disaster recovery plan with a stated RPO/RTO and a tested runbook | S | infra | TABLE STAKES | OPS-1 | docs + a drill | **YES** |
| OPS-15 | Secrets management beyond a `.env` file on the box | M | infra | TABLE STAKES | none | infra | LATER |
| OPS-16 | Per-tenant data export/deletion for PDPL/GDPR requests at the *shop* level (customer-level exists) | S | infra | TABLE STAKES | ONB-10 | export/purge | **YES** |
| OPS-17 | Load testing and a documented capacity model | M | infra | TABLE STAKES | OPS-3 | a test harness | LATER |

### OPS-1 and OPS-2, in detail, because they are the two that would hurt most

There are live merchants on custom domains. The database is backed up by a script that
nothing runs, on a single VPS, with no replica. The restore path has never been
exercised against a real backup. If that machine's disk fails tonight, the recovery
position is "whatever was in `./backups` on the same failed disk", which is nothing.

Both fixes are hours, not days:

- A cron running `tools/backup-db.sh`, piping to an S3-compatible bucket (the S3
  storage provider already exists and the credentials pattern is already established),
  with a retention policy and a monthly restore drill into a scratch database. The
  runbook already documents restore; what is missing is that anything actually runs it.
- `ERROR_TRACKING_WEBHOOK_URL` pointed at something that pages a person. The provider
  abstraction is built; the destination is unset.

Also worth fixing in the same pass: `docs/runbook.md` still instructs
`npx prisma migrate status` / `prisma migrate deploy` for post-restore reconciliation.
The backend migrated off Prisma; migrations now run through `scripts/migrate.ts`
against a plain `_migrations` table. Following the runbook as written during an actual
incident would fail confusingly at exactly the wrong moment.

---

## 2.15 Content

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **CNT-1** | **Arbitrary CMS pages** — merchant-authored pages at chosen URLs, rendered through the existing theme-section engine | **M** | feature | TABLE STAKES | theme sections (exist) | a `page` model reusing `ThemeConfig` sections, routing, menu targets | **YES** |
| CNT-2 | Blog with categories, tags, author, scheduling, RSS and SEO | M | feature | TABLE STAKES | CNT-1 | an `article` model + theme sections | **YES** |
| CNT-3 | Media library (same item as CAT-12) | M | feature | TABLE STAKES | storage (exists) | `mediaasset` + a picker | **YES** |
| CNT-4 | Content scheduling and draft/publish for pages and articles | S | feature | TABLE STAKES | CNT-1 | publish state + a sweep | **YES** |
| CNT-5 | Reusable content blocks / snippets shared across pages | S | feature | DIFFERENTIATOR | CNT-1 | a block library in the theme editor | LATER |
| CNT-6 | Menu targets for pages and articles (the menu today targets collections only) | S | feature | TABLE STAKES | CNT-1 | `menuitem` target types | **YES** |
| CNT-7 | Policy pages beyond the five fixed types (shipping-country-specific, B2B terms, care guides) | S | feature | TABLE STAKES | CNT-1 | CNT-1 supersedes the fixed-type model | **YES** |
| CNT-8 | Extend the theme builder's TipTap editor (landed 2026-09-08 for `rich_text` / `image_text` blocks) to every other rich-text surface: product descriptions, policy pages, collection descriptions, email bodies | S | feature | TABLE STAKES | TipTap (now a dep) | ProductForm, policy pages, CNT-1/CNT-2 | **YES** |
| CNT-9 | Care guides / how-to content linked from products (a florist's highest-intent SEO surface) | S | feature | DIFFERENTIATOR | CNT-2, CAT-1 | article↔product linking | **YES** |
| CNT-10 | Lookbooks / shoppable galleries | M | feature | DIFFERENTIATOR | CNT-1 | a theme section with product hotspots | LATER |

CNT-1 is the enabling item and it is cheaper than it looks: the theme engine already
renders an ordered list of typed sections from a JSON config with a draft/published
split and an undo history. A `page` is that same config with a slug and a title. The
`policypage` five-fixed-types model then becomes a seeded special case of it rather
than its own subsystem.

---

## 2.16 Mobile

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| MOB-1 | Storefront PWA — manifest, service worker, installable, offline product browsing | M | feature | DIFFERENTIATOR | none | storefront app shell, caching strategy | **YES** |
| MOB-2 | Web push notifications for order status (shopper) and new orders (merchant) | M | integration | DIFFERENTIATOR | MOB-1 | a push subscription table, VAPID, a send job | **YES** |
| **MOB-3** | **Merchant PWA** — the admin's five real mobile jobs: new-order alerts, order status advance, stock check/adjust, camera barcode scan, camera receipt scan | **M** | feature | DIFFERENTIATOR | none | a focused mobile route set in the admin, `BarcodeDetector` / `getUserMedia` | **YES** |
| MOB-4 | Driver PWA (part of SHP-5) | M | feature | DIFFERENTIATOR | SHP-5 | a driver route set | **YES** |
| MOB-5 | Native merchant app (iOS/Android) | XL | feature | — | MOB-3 proving demand | a whole new build pipeline | NO |
| MOB-6 | Native customer app per merchant | XL | feature | — | — | white-label app pipeline | NO |
| MOB-7 | Camera-based stock-in replacing the current file upload in `scan/` | S | feature | DIFFERENTIATOR | MOB-3 | the scan page's input | **YES** |
| MOB-8 | Offline-capable order taking for a market stall / event with sync on reconnect | L | feature | MOONSHOT | POS (§5) | a local queue + conflict resolution | LATER |

MOB-5 and MOB-6 are NO for a reason worth stating: a native app for this merchant
segment is a distribution cost with no capability payoff that a PWA does not deliver,
and it introduces app-store review as a dependency on every release. The one genuine
native-only capability that matters — reliable push on iOS — has been available to
installed web apps since iOS 16.4. Revisit only if a merchant's own customers demand a
branded app, which is MOB-6 and a different business.

---

## 2.17 AI — where it genuinely helps

**The read.** The temptation in this category is a chat widget and a "generate
description" button, both of which are decoration. The places where a model earns its
cost here are the ones with a tedious, high-volume, low-stakes human task and a
verifiable output — and this codebase has several, one of which is already half-built.

| ID | Proposal | Effort | Type | Class | Depends on | Touches | Ship |
|---|---|---|---|---|---|---|---|
| **AI-1** | **Upgrade the OCR scan flow to a vision model** — read a photographed supplier invoice in Arabic or English, extract line items with quantities and prices, match to catalog | **M** | integration | DIFFERENTIATOR | scan (exists) | swap/augment `OcrService`, keep `fuzzy-match` as the fallback | **YES** |
| AI-2 | Catalog enrichment — generate descriptions, meta titles, alt text and attribute values from an image plus a name, as *drafts* the merchant approves | M | integration | TABLE STAKES | none | a product-form action, a bulk queue | **YES** |
| AI-3 | Product image cleanup — background removal, consistent crop, upscale | M | integration | DIFFERENTIATOR | storage (exists) | an upload post-process | **YES** |
| AI-4 | Migration mapper — take an arbitrary competitor CSV and map its columns to Requital's importer schema | M | integration | DIFFERENTIATOR | ONB-1 | importer | **YES** |
| AI-5 | Natural-language reporting ("what were my best sellers in Ramadan last year") over the ANL-1 rollups | M | feature | DIFFERENTIATOR | ANL-1 | a constrained query generator over a fixed schema | **YES** |
| AI-6 | Demand forecasting assist — explain the forecast, flag anomalies in plain language | M | feature | DIFFERENTIATOR | ANL-7 | a narration layer | LATER |
| AI-7 | Customer support draft replies over the order context | M | feature | TABLE STAKES | CUS-17 inbox | an inbox surface | LATER |
| AI-8 | Arabic ↔ English content translation as a first-pass draft for I18N-2 | S | integration | DIFFERENTIATOR | I18N-2 | the translation editor | **YES** |
| AI-9 | Theme generation from a brand brief or a reference image | M | feature | MOONSHOT | theme templates (exist) | a `ThemeConfig` generator constrained to the validated shape | LATER |
| AI-10 | Semantic product search on the storefront (replacing/augmenting the fuse.js fallback) | M | integration | DIFFERENTIATOR | embeddings storage | `storefront-search`, an embedding job | LATER |
| AI-11 | Fraud/risk scoring narration for COD orders | M | feature | DIFFERENTIATOR | ORD-15 | scoring | LATER |
| AI-12 | Chat assistant in the admin ("how do I set up delivery zones") | M | feature | — | docs corpus | a widget | NO |
| AI-13 | Customer-facing storefront chatbot | M | feature | — | — | a widget | NO |

### AI-1 — In detail, because it is the one with a working precedent in the repo

`scan/` already does the hard product work: an upload path, a preview/confirm flow,
fuzzy matching against the catalog, configurable include/exclude keywords, unmatched-row
behaviour, and a `scanbatch` audit trail. What it has is `tesseract.js` with the `eng`
language pack and a heuristic line parser — which means it fails on Arabic invoices
(most local flower-market suppliers), on handwritten delivery notes (also common), and
on any layout the heuristic parser was not tuned for.

A vision model call replaces `OcrService.recognize` plus `parseInvoiceText` with one
structured-output request returning `{ supplier, date, lines: [{ description, quantity,
unit, unitPrice }] }`. Everything downstream — matching, preview, confirm, audit —
stays exactly as built. Keep tesseract as the offline/failure fallback rather than
deleting it.

This is the highest-value AI item because the surrounding product is already finished,
the failure mode is a merchant editing a row in a preview screen they already use, and
it turns a feature that works for some invoices into one that works for most. Pair it
with INV-3 (match against an open PO) and the whole receiving loop closes.

### AI-2 — In detail, with the constraint that makes it not decoration

Generated descriptions are only useful under three rules: the output is a **draft** in
an editable field and is never auto-published; the generation is **bulk-capable**
(the merchant with 400 undescribed products is the one who needs it, not the one adding
their fifth); and it is **grounded in the merchant's own data** — the product's images,
name, attributes, collection, brand and metafields — rather than generic copy.

The bulk path routes through the existing job queue, which already has retries, an
idempotency key and a failed-jobs review page. CAT-20's catalog health score is the
natural entry point: "312 products have no meta description — generate drafts for all
of them" is a real, honest use of a model, and the review UI is a list with an approve
button.
---
---

# 3. REGIONAL / GULF-SPECIFIC OPPORTUNITIES

*The competitive set here is Salla, Zid, Dukan and Shopify's MENA presence. Salla and
Zid win on regional fit and lose on depth; Shopify wins on depth and loses on
regional fit. The gap between them is where a Gulf-native platform with a real
operations spine can live — and most of the items below are things Shopify structurally
will not build and Salla/Zid have not built well.*

Items already enumerated in §2 that are regionally load-bearing are cross-referenced,
not repeated.

## 3.1 Language, script and culture

| ID | Proposal | Effort | Type | Class | Ship |
|---|---|---|---|---|---|
| **GLF-1** | Arabic + full RTL storefront (= I18N-1/2/3/15) | XL | infra | TABLE STAKES | **YES** |
| GLF-2 | Arabic-aware search normalisation — alef/hamza forms (أ إ آ ا), taa marbuta vs haa (ة/ه), yaa forms (ي/ى), diacritic stripping, and Arabizi ("ward" → ورد) | S | infra | DIFFERENTIATOR | **YES** |
| GLF-3 | Bilingual product data with a per-field fallback (Arabic name, English description) rather than all-or-nothing locales | S | feature | DIFFERENTIATOR | **YES** |
| GLF-4 | Arabic OCR in the scan module (= I18N-14 / AI-1) | S | integration | DIFFERENTIATOR | **YES** |
| GLF-5 | Hijri calendar alongside Gregorian in the admin and on delivery dates | S | feature | DIFFERENTIATOR | **YES** |
| GLF-6 | Arabic-first typography in the theme system — Arabic display/body pairings, correct line-height for Arabic ascenders, and a `font-feature-settings` pass | S | feature | TABLE STAKES | **YES** |
| GLF-7 | Names and honorifics — a name model that handles Arabic naming conventions and a title field ("Sheikha", "Dr.") used on gift cards and invoices | S | feature | DIFFERENTIATOR | LATER |

**GLF-2 in detail.** This is a small change with an outsized effect on a
storefront's usable search. `common/normalize.ts` already exists and already has a
spec. Adding an Arabic normalisation pass (Unicode NFKD, strip combining marks,
fold alef/yaa/taa-marbuta variants) to both `storefront-search` and the admin `search`
module turns a search that fails on "ورد" typed with a different alef into one that
works. The Arabizi mapping is a second, optional layer — a small transliteration table
covering the ~30 flower and gift terms that matter, not a general system.

## 3.2 Payments and money

| ID | Proposal | Effort | Type | Class | Ship |
|---|---|---|---|---|---|
| **GLF-8** | **Cash on delivery as a first-class workflow**, not a payment method string — COD fee, COD risk rules, cash reconciliation per driver per day, partial cash, change management | **M** | feature | DIFFERENTIATOR | **YES** |
| GLF-9 | PayTabs, Telr, Network International (N-Genius), Checkout.com, MyFatoorah, HyperPay, Moyasar, Tap — pick the two that matter (= PAY-3) | M each | integration | TABLE STAKES | **YES** (pick 2) |
| GLF-10 | Tabby and Tamara **checkout** correctness pass — the PDP widget copy is currently ours, hardcoded, not the provider's own messaging (`CLAUDE.md` flags this as a compliance item) | S | integration | TABLE STAKES | **YES** |
| GLF-11 | Apple Pay and Google Pay (= PAY-1) — very high share in UAE/KSA | M | integration | TABLE STAKES | **YES** |
| GLF-12 | Mada (KSA), Benefit (BH), KNET (KW), NAPS/Meeza equivalents — the domestic debit schemes that dominate their markets | M each | integration | TABLE STAKES for those markets | LATER |
| GLF-13 | Bank transfer with a proof-of-payment upload and manual verification — still a real channel for corporate accounts | S | feature | TABLE STAKES | **YES** |
| GLF-14 | Multi-currency for GCC (AED/SAR/KWD/QAR/BHD/OMR), including the three-decimal currencies KWD, BHD and OMR | XL | infra | TABLE STAKES | LATER |

**GLF-14's hidden trap, worth stating now.** KWD, BHD and OMR are **three-decimal**
currencies. Every money column in this schema is a MySQL `DECIMAL` and every display
path assumes two decimals; `trimDecimal()` exists specifically because mysql2 returns
unannotated decimals at full precision. Any multi-currency work must decide minor-unit
handling per currency at the schema level, not at display. Getting this wrong produces
rounding errors in a Kuwaiti merchant's VAT return, which is the worst class of bug
this product could ship.

**GLF-8 in detail.** COD is the dominant payment method for a large share of orders in
this region, and today it is a string on `order.paymentMethod` plus two columns
(`cashCollectedAt`, `cashCollectedBy`) that only Slider's webhook ever satisfies. What
a merchant actually needs:

- A COD availability rule per zone and per order value (the Slider caps already encode
  a version of this — AED 350 for COD, AED 500 for card-on-delivery — but only for
  Slider dispatch, not for the merchant's own drivers).
- A COD surcharge (PAY-14) that most merchants charge and cannot today.
- Per-driver, per-day cash reconciliation: what was collected, what was banked, what
  is outstanding. This is SHP-5's driver model plus a cash ledger, and it is the thing
  that makes COD manageable rather than a source of shrinkage.
- COD risk rules: first-time customer + high value + no answered phone = require
  prepayment. This is ORD-15's scoring with a COD-specific action.
- Failed-delivery-with-cash handling: the order goes back, the cash never existed, and
  the status machine currently has no path for it (ORD-18).

No regional competitor does the reconciliation half. It is the difference between
supporting COD and operating COD.

## 3.3 Compliance and government

| ID | Proposal | Effort | Type | Class | Ship |
|---|---|---|---|---|---|
| **GLF-15** | UAE FTA e-invoicing (Peppol) (= I18N-7) | XL | integration | becoming mandatory | **YES** |
| GLF-16 | ZATCA Phase 2 for Saudi (= I18N-8) | XL | integration | mandatory in KSA | LATER |
| GLF-17 | Proper bilingual VAT invoice with TRN, rate breakdown and sequential numbering (= I18N-9) | S | feature | TABLE STAKES | **YES** |
| GLF-18 | UAE PDPL / KSA PDPL posture beyond the customer self-service already built — consent records, processing register, breach procedure, DPA templates for merchants | M | infra | TABLE STAKES | **YES** |
| GLF-19 | Trade licence capture and verification at merchant onboarding | S | feature | DIFFERENTIATOR | LATER |
| GLF-20 | Emirates ID / national address integration where a merchant needs verified identity (B2B, high-value) | M | integration | — | NO |
| GLF-21 | Arabic legal templates for the five policy pages, pre-written and jurisdiction-correct | S | feature | DIFFERENTIATOR | **YES** |

**GLF-18 note.** The customer-facing PDPL work already built (`customer-account`'s
rate-limited export and two-step anonymising deletion) is genuinely ahead of most
competitors. What is missing is the *merchant*-facing half: a merchant using Requital
is a data controller and Requital is a processor, and there is currently no DPA, no
processing register, no consent record on the customer row (CUS-11), and no
shop-level export/purge (OPS-16). This is cheap to close and it is the first thing a
corporate customer's procurement team will ask a merchant for.

## 3.4 Logistics

| ID | Proposal | Effort | Type | Class | Ship |
|---|---|---|---|---|---|
| GLF-22 | Regional courier integrations behind the existing provider interface — Careem Express, Talabat, Aramex, SMSA, Naqel, Fetchr, Quiqup, Lyve, Zajil (= SHP-9) | M each | integration | TABLE STAKES | **YES** (pick 2) |
| GLF-23 | UAE address reality — Makani numbers, building/villa names, "near the mosque" landmark directions as a structured field rather than free text | M | feature | DIFFERENTIATOR | **YES** |
| GLF-24 | Emirate/area taxonomy as real data instead of a hardcoded const and a free-text zone name (= I18N-6, SHP-1) | M | infra | TABLE STAKES | **YES** |
| GLF-25 | Cross-emirate delivery timing rules (Dubai→Abu Dhabi is a different promise than Dubai→Dubai) | S | feature | DIFFERENTIATOR | **YES** |
| GLF-26 | Friday/weekend model — the UAE moved to a Sat/Sun weekend in 2022, KSA and others differ; business-hours defaults and "next business day" maths must be per-country | S | infra | TABLE STAKES | **YES** |

**GLF-23 in detail.** UAE addresses do not have a reliable street-number-and-postcode
model. Real delivery instructions look like "Villa 12, behind Choithrams, Jumeirah 1,
gate on the side street". Today that all lands in one free-text `customerAddress`
string plus optional lat/lng from the map picker. Two cheap structural improvements:
capture the **Makani number** (Dubai's 10-digit geocode, which is on every building and
which every Dubai driver understands) as its own field, and split landmark directions
from the address line so they can be surfaced to a driver without cluttering the
invoice. Both are field additions plus a checkout change, and both materially reduce
failed deliveries.

## 3.5 Trading patterns and seasonality

This is the category most likely to be dismissed as soft and most likely to actually
move revenue for this merchant base.

| ID | Proposal | Effort | Type | Class | Ship |
|---|---|---|---|---|---|
| **GLF-27** | **Ramadan / Eid trading mode** — a saved bundle of hours, slots, capacity, banner, delivery cutoffs and campaign that a merchant enables once per season | **M** | feature | DIFFERENTIATOR | **YES** |
| GLF-28 | Prayer-time-aware slot generation (suppress or reduce slots across the five daily prayers; longer suppression at Friday Jumu'ah) | S | feature | DIFFERENTIATOR | **YES** |
| GLF-29 | Seasonal demand presets for the calendar that actually drives this business — Valentine's, Mother's Day (21 March in the Arab world, **not** the US/UK date), Eid al-Fitr, Eid al-Adha, National Day (2 Dec UAE, 23 Sep KSA), Teachers' Day, graduation season, wedding season | S | feature | DIFFERENTIATOR | **YES** |
| GLF-30 | Peak-day capacity mode — a merchant declares a peak day, and slot quotas, prep times, minimum order values and delivery fees all shift together | M | feature | DIFFERENTIATOR | **YES** |
| GLF-31 | Pre-order windows for peak days ("order by 10 Feb for Valentine's delivery") with hard cutoffs | S | feature | DIFFERENTIATOR | **YES** |
| GLF-32 | Weather-aware delivery advisories (a 48°C August afternoon is a real problem for fresh flowers) | S | integration | DIFFERENTIATOR | LATER |

**GLF-27/28/30 in detail.** A UAE florist's year is not a smooth curve. It is four or
five days that produce a disproportionate share of annual revenue, plus Ramadan, which
changes the *shape* of every day: shopping shifts to late evening, deliveries cluster
after iftar, and business hours change entirely. Today a merchant handles that by
manually editing business hours, slot gaps, preparation times and banners across four
different settings pages, then reverting them a month later, and inevitably forgetting
one.

A **trading mode** is a saved, named, dated bundle of overrides:
`tradingmode` (`shopId`, `name`, `startsAt`, `endsAt`, `overridesJson`) where the
overrides are a partial of the shop's own hours/slot/fee/capacity settings plus an
optional theme announcement and an optional discount activation. Applying it is a
merge; ending it restores. This is the same "optional keys, unset means unchanged"
pattern the theme system already uses, applied to operational settings instead of
visual ones — so the convention is already established in this codebase.

Prayer-time suppression (GLF-28) is a small, high-signal detail: slot generation
already runs through `backend/src/public/time-slots.ts` with a shop timezone and an
`Intl.DateTimeFormat` technique, so adding a prayer-time table (computed locally from
lat/lng with a standard algorithm — no API dependency needed) and a per-slot
suppression rule is a contained change. Whether a merchant *wants* it on is a setting,
not an assumption.

## 3.6 Channel

| ID | Proposal | Effort | Type | Class | Ship |
|---|---|---|---|---|---|
| ~~**GLF-33**~~ | ~~**WhatsApp commerce** — catalog sync, order-taking in-thread, payment link in-thread, order status in-thread~~ | L | integration | — | **DROPPED (D15)** |
| ~~GLF-34~~ | ~~WhatsApp as a marketing channel with template management (= MKT-6)~~ | L | integration | — | **DROPPED (D15)** |
| GLF-35 | Instagram/TikTok shopping feed (= MKT-11) | S | integration | TABLE STAKES | **YES** |
| GLF-36 | Talabat / Deliveroo / Careem marketplace listing sync for merchants who also sell there | L | integration | DIFFERENTIATOR | LATER |
| GLF-37 | Noon and Amazon.ae marketplace listing sync | L | integration | — | NO |
| GLF-38 | Snapchat commerce (disproportionately large in KSA) | M | integration | DIFFERENTIATOR | LATER |

> **DROPPED by D15 (2026-09-10).** Customer-facing WhatsApp is out of scope; the
> channel is platform-owned and merchant-facing only. The reasoning is in §11.6 — the
> short version is that every part of GLF-33 except catalog sync requires messaging
> *shoppers*, which requires a per-merchant WABA, which is exactly the onboarding
> friction D15 exists to avoid. The analysis below is left as written, because it is
> what a reversal would have to argue against. See §11 for what was built instead.

**GLF-33 in detail, because it is the highest-conviction regional bet in this
document.** In this region, a very large share of small-merchant commerce happens in a
WhatsApp thread, and the storefront is often the catalog the merchant links *into*
that thread. The product already has: a per-shop WhatsApp Business credential store
(encrypted), a platform-owned alerting account, a floating WhatsApp button on the
storefront, a `cartDisabledMode: 'contact_to_order'` mode that removes checkout
entirely in favour of WhatsApp, and a job queue for outbound sends.

What it does not have is the inbound half. The full version is:

1. **Catalog sync** — push products to the merchant's WhatsApp Business catalog so
   they are shareable in-thread as product cards.
2. **Inbound webhook** — receive messages, thread them against a `customer` by phone
   (which is already the customer's natural key — `[shopId, phone]`), and surface them
   in an admin inbox (CUS-17).
3. **In-thread ordering** — a merchant replies with a product card; the customer taps;
   a draft order is created; a payment link (already built, `/pay/:token`) is sent
   in-thread; paying converts the draft to a real order.
4. **Status updates in-thread** rather than by email, since the customer is already
   there.

Steps 2 and 3 are the differentiator. Nobody in this competitive set closes the loop
from a WhatsApp conversation to a real order with real stock decrement and a real
invoice — merchants do it manually, and every one of those orders is invisible to
their own reporting.

Note the constraint honestly: Meta's Business Messaging policy, 24-hour customer
service windows, and template pre-approval all shape what is possible, and the
per-merchant onboarding (each merchant needs their own WABA and phone number) is real
friction. **Decided (D15, 2026-09-10): neither — customer-facing WhatsApp is dropped
entirely.** See §11.6.
---
---

# 4. ODOO-ADJACENT / ERP-ADJACENT OPPORTUNITIES

*Why this section deserves real weight, and is not a name-drop.*

The merchant this product serves runs a shop, not a website. A UAE florist with two
branches, twelve staff, a van, a supplier in the Dubai Flower Centre and a corporate
account with a hotel is currently running: Requital (or a competitor) for the store,
a spreadsheet for purchasing, Zoho Books or a bookkeeper's Tally file for accounting,
WhatsApp for the sales pipeline, another spreadsheet for staff shifts, and a physical
notebook for the van. Odoo's actual pitch — and the reason it wins mid-market
customers from Shopify — is that those are one system.

Requital is unusually close to being able to make that pitch, and closer than any
regional competitor, for one specific reason: **it already has the two hardest ERP
pieces built.** A real per-location stock ledger with an append-only movement history,
and a real bill of materials. Those are the parts that are painful to retrofit. What
sits around them — purchasing, valuation, invoicing, a CRM pipeline, a project/event
model — is comparatively ordinary CRUD on top of a ledger that already exists.

The strategic framing worth being explicit about: **this is not a plan to build Odoo.**
It is a plan to absorb the ~15% of Odoo that a 5-to-50-person retail business actually
uses, so that the second system disappears. Every item below is scoped to that test —
"would this let a merchant cancel a subscription to something else" — and anything
that fails it is marked NO.

---

## 4.1 From Odoo Inventory

Odoo's inventory module is its strongest, and the gap between it and Requital's is the
purchasing and valuation half, already enumerated as INV-1 through INV-20. What is
*additionally* worth taking from Odoo specifically:

| ID | Proposal | Effort | Type | Class | Ship |
|---|---|---|---|---|---|
| **ERP-1** | **Double-entry stock moves** — every movement has a source and a destination location (including virtual locations: supplier, customer, scrap, inventory-adjustment), so stock is conserved and every discrepancy has a named counterparty | **M** | infra | DIFFERENTIATOR | **YES** |
| ERP-2 | Procurement rules — a per-product min/max per outlet that generates a replenishment suggestion or an inter-outlet transfer automatically (= INV-5 + INV-14) | M | feature | DIFFERENTIATOR | **YES** |
| ERP-3 | Delivery/receipt "operations" as documents distinct from the stock move itself (a picking that can be validated, partially validated, or cancelled) | M | feature | TABLE STAKES | LATER |
| ERP-4 | Units of measure with conversion (buy roses by the box of 20, sell by the stem, consume by the stem) | **S** | infra | DIFFERENTIATOR | **YES** |
| ERP-5 | Product routes (buy / make / dropship) as a per-product policy driving what replenishment does | M | infra | — | LATER |
| ERP-6 | Landed costs (= INV-19) | M | feature | DIFFERENTIATOR | LATER |
| ERP-7 | Inventory valuation with automated accounting entries (= INV-6 + ERP-13) | L | infra | TABLE STAKES | LATER |

**ERP-1 in detail — the single most valuable structural idea in this section.**

`stockmovement` today has `outletId`, an optional `toOutletId`, a `type`, a `reason`
and a signed `delta`. It records what happened but not where stock came from or went
to in the general case: a sale removes stock and the counterparty is implicit; a
write-off removes stock and the counterparty is nothing at all. That means stock is
not conserved in the ledger, and "where did 40 stems go" can only be answered by
reading `type`/`reason` strings.

Odoo's model is that every move is `from location → to location`, where locations
include **virtual** ones: `Vendors`, `Customers`, `Production`, `Scrap`,
`Inventory Loss`. A purchase is `Vendors → Stock`. A sale is `Stock → Customers`. A
bouquet assembly is `Stock → Production` and `Production → Stock`. A write-off is
`Stock → Scrap`. An adjustment is `Inventory Loss → Stock`. Now the sum of every move
across all locations is always zero, discrepancies are visible as movements into
`Inventory Loss`, and shrinkage reporting is a query rather than a heuristic.

The migration is additive and cheap because the current model is a strict subset:
add `sourceLocationId` and `destLocationId` to `stockmovement`, create one virtual
location set per shop plus one real location per outlet, and backfill from the existing
`type`/`outletId`/`toOutletId` triple. Every existing read keeps working off
`outletId`. What it unlocks: honest wastage reporting (INV-11), correct valuation
(INV-6), assembly orders (INV-13), consignment if ever wanted, and the accounting
export in ERP-13 — all of which are awkward or impossible without it.

**ERP-4 in detail.** Units of measure sound like bookkeeping and are, for this
merchant base, a daily operational problem. Roses arrive in boxes of 20 stems, are
priced per box by the supplier, consumed per stem by a bouquet's BoM, and counted per
bucket at stocktake. Today `ingredient.unit` is a free-text string and every quantity
is an integer in whatever unit somebody typed. A UoM table with a category (unit /
weight / length / volume) and a conversion factor to a category reference unit turns
"how many roses do I have" into a question with one answer. It is an S because the
consumption path (`consumeForOrderItems`) is a single well-factored place to apply the
conversion.

---

## 4.2 From Odoo Purchase

Fully covered by INV-1 (suppliers), INV-2 (purchase orders), INV-3 (OCR receipt
matching), INV-5 (reorder suggestions), INV-18 (price-change alerting) and INV-19
(landed cost). Two Odoo-specific additions:

| ID | Proposal | Effort | Type | Class | Ship |
|---|---|---|---|---|---|
| ERP-8 | Requests for quotation to multiple suppliers, with comparison | M | feature | — | NO |
| ERP-9 | Vendor bills matched three-way against PO and receipt, with a discrepancy queue | M | feature | DIFFERENTIATOR | LATER |
| ERP-10 | Supplier scorecard — on-time rate, price variance, quality/rejection rate, all derived from receipts | S | feature | DIFFERENTIATOR | **YES** |

ERP-10 is cheap once INV-2 exists (it is three queries over PO receipts) and it is the
kind of thing that makes a merchant feel the system is smarter than their spreadsheet.

---

## 4.3 From Odoo Manufacturing / MRP

| ID | Proposal | Effort | Type | Class | Ship |
|---|---|---|---|---|---|
| ERP-11 | Multi-level BoM with sub-assemblies (= INV-12) | M | feature | DIFFERENTIATOR | LATER |
| **ERP-12** | **Production/assembly orders** — "make 30 of the standard Eid box for Thursday", reserving and consuming components ahead of the sale (= INV-13) | **L** | feature | DIFFERENTIATOR | **YES** |
| ERP-13 | BoM cost rollup that keeps `product.costPrice` honest as ingredient costs change | S | infra | TABLE STAKES | **YES** |
| ERP-14 | Work centres, routings, capacity planning | L | feature | — | NO |
| ERP-15 | Scrap/rejection recording during assembly (three stems broken making the bouquet) | S | feature | DIFFERENTIATOR | **YES** |

**ERP-12 in detail.** The BoM today only fires on order confirmation — the bouquet is
"made" the moment the order is confirmed, atomically, in the same transaction. That is
correct for made-to-order, which is most of this business. It is wrong for the other
half: a shop preparing 30 identical Eid gift boxes on Tuesday for Thursday's orders is
doing batch production, and today the platform has no representation for it. Those 30
boxes are either not in stock (so they cannot be sold) or are in stock as a product
whose components were never deducted (so ingredient stock is wrong).

An `assemblyorder` (`shopId`, `outletId`, `productId`, `quantity`, `status`,
`plannedFor`) consuming components on start and producing finished stock on completion
closes it, and it uses exactly the same movement machinery `consumeForOrderItems`
already implements — plus ERP-1's virtual `Production` location to keep the ledger
balanced. ERP-15 falls out of the same flow.

**ERP-13 is small and matters more than it looks.** `product.costPrice` for an
ingredient-backed product is entered by hand and immediately goes stale, because the
real cost is `sum(quantityPerUnit × ingredient.costPerUnit)` and ingredient costs
change with every delivery. A rollup job (or a computed read) makes ANL-6's margin
numbers true instead of decorative. Without it, margin reporting for the products this
merchant base actually sells is fiction.

---

## 4.4 From Odoo Accounting / Invoicing

This is the section where the "would this let a merchant cancel a subscription" test
matters most, and where I would deliberately stop short.

| ID | Proposal | Effort | Type | Class | Ship |
|---|---|---|---|---|---|
| **ERP-16** | **Accounting export** — a clean, mapped journal export (sales, COGS, VAT, payments, refunds, discounts) to Zoho Books / QuickBooks / Xero / Tally, plus a generic CSV | **M** | integration | TABLE STAKES | **YES** |
| ERP-17 | Chart of accounts mapping UI (which Requital event posts to which merchant account) | S | feature | TABLE STAKES | **YES** |
| ERP-18 | Accounts receivable — invoice, due date, ageing, statements, payment application (= PAY-5 B2B's other half) | M | feature | DIFFERENTIATOR | **YES** |
| ERP-19 | Accounts payable — supplier bills, due dates, payment scheduling | M | feature | — | LATER |
| ERP-20 | VAT return preparation — a period's output tax, input tax and a filing-ready summary | M | feature | DIFFERENTIATOR | **YES** |
| ERP-21 | A full general ledger, journals, bank reconciliation, fixed assets, multi-book | XL | infra | — | **NO** |
| ERP-22 | Expense recording (van fuel, market runs, packaging) against outlets | S | feature | DIFFERENTIATOR | LATER |

**ERP-21 is an emphatic NO** and the reasoning should be recorded, because it is the
decision that keeps this section from becoming a rewrite of Odoo. A general ledger is a
regulated, audited, jurisdiction-specific artefact; the merchant's accountant already
has one and will not move it; and getting it subtly wrong creates liability that a
store platform should not carry. The right position is: **be the best possible source
system for someone else's ledger.** ERP-16, ERP-17 and ERP-20 achieve that at a
fraction of the cost and are what a merchant's bookkeeper will actually thank them for.

**ERP-16 in detail.** Zoho Books has significant share among UAE SMBs; Tally has
significant share among the accountant community serving them. A journal export needs:
per-period sales by tax rate, COGS (ERP-13 + ANL-6), payment receipts split by gateway
with fees, refunds and credit notes, discounts as a contra-revenue line, and gift-card
liability movement (issued vs redeemed — a real liability most SMB systems get wrong).
Every one of those numbers is derivable from tables that already exist, except COGS,
which needs `orderitem.unitCost` — the same prerequisite ANL-6 has. Build them
together.

---

## 4.5 From Odoo CRM

| ID | Proposal | Effort | Type | Class | Ship |
|---|---|---|---|---|---|
| **ERP-23** | **A sales pipeline for corporate enquiries** — lead, stage, owner, expected value, next action, won/lost — sitting above draft orders | **M** | feature | DIFFERENTIATOR | **YES** |
| ERP-24 | Activity/task management on a lead or a customer (call back Thursday, send proposal) | S | feature | TABLE STAKES | **YES** |
| ERP-25 | Quotation templates and a send-track-accept flow (= ORD-9) | S | feature | TABLE STAKES | **YES** |
| ERP-26 | Contact model separating a person from a company (= PAY-5's `companycontact`) | M | infra | TABLE STAKES | **YES** |
| ERP-27 | Lead scoring and automated assignment | M | feature | — | NO |
| ERP-28 | Email integration — pipe a shared inbox into the CRM against the right contact | L | integration | — | LATER |

**ERP-23 in detail.** This is the module a florist doing weddings and corporate
accounts most obviously needs and most obviously does not have. The high-value work in
this business is not a checkout — it is a wedding enquiry that takes six weeks, four
conversations, a site visit, a proposal and a deposit. Today that lives in WhatsApp
and a person's memory, and the platform sees only the final draft order, if that.

The shape is small and should stay small: `lead` (`shopId`, `outletId`, `customerId`
nullable, `companyId` nullable, `title`, `stage`, `ownerUserId`, `expectedValue`,
`expectedCloseDate`, `source`, `status`) with an ordered per-shop stage list and a
kanban board — which is a UI pattern the admin already has for orders. Convert a won
lead into a draft order, which already converts into a real order. Two entities, one
board, reusing two existing flows.

Pair it with ERP-24's activities and CUS-8's communication log and a merchant has a
genuine CRM for the segment of their business that produces the largest orders.

---

## 4.6 From Odoo Project / Events / Field Service

| ID | Proposal | Effort | Type | Class | Ship |
|---|---|---|---|---|---|
| **ERP-29** | **Event/wedding jobs** — a dated job with a checklist, assigned staff, a materials list drawn from the BoM, a site address, and a linked quote and invoice | **L** | feature | DIFFERENTIATOR | **YES — but Phase 7 (D20, §10.4)** |
| ERP-30 | Job costing — planned vs actual materials and labour on an event | M | feature | DIFFERENTIATOR | LATER |
| ERP-31 | Resource/equipment booking (vases, arches, stands lent for an event and returned) | M | feature | DIFFERENTIATOR | LATER |
| ERP-32 | Timesheets | M | feature | — | NO |
| ERP-33 | Field-service style dispatch (= SHP-5 driver runs, generalised to installers/setup crews) | M | feature | DIFFERENTIATOR | LATER |

**ERP-29 in detail.** Event work is where this merchant base makes its margin, and it
is structurally different from e-commerce: one order, a long lead time, a deposit, a
materials list that changes, staff assigned to a setup slot, equipment that goes out
and comes back, and a delivery that is an installation. Nothing in the product models
any of that.

A `job` entity tying together a customer/company, a date and site address, a linked
draft order or order, a materials list (reusing `productingredient`'s shape but
per-job), assigned staff, an ordered checklist, and returnable equipment (ERP-31) would
be the single most differentiated thing Requital could build for its actual customers.
No competitor in this segment — regional or global — has it, because they are all built
for parcel commerce.

I have it as YES but late: it depends on ERP-23 (the pipeline that feeds it), PAY-5
(the corporate account that pays for it), PAY-6 (deposits) and SHP-5 (the crew that
delivers it). It is the payoff of the ERP thread, not its starting point.

---

## 4.7 From Odoo HR

| ID | Proposal | Effort | Type | Class | Ship |
|---|---|---|---|---|---|
| ERP-34 | Staff shifts and rota per outlet (= STF-9) | M | feature | DIFFERENTIATOR | LATER |
| ERP-35 | Attendance / clock-in tied to an outlet, usable from the merchant PWA | S | feature | DIFFERENTIATOR | LATER |
| ERP-36 | Leave requests and approval | M | feature | — | NO |
| ERP-37 | Payroll | XL | feature | — | **NO** |
| ERP-38 | Staff commission on sales (= STF-10) | M | feature | DIFFERENTIATOR | LATER |

HR is the weakest fit and the section where the "cancel another subscription" test
mostly fails — UAE payroll has WPS obligations that a store platform has no business
touching. Shifts and attendance are the two that connect to something Requital already
knows (who was working at which outlet when, which `auditlog` half-records), and they
are worth it only alongside STF-10 commissions and a POS story.

---

## 4.8 From Odoo Helpdesk

| ID | Proposal | Effort | Type | Class | Ship |
|---|---|---|---|---|---|
| ERP-39 | Ticketing over the customer/order context (= CUS-17) | L | feature | DIFFERENTIATOR | LATER |
| ERP-40 | SLA tracking and escalation on tickets | M | feature | — | NO |
| ERP-41 | Canned responses and macros | S | feature | TABLE STAKES | LATER |
| ERP-42 | Complaint/quality-issue logging against a product or a supplier, feeding ERP-10 | S | feature | DIFFERENTIATOR | **YES** |

ERP-42 is the cheap one worth taking: a merchant recording "these roses arrived wilted"
against a supplier and a delivery turns supplier quality from an opinion into data,
and it needs only a small table plus a link from the receiving screen.

---

## 4.9 The ERP thread, sequenced

Read as one arc rather than a list, the ERP-adjacent work has a natural order and a
natural stopping point:

1. **`orderitem.unitCost` + ERP-13 cost rollup + ANL-6 margin.** Makes every number
   downstream true. Cheap. Do it first.
2. **INV-1 suppliers + INV-2 purchase orders + INV-3 OCR receipt matching.** Closes
   the buy side. This is the "cancel the purchasing spreadsheet" moment.
3. **ERP-1 double-entry locations + ERP-4 units of measure + INV-4 lots/expiry.**
   Makes the ledger honest. Unlocks valuation and wastage.
4. **ERP-16/17/20 accounting export + VAT return prep.** The "your bookkeeper thanks
   you" moment, and the point at which a merchant stops re-keying data.
5. **PAY-5 B2B + ERP-18 AR + ERP-23 CRM pipeline.** The corporate-account thread.
6. **ERP-12 assembly orders + ERP-29 event jobs.** The high-margin operational
   thread, and the genuine end of the arc.

And a stated stopping point: no general ledger, no payroll, no work centres, no
requests-for-quotation. Those are where a store platform stops being a store platform.
---
---

# 5. GENUINELY NOVEL PROPOSALS

*Not traceable to a competitor. Each of these exists because of something specific
about this product's shape — multi-tenant, Gulf-regional, florist/gifting merchant
base, an unusually real inventory and BoM layer, a mature theme system, a
platform-owned WhatsApp rail, and a DB-backed job queue — rather than because
somebody else built it. Some will be wrong. That is the point of a generative pass.*

Each entry states the mechanism, not just the idea, because the mechanism is what
makes it assessable.

---

## NOV-1 — The perishability engine

**S→M · feature · DIFFERENTIATOR · depends: INV-4 lots/expiry, DSC-15 auto-markdown ·
Ship: YES — moved to Phase 7 by D20 (§10.2)**

> **D20 (2026-09-10):** still worth building; narrows. The markdown *automation* is
> strongest where shelf life is days rather than months — flowers, bakery, grocery, food
> service. **INV-4 lots and expiry itself stays in Phase 5**, because expiry is table
> stakes for grocery, pharmacy, cosmetics and anything with a batch code, and in several
> of those it is a legal requirement.

Every other proposal treats expiry as an inventory problem. It is actually a
*merchandising* problem, and this product has the two halves nobody else has together:
a lot-level expiry date and an auto-apply discount engine that already computes
storefront display prices.

The mechanism: a lot's remaining shelf life drives a markdown curve. A stem lot at day
1 sells at full price; at day 4 an auto discount of 15% activates and the product card
shows it; at day 6 it enters a "Last chance" collection that a theme section renders;
at day 7 it is written off to `Scrap` with a real wastage number. All of it is
automatic, all of it is one rule the merchant configures once, and every piece of it
already has an implementation in the codebase — `discount.discountType = 'auto'`, the
rule-based `template` (which computes membership live from conditions), the theme
section renderer, and `stockmovement`.

Why it is novel: markdown optimisation exists in enterprise retail (Blue Yonder, Oracle
RGBU) and nowhere near an SMB store platform. Framed as "stop throwing flowers away",
it is the most legible ROI story this product could tell a florist — and it is
measurable, because the wastage number before and after is right there.

---

## NOV-2 — Recipient graph and the occasion engine

**M · feature · DIFFERENTIATOR · depends: CUS-14, CUS-15 · Ship: YES**

Covered mechanically in §2.5. What makes it novel is what it becomes at platform scale
rather than per-shop: gifting is a *directed graph* — buyers point at recipients — and
that graph is the highest-signal retention asset in the business.

The per-shop version is CUS-14/15. The platform version, which nobody has: a recipient
who receives from three different buyers on the same merchant is a person that merchant
should know about, even though that person has never bought anything. A recipient who
becomes a buyer is the most valuable acquisition channel a florist has and is currently
completely untracked — the gift card in the box is the only link, and it is paper.

Mechanism: `recipient` rows carry a phone number. When a phone number that has only
ever been a recipient places its first order, attribute it. Then a merchant can see
"37% of your new customers this year first received flowers from an existing customer",
which is both true and, as far as I know, unmeasured anywhere in this category. A
one-time discount to a recipient shortly after delivery ("liked them? here's 15% off
your own order") is the obvious action, and it converts at rates a cold channel cannot
touch.

Privacy constraint that must be honoured: a recipient did not opt in. Marketing to them
needs an explicit consent step and, under PDPL, a lawful basis — which in practice
means the *buyer* triggers it or the message rides on the delivery itself (a QR on the
card), not a cold send. **Decided (D12/D13, 2026-09-10):** both halves ship, and the
no-cold-send rule is now a terms obligation with an engineering enforcement point — see
§13.2.

---

## NOV-3 — Trading modes as a first-class operational primitive

**M · infra · DIFFERENTIATOR · depends: none · Ship: YES**

Described in GLF-27 as a Ramadan feature. The generalisation is the novel part: a
merchant's operational settings — hours, slots, prep time, capacity, fees, minimum
order, banner, active discounts — are today a single flat state, edited in four
different pages, with no history and no way to plan a change.

Make them a **stack of dated, named overlays.** Base settings at the bottom; a
"Ramadan" overlay from date X to Y; a "Valentine's peak" overlay for three days; a
"Chef is on holiday" overlay for a week. Resolution is a merge in priority order, and
the effective settings are computed, not stored.

This is precisely the pattern the theme system already proved out — optional keys, unset
means inherit, a shop that never uses one behaves byte-identically — applied to
operations instead of visuals. It is cheap because the merge machinery and the
convention already exist and are well understood by this codebase.

Why it is novel: every competitor treats store settings as a single mutable state.
Making them time-layered turns "I forgot to change the delivery cutoff back after Eid"
from a recurring revenue loss into an impossibility, and it makes seasonal planning a
thing a merchant does in advance rather than at 6am on the day.

---

## NOV-4 — Cross-tenant benchmarking with honest anonymity

**M · feature · DIFFERENTIATOR · depends: ANL-1 rollups, §13.1 ToS revision live ·
Ship: YES — decision made (D12); Phase 8**

A single-tenant merchant has no idea whether their 2.1% conversion rate, 38% gross
margin, 6% wastage or AED 240 average order value is good. A multi-tenant platform
knows, and is the only party that can tell them.

Mechanism: over the ANL-1 rollups, compute per-metric distributions across shops
sharing a segment (business type, emirate, size band), with a hard k-anonymity floor —
no cohort renders below N shops, and the merchant sees a percentile band, never
another shop's number. Surface it as one line per dashboard card: "your average order
value is in the top 25% for florists in Dubai; your repeat rate is below median".

Why it is novel here specifically: Shopify has the data and does almost nothing with
it for SMBs; Salla and Zid do not surface it at all. And this product's merchant base
is homogeneous enough (a specific vertical, a specific region) that the comparison is
genuinely meaningful, which is not true of a general-purpose platform where "retail" is
a meaningless cohort.

**Decided (D12, 2026-09-10):** yes, and the ToS is rewritten to say so — k-anonymity
floor of 10, no per-shop identifiability, merchant opt-out, drafted in §13.1, lawyer
review required before it goes live. The original framing of the question is kept below
because the constraints it names are now the clauses.

The decision that had to precede it: is aggregate cross-tenant analysis within the
terms merchants agreed to? My reading is yes with a k-floor and no per-shop identifiability, but it is a policy call and it must be
made explicitly, in the terms of service, before a line of it is written.

---

## NOV-5 — The wholesale layer between merchants on the platform

**L · feature · MOONSHOT · depends: PAY-5 B2B, INV-1/2, PLT-4 API · Ship: LATER**

Requital's merchants buy from the same small set of suppliers — the Dubai Flower
Centre, a handful of importers, a few packaging wholesalers. Several of them also sell
*to each other* (a small shop buying overflow stock from a larger one on a peak day is
routine in this trade).

Mechanism: let a shop mark part of its catalog as available wholesale to other verified
Requital shops, at a wholesale price list (CAT-8), with a purchase order (INV-2) on the
buyer's side becoming a sales order on the seller's side automatically. The two sides
are the same platform, so the entire integration problem disappears — one shop's
`purchaseorder` and another's `order` are two views of one row.

Why it is novel: it is a marketplace that only a multi-tenant platform with a real
purchasing module could build, and neither half exists in any competitor. It also
creates a network effect the product currently has none of — today, two Requital
merchants are strictly independent and Requital gains nothing from having both.

Why LATER: it needs B2B, price lists and purchase orders to exist first, and it needs a
trust/verification model (who can see whose wholesale prices) that is a real design
problem. But it is the most defensible long-term position in this document.

---

## NOV-6 — Bill-of-materials-driven substitution and live buildability

**M · feature · DIFFERENTIATOR · depends: BoM (exists), INV-21 · Ship: YES — moved to
Phase 7 by D20 (§10.2)**

> **D20 (2026-09-10):** narrows. Requires a BoM to be meaningful, and BoM-backed
> products are a subset of general retail (food service, kitting, assembly,
> made-to-order). Sub-item 3 — "what can I sell today, ranked by margin" — is nearly
> general and could be lifted out against plain stock as a smaller, earlier feature.

The BoM already computes whether a product can be made from current ingredient stock —
that is what `ingredientStockWarnings` is. Today that computation surfaces as a warning
to staff after the fact. Turn it around and it becomes three things nobody has:

1. **Live storefront buildability.** A made-to-order bouquet's availability is
   `min(floor(ingredientStock / quantityPerUnit))` and is currently invisible to the
   storefront, which shows the parent product's own (often untracked) stock. Compute it
   and the PDP can honestly say "we can make 4 more of these today".
2. **Substitution rules.** `ingredientsubstitute` (INV-21): if white roses are out,
   cream roses substitute at a 1:1 ratio with merchant approval. The storefront stays
   sellable, the florist gets a note on the order, and the customer is told the
   arrangement may vary — which is the industry norm anyway and is currently handled by
   a phone call.
3. **Reverse merchandising — "what can I sell today".** Given current ingredient stock,
   which products are buildable in quantity, and which of those have the highest
   margin? That is a query over the BoM plus ANL-6, and it is a screen a florist would
   open every morning. No e-commerce platform has this because no e-commerce platform
   has a BoM.

Item 3 is the novel one, and it is nearly free once ANL-6's cost work exists.

---

## NOV-7 — Delivery-window market pricing

**M · feature · DIFFERENTIATOR · depends: SHP-3 slot quotas, SHP-1 distance ·
Ship: LATER**

Slots are currently free and uniform. In reality a Friday 4–6pm slot on Valentine's
week is worth an enormous amount more than a Tuesday 11am–1pm slot in August, and both
cost the merchant the same to offer.

Mechanism: per-slot pricing modifiers driven by remaining capacity, day of week, and
proximity to a peak date. As a slot fills, its fee rises (or its discount falls);
underused slots get cheaper. The customer sees "11am–1pm — free · 4–6pm — AED 15" and
self-sorts, which flattens the merchant's own peak.

Why it is novel: surge pricing is normal in ride-hailing and unheard of in local
delivery e-commerce, and this product already has the two prerequisites (real slot
generation with server-side validation, and a delivery fee that is computed rather than
fixed). The framing that makes it palatable to a merchant and a shopper is
**discounting the quiet slots**, not surcharging the busy ones — same effect, entirely
different reception.

---

## NOV-8 — The order-to-photo loop

**S · feature · DIFFERENTIATOR · depends: SHP-7 proof of delivery, storage (exists) ·
Ship: YES**

A florist's product is made to order and every unit is slightly different. The
customer who ordered it never sees it — it went to someone else, in another emirate,
while they were at work.

Mechanism: proof of delivery (SHP-7) is already going to capture a photo. Send that
photo to the *buyer*, not just file it. "Here's the arrangement we delivered to Fatima
this afternoon." That single message is the highest-emotional-value touchpoint in the
entire transaction and it currently does not exist anywhere in this category.

Second-order effects, all cheap: it is the natural moment to request a review
(MKT-21), the natural moment to offer a reorder to the same recipient (CUS-15), and the
most shareable artefact the merchant produces — with the merchant's consent flow, it is
also user-generated content for the storefront (a "recently delivered" theme section
built from real photos).

Why it is novel: proof of delivery is universally treated as a *dispute* artefact — a
defensive record. Treating it as a *marketing* artefact is a reframe nobody in this
space has made, and it costs one extra send on an image that is already being captured
and stored.

---

## NOV-9 — Theme-system-as-content-system

**M · infra · DIFFERENTIATOR · depends: CNT-1 · Ship: YES**

The theme engine is the most over-built subsystem relative to the rest of the product:
a validated JSON config, a typed section vocabulary, per-section settings, draft and
published states, undo snapshots, a live preview channel with postMessage, in-preview
drag-and-drop editing, and four starter templates. It renders exactly one thing — the
homepage.

The novel move is to notice that this is a general page-composition engine that happens
to be pointed at one route, and repoint it: CMS pages, blog articles, landing pages,
collection page layouts, PDP layouts, and — the interesting one — **email templates and
the invoice document**.

An email built from the same section vocabulary as the storefront inherits the
merchant's fonts, colours, radii, button styles and logo automatically, which is the
single hardest part of making merchant email not look like a form letter. The invoice
likewise: `invoices/` currently serves hand-written HTML with hardcoded styling and the
plain currency code, visually unrelated to the merchant's brand.

Why it is novel: every platform has a theme engine and a separate email-template
system, and they always drift. Making them one is possible here specifically because
the theme config is a plain validated JSON tree with pure render functions, rather than
a Liquid-style template language with a runtime.

Caveat to respect: email HTML is a hostile rendering target and the section renderers
are React components producing modern CSS. This needs a separate email-safe renderer
over the *same config*, not a reuse of the same components — which is still a large win
over authoring two design systems.

---

## NOV-10 — Merchant-to-merchant capacity sharing on peak days

**M · feature · MOONSHOT · depends: SHP-5 drivers, NOV-5 trust model · Ship: NO (yet)**

On Valentine's Day every florist in Dubai is capacity-constrained on the same
afternoon, and each of them turns away orders while another two kilometres away has an
idle van for an hour.

Mechanism: opt-in, per-day, per-slot: a merchant publishes spare delivery capacity;
another merchant's order that would otherwise be refused gets offered to them at a
platform-set rate; the delivery runs under the receiving merchant's driver with the
originating merchant's branding on the card.

I am marking this **NO for now** and including it because it is the clearest example of
a capability that is only possible for a multi-tenant platform with a driver model, and
because it may be the right answer in three years. The reasons not to build it now are
real: it needs SHP-5, a trust and liability model, a settlement mechanism, and enough
merchant density in one city to matter. But it should be on the record, because the
data model decisions made for SHP-5 either leave room for it or foreclose it.

---

## NOV-11 — Storefront as a WhatsApp catalog, not a website

> **DROPPED by D15 (2026-09-10).** NOV-11 was GLF-33's product framing; without the
> integration it has no mechanism. Note that `shop.disableStoreCart` +
> `cartDisabledMode: 'contact_to_order'` still exists and still works — what is dropped
> is the platform closing the loop back into a real order. Left in place as the record
> of what a reversal would restore; see §11.6.

**L · feature · DIFFERENTIATOR · depends: GLF-33 · Ship: ~~YES~~ DROPPED**

`shop.disableStoreCart` with `cartDisabledMode: 'contact_to_order'` already exists —
a mode where the storefront has no checkout at all and every product's CTA is a
WhatsApp message. That is a remarkably honest acknowledgment of how a large share of
this market actually transacts, and it is currently a degraded mode: the merchant loses
orders, inventory, reporting and everything downstream.

Invert it. Make WhatsApp the *primary* transaction surface with the platform fully
behind it (GLF-33), and the website the catalog that feeds it. The merchant gets a real
order, real stock decrement, a real invoice and real reporting for a conversation that
today produces none of those.

The specific novel piece: **a per-product deep link that carries cart state into the
WhatsApp thread**, so tapping "order this" on the storefront opens a thread pre-filled
with the product, variant, quantity and a token the backend can resolve into a draft
order. The merchant replies with a payment link; the customer pays; the draft converts.
Every part of that chain except the WhatsApp inbound webhook already exists in this
codebase.

Why it is novel: everyone treats WhatsApp as a support channel bolted onto commerce.
For this market it is the commerce channel, and the platform that treats the website as
the accessory rather than the product is the one that fits how these merchants
actually work.

---

## NOV-12 — Prep-time truth from the operations data

**S · feature · DIFFERENTIATOR · depends: none · Ship: YES**

`shop.deliveryPreparationTimeMinutes` and its four siblings are merchant-guessed
constants that determine which slots a customer is offered. Nobody re-tunes them, and
every one of them is wrong.

Mechanism: the order status timestamps already record `confirmed → preparing →
out_for_delivery`. That is a real measured preparation time, per outlet, per product
mix, per day of week. Compute the actual distribution, compare it to the configured
constant, and tell the merchant: "your configured prep time is 45 minutes; your actual
p90 on Fridays is 2 hours 10 minutes, which is why you missed 14 delivery windows last
month." Offer to update the setting, or to vary it by day.

Why it is novel: it is a class of feature — *the platform grading the merchant's own
configuration against the platform's own measurements* — that almost nobody builds,
because it requires caring about whether a setting is correct rather than merely
settable. This codebase has several other settings in the same shape (delivery radius
versus actual delivered distances, low-stock thresholds versus actual stockout
frequency, slot gaps versus actual clustering), so the pattern generalises into a
**"settings health" surface** that is cheap and unusually high-trust.

---

## NOV-13 — Ingredient-level provenance and the sustainability story

**M · feature · MOONSHOT · depends: INV-1 suppliers, INV-4 lots · Ship: LATER**

Once a lot has a supplier and a receipt date, the platform knows where every stem in a
bouquet came from and when. That is a story the storefront can tell — origin,
freshness, grower — and it is a story this category's premium segment actually pays
for.

Mechanism: a per-lot `origin` field populated from the supplier record, surfaced on the
PDP as "today's roses: Kenyan, arrived 2 days ago" and on the delivered-order page as a
provenance card. Longer term, a per-order footprint estimate (air-freighted versus
local, chilled transport) for merchants positioning on sustainability.

Why it is MOONSHOT: it depends on suppliers actually providing origin data reliably, on
merchants keeping it accurate, and on a customer segment caring enough to pay. The
first two are real risks. But no competitor could build it even if they wanted to,
because none of them has lot-level stock in an SMB product.

---

## NOV-14 — The pre-built vertical, shipped as data

**S · infra · DIFFERENTIATOR · depends: CAT-1 metafields, seed infrastructure ·
Ship: YES**

A new florist signing up today gets an empty catalog, an empty collection tree, no
metafield definitions, no BoM ingredients, no delivery zones and four theme templates.
The theme templates were built precisely because a blank canvas is a bad onboarding
experience — and then that insight was applied to nothing else.

Mechanism: a **vertical pack** is a seeded bundle — metafield definitions (stem count,
occasion, colour family, care instructions), a collection tree (Bouquets / Arrangements
/ Plants / Gifts / Occasions), an ingredient starter list with units, a set of BoM
templates, UAE emirate delivery zones with sensible default fees, the five policy pages
pre-written in English and Arabic, a seasonal calendar of the occasions that matter in
this region, and a matched theme template. Applied at signup, fully editable, fully
deletable.

Why it is novel: platforms ship *theme* templates and stop. Nobody ships an
operational vertical as data. And this product's merchant base is homogeneous enough
that one pack covers most of it — which is not true of a horizontal platform, and is
exactly why this is possible here and not at Shopify.

It also creates a durable strategic asset: a second pack (gift shops, cake shops,
perfume, chocolate, event rental) is the cheapest possible way to enter an adjacent
vertical, and each one is data plus a theme, not code.

---

## NOV-15 — Deliverability and reputation as a platform service

**M · infra · DIFFERENTIATOR · depends: MKT-3 per-shop sending domains · Ship: YES**

Once merchants send marketing email (MKT-1), the platform inherits a problem nobody
plans for: one merchant's purchased list poisons a shared sending reputation and every
other merchant's order confirmations start landing in spam. MKT-3 (per-shop domains)
solves the blast radius. The novel part is turning the necessary defence into a
merchant-visible feature.

Mechanism: a per-shop **sending health score** — domain authentication status (SPF,
DKIM, DMARC), bounce rate, complaint rate, list growth pattern, engagement rate — with
a plain-language explanation and a gate: a shop below a threshold cannot send bulk
until it fixes the cause. Plus automatic list hygiene (suppress hard bounces, suppress
complaints, sunset unengaged addresses after N sends).

Why it is novel: every ESP does this internally and shows the merchant almost none of
it. Surfacing it, in a segment where most merchants have never heard of DMARC, is
genuinely useful and simultaneously protects the platform from its own worst user. It
is the rare feature where the merchant's interest and the platform's are perfectly
aligned.

---

## NOV-16 — Order-time capacity truth ("we can actually do this")

**M · infra · DIFFERENTIATOR · depends: SHP-3 slot quotas, NOV-6 buildability,
NOV-12 prep truth · Ship: YES**

Three independent constraints determine whether an order the customer is about to place
can actually be fulfilled: is the product buildable from current ingredient stock, is
there delivery capacity in that slot, and is there enough time before the slot given
real measured prep time. Today the checkout checks none of them — it validates the slot
against business hours and takes the money.

Mechanism: one `assertFulfillable(cart, slot, outlet)` call in `PublicService.createOrder`
combining all three, in the same place `assertValidTimeSlot` already sits, returning a
specific reason and an alternative ("we can't do 4–6pm today, but 6–8pm works, or
tomorrow morning"). It is a composition of three things each of which is separately
proposed here.

Why it is worth calling out as its own item rather than an implicit consequence: the
merchant-visible outcome of this product is not "orders taken", it is "orders
delivered on time". The single largest source of merchant pain in this segment is
accepting an order that cannot be delivered, and the platform currently has all the
information needed to prevent it and uses none of it. The composite is worth more than
the parts, and if the parts are built without this in mind they will not compose.

---

## 5.1 Which of these I would actually build

If the novel section were funded as one thread rather than distributed through §8's
phases, the order would be:

1. **NOV-12** (prep-time truth) — an S, needs nothing, and immediately makes the
   product feel like it is paying attention.
2. **NOV-8** (order-to-photo) — an S on top of SHP-7, and the highest emotional return
   per line of code in this document.
3. **NOV-14** (vertical pack) — an S, and it improves every future merchant's first
   week.
4. **NOV-3** (trading modes) — the operational primitive that GLF-27/28/30 all reduce
   to.
5. **NOV-1** (perishability engine) — the ROI story, once lots exist.
6. **NOV-6** (buildability and reverse merchandising) — the payoff of the BoM nobody
   else has.
7. **NOV-2** (recipient graph) — the retention engine.
8. **NOV-11 / NOV-16 / NOV-4 / NOV-9 / NOV-15** — real, larger, and each dependent on a
   §2 thread landing first.
9. **NOV-5, NOV-7, NOV-10, NOV-13** — on the record, not now.
---
---

# 6. ARCHITECTURALLY BLOCKED — WHAT WOULD NEED TO CHANGE FIRST

*Things in §2–§5 that cannot be built as an ordinary feature because something in the
current schema, tenancy model, auth model or deployment shape prevents it. Each entry
names the specific blocker, the specific files, and the specific change — not a general
"we'd need to refactor".*

---

## §6-A — Variant options are capped at three by hard columns

**Blocker.** `productvariant` has `optionValue1Id`, `optionValue2Id`, `optionValue3Id`
as three literal nullable FK columns. There is no fourth. The variant generator
(`variant-generator.ts`) computes a cartesian product over at most three option lists,
and every variant read, the reconciliation logic in `updateOptions`, the admin variant
grid and the storefront variant picker all assume the three-slot shape.

**Blocks.** CAT-13 (more than three axes). Any product needing size + colour + material
+ finish — which is real for gift boxes and hampers.

**What would need to change.** Replace the three columns with a
`productvariantoptionvalue` join (`variantId`, `optionValueId`) with a composite PK, plus
a deterministic option-signature column for the uniqueness check the three columns
currently give for free. The generator becomes an n-ary cartesian product; the
reconciliation matches on the signature rather than on a three-tuple. Expand/contract:
add the join table, backfill from the three columns, dual-write, migrate readers,
then drop.

**Cost and priority.** M. Low priority — three axes covers the overwhelming majority of
this merchant base, and the migration is not free. Do it only when a real merchant is
blocked.

---

## §6-B — An order belongs to exactly one outlet

**Blocker.** `order.outletId` is `NOT NULL`. It is the axis
`resolveOutletFilter(ctx, requestedOutletId?)` operates on, the axis every `branch`-role
check uses, the axis the order kanban filters by, and the value forced server-side for
a `branch` user on create. Stock decrements against `outletstock[order.outletId]`.

**Blocks.** ORD-1 (fulfilments), ORD-17 (split/merge), SHP-18 (ship-from-store
routing), any multi-branch cart, and the whole "we're out here, send it from the other
branch" flow that a two-branch merchant hits weekly.

**What would need to change.** The five-step expand/contract in §2.3's ORD-1 detail:
introduce `fulfilment`/`fulfilmentitem`, backfill one per order, keep `order.outletId`
as the primary fulfilment's outlet through the whole transition so
`resolveOutletFilter` and every branch-role check keep working, derive `order.status`
from its fulfilments, and only demote `order.outletId` to advisory once every consumer
reads fulfilments.

**The specific hazard.** `security-outlet-isolation.e2e-spec.ts` asserts that spoofing
`outletId` across outlets and shops either re-scopes or 404s on every outlet-scoped
endpoint. A fulfilment model adds a second outlet-bearing entity, and every one of
those assertions needs an equivalent at the fulfilment level *in the same PR* — this is
the single highest-risk isolation change in the document.

**Cost and priority.** L/XL. High value, high risk, its own phase.

---

## §6-C — There is no internationalisation layer at all

**Blocker.** No i18n library in any of the three apps. Every user-facing string is a
hardcoded English literal in a `.tsx` file — several thousand of them across
`admin/` and `storefront/`. No translation tables for any content entity. No
`dir` handling. The theme system's motion tokens encode directional travel
(`translateX`), the header/footer preset model encodes left/right arrangements, and
the `.theme-*` class layer uses physical properties throughout.

**Blocks.** I18N-1/2/3/15, GLF-1/3/6, and by extension any market where the shopper
does not read English — which is most of the addressable market.

**What would need to change.** In order: (1) a mechanical logical-properties sweep of
both apps (`ml-`→`ms-`, `pl-`→`ps-`, `left-`→`start-`, `text-left`→`text-start`), which
is a no-op in LTR and is the prerequisite that makes everything after it possible;
(2) an RTL negation block for the directional motion tokens; (3) `next-intl` plus
string extraction, storefront first; (4) translation tables per content entity with a
per-field fallback (GLF-3), and an admin translation editor; (5) locale routing,
`hreflang` and per-locale sitemaps.

**The specific hazard.** Step 1 touches roughly every component in both apps, which
makes it a very large diff with a very small behavioural surface — exactly the shape
that gets rubber-stamped in review. It needs a mechanical codemod plus a visual
regression pass, not a hand edit.

**Cost and priority.** XL total; step 1 alone is an M and is worth doing early and
independently, because it is the only part that gets harder the longer the codebase
grows.

---

## §6-D — Money is single-currency by omission, not by design

> **DECIDED (D6, 2026-09-10): true multi-currency, committed, and moved to Phase 2a.**
> The "presentment versus settlement" question below is answered — settlement. My own
> recommendation in the pre-decision §9 (base-currency-per-shop) is **overruled and
> withdrawn**. Point 3 below (per-currency minor units for KWD/BHD/OMR) is a schema-level
> requirement from the start, not a later refinement. See §8 Phase 2a.

**Blocker.** `order` has no currency column. Every money column is a bare `DECIMAL`
with no scale annotation in several cases (hence `trimDecimal()`). `shop.currency`
exists and is offered in a seven-option dropdown but is read only for display.
`PayPalPaymentProvider` hardcodes `'AED'`. `storefront/lib/currency.ts` has one entry.
`CurrencySymbol.tsx` renders an SVG Dirham glyph for AED and the raw code for anything
else.

**Blocks.** I18N-4, PAY-18, GLF-14, and any merchant outside the UAE — including the
merchants the currency dropdown already invites in.

**What would need to change.**
1. `order.currency` (and `draftorder.currency`, `giftcard.currency`,
   `paymenttransaction.currency`), backfilled to `'AED'`, `NOT NULL`.
2. ~~A decision on presentment versus settlement.~~ **Decided (D6): true multi-currency
   settlement.** Base-currency-per-shop is rejected. The cost is the XL, not the L.
3. **Minor-unit handling per currency.** KWD, BHD and OMR are three-decimal. Every
   rounding site, every provider amount conversion, and every display format needs a
   per-currency minor-unit rather than an assumed 2. Getting this wrong produces
   wrong VAT returns.
4. Every provider's amount serialisation (PayPal's hardcode is the visible one; the
   others take the currency from a caller that always passes AED today).
5. A rate source and a rate-freeze policy for orders (the rate at order time is the
   rate that must appear on the invoice forever).

**Cost and priority.** XL. **No longer blocked — decided (D6) and scheduled as Phase 2a**
(§8), ahead of every money-touching feature rather than behind them.

---

## §6-E — The address model is UAE-shaped and enum-locked

> **DECIDED (2026-09-10): remove all Emirates-specific structure**, not add a region
> model alongside it. The const, the required `order.emirate` column, the six DTO
> validators and the six frontend hardcodes all go. Scope is wider than what is written
> below — the transition is expand/contract with a real contract step, including a
> merchant-facing zone-remapping screen. See §8 Phase 2b.

**Blocker.** `EMIRATES` is a seven-element `as const` in
`backend/src/orders/constants.ts`, used as an `@IsIn(EMIRATES)` validator in **six**
backend DTOs (`create-order`, `create-public-order`, `create-draft-order`,
`update-draft-order`, `save-address`, `update-address`) and hardcoded in **six**
frontend files across both Next apps. `order.emirate` is a required column.
`shop.country` exists, is settable-once and locked — and drives nothing.

**Blocks.** I18N-6, GLF-24, GLF-25, GLF-26, and every non-UAE market. Also blocks
SHP-1/SHP-2 doing anything sensible, because delivery zone matching is a string compare
against this same free-text axis.

**What would need to change.** Replace the enum with a real region table
(`region`: `countryCode`, `code`, `nameEn`, `nameAr`, `parentRegionId`) seeded per
country, `order.regionId` alongside a retained `order.emirate` string for the
transition, DTO validation against the shop's own country's regions rather than a
global const, and the frontends fetching the list instead of importing it. Delivery
zones then reference `regionId` sets instead of matching on a free-text name — which
is also the fix for the zone-matching correctness problem in §7.

**Cost and priority.** M. This is the cheapest of the five blockers and it unlocks both
the multi-country story and the delivery-zone correctness fix, so it has the best
ratio in this section.

---

## §6-F — There is no billing primitive, so nothing can be gated

**Blocker.** No plan, no subscription, no entitlement, no usage counter. The existing
per-shop feature flags are ad-hoc `shop.xEnabled` booleans (twelve of them, several
dead), each hand-checked at its own call site, with no notion of "this shop's plan
includes this".

**Blocks.** PLT-1/2/3/9/10/12, ONB-12, and — more subtly — **every feature in this
document that should be plan-differentiated**. Building B2B, subscriptions, campaigns
or the API without an entitlement layer means shipping them to every shop for free and
retrofitting the gate later, which is the harder direction.

**What would need to change.** PLT-11 first (a real feature-flag/entitlement resolver
replacing the boolean pattern), then PLT-1 (plans and subscriptions), then PLT-2
(limits and metering). The entitlement resolver is the piece that must exist *before*
the next large feature ships, not after.

**Cost and priority.** PLT-11 is an S and should happen very early. PLT-1 is an XL and
is gated on §9's pricing decisions.

---

## §6-G — Single-node deployment with no replica and no scheduled backup

**Blocker.** One VPS, one MySQL instance, PM2, manual deploys, a backup script nothing
runs, no staging, no CDN, no monitoring destination configured. The application code is
actually mostly ready for horizontal scale — `scheduledjoblock`/`runLocked` protects
crons, the job worker claims rows with CAS, sessions are stateless JWTs, and uploads
can already go to S3 — so the blocker is infrastructural, not architectural.

**Blocks.** OPS-4/5/6/7, any credible SLA, any enterprise or corporate merchant with a
procurement process, and the ability to survive a disk failure with less than total
data loss.

**Two application-level caveats that would need fixing before scaling out.** The
`storefront-search` module caches per-`(shopId, query)` in an in-memory `Map`, and
`DomainsService.resolveSubdomain` holds a 30s in-process TTL cache invalidated on
connect/disconnect/verify. Both are correct on one node and become inconsistent across
several — the domain cache in particular would mean a merchant's newly verified domain
resolving on one node and 404ing on another for up to 30 seconds. Neither is hard to
fix (a shared cache, or accepting the staleness explicitly), but both need to be
decided before a second node exists, not after.

**Cost and priority.** OPS-1 and OPS-2 are hours and should be done this week. The rest
is an infrastructure project, not a feature.

---

## §6-H — The invoice is not a snapshot

**Blocker.** `invoices/` stores an `invoice` row with a number and a type, and
`GET /invoices/:id/pdf` renders HTML **from live order data at request time**. Editing
an order after its invoice was issued silently changes the document served at that
invoice number.

**Blocks.** I18N-7 (UAE e-invoicing requires an immutable issued document), I18N-10
(credit notes only make sense against a fixed original), ERP-16/18 (an accounting
export cannot reconcile against a mutable invoice), and any audit or dispute process.

**What would need to change.** Capture the rendered document — or, better, the
structured data that produces it — at issue time: `invoice.snapshotJson` holding the
frozen line items, tax breakdown, totals, buyer and seller details. Render from the
snapshot. Order edits after issue produce a *credit note plus a new invoice*, which is
the correct accounting behaviour anyway.

**Cost and priority.** S/M, and it is a correctness fix as much as a blocker. It should
happen before any accounting or e-invoicing work and ideally before more merchants
start relying on invoices for their VAT filing.

---

## §6-I — Theme config shape changes are a reset, not a migration

**Blocker.** By deliberate convention (`docs/plans/theme-templates-and-motion.md`),
`theme.config` shape changes are handled by reset — `deepMergeDefaults` and
`backfillGlobalSettings` only *add* missing keys from `DEFAULT_THEME_CONFIG` on read;
there is no migration path for a changed or removed key.

**Blocks.** NOV-9 (repointing the theme engine at CMS pages, emails and invoices)
partially — those new consumers would each carry the same no-migration constraint, and
an email template that resets on a shape change is a worse outcome than a homepage
that does.

**What would need to change.** Not much, but it needs deciding: either a versioned
config with a real migration chain (a genuine cost, and the convention exists precisely
because that cost was judged not worth paying for a homepage), or an explicit rule that
the reset convention applies only to the storefront theme and any new consumer gets its
own versioned shape.

**Cost and priority.** A decision, not a build. Make it before NOV-9 starts, not
during.

---

## §6 summary — the five that actually matter

| Blocker | Blocks | Cost to clear | Recommendation |
|---|---|---|---|
| **§6-F** no billing primitive | the entire platform layer, and correct gating of everything else | S (entitlements) + XL (billing) | **Clear the S part now**; it gets more expensive with every feature shipped ungated |
| **§6-E** UAE-locked address enum | multi-country, and correct delivery zones | M/L | **DECIDED — Phase 2b.** Full removal, not a dual-column hedge |
| **§6-C** no i18n layer | the whole Arabic/RTL market | M (logical properties) + XL (the rest) | **Do the M part early**, independently |
| **§6-B** one outlet per order | split fulfilment, ship-from-store | L/XL | Own phase, later, with isolation tests extended in the same PR |
| **§6-D** single-currency by omission | every non-AED market | **XL** | **DECIDED (D6) — Phase 2a.** True multi-currency, committed; no longer blocked |

Plus two that are cheap and should just be fixed: **§6-H** (invoice snapshots) and the
two in-process caches noted under **§6-G**.
---
---

# 7. TECHNICAL DEBT AND CORRECTNESS RISK

*Things worth paying down regardless of whether any feature in §2–§5 is ever built.
Ordered by what would hurt most. Every item cites the file. Items marked **CORRECTNESS**
are producing wrong behaviour today, not just carrying risk.*

---

## 7.1 Correctness — money, tax and pricing

### D-1 · **CORRECTNESS** · Auto-apply discounts are displayed but never charged
`backend/src/public/public.service.ts` (`createOrder`) · `storefront/lib/auto-discounts.ts`

The storefront computes and displays an auto-discounted price on product cards and the
PDP. `createOrder` never consults `listActiveAutoDiscounts`. A shopper is shown one
price and charged another. `CLAUDE.md` records this as a deliberate scope boundary,
which it was — but a merchant using the feature is currently mis-pricing every order,
and in the UAE, price-display mismatch is a consumer-protection matter, not just a bug.

**Fix:** DSC-1. An S. This should be the first change made out of this entire document.
**Test gap:** no e2e asserts that a displayed auto-discount price equals the charged
price. Add one in the same PR.

### D-2 · **CORRECTNESS** · `product.chargeTax` is stored, editable, and read by nothing
`backend/src/public/order-pricing.ts:5` · `products.service.ts:320,484,774`

`computeOrderTotals` applies the shop-wide `taxRate` to the entire goods subtotal. A
merchant who un-ticks "charge tax" on a zero-rated item is charged VAT on it anyway,
and files a wrong return. The column is set on create, copied on duplicate, and
updatable — everything except consumed.

**Fix:** I18N-5 (tax classes), with `chargeTax` unticked migrating to a zero-rate class.
An M. **Test gap:** `order-pricing.spec.ts` exists and tests inclusive/exclusive
arithmetic; it has no per-product tax case because there is no per-product tax.

### D-3 · **CORRECTNESS** · Delivery zone matching is a free-text string compare
`backend/src/public/order-pricing.ts` (`matchDeliveryZone`)

Zones are matched by a case-insensitive, whitespace-sensitive comparison of the zone's
`name` against the customer's `area`, falling back to `emirate`. A trailing space, a
spelling variant, or "Dubai Marina" vs "Marina" silently falls through to the
emirate-level zone — so a merchant with per-area fees charges the wrong fee routinely
and never finds out. Meanwhile every zone carries a real `lat`/`lng`/`radiusKm` that is
never read.

**Fix:** SHP-1 (haversine against the captured centre/radius) plus §6-E (structured
regions). The function's own comment already says "flag back if zones should instead
carry a structured area/emirate list" — this is that flag.

### D-4 · **CORRECTNESS** · The invoice is regenerated from live data, not snapshotted
`backend/src/invoices/invoices.service.ts`

Editing an order after its invoice was issued changes the document served at that
invoice number. See §6-H. **Fix:** capture a snapshot at issue. S/M.

### D-5 · Ingredient-backed cost is never rolled up
`product.costPrice` (hand-entered) vs `productingredient` × `ingredient.costPerUnit`

For every ingredient-backed product — which is most of this merchant base's catalog —
`costPrice` is a stale hand-typed number. Any margin reporting built on it (ANL-6) will
be wrong until ERP-13 exists. Not currently causing harm only because nothing computes
margin.

### D-6 · No test coverage on the two largest services
`products.service.ts` (3,865 lines) and `orders.service.ts` (1,355 lines) have **no unit
spec**. Both are covered indirectly by e2e specs, which is real coverage but slow,
coarse, and unable to exercise branch combinations (negative-stock paths, BoM delta
adjustment on quantity change, variant reconciliation edge cases).

The specific untested paths that would hurt most: `adjustStockForOrder`'s restock branch
on cancellation from each status; `updateItems`' ingredient delta arithmetic;
`resolveOrderItems`' variant/price resolution; `consumeForOrderItems`' BoM fan-out. All
four are money- or stock-affecting and all four are pure enough to unit test.

### D-7 · `resolveOrderItems`' variant lookup is not itself `shopId`-filtered
`backend/src/products/products.service.ts` · flagged as CONCERN #7 in
`docs/audit-2026-08.md`, still open

Safety today comes from a chained invariant (`found.productId !== product.id`, where
`product` was already shop-verified) rather than a direct filter. Correct now, fragile
to any refactor that reorders the checks. Defence-in-depth fix, S.

---

## 7.2 Dead controls and misleading UI

A `shop` boolean that persists a merchant's choice and changes nothing is worse than an
absent feature: it converts a settings page into a source of false confidence.
`CLAUDE.md` already establishes the rule for one direction ("don't leave a functional
toggle under Coming Soon copy"). The inverse rule is missing and should be added:
**a non-functional toggle must not sit outside it.**

| Control | Location | Status |
|---|---|---|
| `shop.allowPreOrders` | Store Configuration, normal body | **Dead.** No consumer anywhere. |
| `shop.customerConfirmationRequired` | Store Configuration, normal body | **Dead.** No consumer. |
| `shop.asapDeliveryEnabled` | Store Configuration, normal body | **Dead.** No consumer. |
| `shop.deliveryCalendarEnabled` | Store Configuration, normal body | **Dead.** No consumer. |
| `shop.birthdayDiscountEnabled` | Store Configuration | **Dead.** No consumer; `customer.birthday` also captured and unread. |
| `shop.notifyWhatsapp` | Business Information | **Dead.** Documented as such in `order-notifications.service.ts:40-46`. |
| `shop.dynamicThemeBuilderEnabled` | Store Configuration, **under Coming Soon** | Dead and honestly labelled — the correct treatment. |
| `product.chargeTax` | Product form | **Dead** (D-2 above). |
| `deliveryzone.lat/lng/radiusKm` | Zone modal map | **Captured, never read** (D-3 above). |
| Integrations → "Webhooks" tab | Integrations app | **Misleading name.** Shows *inbound* diagnostics; every merchant will read it as outbound. PLT-6, an S. |
| Newsletter subscribers | collected at `POST /public/:shopSlug/newsletter-subscribe` | **Write-only.** No admin page, no export, no send path. Data collected and never usable. |
| `customer.birthday` | Customer form | **Captured, never read.** |

**Recommendation:** one small PR that (a) moves the four dead order toggles and
`birthdayDiscountEnabled` and `notifyWhatsapp` under the Coming Soon card, (b) renames
the Webhooks tab to "Webhook activity" or "Incoming webhooks", and (c) adds a
newsletter-subscribers list page with export. That is an S total and it removes every
place the product currently lies to a merchant.

---

## 7.3 Documentation drift

### D-8 · `docs/runbook.md` documents a Prisma workflow that no longer exists
The restore procedure instructs `npx prisma migrate status` and `prisma migrate deploy`.
The backend migrated off Prisma; migrations run through `scripts/migrate.ts` against a
plain `_migrations` table, invoked as `npm run db:migrate`. The runbook is the document
someone reads at 3am during a restore, and following it as written would fail
confusingly at exactly the wrong moment. It also refers to `_prisma_migrations` when
describing what a dump contains. **S. Fix now.**

### D-9 · `BUILD_BRIEF.md` points at an SRS that is not in the tree
`REQUITAL_SRS.md` is named as the source-of-truth spec and does not exist in the
repository. `CLAUDE.md` already notes this. Several of its decisions were superseded
(separate top-level domains → path-segment tenancy; Nomod-as-one-integration → four
separate integrations), and several of its launch-scope requirements (i18n, RTL,
multi-currency) are unbuilt and now §6 blockers. Either restore the SRS with a
superseded-decisions banner or retire `BUILD_BRIEF.md` — a pointer to a missing
document is worse than neither.

### D-10 · `db/types.ts` is missing two tables it is supposed to be the source of truth for
`OutletstockRow` and `OutletvariantstockRow` do not exist in
`backend/src/db/types.ts`, despite the file's header declaring it the hand-maintained
source of truth for every table's row shape, and despite both tables being queried in
five services. S.

---

## 7.4 Structural and scaling risk

### D-11 · `products.service.ts` is 3,865 lines
It owns catalog CRUD, variants and options, stock adjustment, stock transfer, stock
movements, low-stock thresholds, CSV import preview and confirm, bulk operations,
ingredient shadow-product provisioning, BoM resolution and consumption, and order-item
resolution. Several of those are separate domains that happen to live together. This is
the file where a mistake is most likely and hardest to review. Splitting it — stock
operations, import, BoM/ingredients, catalog — is a mechanical M with real ongoing
payoff.

### D-12 · No pagination on platform lists
`GET /platform-admin/shops` returns every row. Already documented in `CLAUDE.md` as a
known gap and has already crashed a verification script against the dev DB's ~26,000
leftover shops. Harmless at the current live-merchant count and not harmless at 10x. S.

### D-13 · Every dashboard and report query scans `order`/`orderitem` directly
No rollups, no archiving, no partitioning. Fine now, linear degradation with history
length regardless of merchant count — a single three-year-old merchant will feel this
before the platform does. **Fix:** ANL-1 rollups plus ORD-8 archiving.

### D-14 · Admin data pages fetch on mount with no caching, and orders polls every 20s
Every admin page is a client component fetching in `useEffect` with a `refresh()`
closure, no SWR/React Query, no deduplication, and the orders list polls
unconditionally. At one merchant this is invisible; at a hundred concurrent staff
sessions it is a constant baseline load on a single-node backend. The
`react-hooks/set-state-in-effect` lint debt (77 findings in `admin`, 33 in `storefront`)
is a symptom of the same pattern, and is accepted rather than fixed for exactly this
reason. Not urgent; worth a decision before the merchant count grows.

### D-15 · Two in-process caches that break on a second node
`storefront-search`'s per-`(shopId, query)` `Map` (60s) and
`DomainsService.resolveSubdomain`'s 30s TTL cache with explicit invalidation on
connect/disconnect/verify. Both correct on one node; the domain cache in particular
would produce a newly verified custom domain resolving on one node and 404ing on
another. See §6-G. Decide before scaling out.

### D-16 · Migration ordering is enforced only by folder timestamp
`CLAUDE.md` documents this and documents the one real failure it caused (an
`ALTER TABLE outlet` timestamped before the `CREATE TABLE outlet`), invisible against a
long-lived dev DB and fatal against a clean one. CI's clean-DB `db:migrate` is the only
place this bug class is exercised. That is an adequate control today; it is worth
knowing it is the *only* control, and that a migration merged without CI running would
carry the risk unmitigated.

---

## 7.5 Security and operational risk

### D-17 · Email verification blocks nothing except change-password
Open from `docs/audit-2026-08.md` §1.1, item 4. An unverified account has full access
to everything: creating a shop, taking orders, connecting a payment gateway. Combined
with open self-signup and no signup velocity limit, an attacker can create unbounded
shops with unverified addresses. **Fix:** STF-14 + OPS-10. S.

### D-18 · Backups are a script nothing runs, on the same disk as the database
See OPS-1. This is the highest-consequence item in this section and one of the
cheapest to fix.

### D-19 · Error tracking has no destination configured
`resolveErrorTrackingProvider()` returns a logging no-op unless
`ERROR_TRACKING_WEBHOOK_URL` is set. The abstraction is built; nothing is listening.
Production errors currently reach a log file on one box that nobody watches. See
OPS-2. Hours.

### D-20 · `irmain.com` was grandfathered to `verified` without passing DNS-TXT
Documented in `CLAUDE.md` as a flagged fast-follow. A real live merchant holds a
`verified` custom domain that never proved ownership. The exclusivity index means no
other shop can claim it, so the practical risk is low — but the verification invariant
the whole custom-domain design rests on has one known exception, and it should either
be re-verified or explicitly recorded as permanent.

### D-21 · The staff bearer-token test fallback is compiled into production
`AuthGuard.extractToken` keeps a `NODE_ENV === 'test'`-gated bearer-header path for
~60 legacy e2e specs. It is genuinely inert outside Jest and the reasoning in
`CLAUDE.md` is sound. Noting it only because it is the exact shape of the
"two legitimate auth paths" pattern the codebase's own toggle-bypass lesson warns
about, and because it will look alarming to any future security review that does not
read the justification. A comment at the call site pointing at that justification would
be cheap insurance.

### D-22 · BNPL instalment copy is ours, not the provider's
`BnplWidgetCard.tsx` renders hardcoded "Pay in 4 interest-free payments!" /
"Split your bill into 3 payments. Interest-free!" text, replacing the providers' own
on-site messaging widgets. `CLAUDE.md` flags this as needing sign-off against each
provider's merchant messaging guidelines. It is a compliance item with a real (if
small) risk of a provider objection, and it does not self-resolve.

---

## 7.6 Test coverage gaps around money, tax and inventory

The e2e suite is genuinely good — 69 specs against a real MySQL, including a dedicated
adversarial cross-tenant isolation spec and a branch-role escalation spec. The gaps are
specific and they cluster exactly where they should not.

| Gap | Why it matters |
|---|---|
| No unit tests on `orders.service.ts` or `products.service.ts` | D-6. The two files that move money and stock. |
| No test that displayed price equals charged price | D-1 would have been caught. |
| No test for per-product tax behaviour | Because there is no per-product tax (D-2). |
| No test for concurrent stock decrement across two orders | The CAS design is correct; nothing proves it stays correct. |
| No test for gift card + discount + tax interaction on one order | Three money paths that compose, tested only individually. |
| No test for return-restock arithmetic against BoM-backed products | `returns` restocks products; ingredient restock on return is not obviously covered. |
| No test for the ingredient delta path on order item edit | `order-items-edit-bom.e2e-spec.ts` exists — worth confirming it covers the negative-stock-warning branch specifically. |
| No property/fuzz testing on `computeOrderTotals` | Inclusive/exclusive tax rounding is exactly where a property test earns its keep. |
| No load or concurrency test anywhere | The CAS patterns are the product's main correctness claim and are only ever exercised serially. |

**Recommendation:** one focused testing PR alongside the DSC-1/I18N-5 money work,
adding unit specs for the four untested money/stock paths in D-6 plus a
concurrency test for the stock-decrement CAS. That is an M and it is the highest-value
testing work available.

---

## 7.7 The debt-payment recommendation, in one list

Everything above, ordered by what I would actually do first:

1. **OPS-1** scheduled off-host backups + a restore drill · **OPS-2** point error
   tracking at something that pages a human. *(Hours. Highest consequence.)*
2. **DSC-1** charge the auto-discount that is being displayed. *(S. Live mis-pricing.)*
3. **D-8** fix the runbook's Prisma instructions · **PLT-6** rename the Webhooks tab ·
   **§7.2** move the six dead toggles under Coming Soon. *(S total. Removes every place
   the product currently lies.)*
4. **STF-14 + OPS-10** email verification gate and signup velocity limits. *(S.)*
5. **I18N-5** tax classes, wiring `chargeTax`. *(M. Correctness + unblocks e-invoicing
   and B2B.)*
6. **§6-H / D-4** invoice snapshots. *(S/M. Correctness + unblocks accounting.)*
7. **D-6 + §7.6** unit specs on the four untested money/stock paths + a stock CAS
   concurrency test. *(M.)*
8. **SHP-1 + §6-E** haversine zone matching and a real region model. *(M. Correctness +
   unblocks multi-country.)*
9. **ANL-1** rollups · **D-12** platform pagination · **ORD-8** archiving. *(Scaling,
   before it is needed.)*
10. **D-11** split `products.service.ts`. *(M. Ongoing review quality.)*
---
---

# 8. PRIORITISATION AND PHASING

> **Revised 2026-09-10** against the §9 decision record. The original sequencing
> (written before any decision was locked) hedged on multi-currency, the region model
> and the vertical. Six decisions are now locked and three of them move work
> substantially earlier. **§9 is authoritative; this section is derived from it.** If
> the two ever disagree, §9 wins and this section is stale.

*Grouped into phases with dependencies, in the shape the existing plan docs use. A
phase is a coherent unit of work with a stated outcome, not a time box. Nothing here is
committed scope — each phase gets its own plan-mode round before starting, the way
`theme-templates-and-motion.md` §8 did.*

## 8.0 What changed from the pre-decision sequencing

| Change | Driver | Effect |
|---|---|---|
| **Multi-currency moves from Phase 6 to Phase 2** | D6 locked: true multi-currency, committed | Every money-touching feature after Phase 2 is built currency-aware from the start instead of retrofitted. This is the single largest re-sequencing in the revision. |
| **Region model moves from Phase 2 to Phase 2, and its scope widens** | §6-E locked: remove all Emirates-specific structure | Was "add a region table alongside `order.emirate`". Now includes deleting the const, the six DTO validators and the six frontend hardcodes. Larger, and paired with multi-currency as one "geography and money" phase. |
| **Vertical-specific operations work drops a phase** | D20 locked: general retail | NOV-1 perishability, NOV-6 buildability and ERP-29 event jobs move from Phase 5 to Phase 7. INV-4 lots stays in Phase 5 — expiry is not florist-only (see §10). |
| **WhatsApp customer-facing work is deleted, merchant-facing work moves earlier** | D15 locked: platform-owned, merchant-facing only | GLF-33 and NOV-11 are dropped entirely (§11.6). The merchant notification set becomes a small, cheap Phase 3 item instead of a large Phase 8 one. |
| **Recipient graph keeps both halves and gains gift mode** | D13 locked | CUS-14/15/NOV-2 stay in Phase 4, now including checkout gift mode (§12). Blocked on the ToS change (§13), which is a Phase 0 document task. |
| **A ToS revision becomes a Phase 0 deliverable** | D12 locked | NOV-2 and NOV-4 are both blocked on wording, not engineering. Drafting it early costs nothing and unblocks two phases. |
| **Settings IA restructure becomes a real phase item** | New scope (§14) | The current IA cannot absorb the ~60 settings this document adds. It has to be restructured before, not after. |

**The sequencing logic, restated.** Five principles now drive the order, and they
override individual item value:

1. **Stop the bleeding first.** A backup that does not run and a price that is
   displayed but not charged are not roadmap items.
2. **Clear cheap blockers before building on top of them.** Entitlements, the region
   model, tax classes and logical properties all get more expensive with every feature
   shipped without them.
3. **Money and geography are foundational, not features.** *(New — from D6 and §6-E.)*
   Multi-currency and the region model touch every money column, every price display,
   every provider and every address form. Deferring them means every feature built in
   between has to be revisited. This is the same argument the SRS made about i18n in
   2026-07 and that was not heeded; §6-D and §6-E are the cost of not heeding it.
4. **Retention before acquisition, and measurement before both.** There is no point
   building campaigns for merchants who cannot measure whether they worked, and no
   point acquiring merchants onto a product with no billing.
5. **Depth where the product is already differentiated — but for the general base.**
   *(Revised — from D20.)* The inventory and operations spine is still the moat.
   Extending it is still worth more per unit of effort than reaching parity on things
   Shopify does better. But "extending it" now means the parts that serve any retailer,
   not the parts that serve a florist.

---

## Phase 0 — Stop the bleeding, and write the documents *(days, not weeks)*

**Outcome:** the product stops losing data on a disk failure, stops mis-pricing orders,
stops presenting non-functional controls as functional — and the two documents that
block later phases exist in draft.

| Item | Effort | Why it is here |
|---|---|---|
| OPS-1 scheduled off-host backups + a real restore drill | S | The single highest-consequence gap in the product |
| OPS-2 point `ERROR_TRACKING_WEBHOOK_URL` at something that pages a human | S | The abstraction is built; nothing is listening |
| **DSC-1 charge the auto-discount that is displayed** | S | Live mis-pricing (§7 D-1) |
| §7.2 move the six dead toggles under Coming Soon | S | Stops the product lying to merchants |
| PLT-6 rename the Integrations "Webhooks" tab | S | One label, removes a real misconception |
| MKT-7 newsletter subscriber list + export | S | Data collected and currently unusable |
| D-8 fix `docs/runbook.md`'s stale Prisma restore instructions | S | The document read during an incident |
| D-10 add the two missing row types to `db/types.ts` | S | Hygiene on a file declared source-of-truth |
| PLT-16 / D-12 pagination on platform lists | S | Already caused a real failure |
| STF-14 + OPS-10 email verification gate, signup velocity limits | S | Open signup with no gate |
| **§13 ToS revision drafted** (benchmarking + recipient data) | S | *New.* Blocks NOV-2 (Phase 4) and NOV-4 (Phase 8). Drafting is free; legal review has a lead time, so start it now. |
| **§14 settings IA restructure — decided and specced** | S | *New.* The plan, not the build. Phase 2 adds ~15 settings and Phase 3 adds ~12 more; the target structure has to exist before they land. |

**Dependencies:** none. Everything in Phase 0 is independent and parallelisable.

---

## Phase 1 — Measurement *(the prerequisite for every commercial decision after it)*

**Outcome:** a merchant can measure their business, and Requital can measure its
merchants. Unchanged from the pre-decision sequencing — D20 does not touch it, because
margin, attribution and rollups are vertical-neutral.

| Item | Effort | Depends on |
|---|---|---|
| **MKT-4 analytics + pixel layer** (GA4, Meta + CAPI, TikTok, Snap), consent-gated | M | consent banner (exists), job queue (exists) |
| MKT-14 UTM capture and first/last-touch attribution on the order | S | MKT-4 |
| **`orderitem.unitCost` captured at order time** | S | — |
| ERP-13 BoM cost rollup so ingredient-backed cost is real | S | `orderitem.unitCost` |
| **ANL-6 margin and profitability reporting** | M | the two above |
| ANL-1 nightly rollup tables | M | — |
| ANL-5 scheduled report emails · ANL-8 inventory analytics · ANL-11 server-side exports | S each | ANL-1 |
| ANL-9 real-time today dashboard | S | — |
| MKT-8 JSON-LD · MKT-9 canonical/OG/Twitter | S | — |
| NOV-12 prep-time truth (measured vs configured) | S | order status timestamps (exist) |
| §7.6 unit specs on the four untested money/stock paths + a stock CAS concurrency test | M | — |

**One addition from D6.** `orderitem.unitCost` must be added **with a currency column
alongside it**, or Phase 2 immediately rewrites it. Cost in an unspecified currency is
the same class of mistake as `order.total` in an unspecified currency, and it is
cheaper to get right in a column that has no historical rows than in one that does.

---

## Phase 2 — Money, geography and correctness *(the foundational phase)*

**Outcome:** money and place are modelled properly, once, before anything else is built
on top of them. This phase absorbs what were previously Phase 2 and most of Phase 6.

**This is the largest and riskiest phase in the plan, and it is deliberately early.**
Every argument for deferring it is an argument that gets weaker every week.

### 2a — Money

| Item | Effort | Depends on |
|---|---|---|
| **§6-D / I18N-4 true multi-currency** — currency columns on `order`, `draftorder`, `orderitem`, `giftcard`, `paymenttransaction`, `discount`, `product` price fields; per-currency minor units; rate capture and freeze at order time | **XL** | D6 (locked) |
| **Three-decimal currency handling (KWD, BHD, OMR) at the schema level** | *(part of the above, called out separately because it is the failure mode)* | — |
| Provider amount serialisation per currency (PayPal's `'AED'` hardcode is the visible one; every other provider takes it from a caller that always passes AED) | S | multi-currency |
| `CurrencySymbol.tsx` / `lib/currency.ts` generalised beyond the one AED entry | S | multi-currency |
| **I18N-5 tax classes + per-product tax behaviour** (wires `chargeTax`) | M | — |
| I18N-9 bilingual VAT invoice · I18N-10 credit notes | S each | I18N-5 |
| **§6-H invoice snapshots** | S/M | — |

### 2b — Geography

| Item | Effort | Depends on |
|---|---|---|
| **§6-E region model — full removal of Emirates-specific structure** | **M/L** | §6-E (locked) |
| **SHP-1 haversine distance-based delivery fees** | S | region model helps, not required |
| SHP-2 polygon zones · SHP-14 blackout dates · SHP-16 free-shipping progress | S each | SHP-1 |
| GLF-26 per-country weekend and business-day maths | S | region model |
| I18N-11 per-outlet timezone | S | region model |

### 2c — Foundations that everything later assumes

| Item | Effort | Depends on |
|---|---|---|
| **PLT-11 entitlement/feature-flag resolver** replacing the `shop.xEnabled` pattern | S | — |
| **§6-C step 1: logical-properties codemod** across both Next apps | M | — |
| CAT-1 **metafields** (with vertical preset packs, not one florist pack — see D20) | L | — |
| **§14 settings IA restructure — built** | M | §14 spec from Phase 0 |
| D-11 split `products.service.ts` | M | — |

### Why multi-currency moved here, in detail

The pre-decision draft put it in Phase 6 and recommended base-currency-per-shop as a
cheaper substitute. D6 rejects the substitute, and once true multi-currency is
committed, deferring it is strictly worse than doing it early, for three reasons:

1. **Every money-touching feature built in between has to be revisited.** Phases 3–8
   add store credit, loyalty points, subscriptions, B2B price lists, purchase orders,
   stock valuation, accounting exports and platform billing. Each one introduces new
   money columns. Adding currency to eight new tables later costs more than adding it
   to the existing nine now, and each retrofit is a migration against live rows rather
   than a column definition against none.
2. **The three-decimal problem is a schema decision, not a display one.** KWD, BHD and
   OMR have three minor units. Every rounding site, every provider amount conversion,
   every tax computation and every stored `DECIMAL` scale has to know the currency's
   minor unit. Retrofitting that after a Kuwaiti merchant has real orders means
   recomputing historical totals, which is not a migration anyone should have to write.
   `trimDecimal()` already exists because unannotated decimal scales are a live source
   of confusion in this codebase — that is the warning shot.
3. **General retail across markets is now the position (D20).** A UAE-only money model
   is not compatible with it. Under the previous florist-vertical framing, deferring
   was defensible because the merchant base was single-market. It no longer is.

The honest cost: this is an XL and it will feel like a phase with no visible merchant
value. It should be planned as its own round with its own detailed plan doc, the way
Phase A of the theme engagement was, and it should carry the same byte-identical-no-op
discipline — a shop trading only in AED must render and compute identically before and
after, proven with a parity table.

### Why the region model's scope widened

§6-E as originally written proposed `order.regionId` **alongside** a retained
`order.emirate` string for the transition. The locked decision removes the
Emirates-specific structure entirely, which means the transition is expand/contract
with a real contract step rather than a permanent dual-column:

1. Add `region` (`countryCode`, `code`, `nameEn`, `nameAr`, `parentRegionId`, `sortOrder`),
   seeded per country. The seven emirates become seven UAE rows, not a special case.
2. Add `order.regionId` nullable; backfill from `order.emirate` by name match; the same
   for `draftorder`, and for the address entries inside `customer.addresses` JSON.
3. Replace the six `@IsIn(EMIRATES)` DTO validators with a validator resolving against
   the shop's own country's regions. This is the step that changes behaviour: a shop in
   Saudi Arabia validates against Saudi regions.
4. Replace the six frontend hardcodes with a fetched list. The storefront checkout, the
   account address book, the draft-order builder and the admin all consume one endpoint.
5. Delivery zones reference `regionId` sets instead of matching on a free-text name —
   which is simultaneously the fix for D-3, the zone-matching correctness bug.
6. Drop `order.emirate` and the `EMIRATES` const.

Steps 5 and 6 are what make this an M/L rather than an M. Step 5 in particular is a
merchant-visible migration: every existing zone's free-text name has to be mapped to
one or more regions, and some will not map cleanly. That needs a merchant-facing
migration screen, not a silent backfill — which is worth doing anyway, because it
surfaces exactly the mismatches that are currently causing wrong fees.

---

## Phase 3 — The commercial layer *(make it a business)*

**Outcome:** Requital can charge merchants, limit them, know its own numbers — and
reach them reliably on a channel they actually read.

| Item | Effort | Depends on |
|---|---|---|
| **PLT-1 billing** — plans, subscriptions, trials, proration, dunning (Stripe Billing) | XL | PLT-11, multi-currency (Phase 2), §9 D1–D5 |
| **PLT-2 plan limits and usage metering** | M | PLT-1, ANL-1 |
| PLT-3 self-serve upgrade/downgrade | M | PLT-1 |
| PLT-10 platform revenue and cohort reporting (MRR, churn, ARPU) | M | PLT-1 |
| ONB-12 trial-to-paid onboarding | S | PLT-1 |
| PLT-14 status page · PLT-15 merchant changelog | S each | — |
| **§11 WhatsApp merchant notifications, tiers 1–2** (new order with Confirm/Reject, payment received/failed, order stuck past slot, low stock, daily summary) | **M** | inbound webhook + template approval; see §11.5 |

**Two changes from the pre-decision sequencing.**

**Multi-currency is now a hard dependency of billing**, not a parallel track. Plan
prices, platform invoices and dunning all denominate in something, and a platform that
charges a Saudi merchant in AED while they trade in SAR has a conversion problem in its
own billing. Since Phase 2 delivers it, Phase 3 simply inherits it — but the dependency
should be stated so nobody tries to run them concurrently.

**WhatsApp merchant notifications land here rather than Phase 8.** D15 shrank this from
a large customer-facing commerce integration to a small merchant-facing notification
channel, and Phase 3 is where it earns the most: billing and dunning (§11.4 tier 4) are
exactly the messages that must not be missed, and the notification infrastructure has
to exist before the first invoice is issued. Tiers 3–5 follow in later phases as their
triggering features land.

---

## Phase 4 — Retention *(make merchants' customers come back)*

**Outcome:** the CRM and marketing layer. Unchanged in substance from the pre-decision
sequencing; the recipient-graph items are now confirmed rather than conditional, and
gift mode joins them.

| Item | Effort | Depends on |
|---|---|---|
| **CUS-6 store credit ledger** (generalising the gift-card mechanics) | M | multi-currency (Phase 2) |
| **CUS-1 customer segments** + CUS-2 tags + CUS-3 notes | M | — |
| CUS-10 merge duplicates · CUS-11 consent tracking · CUS-12 stored LTV | S each | CUS-1, ANL-1 |
| **MKT-3 per-shop verified sending domains** | M | — |
| **MKT-1 campaigns** (email; WhatsApp customer sends are **not** in scope — D15) | L | MKT-3, CUS-1 |
| **MKT-2 automation flows** with five presets shipped enabled | L | MKT-1 |
| MKT-5 abandoned-cart sequence · MKT-21 review requests · CUS-7 birthday voucher · CUS-13 win-back | S each | MKT-2 |
| NOV-15 sending health score + list hygiene | M | MKT-3 |
| **CAT-10 product reviews** with moderation | L | — |
| **CUS-14/15 + NOV-2 recipient book, occasion reminders, recipient-to-buyer attribution** | M | §13 ToS revision live |
| **§12 gift mode at checkout** (merchant-configurable, off by default) | M | CUS-14 recipient model |
| CUS-16 reorder · CUS-19 guest-to-account · CUS-20 delivery preferences | S each | — |
| **CUS-5 loyalty** | L | CUS-6 |
| MKT-15 customer referral program · MKT-16 affiliate payouts | M each | CUS-6 |
| **§11 WhatsApp merchant notifications, tier 3** (approval requests once STF-2 exists) | S | §11 tier 1–2 |

**MKT-1's scope narrowed by D15.** Campaigns are email-only. The WhatsApp marketing
channel (MKT-6, GLF-34) is dropped — see §9.2 and §11.6. This is a real capability loss
in a market where WhatsApp open rates dwarf email, and it is a deliberate one; §11.6
records the reasoning so a future reversal is a decision rather than a rediscovery.

---

## Phase 5 — Operations depth, general-retail core *(extend the moat, for everyone)*

**Outcome:** any retailer stops using a second system for purchasing and stops guessing
at delivery. **Re-scoped by D20:** this phase now carries only the operations work that
serves a general retail base. The vertical-specific half moved to Phase 7.

| Item | Effort | Depends on |
|---|---|---|
| **INV-1 suppliers** as a first-class entity | M | multi-currency (supplier currency is a real field) |
| **INV-2 purchase orders** with per-line receiving | L | INV-1 |
| INV-3 OCR receipt matched against an open PO · AI-1 vision-model OCR | M each | INV-2, scan (exists) |
| INV-5 reorder points and suggested POs · INV-18 price-change alerts · ERP-10 supplier scorecard | S/M | INV-2 |
| **ERP-1 double-entry stock locations** (virtual: vendor, customer, scrap, production) | M | — |
| ERP-4 units of measure with conversion | S | — |
| **INV-4 lots and expiry with FEFO allocation** | L | ERP-1 |
| INV-7 stocktake · INV-11 wastage with reasons · INV-20 dead stock · INV-10 negative-stock policy | S each | ERP-1 |
| INV-6 weighted-average valuation | L | INV-2, ERP-1, multi-currency |
| **SHP-5 driver dispatch** (driver entity, runs, mobile view, proof of delivery) | L | — |
| SHP-7 proof of delivery · **NOV-8 order-to-photo loop** · SHP-15 live ETA | S each | SHP-5 |
| ORD-12 fulfilment run sheet | M | SHP-5 |
| **SHP-3 slot capacity/quotas** · ORD-19 capacity-aware acceptance | M | — |
| **NOV-3 trading modes** (dated operational overlays) | M | SHP-3 |
| GLF-8 COD as a real workflow with per-driver cash reconciliation | M | SHP-5 |
| MOB-3 merchant PWA · MOB-7 camera stock-in · INV-17 barcode input | M | — |
| **§11 WhatsApp merchant notifications, tier 4** (delivery exceptions) | S | SHP-5 |

**INV-4 lots stays in Phase 5 under D20.** Expiry is not florist-specific — grocery,
pharmacy, cosmetics, food, supplements and anything with a batch code need it, and it
is the prerequisite for correct weighted-average valuation regardless of vertical. What
moves to Phase 7 is **NOV-1**, the perishability *markdown engine* built on top of it,
which is where the florist-specific reasoning actually lived. See §10.

**NOV-8 stays here and is explicitly retained** (D20). It is proof-of-delivery photo
plus one extra send, merchant-disableable, and it is quality-of-life for any merchant
whose product is delivered to someone other than the buyer — which is not a florist
property, it is a delivery property.

---

## Phase 6 — Reach *(new markets and new merchants)*

**Outcome:** the product can be sold outside the UAE and to merchants currently on
another platform. **Reduced from the pre-decision sequencing** — multi-currency and the
region model graduated to Phase 2, so this phase is now language plus migration.

| Item | Effort | Depends on |
|---|---|---|
| **§6-C i18n: `next-intl` + string extraction, storefront first** | XL | Phase 2's logical-properties sweep |
| I18N-2 content translation with per-field fallback · AI-8 translation drafts | L | i18n |
| I18N-3 locale routing, `hreflang`, per-locale sitemaps · I18N-15 Arabic typography | M | i18n |
| GLF-2 Arabic search normalisation · I18N-14 Arabic OCR · GLF-5 Hijri dates | S each | — |
| **ONB-1 Shopify importer** + ONB-5 image-by-URL + ONB-6 dry-run | L | multi-currency (imported prices carry a currency) |
| **ONB-4 URL redirect map** + a 404 log | S | — |
| ONB-2 Salla and Zid importers · AI-4 migration column mapper | M each | ONB-1 |
| ONB-7 guided setup · ONB-8 demo data · **NOV-14 vertical packs (plural)** · ONB-9 concierge import | S each | CAT-1 |
| GLF-21 Arabic legal policy templates | S | — |
| **I18N-7 UAE e-invoicing** | XL | I18N-5, §6-H, §9 D8 |
| ERP-16/17 accounting export + CoA mapping · ERP-20 VAT return prep | M | ANL-6, I18N-5 |
| I18N-8 ZATCA Phase 2 for Saudi | XL | multi-currency (done), §9 D7 |

**ZATCA moves onto the table.** Under base-currency-per-shop it was gated behind an
unbuilt multi-currency layer. With D6 delivered in Phase 2, Saudi is reachable and
ZATCA Phase 2 becomes the remaining gate — which makes §9 D7 (which markets, in what
order) a more consequential open decision than it was.

**NOV-14 is plural now.** Under D20 the vertical pack is a mechanism, not the product's
identity. Ship the framework plus two or three packs — florist/gifting (the existing
base), general retail, and one more chosen from where the sales pipeline actually is.
See §10.5.

---

## Phase 7 — Vertical depth *(deep for a subset, once the base is served)*

**Outcome:** the vertical-specific operations features, for the merchant segments that
need them. **New phase, created by D20.** These were Phase 5 items under the
florist-vertical framing; they are still worth building and they no longer come first.

| Item | Effort | Depends on |
|---|---|---|
| **NOV-1 perishability engine** (expiry-driven markdown, last-chance collection, real wastage) | S | INV-4 (Phase 5), DSC-15 |
| **NOV-6 buildability + reverse merchandising** ("what can I sell today") | M | BoM (exists), ANL-6 |
| INV-21 ingredient substitution rules | M | BoM |
| ERP-11/INV-12 multi-level BoM | M | recursion guard |
| **ERP-12 assembly orders** · ERP-15 scrap on assembly | L | ERP-1, ERP-4 |
| **ERP-29 event/wedding jobs** · ERP-31 equipment booking | L | ERP-23, PAY-5, PAY-6, SHP-5 |
| CAT-25 composite configurator ("build your own") | L | CAT-4, BoM |
| GLF-28 prayer-time slot suppression · GLF-29 regional occasion calendar · GLF-30/31 peak-day mode | S each | NOV-3 trading modes |
| NOV-13 ingredient provenance | M | INV-1, INV-4 |
| CNT-9 care guides linked from products | S | CNT-2, CAT-1 |
| **§11 WhatsApp merchant notifications, tier 5** (platform announcements) | S | §11 tiers 1–4 |

**Why these are still on the list at all.** D20 says general retail is the position, not
that the existing merchant base stops mattering. Every item here is real for a
identifiable subset — perishables for grocery/pharmacy/food as well as flowers,
assembly for anyone selling kits or hampers, event jobs for caterers and rental as well
as florists. They drop in priority; they do not drop out. §10 states, per item, whether
the general-retail justification holds.

---

## Phase 8 — Platform and depth *(let other people build on it)*

| Item | Effort | Depends on |
|---|---|---|
| **STF-1 expanded permissions + shop-wide custom roles** | M | — |
| **PLT-4 public REST API** with scoped keys and per-key rate limits | L | STF-1 |
| **PLT-5 outbound webhooks** with signing, retries and replay | M | job queue (exists) |
| PLT-13 OpenAPI spec + developer docs | S | PLT-4 |
| STF-3 2FA · STF-4 session list · STF-5 password policy · STF-7/8 audit export and field diffs | S/M | — |
| STF-2 approval workflows | M | STF-1 |
| PLT-9 partner/agency tier | M | PLT-1 |
| PLT-12 sandbox/test mode | M | PLT-4 |
| PLT-7 app/extension model | XL | PLT-4, CAT-1 |
| **§6-B / ORD-1 fulfilments** (split shipment, ship-from-store) | XL | its own round; isolation tests extended in the same PR |
| ORD-2 exchanges · ORD-3 customer returns portal | M each | ORD-1, CUS-6 |
| SHP-18 ship-from-store routing | M | ORD-1, SHP-1 |
| **PAY-4 subscriptions** | XL | PAY-2 vaulting, multi-currency |
| PAY-2 saved cards · **PAY-1 Apple/Google Pay** · PAY-11 express checkout | M | Stripe or Nomod (§9 D17) |
| **PAY-5 B2B** — companies, terms, credit limits, PO numbers, tax exemption | XL | CAT-8 price lists, I18N-5, multi-currency |
| ERP-18 accounts receivable and ageing | M | PAY-5 |
| **ERP-23 CRM pipeline** + ERP-24 activities + ORD-9 customer-acceptable quotes | M | — |
| CNT-1 CMS pages · CNT-2 blog · CAT-12 media library · **NOV-9 theme-as-content-system** | M each | §9 D26 |
| CAT-4 bundles · DSC-2/3/4/5 the discount engine rebuild | M/L | DSC-5's unified evaluator first |
| **NOV-4 cross-tenant benchmarking** | M | ANL-1, §13 ToS revision live |

**PLT-4 and PLT-5 ship together.** An API without webhooks forces polling; webhooks
without an API give an integrator nothing to act with.

---

## 8.1 The dependency spine, in one picture

Read top to bottom; each row needs the rows above it. Changes from the pre-decision
version are marked ◆.

```
Phase 0   backups · error alerting · charge the displayed price · stop lying in the UI
       ◆  ToS draft ──> unblocks NOV-2 (P4) and NOV-4 (P8)
       ◆  settings IA spec ──> unblocks the ~60 settings P2/P3 add
             |
Phase 1   orderitem.unitCost (◆ with currency) ──> margin ──> rollups ──> everything measured
          analytics/pixel layer ──> attribution ──> any marketing claim
             |
Phase 2 ◆ MULTI-CURRENCY ──> every money column, provider, display, and every
             |                money-touching feature in P3-P8
       ◆  REGION MODEL ──> multi-country · correct delivery zones · per-country calendars
          tax classes ──> e-invoicing · B2B · VAT returns
          entitlements ──> anything plan-gated later
          logical properties ──> RTL
          metafields ──> feeds · filters · ERP mapping · apps
       ◆  settings IA built ──> a place to put what P3+ adds
             |
Phase 3   billing (needs §9 D1-D5, ◆ and multi-currency) ──> a business
       ◆  WhatsApp merchant notifications ──> dunning that gets read
             |
Phase 4   store credit ──> loyalty · refunds-to-credit · referrals
          segments ──> campaigns (◆ email only) ──> flows ──> retention
          sending domains ──> deliverability that survives volume
       ◆  recipient book ──> occasion reminders · gift mode · recipient attribution
             |
Phase 5   suppliers ──> purchase orders ──> receiving ──> valuation
          double-entry locations ──> lots/expiry (◆ stays; general retail needs it)
          driver model ──> runs · proof of delivery · order-to-photo · COD reconciliation
          slot capacity ──> trading modes ──> fulfillability
             |
Phase 6   i18n ──> Arabic ──> the actual regional market
          importers + redirects ──> merchants who already sell somewhere else
       ◆  ZATCA now reachable (multi-currency done in P2)
             |
Phase 7 ◆ VERTICAL DEPTH — perishability markdown · buildability · assembly · event jobs
             |
Phase 8   permissions ──> API + webhooks ──> integrators ──> apps
          fulfilments ──> split shipment · ship-from-store · exchanges
          vaulting ──> subscriptions
          companies + price lists ──> B2B ──> AR
```

## 8.2 If only one phase could happen

Unchanged: **Phase 0 and Phase 1.** Phase 0 because the failure modes it prevents are
catastrophic and the fixes are hours. Phase 1 because every subsequent decision is
currently being made without the numbers.

**If two:** add Phase 2a (money). Not 2b, not 2c — the currency work specifically. It is
the item whose cost grows fastest with delay and the one most likely to be deferred
again because it has no visible merchant value.

## 8.3 What I would deliberately not do

Unchanged except for two additions from the decision record:

- **A general ledger, payroll, or work centres** (ERP-21, ERP-37, ERP-14). Regulated,
  jurisdiction-specific, already served by the merchant's accountant.
- **Native mobile apps** (MOB-5, MOB-6). A PWA delivers every capability that matters.
- **A theme marketplace** (PLT-8). Requires a partner ecosystem that does not exist.
- **A merchant-scriptable pricing language** (DSC-14) and **AI chat widgets** (AI-12,
  AI-13).
- **Bins within an outlet** (INV-8), **serial numbers** (INV-16), **pickup lockers**
  (SHP-13), **consignment** (INV-15).
- **Marketplace listing sync to Noon/Amazon** (GLF-37).
- ◆ **WhatsApp customer-facing commerce** (GLF-33, NOV-11) and **WhatsApp marketing**
  (MKT-6, GLF-34). Dropped by D15. Reasoning recorded in §11.6 so a reversal is a
  decision, not a rediscovery.
- ◆ **Base-currency-per-shop as a multi-currency substitute.** Rejected by D6. Recorded
  because it was my own recommendation and someone reading the pre-decision §9 will
  find it.

---
---

# 9. DECISION RECORD

*Was "Open business / product decisions". Six decisions were taken on 2026-09-10 and
are now locked; the rest stay open. Same treatment as
`docs/plans/theme-templates-and-motion.md` §7.2.*

**How to read this section.** §9.1 is the locked record — these are settled, and §8 is
derived from them. §9.2 lists what each locked decision removed from the plan, so a
reader who finds a dropped proposal still described in §2–§5 knows why. §9.3 is what
remains open, unchanged in substance from the pre-decision draft. §9.4 is what the
locked decisions turned *into* new work.

---

## 9.1 Decision record (locked 2026-09-10)

| # | Question | **Decision** |
|---|---|---|
| **D20** | Is the vertical florist/gifting, or general retail? | **GENERAL RETAIL, BROADLY.** Not florist-specific. NOV-14 vertical packs stay as a *mechanism* — one pack among several, not the product's identity. Florist is the **first** pack because it is the existing merchant base, not because it is the position. NOV-1 perishability, NOV-6 buildability and ERP-29 event jobs stay on the list but **drop to Phase 7** — strong for a subset, not the whole base. Every proposal justified with "for this merchant base" reasoning is re-examined explicitly in **§10**; the re-justification is stated, not implied. **NOV-8 order-to-photo is explicitly KEPT** at Phase 5 priority: quality-of-life for any merchant, merchant-disableable, one extra send on an image already captured. |
| **D13** | Recipient graph — which halves? | **BOTH HALVES, including recipient-to-buyer attribution.** The ToS change is worth it (see D12). Scope: (a) **recipient book** — saved recipients with names, addresses, notes, occasion dates; recipient distinct from buyer on the order; (b) **occasion reminders** with one-click reorder to the same recipient; (c) **recipient-to-buyer attribution** at platform scale; (d) **gift mode at checkout** — a merchant-configurable "Is this a gift?" toggle, **OFF by default**; when the merchant enables it and the shopper ticks it, the packing slip renders without prices and with the gift message instead. Full gift-mode scope, including what else changes in gift mode, is **§12**. |
| **D6** | Multi-currency: presentment-only, base-currency-per-shop, or true multi-currency? | **TRUE MULTI-CURRENCY.** Committed. My own pre-decision recommendation (base-currency-per-shop) is **overruled and withdrawn**. It is foundational for general retail across markets and gets more expensive with every money-touching feature shipped without it, so it **moves from Phase 6 to Phase 2a** — see §8.0 and §8's "Why multi-currency moved here". **Three-decimal currency handling (KWD / BHD / OMR) is a schema-level requirement from the start**, per §3.2's own warning, not a display concern retrofitted later. |
| **§6-E** | Region model: add alongside `order.emirate`, or remove Emirates-specific structure? | **REMOVE ALL EMIRATES-SPECIFIC STRUCTURE.** The hardcoded `EMIRATES` const, the required `order.emirate` column, the six backend DTO validators (`create-order`, `create-public-order`, `create-draft-order`, `update-draft-order`, `save-address`, `update-address`) and the six frontend hardcodes. Replaced by the real region model. Same reasoning as multi-currency — **moves to Phase 2b**, with a real contract step rather than a permanent dual-column transition. Scope widened accordingly (§8 Phase 2b). |
| **D15** | WhatsApp: platform-brokered or merchant-brought, and how far into commerce? | **PLATFORM-OWNED, MERCHANT-FACING ONLY.** No customer-facing sends. **GLF-33 (WhatsApp commerce) and NOV-11 (storefront-as-WhatsApp-catalog) are DROPPED**, as are MKT-6 and GLF-34 (WhatsApp as a marketing channel) — reasoning recorded in §11.6 so a reversal is a decision, not a rediscovery. **Interactive buttons, not reply-with-a-number**: WhatsApp template quick-reply and URL buttons, e.g. `New order #1234 — [Confirm] [Reject] [View]`. Notification set, per-type merchant-disableable preferences, brokering constraints and build order are **§11**. |
| **D12** | Terms of service — is cross-tenant aggregation and recipient attribution defensible? | **YES, AND THE ToS IS REWRITTEN TO SAY SO.** The current ToS was AI-drafted, not author-written, and is treated as **fully editable**. §13 drafts what the terms need to say for both **NOV-4 cross-tenant benchmarking** (k-anonymity floor, no per-shop identifiability, merchant opt-out) and **NOV-2 recipient attribution** (lawful basis, consent path). Wording to be verified by the user. **A lawyer must review before it goes live** — stated plainly in §13 and repeated here. |

---

## 9.2 What the locked decisions removed

Recorded so a reader who finds one of these still described in §2–§5 knows it is
history, not backlog. Each is left in place in its original section with a **DROPPED**
banner rather than deleted — same convention as §6.5 of the theme plan being frozen
with a STALE banner rather than removed.

| Dropped | Was | Removed by | Reasoning |
|---|---|---|---|
| **GLF-33** WhatsApp commerce (catalog sync, inbound webhook, in-thread ordering) | §3.6, Phase 8, described as "the highest-conviction regional bet in this document" | D15 | Customer-facing WhatsApp is out of scope. Full reasoning in §11.6. |
| **NOV-11** Storefront as a WhatsApp catalog | §5, Phase 8 | D15 | Same. NOV-11 was GLF-33's product framing; without the integration it has no mechanism. |
| **MKT-6** WhatsApp as a marketing channel (template management, broadcast, click tracking) | §2.6, Phase 4 | D15 | Customer-facing. MKT-1 campaigns are now email-only. |
| **GLF-34** WhatsApp marketing channel (duplicate of MKT-6 in the regional section) | §3.6, Phase 4 | D15 | Same. |
| **Base-currency-per-shop** as a multi-currency substitute | §9 D6 recommendation, pre-decision | D6 | Overruled. True multi-currency committed. Recorded because it was my recommendation and someone reading the old §9 will find it. |
| **`order.emirate` retained alongside `regionId`** | §6-E's original transition plan | §6-E decision | Widened to a full contract step. The dual-column transition was a hedge; the decision removes the hedge. |
| **CUS-17** customer support inbox — *partially* affected | §2.5, Phase 8 | D15 | The **WhatsApp** inbound half is dropped. An email-based support inbox remains viable and stays LATER. Noted rather than dropped outright. |

---

## 9.3 Still open

Unchanged from the pre-decision draft except where a locked decision changed the
stakes. **D19 is resolved by D20** and moves to §9.1's consequences; **D7's stakes rose**
because multi-currency landing in Phase 2 makes Saudi reachable earlier.

### Blocking Phase 3 (billing)

**D1 · Is Requital charging merchants, and when?**
No billing mechanism exists and there are live merchants. Blocks the entire platform
layer.

**D2 · What is the pricing model?**
Flat monthly per shop; tiered by feature; tiered by usage; a transaction percentage; or
a hybrid. Determines whether PLT-2 metering is load-bearing from day one.
*Recommendation unchanged:* tiered by feature with a soft order-volume ceiling per tier.
**Now also needs a per-currency answer** — D6 means plan prices denominate in something,
and a Saudi merchant billed in AED while trading in SAR is a conversion problem in
Requital's own billing.

**D3 · What happens to the existing live merchants?**
Grandfather free indefinitely, migrate with notice, or negotiate individually. Must be
expressible in `shopsubscription` as a first-class state, not a code special-case.
*Recommendation unchanged:* grandfather explicitly with a named legacy plan.

**D4 · Which features are in which tier?**
Makes PLT-11's entitlement resolver useful rather than theoretical. Anything positioned
as a paid-tier differentiator needs the gate to exist before it ships.

**D5 · Free trial length, and what happens at the end?**

### Markets and compliance

**D7 · Which markets, in what order?** *(stakes raised by D6)*
Under base-currency-per-shop this was gated behind an unbuilt currency layer. With true
multi-currency delivered in Phase 2, KSA is technically reachable and **ZATCA Phase 2 is
the remaining gate** — mandatory, non-trivial, and its own integration. Kuwait, Bahrain
and Oman are smaller and are the reason three-decimal handling is a D6 requirement. This
is now a "which market justifies which compliance integration" question rather than a
"can we even" question.

**D8 · UAE e-invoicing: integrate an Accredited Service Provider, or export?**
*Recommendation unchanged:* export first (needed for ERP-16 anyway), ASP only once a
merchant is in scope of the mandate and asks.

**D9 · Controller vs processor, and is the DPA written?**
*Now partly addressed by §13*, which drafts the merchant-facing terms. The DPA itself is
still a separate legal deliverable.

**D10 · The BNPL instalment copy.**
`BnplWidgetCard.tsx` renders our own hardcoded instalment claims rather than the
providers' own messaging widgets. Get sign-off, revert, or accept knowingly.

**D11 · Consumer price display.**
DSC-1 is Phase 0. Separate acknowledgment that displaying one price and charging another
has a regulatory dimension, not only a product one.

### Vendors and integrations

**D16 · Which two payment gateways, and which two couriers?**
Market intelligence, not engineering. PayTabs and Network International; Careem Express
and Aramex are the obvious candidates. The right answer is whichever ones existing
merchants already use off-platform.

**D17 · Nomod: revive or delete?**
`BUILD_BRIEF.md` chose Nomod because it bundles cards + Tabby + Tamara + Apple Pay +
Google Pay in one integration. What shipped is four separate integrations and no
wallets. Reviving is the cheapest path to PAY-1. Leaving the stub is the only wrong
answer.

**D18 · Google Shopping — are prerequisites P1–P4 being pursued?**
`docs/plans/google-shopping-listing.md` is complete and gated on four unverified human
action items, one of which caps launch at ~50 merchants. If not being pursued, mark the
plan dormant so it stops reading as near-term.

### Engineering-adjacent

**D22 · Should `order_manager` see shop financials?**
Open from `docs/audit-2026-08.md` CONCERN #3.

**D23 · Native apps: ever?**

**D24 · Does `irmain.com` get re-verified?**

**D25 · Is the admin's fetch-on-mount-everywhere pattern acceptable at 10x?**

**D26 · Does the theme config's reset-not-migrate convention extend to new consumers?**
*Stakes unchanged, but now blocks NOV-9 in Phase 8.*

**D27 · When does a second application node become necessary?**

### Resolved by a locked decision

**D19 · How far into ERP does Requital go?** — **Resolved by D20.** General retail
widens the ERP case rather than narrowing it: purchasing, valuation, accounting export
and a CRM pipeline are *more* broadly applicable to general retail than to florists
specifically. The §4.9 arc and its stated stopping point (no general ledger, no payroll,
no work centres) stand unchanged. What changes is that ERP-29 event jobs and ERP-12
assembly orders move to Phase 7 as vertical depth. See §10.4.

**D21 · The four dead order toggles — build, hide, or delete?** — **Partly resolved.**
Phase 0 hides all four; that is now committed rather than recommended. Whether ASAP
delivery specifically gets built remains open and is a small Phase 5 item.

---

## 9.4 New work created by the locked decisions

| Decision | New section | New work |
|---|---|---|
| D20 | **§10** | General-retail re-justification pass — every "for this merchant base" claim re-examined and stated |
| D15 | **§11** | WhatsApp merchant notification scope: brokering model confirmed, constraints flagged, notification set, per-type preferences, build order |
| D13 | **§12** | Gift mode at checkout — full scope, including what else changes beyond the packing slip |
| D12 | **§13** | Draft ToS language for benchmarking and recipient data, with a stated lawyer-review gate |
| *(new scope)* | **§14** | Admin settings information-architecture audit and restructure |

---
---

# 10. THE GENERAL-RETAIL RE-JUSTIFICATION PASS

*Required by D20. Every proposal in this document that was justified — in whole or in
part — with florist, gifting, perishable or event-work reasoning, re-examined against a
general retail base. The verdict is stated, not implied.*

**Method.** I grepped my own document for every occurrence of "florist", "gifting",
"flower", "bouquet", "stem", "perishable", "wedding" and "merchant base", and worked
through every proposal those appear in. Each row below states the **original
justification**, whether it **still holds** for general retail, and what changes.

**Four verdicts are used:**

- **HOLDS** — the justification was vertical-flavoured but the underlying need is
  general. No priority change.
- **HOLDS, RE-FRAMED** — the need is general but the framing was wrong. The proposal
  survives with a different rationale, and the rationale matters because it changes what
  gets built.
- **NARROWS** — genuinely stronger for a subset. Stays on the list, drops in priority
  (Phase 7).
- **WEAKENS** — the vertical reasoning was doing most of the work. Reconsider.

---

## 10.1 Catalog and merchandising

| Item | Original justification | Verdict | What changes |
|---|---|---|---|
| **CAT-1** metafields | "the single thing most limiting for a florist/gifting merchant base, where the interesting product facts are stem count, vase included, occasion, colour family, seasonality, care instructions" | **HOLDS, RE-FRAMED** | The *argument* was vertical; the *need* is the opposite of vertical. A general retail platform needs metafields **more**, because it cannot anticipate any vertical's attributes. Every example in the original text becomes one pack's worth of definitions. Priority unchanged (Phase 2). |
| **CAT-1's preset pack** | "seed a florist/gifting definition set" | **HOLDS, RE-FRAMED** | Becomes **packs, plural** (see NOV-14 / §10.5). Ship the framework plus a florist pack, a general-retail pack (material, dimensions, warranty, country of origin, model number) and one more from the sales pipeline. |
| **CAT-24** care instructions / occasion / seasonality as first-class fields | "florist fields" | **HOLDS, RE-FRAMED** | Stops being a proposal at all and becomes *pack content* under CAT-1. Delete as a separate item; it is one pack's definition list. Occasion and seasonality are broadly useful (gifting, apparel, seasonal grocery); care instructions are apparel-relevant too. |
| **CAT-4** bundles | "a gifting merchant uses all three [pricing modes]" | **HOLDS** | Bundles are universal retail — electronics kits, cosmetics sets, grocery multipacks, apparel outfits. The gifting framing was incidental. Priority unchanged (Phase 8). |
| **CAT-25** build-your-own configurator | "pick stems, wrap, vase, card" | **NARROWS** | Real for florists, cake shops, hampers, custom furniture, PC builders — a genuine subset, not the base. Moves to Phase 7. Worth noting it generalises well *if* built on CAT-1 + CAT-4 rather than as a florist feature. |
| **CAT-15** swatch metadata on option values | *(no vertical claim)* | **HOLDS** | Apparel and cosmetics need this more than florists do. Arguably rises in priority under general retail. |

**Net effect on §2.1:** no priority changes except CAT-25 dropping to Phase 7 and CAT-24
being absorbed into CAT-1. The catalog domain was the least vertical-dependent section
of the document, which is itself informative — the general retail case for metafields is
stronger than the florist case I originally made.

## 10.2 Inventory and operations

| Item | Original justification | Verdict | What changes |
|---|---|---|---|
| **INV-4** lots, batch, expiry, FEFO | "For a florist, expiry is not a nice-to-have: perishable stock with a 5–10 day life is the defining constraint" | **HOLDS, RE-FRAMED** | **Stays in Phase 5.** Expiry is table stakes for grocery, pharmacy, supplements, cosmetics, food service, chemicals and anything with a batch code or a regulatory recall obligation — a large share of general retail, and in several of those it is a *legal* requirement rather than a merchandising one. FEFO is the correct allocation policy for all of them. The florist framing understated it. |
| **NOV-1** perishability engine (expiry-driven markdown) | "the most legible ROI story this product could tell a florist" | **NARROWS** | **Moves to Phase 7.** The *markdown automation* on top of lots is genuinely strongest where shelf life is days rather than months. A pharmacy with 18-month expiry does not need an automatic day-4 markdown curve. Still real for grocery, bakery, food service and flowers. Keep, deprioritise. |
| **NOV-6** buildability + reverse merchandising | "a made-to-order bouquet's availability"; "a screen a florist would open every morning" | **NARROWS** | **Moves to Phase 7.** Requires a BoM to be meaningful, and BoM-backed products are a subset of general retail (food service, assembly, kitting, made-to-order). The *third* sub-item — "what can I sell today, ranked by margin" — is nearly general and could be lifted out and generalised to plain stock, but that is a different, smaller feature. |
| **ERP-4** units of measure | "Roses arrive in boxes of 20 stems, priced per box, consumed per stem, counted per bucket" | **HOLDS** | Universal wholesale-purchasing problem. Buying cases and selling units is how nearly every retailer buys. The example was floral; the problem is not. Priority unchanged (Phase 5). |
| **ERP-1** double-entry stock locations | "where did 40 stems go" | **HOLDS** | Vertical-neutral. Shrinkage, wastage and stock conservation are general retail concerns. Priority unchanged (Phase 5). |
| **ERP-12** assembly orders | "30 identical Eid gift boxes on Tuesday for Thursday's orders" | **NARROWS** | **Moves to Phase 7.** Real for kitting, hampers, food prep, subscription boxes and manufacturing-lite retail — a defined subset. |
| **INV-21** ingredient substitution | "if no white roses, use cream" | **NARROWS** | **Phase 7.** Genuinely floral/food-service. Also useful in food service and any recipe-driven business. |
| **NOV-13** ingredient provenance | "Kenyan roses, arrived 2 days ago" | **NARROWS** | **Phase 7**, unchanged disposition (was already LATER). Origin/provenance is real for coffee, chocolate, produce, cosmetics and apparel sustainability claims — arguably *broader* than flowers, but still a positioning play rather than a base requirement. |
| **INV-2/INV-1** purchase orders and suppliers | "the thing a florist actually does every Sunday night" | **HOLDS** | The most vertical-neutral item in the document. Every retailer buys. Priority unchanged (Phase 5). |

**Net effect on §2.2 / §4:** the *ledger* work (INV-1, INV-2, INV-4, ERP-1, ERP-4) all
holds and stays in Phase 5. The *merchandising and assembly* work built on top of it
(NOV-1, NOV-6, ERP-12, INV-21) narrows and moves to Phase 7. That split is clean and it
is the main structural consequence of D20.

## 10.3 Orders, delivery and customers

| Item | Original justification | Verdict | What changes |
|---|---|---|---|
| **ORD-11** gift orders (recipient distinct from buyer, gift message, price-free packing slip) | implicit gifting framing | **HOLDS, RE-FRAMED** | **Rises.** Gift purchasing is a mode every retailer serves at least seasonally — electronics, apparel, books, cosmetics, toys. It is not a florist feature, it is a Q4 feature. Now formalised as **§12 gift mode** and confirmed by D13. |
| **CUS-14/15** recipient book and occasion reminders | "a customer who sends flowers to their mother, their assistant and three clients" | **HOLDS, RE-FRAMED** | Confirmed by D13 with both halves. The mechanism is "buyer ships to people who are not the buyer", which is gifting generally, corporate gifting, and any B2B drop-ship-to-site pattern. |
| **NOV-2** recipient-to-buyer attribution | "the most valuable acquisition channel a florist has" | **HOLDS, RE-FRAMED** | Confirmed by D13. The claim generalises to any gift-heavy category; the *magnitude* is largest where gifting share is highest. State it as "gift-heavy merchants" rather than "florists" in the merchant-facing framing. |
| **NOV-8** order-to-photo loop | "a florist's product is made to order and every unit is slightly different" | **HOLDS — explicitly retained by D20** | The made-to-order framing was too narrow. The general case: **the buyer never sees what was delivered, because it went to someone else.** That is true of every gift order in every category. Merchant-disableable, one extra send on an image already captured for proof of delivery. Stays Phase 5. |
| **SHP-5** driver dispatch | "the more common case for this merchant base, which is a shop with two vans and three drivers" | **HOLDS** | Local delivery with own drivers is general to any retailer doing same-day local — grocery, pharmacy, restaurants, furniture, hardware. Priority unchanged (Phase 5). |
| **ORD-10** recurring / standing orders | "weekly office flowers" | **HOLDS** | Subscription and standing orders are a general retail growth mechanic — coffee, pet food, supplements, cleaning supplies, print consumables. Priority unchanged (Phase 8, behind PAY-4). |
| **SHP-3 / NOV-3** slot capacity and trading modes | "a UAE florist's year is four or five days" | **HOLDS, RE-FRAMED** | Peak-day concentration is general retail — Black Friday, Ramadan, back-to-school, Eid, National Day, end-of-season. Any retailer with delivery capacity has a peak problem. The *specific* florist dates become one entry in a configurable occasion calendar (GLF-29, which narrows to Phase 7 as a content item, not a mechanism). |
| **GLF-28** prayer-time slot suppression | regional/religious operating pattern | **NARROWS** | **Phase 7.** Real and regionally valuable, but a preference a subset of merchants enable, not a base capability. Unchanged disposition, later phase. |
| **GLF-32** weather-aware delivery advisories | "48°C is a real problem for fresh flowers" | **NARROWS** | Already LATER; stays. Generalises to any temperature-sensitive product (chocolate, pharmaceuticals, produce, cosmetics) — arguably broader than flowers. |

## 10.4 ERP, CRM and events

| Item | Original justification | Verdict | What changes |
|---|---|---|---|
| **ERP-23** CRM pipeline | "the module a florist doing weddings and corporate accounts most obviously needs" | **HOLDS, RE-FRAMED** | Any retailer with a high-consideration or B2B sales motion needs a pipeline — furniture, appliances, trade supply, equipment, bulk/wholesale. The wedding framing was one instance. Priority unchanged (Phase 8). |
| **ERP-29** event/wedding jobs | "event work is where this merchant base makes its margin"; "the single most differentiated thing Requital could build for its actual customers" | **NARROWS** | **Moves to Phase 7.** Real for florists, caterers, event rental, AV hire, furniture installation, and any retailer whose delivery is an installation. That is a substantial subset — but it is a subset, and the claim that it is "the single most differentiated thing" was made under the vertical framing and does not survive D20. |
| **PAY-5** B2B | "a florist's corporate accounts are a real and high-value segment — hotels, offices, event planners, funeral homes" | **HOLDS** | B2B is more general than the florist example, not less. Trade supply, wholesale, office supply, hospitality supply. The regional differentiation argument (Shopify B2B is Plus-only; Salla and Zid have little) is unaffected. Priority unchanged (Phase 8). |
| **ERP-16/20** accounting export, VAT return prep | "a merchant's bookkeeper will thank them" | **HOLDS** | Entirely vertical-neutral. Arguably **rises** under general retail, since a broader base means more merchants already running a separate accounting system. |
| **§4's core thesis** ("absorb the 15% of Odoo a small retail business uses") | framed around "a UAE florist with two branches" | **HOLDS, RE-FRAMED** | D19 is resolved by D20 in the *widening* direction. The ERP-adjacent case is stronger for general retail, not weaker — a broader base means more merchants running a second system. The §4.9 arc and its stopping point stand. |

## 10.5 The vertical pack mechanism (NOV-14), re-specced

D20 keeps NOV-14 but changes what it is. Originally: "a florist signing up gets an
operational vertical as data." Now: **the pack framework is the product feature; any one
pack is content.**

What a pack contains, unchanged: metafield definitions (CAT-1), a collection tree, an
ingredient/component starter list with units (ERP-4), BoM templates where relevant,
default delivery zones for the shop's region, pre-written policy pages, a seasonal
occasion calendar, and a matched theme template.

What changes:

1. **Packs are plural and selected at signup**, from a picker, with "skip / set up
   manually" as a first-class option. Under the vertical framing the florist pack could
   be applied silently; under general retail it cannot.
2. **Ship three at minimum**, or the mechanism reads as a florist feature with extra
   steps: florist/gifting (the existing base), general retail (the honest default —
   material, dimensions, warranty, country of origin, model number, a shallow
   department tree), and one more chosen from wherever the sales pipeline actually is.
   **Which third pack is a business decision, not an engineering one** — added to §9.3
   as part of D20's consequences.
3. **A pack must be fully removable**, not just editable. A merchant who picks the wrong
   one at signup needs an undo, and "delete every definition and collection this pack
   created" is a real requirement the original proposal did not state.
4. **The pack format should be data, not code** — the opposite of the theme templates'
   D2 decision, and deliberately so. Theme templates are typed `ThemeConfig` literals
   because `tsc` is the drift guard against a shape that changes weekly. A vertical pack
   is a seed of ordinary rows against stable schemas, has no such drift risk, and
   benefits from being editable by someone who is not an engineer.

## 10.6 What D20 does *not* change

Stated because the temptation after a repositioning is to re-examine everything:

- **The whole of §2.6** (marketing), **§2.9** (analytics), **§2.13** (platform),
  **§2.14** (ops), **§7** (debt) and **§6** (blockers) contain no vertical reasoning at
  all and are unaffected.
- **§3 regional** is unaffected by D20 — regional is orthogonal to vertical. A general
  retail platform for the Gulf still needs Arabic, RTL, local rails, VAT and COD. The
  only §3 items that move are the ones that were vertical *and* regional (GLF-28
  prayer-time slots, GLF-29's specific occasion list, GLF-32 weather).
- **The BoM and OCR scan modules remain the two most differentiated things already
  built.** D20 does not reduce their value; it reframes who they are for. BoM serves
  food service, kitting and assembly as well as florists; OCR receipt-scanning serves
  every retailer who receives paper delivery notes, which is nearly all of them in this
  region.
- **The existing merchant base does not stop mattering.** Phase 7 exists precisely so
  that the florist-specific depth still gets built. D20 changes the order, not the list.
---
---

# 11. WHATSAPP — MERCHANT NOTIFICATION CHANNEL

*Required by D15. Platform-owned, merchant-facing only. No customer-facing sends.*

## 11.1 Your understanding of the brokering model — confirmed, with four flags

**The core of it is correct, and I'll say it plainly: for merchant-facing notifications
from a platform-owned number, no per-merchant WABA is needed at all.** Requital owns one
WhatsApp Business Account and one phone number; every merchant is simply a *recipient*.
The merchant supplies a phone number and receives messages. No SIM, no Meta Business
verification per merchant, no BSP onboarding, no display-name review, no per-merchant
template approval. Zero friction, exactly as you described.

This is also not new infrastructure — it is **the model the product already uses.**
`PLATFORM_WHATSAPP_PHONE_NUMBER_ID` / `PLATFORM_WHATSAPP_ACCESS_TOKEN` already power one
Requital-owned account that alerts the merchant's own outlet on every new order, queued
through the DB-backed job queue, recipient resolved as `outlet.whatsapp` falling back to
`outlet.phone`. D15 does not introduce a channel; it **expands one that exists** and
deletes the bring-your-own-credentials customer-facing path that sits beside it.

Four constraints you should have in front of you. None of them undermines the model;
one of them changes a design choice you made.

### Flag 1 — Interactive **list** messages cannot be business-initiated *(this changes a design choice)*

You asked for "interactive buttons **or** list messages". Templates support **quick-reply
buttons and call-to-action (URL / phone) buttons**. They do **not** support interactive
list messages. A list message is a *session* message type — it can only be sent inside an
open 24-hour customer-service window, i.e. after the merchant has messaged us first or
tapped a button.

Practically: `New order #1234 — [Confirm] [Reject] [View]` works as a template. A list
of twelve orders to triage does not, as an unprompted message. It *does* work as a
follow-up once the merchant has tapped anything, which is a genuinely useful second
step — tap `[View]`, get a list. Design the notification set around buttons and treat
lists as an in-session enhancement.

Button counts per template are limited and Meta has changed the limit more than once.
**Verify the current cap and the permitted button-type mix against the live Cloud API
docs before authoring the template set** — do not design a five-button template on my
recollection.

### Flag 2 — Template categories change the cost and the approval odds, and "platform announcements" is the odd one out

Templates are categorised **utility**, **marketing** or **authentication**, and Meta
prices per message by category. Nine of the ten notification types you listed are
utility — an order, a payment, a stock level, a delivery exception, a dunning notice are
all transactional communications about an existing relationship. Utility is the cheapest
category and the most reliably approved.

**Platform announcements are marketing**, and should be treated as a different thing:
more expensive, more likely to be rejected or throttled, and — under Meta's policy —
needing a separate opt-in from the utility opt-in. My recommendation is to put
announcements last (they are tier 5 in §11.4 for this reason), gate them behind their
own explicit toggle that is **off by default**, and be prepared for the answer to be
"use email for this".

**Staff 2FA codes are authentication category** and have their own rate and their own
template rules. They are also the one type where a delivery failure is a lockout, so
they need an email fallback path, not just a retry.

### Flag 3 — Button taps need an inbound webhook the product does not have, and that is where the real cost is

Today the WhatsApp integration is send-only. A tapped `[Confirm]` arrives as an **inbound
webhook** carrying the button's payload id. To act on it, the product needs:

- a `POST /whatsapp/webhook` route, `@Public()`, verifying Meta's
  `X-Hub-Signature-256` HMAC against the app secret;
- Meta's GET verification challenge handshake on the same route;
- the same do-the-minimum-then-enqueue shape the Slider webhook already uses
  (`SliderWebhookController` → a job → `SliderWebhookJobHandler`) — this is the
  established pattern in this codebase and it fits exactly;
- idempotency on the message id, using the `paymenttransaction`-style
  *insert-fails-means-already-processed* unique constraint rather than a check-then-act;
- status-callback handling (sent / delivered / read / failed) written to the existing
  `webhookevent` diagnostics log, so "did the merchant actually see it" is answerable.

**The inbound webhook is the majority of the build.** Sending is nearly free — the queue,
the provider and the platform credentials all exist. Receiving and acting is new.

### Flag 4 — A tapped button is an authorisation event, and phone numbers are currently unverified

This is the one I would not ship without answering, and it is not in your list.

If `[Confirm]` confirms an order, then **possession of a phone becomes a credential that
mutates shop data without a login.** Three concrete problems:

1. **The recipient number is never verified.** `outlet.whatsapp` is a free-text field
   with no confirmation step. A typo today sends a stranger the shop's order alerts —
   already a privacy leak in the existing feature, independent of buttons. With buttons
   it becomes a stranger who can confirm and reject orders. **A verification step (send
   a code, merchant confirms) is a prerequisite, and it is worth doing regardless of
   whether buttons ever ship.**
2. **The actor is an outlet, not a user.** `outlet.whatsapp` identifies a location, not a
   person, so `auditlog.actorUserId` has nobody to record. The precedent in this codebase
   is BNPL webhooks driving order status "under a synthesized system context" — do the
   same, but record the channel and the recipient number explicitly in
   `auditlog.metadata`, so the trail says *"confirmed via WhatsApp from +971…"* rather
   than attributing it to a human who did not act.
3. **Scope the actions to reversible ones.** `[Confirm]` advances `pending → confirmed`,
   which decrements stock but is reversible by cancel. `[Reject]` cancels, which restocks
   — also reversible in effect. Neither is destructive. **Do not put refunds, deletions,
   price changes or anything money-moving behind a button.** Additionally: put a
   single-use, time-bound token in the button payload rather than a bare order id, so a
   forwarded message cannot be replayed a week later.

One more, smaller: **a merchant who blocks the number breaks every notification for
their shop**, and blocking is what merchants do when a channel is noisy. That is the
strongest argument for the per-type preferences you asked for, and for conservative
defaults. Meta also scores the number's quality rating across all recipients, so one
shop's blocks degrade deliverability for every other shop — the same shared-reputation
problem MKT-3 solves for email by giving each merchant their own sending domain, and
which is **not** solvable the same way here, because the whole point of D15 is one shared
number. Conservative defaults are the only mitigation.

### What is genuinely free about this model

Worth stating alongside the flags, because the flags are the exceptions:

- One WABA, one number, one set of templates, approved once, covering every merchant.
- No per-merchant onboarding of any kind.
- Recipient count equals merchant count, so Meta's per-24-hour unique-recipient tiers are
  a non-issue for a long time.
- Opt-in is satisfied at signup and in settings, and is trivially recordable — the
  merchant is a party to a contract with Requital, which is the cleanest lawful basis
  available. (Record it explicitly with a timestamp anyway; it is the same
  consent-record shape CUS-11 needs.)
- Many follow-up messages land inside an open 24-hour service window because the merchant
  tapped a button, which is the cheaper path. Designing the notification set so common
  actions open a window is a real cost lever.

---

## 11.2 The notification set

Ten types, all merchant-facing, all **individually disableable** — per type, not just
globally, as specified.

| # | Type | Category | Trigger | Buttons | Default |
|---|---|---|---|---|---|
| **N1** | **New order** | utility | `PublicService.createOrder`, draft-order completion | `[Confirm] [Reject] [View]` | **ON** |
| **N2** | **Payment received** | utility | `PaymentsService.handleWebhook` → paid | `[View]` | **ON** |
| **N3** | **Payment failed / expired** | utility | webhook → failed, payment-link expiry | `[Resend link] [View]` | **ON** |
| **N4** | **Order stuck past its slot** | utility | sweep: `deliveryTimeSlot` passed, status not `delivered`/`cancelled` | `[Mark delivered] [View]` | **ON** |
| **N5** | **Delivery exception** | utility | Slider webhook failure states; SHP-5 driver marks failed | `[View] [Call customer]` | ON (once SHP-5) |
| **N6** | **Low stock** | utility | threshold crossing, batched | `[View inventory]` | **OFF** |
| **N7** | **Daily summary** | utility | cron at merchant-chosen hour | `[View dashboard]` | **OFF** |
| **N8** | **Approval request** | utility | STF-2 approval raised | `[Approve] [Decline] [View]` | ON (once STF-2) |
| **N9** | **Staff 2FA code** | **authentication** | STF-3 login step-up | none | ON (once STF-3) |
| **N10** | **Billing / dunning** | utility | PLT-1 invoice issued, payment failed, dunning escalation | `[Pay now]` (URL) | **ON, not disableable** |
| **N11** | **Platform announcement** | **marketing** | manual, platform-admin initiated | `[Read more]` (URL) | **OFF**, separate opt-in |

**Design notes on the defaults.** N1–N4 and N10 are on because missing them costs the
merchant money. N6 and N7 are off because they are the two most likely to make a busy
merchant block the number — low stock fires unpredictably often and a daily summary is
the definition of a message you stop reading. Let merchants opt into those deliberately.
N10 is the one type that is not disableable, for the same reason a bank does not let you
turn off overdue notices; it should still be rate-limited to one message per escalation
step, not one per retry.

**Batching matters more than the message copy.** N6 in particular must be a **digest**
(one message listing N items, once per day at most) rather than one message per product
— the existing low-stock digest email already has exactly this shape and its sweep can
be reused. A per-item WhatsApp message is how a shop with 400 SKUs blocks the number in
a week.

**Quiet hours.** Every type except N9 and N10 should respect a per-shop quiet-hours
window, defaulting to something sane in the shop's own timezone (which the shop row
already carries). A 03:00 low-stock alert is a block waiting to happen.

**Recipient.** Keep the existing resolution — `outlet.whatsapp` falling back to
`outlet.phone` — but make it **per outlet**, so a multi-branch merchant's branch manager
gets their own branch's orders. That is already how the current alert works and it is
correct. Add an optional shop-level number for the types that are not outlet-scoped
(N10 billing, N11 announcements, N7 daily summary).

---

## 11.3 Per-type preferences — the data model

`shopnotificationpreference` (`shopId`, `outletId` nullable, `channel`, `type`,
`enabled`, `quietHoursStart`, `quietHoursEnd`) with a composite unique on
`(shopId, outletId, channel, type)`.

Three reasons to build it generically across channels rather than as a WhatsApp table:

1. Every one of these eleven types has an **email** equivalent that either exists today
   (low-stock digest, order notifications) or will (billing, approvals, 2FA). One
   preference model covering `whatsapp | email | push` avoids a second one later.
2. It is the natural home for the **channel fallback** rule that N9 needs — 2FA over
   WhatsApp with email as the backstop is a per-type policy, not a per-channel one.
3. It gives §14's settings IA a single coherent surface to render (**Notifications**),
   instead of the current situation where notification toggles are scattered across
   Business Information, Store Configuration and Integrations → Messaging.

The existing `shop.notifyEmail`, `shop.notifyCustomersWhatsapp`,
`shop.notifyLowStockDigest`, `shop.notifyAbandonedCart` and the dead `shop.notifyWhatsapp`
all migrate into this table. That is five boolean columns replaced by rows, and it is the
single biggest cleanup available in the settings domain — see §14.4.

---

## 11.4 Build order

Five tiers. Each is independently shippable and each earns something on its own.

**Tier 1 — the channel, and the one message that already exists** *(M — Phase 3)*
The bulk of the cost, delivered once.

> **Decided 2026-09-10: `outlet.whatsapp` verification is a PREREQUISITE STEP of this
> tier, not an enhancement within it.** It ships and is enforced **before** any button
> or authorization flow is built, not alongside it. The ordering is the whole point: a
> button that mutates order state is only safe once the number receiving it is proven
> to belong to the merchant, and building both in one batch means the unsafe
> intermediate state exists in the tree. Sequence: verification → templates → inbound
> webhook → buttons. (Verification is also worth shipping on its own merits — the
> unverified free-text number is a live privacy leak in the *existing* send-only
> alert, independent of buttons: see §14.2 and Flag 4 above.)

- **Recipient phone verification** (send a code, merchant confirms) — **first, and
  landed before the rest of this tier.**
- Inbound webhook route with signature verification and the GET challenge handshake.
- Enqueue-then-process, mirroring `SliderWebhookController`.
- Message-id idempotency via a unique constraint.
- Status callbacks (sent/delivered/read/failed) into `webhookevent`.
- **N1 new order** re-authored from the current plain-text alert into an approved
  template with `[Confirm] [Reject] [View]`, single-use tokened payloads, system-context
  audit writes recording the channel and number.
- `shopnotificationpreference` with N1 as its first consumer.

**Tier 2 — the money messages** *(S — Phase 3, same round as PLT-1)*
- N2 payment received, N3 payment failed, N10 billing/dunning.
- N10 specifically must exist **before the first platform invoice is issued**, which is
  why tier 1 and 2 sit in Phase 3 rather than later.

**Tier 3 — the operational messages** *(S — Phase 3/4)*
- N4 order stuck past its slot (a new sweep, modelled on the abandoned-cart sweep's
  CAS-claim shape).
- N6 low stock, reusing the existing digest sweep.
- N7 daily summary, reusing ANL-1's rollups once they exist.
- Quiet hours.

**Tier 4 — the dependent messages** *(S each, as their features land)*
- N5 delivery exception → Phase 5, with SHP-5.
- N8 approval request → Phase 8, with STF-2.
- N9 2FA → Phase 8, with STF-3, plus the email fallback.

**Tier 5 — announcements** *(S — Phase 7, or never)*
- N11, separate opt-in, off by default, marketing category.
- Genuinely optional. If Meta's marketing-category cost or approval friction makes it
  awkward, drop it — a changelog page (PLT-15) and an email cover the need.

---

## 11.5 Dependencies and prerequisites, consolidated

| Prerequisite | Why | Where |
|---|---|---|
| Recipient phone verification | Unverified free-text numbers become an authorisation credential | Tier 1, **first — a prerequisite step, landed before templates, the webhook or any button** (decided 2026-09-10). Also fixes a live privacy leak in the existing alert. |
| Inbound webhook + signature verification | Button taps have nowhere to land | Tier 1 |
| Template library approved on the platform WABA | One approval covers all merchants; wording changes need re-approval | Tier 1, before any message ships |
| `shopnotificationpreference` | Per-type opt-out is the only mitigation for a shared number's quality rating | Tier 1 |
| Single-use tokened button payloads | A forwarded message must not be replayable | Tier 1 |
| ANL-1 rollups | N7's daily summary content | Tier 3 |
| SHP-5 / STF-2 / STF-3 / PLT-1 | N5 / N8 / N9 / N10 triggers | Tiers 2 and 4 |

---

## 11.6 What was dropped, and why — recorded so a reversal is a decision

D15 removes four proposals. Two of them I rated highly, and the reasoning for removal
should be visible next to the reasoning for having proposed them.

| Dropped | I had rated it | Removed because |
|---|---|---|
| **GLF-33** WhatsApp commerce — catalog sync, inbound customer threads, in-thread ordering, payment links in-thread | "the highest-conviction regional bet in this document" | Customer-facing sends are out of scope. Structurally, every part of GLF-33 except catalog sync requires messaging *shoppers*, which requires a per-merchant WABA (a shopper must see the merchant's identity, not Requital's), which is exactly the per-merchant onboarding friction D15 exists to avoid. **The two are not compatible** — you cannot do customer-facing WhatsApp from one platform-owned number without every shopper receiving messages from "Requital" about a shop they have never heard of. |
| **NOV-11** Storefront as a WhatsApp catalog | one of the four "genuinely novel" items I would ship | It was GLF-33's product framing. Without the integration it has no mechanism. Note that `shop.disableStoreCart` + `cartDisabledMode: 'contact_to_order'` **still exists and still works** — a merchant can still route the storefront into a WhatsApp thread; what is dropped is the platform closing that loop back into a real order. |
| **MKT-6** WhatsApp as a marketing channel | DIFFERENTIATOR, Phase 4 | Customer-facing. MKT-1 campaigns are email-only as a result. |
| **GLF-34** (duplicate of MKT-6 in §3.6) | — | Same. |

**The honest cost of D15.** In this region, WhatsApp open rates are far above email, and
a large share of small-merchant commerce genuinely happens in a WhatsApp thread. Dropping
the customer-facing half means MKT-1 campaigns compete on email against a channel
merchants already know works better, and it means the `contact_to_order` mode stays a
degraded path where orders placed by conversation remain invisible to the merchant's own
reporting.

**The honest benefit.** Per-merchant WABA onboarding — Meta business verification,
display-name review, number provisioning, template approval per merchant — is a real
operational commitment that would need staffing, and it is the reason the existing
bring-your-own-credentials WhatsApp integration in `whatsapp/` has seen the adoption it
has. D15 trades a large, uncertain, operationally heavy bet for a small, certain,
zero-friction one that starts paying off in Phase 3.

**What would reverse it.** A BSP partnership that automates merchant onboarding, or
enough merchant demand to justify staffing manual onboarding. If either happens, GLF-33
is still a good plan; it is dropped, not disproved.

---
---

# 12. GIFT MODE

*Required by D13. A merchant-configurable "Is this a gift?" toggle, OFF by default.
The packing-slip behaviour was specified; this section works out what else should
change, and what deliberately should not.*

## 12.1 The shape

Two settings, one shopper-facing control, one order flag.

- **`shop.giftModeEnabled`** (default `false`) — the merchant switch. Off means checkout
  renders exactly as today, byte-identically. This follows the convention the theme
  engagement established: an optional capability whose unset state is a provable no-op.
- **`shop.giftModeOptions`** — a small JSON blob for the sub-options in §12.2 that the
  merchant enables individually (wrap, gift receipt, recipient notification, date-hold).
- **`order.isGift`** (default `false`) — set when the merchant has enabled gift mode
  *and* the shopper ticks the box. Everything downstream branches on this one flag.
- Checkout renders an "Is this a gift?" checkbox only when `shop.giftModeEnabled`.

`order.receiverMessage` already exists and already carries a gift message verbatim to the
order — gift mode gives it a home rather than inventing a field.

## 12.2 What changes in gift mode — proposed

Ranked by confidence. The first four I would ship in v1; the rest are worth building and
can follow.

### Ship in v1

**G1 · Packing slip renders without prices, with the gift message.** *(specified)*
The `invoices` module already generates a per-`(orderId, type)` document. Add a
`gift_slip` type: line items and quantities, no unit prices, no totals, no payment
method, the gift message rendered prominently, and the buyer's name as "From:" unless
they chose to stay anonymous (G4). **Depends on §6-H invoice snapshots** — a document
whose content is regenerated from live order data is the wrong thing to hand a recipient.

**G2 · The recipient never receives a price, anywhere.** This is broader than the packing
slip and it is the part most easily missed. In gift mode:
- the order-confirmation email goes to the **buyer only**, never the recipient;
- the recipient's tracking link (if G5 is on) shows status, ETA and items — **no prices,
  no totals, no discount, no payment method**;
- the invoice is never sent to the recipient, and `customer-account`'s invoice endpoint
  must not serve it to a recipient-scoped session;
- any WhatsApp or SMS delivery update to the recipient omits money entirely.

Worth stating as a rule rather than a list, because new surfaces will be added later:
**in gift mode, money is buyer-only.**

**G3 · Gift receipt for the recipient.** A returns-enabling document with no prices —
order number, items, date, and a returns instruction. This is the Amazon/Shopify pattern
and it is what makes gift returns possible without revealing what was spent. It pairs
with ORD-3 (customer returns portal): a recipient with a gift receipt can initiate a
return, and the refund goes to **store credit for the recipient** (CUS-6), not to the
buyer's card — which is both the correct commercial behaviour and the reason CUS-6 is a
soft dependency here.

**G4 · Gift wrap and card as configurable add-ons.** The catalog already has
`product.isCheckoutAddon` driving a checkout upsell popup. Gift wrap is exactly that,
with two differences: it should be offered **only when `isGift` is ticked**, and it
should be a per-shop-configurable product rather than a hardcoded fee, so a merchant can
price and stock it (and, with a BoM, consume wrapping materials). Small extension of an
existing mechanism, real revenue.

### Ship in v2

**G5 · Recipient notification — with the consent constraint honoured.**
"A gift from Sarah is on its way, arriving Thursday between 2 and 4pm." Genuinely useful:
it gets someone to be home, which reduces failed deliveries measurably.

**But the recipient did not opt in**, and this is exactly the boundary D12/D13 draws.
The rules that keep it defensible, per §13.2:
- the **buyer** enters the recipient's number and is shown, at checkout, that the
  recipient will be messaged;
- the message is **transactional only** — a delivery notification about a specific
  order, never marketing, never a discount code, never a newsletter opt-in;
- one message per delivery event, not a sequence;
- an unsubscribe/stop path on the first message;
- and — given D15 — it goes by **SMS or email, not WhatsApp**, since WhatsApp
  customer-facing sends are out of scope. This is a real constraint: SMS is a channel the
  product does not have (MKT-18, currently LATER), so **G5 either waits for SMS or ships
  email-only**. Email-only is fine for a v2 and is the recommendation.

**G6 · "Deliver on the day, not before."** A gift for a birthday on the 14th delivered on
the 12th is a spoiled surprise. Gift mode should surface an explicit "do not deliver
early" flag that the fulfilment run sheet (ORD-12) and the driver view (SHP-5) both
respect, and that blocks the "we had capacity, we sent it Tuesday" behaviour a merchant
would otherwise consider helpful.

**G7 · Recipient-fills-their-own-address (the gift-link pattern).**
The buyer does not always know the recipient's address. Shopify and several gifting
platforms solve this with a link the buyer sends to the recipient, who fills in their own
address and preferred slot. Mechanically: create the order with a placeholder address and
a `pending_address` state, issue a tokenised public link (the exact shape
`order.trackingToken` and the survey token already use), and hold fulfilment until it is
filled. This is the single most requested gifting feature I would expect once G1–G4 ship,
and it is a natural fit for the tokened-public-page pattern the codebase already has
three instances of.

**G8 · Gift orders as a first-class analytics dimension.** `order.isGift` in the ANL-1
rollups gives a merchant "18% of December revenue was gift orders, with 2.3× the average
order value" — which is the number that justifies enabling everything else in this
section. Nearly free once the flag exists.

**G9 · Returns policy branches on gift.** A gift return refunds the recipient in credit
(G3) rather than the buyer's card by default, and the buyer is not notified — otherwise
the return itself reveals the gift was returned. Small rule, real embarrassment avoided.

## 12.3 What deliberately does not change

- **Nothing when `giftModeEnabled` is false.** No new checkout field, no new document
  type offered, no behaviour change of any kind. Byte-identical.
- **The buyer stays the `customer`.** `order.customerId` continues to point at the
  purchaser; the recipient is a separate `recipientId` (CUS-14). Loyalty, LTV, segments
  and order history all continue to attribute to the buyer, which is correct.
- **Gift mode does not imply a recipient book entry.** A shopper can tick "this is a
  gift" without saving the recipient. Saving is a separate, opt-in action — otherwise
  every one-off gift address pollutes the recipient book, which is the failure mode the
  current addresses-JSON already has.
- **No gift registries, wishlishes-as-gifting, or group gifting.** Adjacent, larger,
  and not asked for. Out of scope; noted so the absence is deliberate.

## 12.4 Dependencies and effort

| Item | Effort | Depends on |
|---|---|---|
| G1 gift packing slip | S | §6-H invoice snapshots |
| G2 money-is-buyer-only rule | S | — |
| G3 gift receipt + recipient store credit on return | M | CUS-6, ORD-3 |
| G4 gift wrap add-on | S | `isCheckoutAddon` (exists) |
| G5 recipient notification | S (email) / M (SMS) | §13 ToS live; MKT-18 for SMS |
| G6 do-not-deliver-early | S | ORD-12, SHP-5 |
| G7 recipient-fills-address gift link | M | tokened-public-page pattern (exists) |
| G8 gift analytics dimension | S | ANL-1 |
| G9 gift return policy branch | S | G3 |

**Total for v1 (G1, G2, G3, G4): M.** Phase 4, alongside CUS-14's recipient model, which
G1–G9 all assume.
---
---

# 13. DRAFT TERMS-OF-SERVICE LANGUAGE

*Required by D12. The current ToS was AI-drafted rather than author-written and is
treated as fully editable. This section drafts what the terms need to say for
**NOV-4 cross-tenant benchmarking** and **NOV-2 recipient attribution** to be
defensible.*

> ## ⚠ A lawyer must review this before it goes live.
>
> This is engineering-side drafting: it states what the product actually does, in the
> shape a lawyer needs in order to turn it into enforceable terms. It is **not legal
> advice and is not fit to publish as written.** Three things specifically need
> qualified review: whether the stated lawful basis for recipient data holds under UAE
> PDPL (and KSA PDPL if D7 opens that market), whether the benchmarking clause is
> sufficient consideration for the data use it describes, and whether the
> controller/processor allocation in §13.3 is correctly drawn. The user has said they
> will verify the wording; that is a separate and additional step to legal review, not a
> substitute for it.

**Two documents, not one.** The merchant-facing **Terms of Service** governs Requital's
relationship with the merchant. The shopper-facing **Privacy Policy** — which each
merchant publishes on their own storefront via the existing `policypage` mechanism —
governs the merchant's relationship with their shoppers and recipients. §13.1 and §13.3
belong in the first; §13.2 needs language in **both**, because the merchant is the
controller and Requital is the processor.

---

## 13.1 Cross-tenant benchmarking (NOV-4) — merchant Terms of Service

### What the product actually does

Computes aggregate statistics across shops from the ANL-1 rollup tables, and shows a
merchant where their own metrics sit within a distribution of comparable shops. A
merchant sees a percentile band, never another shop's figures, never another shop's
identity, and never a cohort small enough to infer either.

### Draft clause

> **Aggregated Insights and Benchmarking**
>
> **1. What we do.** We calculate aggregated, statistical measures across Shops using
> the platform — for example median order value, typical repeat-purchase rate, or
> typical gross margin — and may show you where your Shop sits relative to those
> measures.
>
> **2. What you see.** Benchmarks are presented only as ranges, percentiles or medians
> for a group of Shops. You will never be shown another Shop's data, another Shop's
> identity, or any figure attributable to an individual Shop.
>
> **3. Minimum group size.** We will not produce or display a benchmark for any group
> containing fewer than **ten (10)** Shops. Where a group would fall below that
> threshold, no benchmark is shown.
>
> **4. No personal data.** Benchmarks are derived from commercial and operational
> metrics only. They do not incorporate, and are never derived at the level of, any
> individual customer, recipient or other identifiable person.
>
> **5. No re-identification.** We will not use aggregated data to identify an individual
> Shop to any other Shop or to any third party, and we will not publish benchmarks in a
> form that would permit a Shop to be identified.
>
> **6. Your choice.** You may opt out of contributing your Shop's data to benchmark
> calculations at any time, in your Shop settings. If you opt out, your data is excluded
> from all future benchmark calculations and you will also no longer see benchmarks. Opt
> out does not affect any other part of the Service.
>
> **7. Our own use.** We may use aggregated, non-identifying platform metrics to operate,
> secure, support and improve the Service, and to describe the platform in general terms
> (for example, "the median Shop on Requital processes N orders per month"). We will not
> use them to disclose or imply the performance of any individual Shop.

### What each clause is doing, and where it binds engineering

| Clause | Engineering obligation |
|---|---|
| 3 — minimum group size | A **hard k-floor of 10** enforced in the query layer, not the UI. A cohort of 9 must return "not enough comparable shops", not a value the UI happens not to render. Add a spec asserting it. |
| 4 — no personal data | Benchmarks read `dailyshopmetrics` / `dailyproductmetrics` only. **Never `customermetrics`.** Enforced by which tables the benchmark service is allowed to query. |
| 5 — no re-identification | A cohort defined narrowly enough (business type + emirate + size band) can identify a shop even at k=10. Cohort definitions need a review step, and single-dimension coarsening when a cohort is too tight. |
| 6 — opt out | `shop.benchmarkingOptOut`, honoured on both the read path (they see nothing) and the write path (their rows are excluded from every aggregate). Symmetric, and the symmetry is the point — the clause promises both. |
| 7 — our own use | Marketing claims about the platform draw from the same aggregates and the same k-floor. Not just a legal line; a constraint on what the marketing site may say. |

### Notice, not just terms

A terms change alone is thin cover for a new data use on existing merchants. Recommend:
notify existing merchants in advance, default the opt-out to **off** (i.e. participating)
only for merchants who accept the revised terms after notice, and default existing
merchants to **opted out** until they have seen the notice. That is more conservative
than strictly necessary and it removes the argument entirely.

---

## 13.2 Recipient data and attribution (NOV-2) — both documents

This is the harder half, and the reason D12 needed deciding at all: **a gift recipient
never agreed to anything.** They gave no consent, they have no account, and their
name, phone and address are in the system because someone else typed them.

### What the product actually does

Three distinct uses, with three different risk profiles. They should be separated in the
terms, because collapsing them is what makes this indefensible.

1. **Storing and using recipient data to fulfil the order.** Uncontroversial. Necessary
   for delivery; the lawful basis is performance of the contract with the buyer, and
   there is no realistic alternative — you cannot deliver to someone without their
   address.
2. **The buyer's recipient book and occasion reminders (CUS-14/15).** The reminder goes
   to the **buyer**, about their own saved contact. No message reaches the recipient. The
   data subject whose inbox is touched is the buyer, who has an account and a
   relationship. Low risk, and it is the majority of NOV-2's retention value.
3. **Recipient-to-buyer attribution (NOV-2's platform half).** When a phone number that
   has only ever appeared as a recipient later places its first order, attribute it.
   **This is analytics on a person who never opted in**, and it is the clause that
   actually needs drafting.

### Draft — merchant Terms of Service

> **Recipient Information**
>
> **1.** Where you or your customers provide information about a person who is to receive
> an order but who is not the purchaser (a "Recipient"), you remain the controller of
> that information and we process it on your instructions in order to provide the
> Service.
>
> **2.** You are responsible for ensuring you have a lawful basis for providing Recipient
> information to us and for any communication you direct us to send to a Recipient.
>
> **3.** We will use Recipient information only to fulfil and support the relevant order,
> to provide the features you have enabled in your Shop, and as described in clause 4.
> We will not use Recipient information to market to a Recipient on our own behalf.
>
> **4.** Where a Recipient later becomes a customer of your Shop, we may record that
> connection and report it to you as an aggregate statistic (for example, "N% of your new
> customers this period had previously received a gift from an existing customer"). We
> will not disclose to you which specific customer was previously a Recipient of which
> specific order.

### Draft — shopper-facing Privacy Policy (the merchant publishes this)

> **If someone sends you something**
>
> When a customer places an order to be delivered to you, we receive your name, delivery
> address and, where provided, your phone number or email address. We use this only to
> deliver the order and to tell you about that delivery.
>
> We do not add you to any marketing list, and we do not send you promotional messages,
> because someone sent you a gift.
>
> If you later shop with us yourself, we may record — for our own statistics only — that
> you first came to us as a gift recipient. This is used to understand how our customers
> find us. It is never shared with the person who sent you the gift, and it is never
> shared outside our business.
>
> You can ask us at any time to tell you what information we hold about you, to correct
> it, or to delete it. [contact details]

### The engineering rules the drafting depends on

These are not optional decoration — the clauses above are only true if these hold:

| Rule | Why | Where enforced |
|---|---|---|
| **No cold marketing to a recipient, ever.** | The whole clause set collapses if a recipient receives a promotional message. NOV-2's "15% off your own order" idea from §5 is therefore **not** a cold send. | Recipients are structurally excluded from every campaign audience (MKT-1) and every flow (MKT-2). Not a filter that can be toggled off — an exclusion at the audience-resolution layer, with a spec. |
| **The recipient-to-buyer link is reported as an aggregate only.** | Clause 4 promises exactly this. A merchant seeing "Fatima Al-X first received a gift from Sarah Y" is a different and much worse product. | The attribution surface returns counts and rates, never a joined row. Enforced by the endpoint's response shape, not by the UI choosing not to render it. |
| **The invitation to a recipient rides on the delivery, or comes from the buyer.** | §5's NOV-2 already said this; it is now a terms obligation. A QR on the gift card, or a buyer-triggered share, is the buyer's act, not ours. | Product design constraint on how NOV-2's "convert the recipient" mechanic is built. |
| **Recipient deletion cascades.** | Open question D14 in the pre-decision §9, now answerable. | When a buyer exercises deletion, their saved recipients are deleted with them. When a *recipient* asks for deletion, their `recipient` rows are anonymised the same way `customer` rows already are — PII scrubbed, order FKs kept. The existing customer-anonymisation code is the pattern; extend it, do not invent a second one. |
| **A recipient who becomes a buyer becomes a normal customer.** | Once they have an account and consent, the recipient-origin flag is history, not an ongoing constraint. | `customer.acquisitionSource = 'gift_recipient'`, set once. Marketing eligibility then follows their own consent record (CUS-11), like any other customer. |
| **Retention.** | Terms should state one. | Recipient rows not linked to any order in N months are purged by the OPS-12 retention sweep. Pick N with the lawyer; 24 months is a defensible starting point. |

### The one thing I would flag to the lawyer specifically

Clause 4's aggregate reporting is the novel part and the part most likely to attract
comment. The safe framing is that it is **statistical analysis for the merchant's own
business insight**, k-floored like §13.1, disclosing nothing about an individual. The
risk is that a regulator reads it as profiling of a non-consenting data subject. Ask
specifically about that, and ask whether the aggregate needs its own minimum-count floor
(I would apply one: no attribution statistic rendered below 10 attributed customers).

---

## 13.3 Controller / processor allocation

Not new, but §13.2 depends on it being stated, and the pre-decision §9 D9 flagged that no
DPA exists. The terms need a clause establishing:

- the **merchant is the controller** of shopper and recipient personal data;
- **Requital is the processor**, acting on the merchant's documented instructions;
- Requital is the **controller** of merchant account data (the merchant's own staff
  details, billing, usage) — a separate relationship, easy to conflate;
- the benchmarking use in §13.1 is Requital acting as **controller of aggregated,
  non-personal commercial metrics**, which is why §13.1 clause 4 is careful to say no
  personal data is involved. If benchmarking ever touched customer-level data it would
  need a different basis entirely.

A **Data Processing Addendum** is a separate document and is still outstanding (D9). It
is the thing a corporate customer's procurement team will ask a merchant for, and the
merchant will forward the request to you.

## 13.4 What has to exist in the product before these terms are true

| Terms promise | Product prerequisite | Phase |
|---|---|---|
| Benchmark k-floor of 10 | Query-layer enforcement + spec | 8 (with NOV-4) |
| Benchmark opt-out, symmetric | `shop.benchmarkingOptOut` on read and write paths | 8 |
| No marketing to recipients | Audience-layer exclusion in MKT-1/MKT-2 | 4 |
| Aggregate-only attribution | Endpoint response shape | 4 |
| Recipient deletion cascade | Extend the existing customer-anonymisation flow | 4 |
| Recipient retention purge | OPS-12 sweep | 4 |
| Consent records per channel | CUS-11 | 4 |

**Which means the ToS revision is a Phase 0 document task with Phase 4 and Phase 8
engineering obligations attached.** Drafting early is free and legal review has a lead
time; shipping the clauses before the enforcement exists would be the mistake.
---
---

# 14. ADMIN SETTINGS — INFORMATION ARCHITECTURE AUDIT

*New scope, 2026-09-10. The settings panel is a dumping ground; this audits it
properly, and sizes the restructure against the ~60 settings this document adds.*

---

## 14.1 The current architecture, mapped

There is **no persistent global navigation** in the admin. `TopBar.tsx` is a logo, a
"View store" link and a user menu. Navigation happens through a tile grid on the home
page, the command palette, and per-section sub-navs. That is the frame everything below
sits in, and it matters: a merchant who wants a setting has no way to scan for it.

```
Home tile grid — 12 tiles, 3 groups
├─ "Storefront": Dashboard · Orders · Products · Inventory · Theme · Bio Links
├─ "Growth":     Affiliate · Customers · Reports
└─ "System":     Activity Log · Settings · Integrations

Settings  (/settings → redirect → /settings/business → redirect → /settings/business/information)
└─ SettingsTabs — horizontal, 4
   ├─ Business Settings
   │  └─ BusinessSettingsSubNav — vertical, 6
   │     ├─ Business Information      (~24 settings)
   │     ├─ Domain                    (2 + verification state)
   │     ├─ Store Configuration       (~22 settings, incl. 5 dead)
   │     ├─ Online Presence           (~9)
   │     ├─ SEO                       (4)
   │     └─ Policy Pages              (5 documents)
   ├─ Outlets
   │  └─ list → outlet edit → OutletEditSidebar — 5 tabs
   │     ├─ Basic Info    (7 outlet + 4 SHOP-WIDE + 4 read-only shop mirrors)
   │     ├─ Address       (outlet geo + radius + delivery zones)
   │     ├─ Delivery      (2 outlet + 11 SHOP-WIDE)
   │     ├─ Pickup        (1 outlet + 7 SHOP-WIDE)
   │     └─ QR
   ├─ Users               (staff CRUD + branch roles)
   └─ Failed Jobs         (platform diagnostics)

Integrations  — separate top-level tile, 4 tabs
├─ Delivery (default, at bare /integrations) · Payments · Messaging · Webhooks

Theme  — separate top-level tile
├─ /theme                      theme library
├─ /theme/[id]/builder         34 theme-settings categories, full-bleed editor
└─ /theme/edit/*               legacy Layout mode — 4 more pages
```

**Depth to reach a common setting:** tile → tab → sub-nav → card, after two redirects.
Changing the VAT rate is: Settings tile → Outlets tab → pick an outlet → Basic Info →
scroll to "Order Setting". Five navigations, in a section named after a *place*, for a
setting that applies to the whole business.

---

## 14.2 Complete settings inventory

Every merchant-editable setting that exists today, where it lives, and its status.
**Status key:** ● live · ◐ live but misplaced · ○ dead (no consumer) · ▲ shop-wide
setting rendered inside an outlet page.

### Settings → Business Settings → **Business Information** (24)

| Setting | Column | Status |
|---|---|---|
| Store published | `published` | ● |
| Logo | `logoUrl` | ● |
| Display Name | `displayName` | ● |
| Business / Brand Name | `name` | ● |
| Legal Business Name | `legalName` | ● |
| Trademark format (3 presets) | `trademarkFormat` | ● |
| Email | `email` | ● |
| Description | `description` | ● |
| Country (settable once, then locked) | `country` | ● |
| Address | `address` | ● |
| TRN | `trn` | ● |
| Website URL | `websiteUrl` | ● |
| Operating model | `operatingModel` | ● |
| Branch count | `branchCount` | ● |
| Allow WhatsApp Notifications | `notifyWhatsapp` | **○ DEAD** — documented as such in `order-notifications.service.ts:40` |
| Allow Email Notifications | `notifyEmail` | ● |
| Send abandoned cart recovery emails | `notifyAbandonedCart` | ● |
| Wait before sending (minutes) | `abandonedCartWindowMinutes` | ● |
| Send a daily low-stock summary email | `notifyLowStockDigest` | ● |
| Auto-deduct ingredient stock | `autoDeductIngredientStock` | ◐ inventory policy, filed under business identity |
| Product editor mode (simple/advanced) | `productEditorMode` | ◐ a catalog UX preference, filed under business identity |

### Settings → Business Settings → **Store Configuration** (22)

| Setting | Column | Status |
|---|---|---|
| Business Type | `businessType` | ● |
| **Currency** | `currency` | ◐ 7 options offered; only AED renders correctly (§1.9) |
| **Default Language** | `defaultLanguage` | **○ DEAD** — no i18n layer exists |
| Default Delivery Fee | `defaultDeliveryFee` | ● |
| Tax Display Text | `taxDisplayText` | ◐ the *label*; the rate itself is on an outlet page |
| Product Display Orientation | `productDisplayOrientation` | ● |
| Product image zoom | `productImageZoomEnabled` | ● |
| Show collection menu | `showCollectionMenu` | ● |
| Allow pre-orders | `allowPreOrders` | **○ DEAD** |
| Customer confirmation required | `customerConfirmationRequired` | **○ DEAD** |
| Business Hours | `businessHours` | ◐ one of **four** hour configurations (see P4) |
| External delivery enabled | `externalDeliveryEnabled` | ● |
| ASAP delivery enabled | `asapDeliveryEnabled` | **○ DEAD** |
| Delivery calendar enabled | `deliveryCalendarEnabled` | **○ DEAD** |
| Birthday discount enabled | `birthdayDiscountEnabled` | **○ DEAD** — honestly labelled in-place |
| Disable store cart | `disableStoreCart` | ● |
| Cart disabled mode | `cartDisabledMode` | ● |
| Customer survey enabled | `customerSurveyEnabled` | ● |
| Dynamic theme builder | `dynamicThemeBuilderEnabled` | **○ DEAD** — correctly under "Coming Soon" |

### Settings → Business Settings → **Online Presence** (9) · **SEO** (4) · **Domain** (2) · **Policy Pages** (5)

| Setting | Column | Status |
|---|---|---|
| Social links (Instagram, TikTok, Facebook, X, Snapchat, YouTube, LinkedIn) | `socialLinks` | ● |
| Meta title, meta description, OG image, keywords | `shopseosettings.*` | ● |
| Custom domain + type + verification | `customDomain`, `domainType`, `customDomainStatus` | ● |
| Terms / Privacy / Refund / Payment / Shipping | `policypage` × 5 | ● |

### Settings → Outlets → *(an outlet)* → **Basic Info**

| Setting | Column | Status |
|---|---|---|
| Name, Name in Arabic | `outlet.name`, `outlet.nameAr` | ● |
| Email, Phone, WhatsApp | `outlet.email/phone/whatsapp` | ● **unverified free text** (§11 Flag 4) |
| Country, Time Zone, Currency, Default Language | shop mirrors | ● read-only, correct |
| Hours | `outlet.businessHours` | ● |
| **Same-day orders** | `shop.allowSameDayOrders` | **▲ SHOP-WIDE** |
| **Next-day orders** | `shop.allowNextDayOrders` | **▲ SHOP-WIDE** |
| **Tax Rate (%)** | `shop.taxRate` | **▲ SHOP-WIDE** — and the only place a merchant can set VAT |
| **Tax Type (inclusive/exclusive)** | `shop.taxInclusive` | **▲ SHOP-WIDE** |

### Settings → Outlets → *(an outlet)* → **Delivery**

| Setting | Column | Status |
|---|---|---|
| Delivery enabled, radius | `outlet.deliveryEnabled`, `deliveryRadiusKm` | ● |
| Delivery zones (name, fee, min order, map centre + radius) | `deliveryzone` | ● (radius never read — D-3) |
| **Card online / Cash on delivery / Card on delivery** | `shop.deliveryPayment*` × 3 | **▲ SHOP-WIDE** — and two clicks from Integrations → Payments, which decides whether "card online" can work at all |
| **Delivery hours** | `shop.deliveryHours` | **▲ SHOP-WIDE** |
| **Time slot gap, prep time, prep+delivery time** | `shop.delivery*Minutes` × 3 | **▲ SHOP-WIDE** |
| **Estimated delivery time from / to / unit** | `shop.estimatedDeliveryTime*` × 3 | **▲ SHOP-WIDE** |
| **Same-day cutoff** | `shop.sameDayCutoffTime` | **▲ SHOP-WIDE** (added 2026-09-08, with a code comment acknowledging it) |

### Settings → Outlets → *(an outlet)* → **Pickup**

| Setting | Column | Status |
|---|---|---|
| Pickup enabled | `outlet.pickupEnabled` | ● |
| **Card online / Cash on pickup / Card on pickup** | `shop.pickupPayment*` × 3 | **▲ SHOP-WIDE** |
| **Pickup hours** | `shop.pickupHours` | **▲ SHOP-WIDE** |
| **Time slot gap, prep time, prep+pickup time** | `shop.pickup*Minutes` × 3 | **▲ SHOP-WIDE** |

### Integrations (separate top-level app)

| Tab | Contents | Status |
|---|---|---|
| **Delivery** | Slider enable + account id (platform-set); Lalamove card | ● |
| **Payments** | Card processor choice; per-gateway enable + encrypted credentials; Telr/PayTabs shown as "Coming soon" | ● |
| **Messaging** | WhatsApp country code + number; notify customers via WhatsApp; floating button; WhatsApp Business API credentials; send test | ◐ mixes merchant contact identity, a storefront widget toggle, and API credentials |
| **Webhooks** | Read-only inbound diagnostics | ◐ **misleadingly named** (PLT-6) |

### Theme (separate top-level app)

| Surface | Contents |
|---|---|
| `/theme/[id]/builder` | 34 theme-settings categories (Colors, Typography, Motion, Radius, Density, Buttons, Badges, Icons, Product Cards, Prices, Popovers, Drawers, Cart, Inputs, Search, Swatches, Variant Pickers, Product Page, Collection Page, Page Layout, Floating Elements, Logo, Custom CSS, Animations …) |
| `/theme/edit/*` | Legacy Layout mode — 13 categories, only effective when no Sections theme is published |

**Approximate total: ~110 merchant-editable settings across 17 surfaces in 3 apps,** of
which **9 are dead** and **22 are shop-wide settings rendered inside an outlet page.**

---

## 14.3 The problems, named

### P1 · Twenty-two shop-wide settings are edited from inside an outlet *(the sharpest problem)*

`OutletBasicInfoTab`, `OutletDeliveryTab` and `OutletPickupTab` each call **both**
`updateOutlet()` and `updateShop()`. Four, eleven and seven shop-wide fields
respectively.

> **Corrected 2026-09-10** (found while building the `fix/shop-wide-scope-warning`
> stopgap). An earlier draft of this paragraph said *"Nothing in the UI indicates which
> is which."* **That was wrong.** Three of the five cards carrying these fields already
> render a static hint: *"These apply shop-wide, across every outlet, not just this
> one."* — `OutletBasicInfoTab`'s "Order Setting", `OutletDeliveryTab`'s "Delivery
> Settings" and `OutletPickupTab`'s "Pickup Settings". `OutletBasicInfoTab` carries a
> second, separate hint for the four read-only shop mirrors.
>
> The accurate finding is narrower and more useful: **the coverage is partial, and it
> is partial in the worst possible way.** Two of the five cards have **no hint at all**
> — `OutletDeliveryTab`'s "Operation Settings" (8 of that tab's 11 shop-wide fields:
> time slot gap, preparation time, preparation + delivery time, the three
> estimated-delivery-time inputs, and the same-day cutoff) and `OutletPickupTab`'s
> "Preparation Time Settings" (3 of its 7). Each of those unhinted cards sits directly
> below a hinted one **and shares its Save button**. So a merchant who reads carefully
> learns that payment methods and hours are shop-wide, and reasonably concludes that
> the prep times in the next card down are not.
>
> Two further weaknesses in the hint that survive the correction: it is `text-xs
> text-text-faint`, the faintest style in the design system, placed above a long card;
> and it is passive — it never fires at the moment of the change.

Concrete consequences:

- A merchant with three outlets sees the VAT rate on three pages. Changing it on one
  changes it everywhere. **The VAT rate's own card is one of the three that does carry
  the static hint** — which is precisely why the hint is not sufficient on its own: it
  was present, and the problem was still worth a dedicated fix.
- The same is true of delivery hours, prep times, estimated delivery windows, the
  same-day cutoff and every accepted payment method. A branch manager "adjusting their
  branch's prep time" silently changes it for every branch.
- **The VAT rate has no other home.** The only route to `shop.taxRate` in the entire
  admin is through an outlet's Basic Info tab. A single-outlet merchant will never
  guess; a multi-outlet merchant will assume it is per-outlet.
- `shop.taxDisplayText` (the label, e.g. "Including VAT") is in Store Configuration
  while `shop.taxRate` and `shop.taxInclusive` are on an outlet page. **The three halves
  of one decision are in two different sections.**

The code is honest about this in one place — the `sameDayCutoffTime` migration comment
explains the shop-level choice and even names the future per-outlet path — and the UI
is honest on three of five cards. Neither reaches the two unhinted cards, and neither
speaks at the moment a value actually changes.

**Partly mitigated (`fix/shop-wide-scope-warning`, 2026-09-10).** A confirm dialog now
fires on any save from an outlet page that would change one of the 22, naming exactly
what is about to change shop-wide, across all 22 fields and therefore across the two
previously unhinted cards. It fires only when a value genuinely changed, so an
outlet-only save is unaffected. **This is a strengthening of partial coverage, not a
fill of total absence, and it is explicitly a stopgap** — it warns about the
misplacement rather than correcting it. The fix is §14.4's reorganisation, which moves
these fields to Settings → Selling → Money & Tax and Settings → Fulfilment and deletes
the dialog along with `admin/lib/shop-wide-fields.ts`.

### P2 · Payment methods and payment gateways are two halves of one decision, in two apps

Whether a shop accepts "Card online" at delivery is on the outlet's Delivery tab.
Whether a card processor is enabled and has credentials is in Integrations → Payments.
`resolvePaymentMethods` already encodes the dependency — it will not offer online card
unless the processor is actually enabled — but the merchant configuring it has to hold
both surfaces in their head, in different top-level apps, with no cross-link.

### P3 · "Store Configuration" is not a category

It contains: business type, currency, language, delivery fee, tax label, product display
orientation, image zoom, collection menu, pre-orders, customer confirmation, business
hours, external delivery, ASAP delivery, delivery calendar, birthday discount, cart
disabling, cart fallback mode, post-purchase survey, and a Coming Soon card. That is at
least six unrelated concerns — money, locale, catalog display, fulfilment, engagement,
checkout — under one heading whose only meaning is "other".

It is also where **5 of the 9 dead settings live**, which is not a coincidence: a page
with no organising principle is where things get put when there is nowhere obvious.

### P4 · Four separate hours configurations, in three places

| Hours | Column | Where |
|---|---|---|
| Shop business hours | `shop.businessHours` | Store Configuration |
| Outlet business hours | `outlet.businessHours` | Outlet → Basic Info |
| Delivery hours | `shop.deliveryHours` | Outlet → Delivery ▲ |
| Pickup hours | `shop.pickupHours` | Outlet → Pickup ▲ |

Three of the four are shop-wide, one is per-outlet, and no page explains the
relationship or which one wins. `outlets/outlet-status.ts` resolves open/closed from the
outlet's own hours; slot generation uses the shop-level delivery/pickup hours. A merchant
cannot discover that from the UI.

### P5 · Notification settings are scattered across three sections in two apps

| Setting | Where |
|---|---|
| Allow Email Notifications | Business Information |
| Allow WhatsApp Notifications *(dead)* | Business Information |
| Abandoned cart emails + delay | Business Information |
| Daily low-stock summary | Business Information |
| Notify customers via WhatsApp | Integrations → Messaging |
| WhatsApp floating button *(a storefront widget, not a notification)* | Integrations → Messaging |
| Post-purchase survey email | Store Configuration |

Seven notification-adjacent controls, four locations, no single answer to "what does my
shop send, to whom, and when". §11 adds eleven more types.

### P6 · Nine dead settings, six of them indistinguishable from working ones

`notifyWhatsapp`, `allowPreOrders`, `customerConfirmationRequired`, `asapDeliveryEnabled`,
`deliveryCalendarEnabled`, `birthdayDiscountEnabled` sit in normal card bodies.
`defaultLanguage` offers an Arabic option that selects nothing. `currency` offers seven
options of which six render incorrectly. Only `dynamicThemeBuilderEnabled` is honestly
labelled. Phase 0 fixes the labelling; the IA needs a *place* for "configured but not yet
active", which the Coming Soon card is a prototype of.

### P7 · Failed Jobs is a top-level Settings tab

Platform diagnostics given equal prominence to Outlets and Users. A merchant will open
it once, not understand it, and never return. It belongs in a support/diagnostics area
with the webhook log — which is currently in Integrations, a third place.

### P8 · Two redirects to reach the default settings page

`/settings` → `/settings/business` → `/settings/business/information`. Harmless
technically, but it means "Settings" has no landing page — no search, no overview, no
"recently changed", no guidance. For ~110 settings, the absence of an index is the
single biggest findability cost.

### P9 · Theme is a third settings app with 34 more categories

Defensible — it is a visual editor with a live preview and genuinely different
interaction needs. But `productDisplayOrientation`, `productImageZoomEnabled` and
`showCollectionMenu` are storefront-presentation settings living in Store Configuration,
while everything else presentational is in the theme builder. The boundary is not drawn
anywhere.

### P10 · The structure has no room for what is coming

This document adds roughly sixty settings: multi-currency (base currency, presentment
currencies, rate source, rounding policy), regions and zones, tax classes, per-type
notification preferences across three channels (§11), gift mode and its sub-options
(§12), trading modes (NOV-3), plan and entitlements (PLT-1/2/11), benchmarking opt-out
(§13), supplier and purchasing defaults, driver and dispatch settings, slot capacity,
API keys and outbound webhooks (PLT-4/5), sending domains (MKT-3), analytics and pixel
credentials (MKT-4).

Under the current IA the honest prediction is: most land in Store Configuration, a few
in Integrations, notifications get a fourth location, and the dumping ground doubles.

---

## 14.4 Proposed information architecture

Two principles, chosen because they are the two the current structure violates most:

1. **Group by the merchant's question, not by the table the column lives in.** "What do
   I charge and how do I get paid" is one question, currently answered in four places.
2. **Scope is a visible property, never inferred from location.** Every setting is
   labelled shop-wide or per-outlet at the point of editing. This is what P1 breaks, and
   it is why the fix cannot be "move the 22 fields" alone.

### The proposed tree

```
Settings                                    ← a real landing page: search, groups, recent
│
├─ Business
│   ├─ Profile                identity, logo, legal name, TRN, address, contact, description
│   ├─ Plan & Billing         NEW — PLT-1/2/3: plan, usage, invoices, payment method
│   └─ Domain                 unchanged
│
├─ Selling
│   ├─ Money & Tax            NEW SURFACE — currency, presentment currencies, rate source,
│   │                          rounding, tax classes, tax-inclusive, tax-on-delivery,
│   │                          tax display text     ◀ fixes P1's worst case + P3
│   ├─ Checkout               cart mode, addon prompt, required fields, gift mode (§12),
│   │                          customer accounts mode, post-purchase survey
│   └─ Payments               card processor, per-gateway credentials, accepted methods
│                              per delivery/pickup   ◀ fixes P2 by merging both halves
│
├─ Fulfilment
│   ├─ Delivery               shop-wide delivery hours, slots, prep times, estimates,
│   │                          same-day cutoff, blackout dates, slot capacity
│   ├─ Pickup                 shop-wide pickup hours, slots, prep times
│   ├─ Zones & Regions        NEW SURFACE — region-based zones (§6-E), distance rules (SHP-1)
│   ├─ Couriers               Slider, external delivery, future providers
│   └─ Drivers                NEW — SHP-5, when it lands
│
├─ Outlets
│   └─ (an outlet)            ONLY per-outlet fields: name, contact, address, geo,
│                              radius, own hours, pickup/delivery enable, QR
│                              ◀ 22 shop-wide fields removed; each replaced by a
│                                read-only summary + "Change for all outlets →" link
│
├─ Notifications              NEW SURFACE — one matrix: type × channel × on/off,
│                              recipients, quiet hours (§11.3)   ◀ fixes P5
│
├─ Storefront
│   ├─ Theme →                deep-link into the theme builder (unchanged)
│   ├─ SEO                    unchanged
│   ├─ Policy Pages           unchanged
│   ├─ Online Presence        social links
│   └─ Display                the three orphans from Store Configuration ◀ fixes P9
│
├─ Operations
│   ├─ Inventory              auto-deduct, negative-stock policy, low-stock defaults,
│   │                          units of measure
│   ├─ Suppliers & Purchasing NEW — INV-1/2, when they land
│   └─ Trading Modes          NEW — NOV-3 dated operational overlays
│
├─ Team
│   ├─ Users                  unchanged
│   ├─ Roles & Permissions    STF-1, when it lands
│   └─ Security               2FA, sessions, password policy (STF-3/4/5)
│
├─ Developer                  NEW — PLT-4/5: API keys, outbound webhooks, event log
│
├─ Data & Privacy             NEW — benchmarking opt-out (§13), consent settings,
│                              export, retention
│
└─ Diagnostics                webhook activity (renamed, PLT-6) + failed jobs  ◀ fixes P7
```

### How this absorbs what is coming

| New settings from this document | Home |
|---|---|
| Multi-currency, rate source, rounding, tax classes | Selling → Money & Tax |
| Regions, distance rules, zones | Fulfilment → Zones & Regions |
| §11 per-type notification preferences (3 channels × 11 types) | Notifications *(one matrix, not 33 toggles)* |
| §12 gift mode + sub-options | Selling → Checkout |
| NOV-3 trading modes | Operations → Trading Modes |
| PLT-1/2/11 plan, usage, entitlements | Business → Plan & Billing |
| §13 benchmarking opt-out, consent, retention | Data & Privacy |
| MKT-3 sending domains, MKT-4 pixel credentials | Notifications / Storefront respectively |
| INV-1/2 supplier defaults | Operations → Suppliers & Purchasing |
| SHP-3 slot capacity, SHP-5 drivers | Fulfilment |
| PLT-4/5 API keys, webhooks | Developer |

Every new group has a stated question it answers, which is the property that stops it
becoming Store Configuration again.

### The three highest-value individual moves

If the full restructure is too much at once, these three carry most of the value:

1. **Create Selling → Money & Tax** and move `taxRate`, `taxInclusive`, `taxDisplayText`
   and `currency` into it. Fixes the worst instance of P1 and the whole of P3's money
   scatter. Small.
2. **Strip the 22 shop-wide fields out of the outlet tabs** into Fulfilment → Delivery
   and Fulfilment → Pickup, leaving a read-only summary and a link. Fixes the rest of P1.
   Medium.
3. **Create Notifications** as one matrix and migrate the five scattered boolean columns
   into `shopnotificationpreference` (§11.3). Fixes P5 and is a hard prerequisite for
   §11 anyway. Medium.

---

## 14.5 Reorganisation or new surfaces? And what it costs

**Both, and the split is roughly 60/40.**

| Work | Kind | Effort |
|---|---|---|
| Settings landing page with search and groups (P8) | **New surface** | S |
| Re-parent existing pages under the new tree; new sub-navs | Reorganisation | S |
| Selling → Money & Tax | **New surface**, assembled from existing fields | S |
| Selling → Payments (merge accepted-methods + gateways) | Reorganisation across two apps | M |
| Fulfilment → Delivery / Pickup (the 22 fields) | Reorganisation + read-only outlet summaries | M |
| Notifications matrix + `shopnotificationpreference` migration | **New surface** + a real migration | M |
| Storefront → Display (three orphans) | Reorganisation | S |
| Diagnostics (webhook log + failed jobs, renamed) | Reorganisation | S |
| Data & Privacy, Developer, Operations, Team → Security | **New surfaces**, mostly empty until their features land | S each |
| Deprecate "Store Configuration" as a name | Reorganisation | — |

**Total: M, plus an S in Phase 0 for the decision and the spec.**

That is cheap because almost none of it is backend work. Every setting already has an
endpoint; `PATCH /shop` takes a partial DTO, so a field moving between pages needs no API
change. The exception is the notification migration, which replaces five boolean columns
with rows and is the one piece with a real backend and data component.

**Sequencing:** spec in Phase 0, build in Phase 2 alongside the multi-currency, region
and tax-class work — because those three land ~15 new settings and Money & Tax plus
Zones & Regions are exactly where they go. Building the structure first and the settings
into it is strictly cheaper than the reverse.

`tools/check-page-width.js` and the settings-page layout convention in `CLAUDE.md`
(cards, grid density, `Toggle` not `Checkbox` for status, responsive collapse) apply
unchanged and should be honoured by every new surface.

---

## 14.6 What would break a merchant's muscle memory

Flagged as requested. Ranked by how much it would hurt.

| Move | Risk | Mitigation |
|---|---|---|
| **Tax rate leaves the outlet page** | **Highest.** It is the only current route, so anyone who has ever set VAT learned this path. A merchant who cannot find it assumes it is gone. | Leave an in-place read-only row on the outlet's Basic Info showing the current rate with "Set for all outlets →". Keep it for at least one release cycle. |
| **Delivery/pickup hours, slots and prep times leave the outlet tabs** | **High.** Eleven and seven fields respectively — the densest configuration in the product, and the one a merchant revisits seasonally. | Same treatment: read-only summary plus link. Also add the label the UI never had — "these apply to all outlets" — which is arguably a bugfix delivered as part of the move. |
| **Accepted payment methods move to Selling → Payments** | **Medium.** Currently reached while configuring delivery, which is when a merchant thinks about them. | Cross-link both ways. Fulfilment → Delivery shows the accepted methods read-only with a link. |
| **"Store Configuration" disappears as a name** | **Medium.** It is a top-level label a merchant has learned, even if it means nothing. | Keep the route resolving with a pointer card listing where each of its settings went — the exact pattern `MovedToIntegrations.tsx` already established for the Payments and Delivery Providers moves. **Reuse that component; do not invent a second one.** |
| **Notification toggles consolidate** | **Medium.** Four locations become one. | The consolidation is the feature. Pointer cards on the old locations; a one-time in-app note. |
| **Failed Jobs moves out of the Settings tab bar** | Low. | Pointer card. |
| **Integrations stops being a separate top-level tile** | **Do not do this.** | Integrations is a coherent, well-named app with its own recent history (Payments and Delivery Providers were deliberately moved *into* it, and those redirect pointers exist and are documented). Absorbing it into Settings would be the second reorganisation of the same pages in six months. **Leave Integrations where it is** and have the Settings tree link into it. |

**One documented workflow to check before moving anything:** `docs/runbook.md`'s
"custom domain connected but no cert" triage references Settings → Business Settings →
Domain by name. Domain does not move in this proposal, but any settings-path rename needs
a grep of `docs/` and `CLAUDE.md` for hardcoded navigation paths before it ships.

**And one that is not muscle memory but is worse:** `AccountSetup.tsx`, the signup
wizard, deep-links into Settings → Business Settings → Domain (CD7) and sets
`productEditorMode` on its Review step. Both are code paths, not merchant habits, and
both break silently if a route moves. Grep `admin/` for `/settings/` string literals as
part of the move — there are several.

---
---

# Appendix A — Cross-reference index

Items referenced from more than one section, so a reader arriving at any one of them
finds the others.

| Item | Also appears as | Sections |
|---|---|---|
| Metafields | CAT-1 | §2.1, §2.13 (apps), §4 (ERP mapping), §8 Phase 2 |
| Auto-discount redemption | DSC-1, D-1 | §1.4, §2.7, §7.1, §8 Phase 0 |
| Tax classes / `chargeTax` | I18N-5, D-2 | §1.1, §1.9, §2.10, §7.1, §8 Phase 2 |
| Distance-based delivery | SHP-1, D-3, GLF-24 | §1.7, §2.8, §3.4, §7.1, §8 Phase 2 |
| Region model / `EMIRATES` | §6-E, I18N-6, GLF-24 | §1.9, §2.10, §3.4, §6, §8 Phase 2 |
| Fulfilments / one-outlet-per-order | ORD-1, §6-B | §1.3, §2.3, §6, §8 Phase 8 |
| Invoice snapshots | §6-H, D-4, I18N-10 | §2.10, §6, §7.1, §8 Phase 2 |
| Store credit ledger | CUS-6 | §2.5, §2.3 (exchanges), §8 Phase 4 |
| Margin / `orderitem.unitCost` | ANL-6, D-5, ERP-13 | §1.8, §2.9, §4.3, §7.1, §8 Phase 1 |
| Analytics / pixels | MKT-4 | §1.6, §2.6, §2.9, §8 Phase 1 |
| Per-shop sending domains | MKT-3, NOV-15 | §2.6, §5, §8 Phase 4 |
| Suppliers + purchase orders | INV-1, INV-2, ERP-2 | §1.2, §2.2, §4.2, §8 Phase 5 |
| Lots / expiry | INV-4, NOV-1, NOV-13 | §1.2, §2.2, §5, §8 Phase 5 |
| Double-entry stock locations | ERP-1 | §4.1, §8 Phase 5 |
| Driver dispatch | SHP-5, MOB-4, GLF-8 | §1.7, §2.8, §3.2, §8 Phase 5 |
| Slot capacity | SHP-3, ORD-19, NOV-7, NOV-16 | §2.3, §2.8, §5, §8 Phase 5 |
| Trading modes | NOV-3, GLF-27/28/30/31 | §3.5, §5, §8 Phase 5 |
| Recipient book | CUS-14/15, NOV-2, ORD-11 | §2.3, §2.5, §5, §8 Phase 4 |
| WhatsApp commerce | GLF-33, NOV-11, MKT-6, CUS-17 | §2.5, §2.6, §3.6, §5, §8 Phase 8 |
| i18n / RTL | §6-C, I18N-1/2/3, GLF-1/6 | §1.9, §2.10, §3.1, §6, §8 Phase 2+6 |
| Billing / entitlements | PLT-1/2/11, §6-F | §1.12, §2.13, §6, §8 Phase 3, §9.1 |
| Public API + webhooks | PLT-4/5/6 | §1.12, §2.13, §7.2, §8 Phase 7 |
| Backups + alerting | OPS-1/2, D-18/19 | §1.13, §2.14, §7.5, §8 Phase 0 |
| Vertical packs | NOV-14, ONB-8 | §2.12, §5, §8 Phase 6, §9 D20, **§10.5** |
| **Gift mode** | ORD-11, G1–G9 | §2.3, §2.5, **§12**, §8 Phase 4 |
| **WhatsApp merchant notifications** | N1–N11 | §1.6, **§11**, §8 Phases 3–7 |
| **WhatsApp customer-facing** *(dropped)* | GLF-33, NOV-11, MKT-6, GLF-34 | §2.6, §3.6, §5, **§9.2, §11.6** |
| **ToS revision** | benchmarking + recipient clauses | **§13**, §8 Phase 0, §9 D12 |
| **Settings IA restructure** | P1–P10 | **§14**, §8 Phases 0 and 2c |
| **General-retail re-justification** | D20 consequences | **§10**, §8 Phase 7 |
| Shop-wide settings inside outlet pages | §14 P1 | **§14.2, §14.3, §14.6** |

---

# Appendix B — Proposal count by disposition

**Revised 2026-09-10** for the locked decisions. Four proposals moved to DROPPED (D15);
one was absorbed (CAT-24 into CAT-1, D20); the YES set is otherwise unchanged in
membership — D20 changed *phasing*, not disposition, for the eight items it narrowed.

| Section | Proposals | YES | LATER | NO | DROPPED |
|---|---|---|---|---|---|
| §2.1 Catalog | 25 | 14 | 8 | 2 | — *(CAT-24 absorbed into CAT-1)* |
| §2.2 Inventory | 22 | 14 | 5 | 3 | — |
| §2.3 Orders | 20 | 16 | 4 | 0 | — |
| §2.4 Payments | 20 | 13 | 6 | 1 | — |
| §2.5 Customers | 20 | 17 | 3 | 0 | — |
| §2.6 Marketing | 23 | 16 | 5 | 1 | 1 *(MKT-6)* |
| §2.7 Discounts | 16 | 13 | 2 | 1 | — |
| §2.8 Shipping | 18 | 14 | 3 | 1 | — |
| §2.9 Analytics | 16 | 14 | 2 | 0 | — |
| §2.10 i18n / tax | 15 | 12 | 3 | 0 | — *(I18N-4 LATER → DECIDED/YES)* |
| §2.11 Staff | 14 | 10 | 3 | 1 | — |
| §2.12 Onboarding | 12 | 10 | 2 | 0 | — |
| §2.13 Platform | 16 | 12 | 3 | 1 | — |
| §2.14 Ops | 17 | 14 | 3 | 0 | — |
| §2.15 Content | 10 | 8 | 2 | 0 | — |
| §2.16 Mobile | 8 | 5 | 1 | 2 | — |
| §2.17 AI | 13 | 7 | 4 | 2 | — |
| §3 Regional | 38 | 25 | 8 | 3 | 2 *(GLF-33, GLF-34)* |
| §4 ERP | 42 | 17 | 15 | 10 | — |
| §5 Novel | 16 | 9 | 4 | 2 | 1 *(NOV-11)* |
| §12 Gift mode *(new)* | 9 | 9 | — | — | — |
| §11 WhatsApp notifications *(new)* | 11 | 11 | — | — | — |
| §14 Settings IA *(new)* | 1 restructure | 1 | — | — | — |
| **Total** | **402** | **281** | **86** | **30** | **4** |

The YES count is not a plan. §8's phases select roughly 65 of those for Phases 0–3 and
sequence the rest behind them; the remainder are on the record so that a later decision
to build one is a decision, not a discovery.

**Phase distribution of the YES set** (§8, post-revision):

| Phase | Items | Character |
|---|---|---|
| 0 | 12 | Correctness, ops, and two document tasks |
| 1 | 11 | Measurement |
| 2 | 18 | **Money, geography, foundations** — the largest and riskiest |
| 3 | 7 | Billing + the WhatsApp channel |
| 4 | 18 | Retention, recipient graph, gift mode |
| 5 | 21 | Operations depth, general-retail core |
| 6 | 14 | i18n, migration, compliance |
| 7 | 11 | **Vertical depth** — new, created by D20 |
| 8 | 22 | Platform, fulfilments, subscriptions, B2B |
