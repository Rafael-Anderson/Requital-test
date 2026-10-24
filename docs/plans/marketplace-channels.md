# Marketplace channels (Deliveroo, Talabat): facts, design, hand-off

Status: E0 (facts) and E1 (framework) are merged (#260). E2 (Deliveroo provider and webhook endpoint, SANDBOX ONLY, built on branch `feat/marketplace-deliveroo`, section 13), E3 (Talabat provider, behind an in-repo simulator until a contract, credentials and a sandbox exist; built on branch `feat/marketplace-talabat`) and E4 (admin UI) build on the interface described here. Everything ships **disabled**: no provider is registered in production by E1, `channelconnection.enabled` defaults to 0, and the feature flag `marketplace_channels` defaults to false.

Rule used throughout: **VERIFIED** means read on a public documentation page (URL and date given). **INFERRED** means reasoned from those pages or from this codebase and not confirmed by the vendor. No date or commitment is promised to or on behalf of either marketplace.

## 1. Sources read

All pages were fetched as public documentation (GET of the docs sites only). No marketplace API was called, no credential was used, and no page was login-gated except where listed. Read on 2026-10-13 and 2026-10-14.

| Page | Result |
|---|---|
| https://api-docs.deliveroo.com/docs/order-integration.md | read |
| https://api-docs.deliveroo.com/docs/picking.md, picking-api-overview.md, picking-api-webhook.md, price-related-fields.md | read |
| https://api-docs.deliveroo.com/docs/securing-webhooks.md | read |
| https://api-docs.deliveroo.com/docs/authentication.md | read |
| https://api-docs.deliveroo.com/docs/test-webhooks.md | read |
| https://api-docs.deliveroo.com/docs/site.md | read |
| https://api-docs.deliveroo.com/docs/prep-stages-endpoint.md | read |
| https://api-docs.deliveroo.com/docs/refund-webhook.md | read |
| https://api-docs.deliveroo.com/docs/menu-api-overview.md | read (summarised) |
| https://api-docs.deliveroo.com/docs/introduction.md, help-faq.md | read |
| https://api-docs.deliveroo.com/deliveroo/reference/order-events-webhook-1 (Order Events webhook schema) | read, first 100,000 of 121,492 characters |
| https://api-docs.deliveroo.com/deliveroo/reference/get-order-v2 (Get Single Order Details) | read |
| https://api-docs.deliveroo.com/deliveroo/reference/patch-order-1 (Update Order Status) | read |
| https://api-docs.deliveroo.com/reference/post-create-test-order | read |
| https://api-docs.deliveroo.com/deliveroo/docs/cancelled-orders.md | read |
| https://api-docs.deliveroo.com/reference/put_v2-brands-brand-id-sites-site-id-menu-item-unavailabilities | read (first 100,000 of 119,069 characters) |
| https://api-docs.deliveroo.com/deliveroo/reference/get-orders-v2, create-sync-status-1, put-order-events-webhook-1 | **only the titles and links were seen; the request and response details were not read** |
| Deliveroo Retail "integration guide" (a Google Drive file linked from `introduction.md`) | not fetched (not a docs-site page) |
| https://developer.talabat.com/en/documentation/api-partner-api-overview, sandbox-sandbox-testing | read |
| .../pos-partner-picking-overview, -how-to-integrate, -use-cases, -testing-the-integration, -faq | read |
| .../pos-pelican-picking-overview, -how-to-integrate, -use-cases, -faq, -troubleshooting | read |
| .../outlet-management-api-use-cases-endpoints-explained | read |
| .../catalog-api-overview, catalog-api-use-cases | read |
| Talabat promotions pages, the "api-specifications" page (404), and the regional Swagger at developers.deliveryhero.com | **not read / not reachable** |

Deliveroo's "Rider Status", "Promotions" and "Site" APIs exist in the docs but the owner cannot use them yet (section 7), so their request details were not studied beyond `site.md`.

## 2. VERIFIED: Deliveroo

Two API suites matter (`introduction.md`): the **Partner Platform Suite** (restaurants: Order API, Menu API, Site API) and the **Retail Platform Suite** (grocery and non-food retailers: Catalogue API and Picking API). Which one a florist or gift shop belongs to is not stated (open question Q1).

**Order events (Order API).**
- Two events on the Order Events webhook: `order.new` and `order.status_update` (`order-integration.md`; schema page). Headers `x-deliveroo-payload-type` (`event/order.new` or `event/order.status_update`) and `x-deliveroo-webhook-version` (`"1"`).
- Order status enum: `pending`, `placed`, `accepted`, `confirmed`, `rejected`, `canceled`. `status_log` is a list of `{status, at}` and "is the source of truth for ordering". `order.new` carries only `placed`.
- The order carries `id` (`{market}:{uuid}`), `order_number`, `display_id`, `location_id`, `brand_id`, `fulfillment_type` (`deliveroo`, `restaurant`, `customer`, `table_service`, `autonomous`, `catering`), `asap`, `prepare_for`, `start_preparing_at`, `confirm_at` (scheduled orders only), money fields `subtotal`, `total_price`, `partner_order_subtotal`, `partner_order_total`, `offer_discount`, `cash_due`, `bag_fee`, `surcharge`, `fee_breakdown`, `items[]` (each with `pos_item_id`, `name`, `quantity`, `unit_price`, `total_price`, `menu_unit_price`, `discount_amount`, nested `modifiers[]`, `item_fees`), `promotions[]`, `remake_details`, `customer` (`first_name`, `contact_number`, loyalty id), and `delivery` (restaurant-fulfilled only). Money is `{fractional, currency_code}` in minor units.
- **Absent from the order schema (VERIFIED by reading it): any tax field, any commission field, any acceptance-deadline field.** `get-order-v2` says the same. So tax and commission are stored as NULL for Deliveroo orders unless Deliveroo supplies them another way (Q5).
- `item.total_price` is documented two ways: "per-unit price including modifiers, before discounts" and, for test orders, "already the line total". Do not multiply by quantity for test orders. Verify against a live payload.
- Delivery guarantees: "order and timing are not guaranteed, and duplicates are possible. Deduplicate and use `status_log` for ordering." On an error response Deliveroo retries **up to 6 minutes for ASAP orders and 30 minutes for scheduled orders** (schema page). The Picking webhook page says 2xx is success, retries use exponential back-off with a circuit breaker, and "for order statuses we give up and discard the event callback after 30 minutes" (`picking-api-webhook.md`).
- Cancellation arrives as `order.status_update` with `status: canceled`. The integration "must acknowledge canceled order events to be considered functional" with a 200 (`cancelled-orders.md`).

**Accept and reject** (`patch-order-1`): `PATCH /v1/orders/{order_id}` with `{"status": "accepted" | "rejected" | "confirmed"}`; `reject_reason` is one of `closing_early`, `busy`, `ingredient_unavailable`, `other` (required for a rejection), optional `notes`; `confirmed` is for scheduled orders after acceptance. Transitions: `placed`→`accepted`, `placed`→`rejected`, `accepted`→`confirmed`; anything else is **409** `invalid_status_transition`. Other answers: 204 success, 400, 401, 500, **503 `order_not_ready` with a `Retry-After` header**. **Rate limit 5 requests per minute per order.** Servers: production `https://api.developers.deliveroo.com/order/`, sandbox `https://api-sandbox.developers.deliveroo.com/order/`.

**Acceptance deadline.** "An ASAP order not accepted within 10 minutes is rejected automatically. The window is **7 minutes for Kuwait and UAE**" (`patch-order-1`). `order-integration.md` also says "10 minutes (this timeout may be different depending on your region)". There is no deadline field in the payload; E2 must derive it (placed time from `status_log` plus the market window). **Three auto-rejections within 15 consecutive minutes close the site** (`site.md`, reason `CLOSED_PERIOD`). This is why the merchant alert and the stale sweep matter commercially.

**Webhook signature** (`securing-webhooks.md`): headers `X-Deliveroo-Sequence-Guid` and `X-Deliveroo-Hmac-Sha256`; HMAC-SHA256 keyed by the webhook secret, hex digest, over `<guid> + " " + <raw request body>` (a single space; a space-newline-space separator applies only to the legacy `new_order`/`cancel_order` POS webhooks). The raw bytes must be used. The secret is provided by Deliveroo after the endpoints are configured. **No timestamp and no replay protection are documented.**

**Authentication** (`authentication.md`): OAuth 2.0 client credentials, form-encoded POST of `client_id`, `client_secret`, `grant_type=client_credentials`, `Authorization: Bearer <token>`, `expires_in` 300 seconds. That page gives the token URLs `https://auth-sandbox.developers.deliveroo.com/oauth2/token` (sandbox) and `https://auth.developers.deliveroo.com/oauth2/token` (production). The OpenAPI pages instead name `https://deliveroo-api.auth.eu-west-1.amazoncognito.com/oauth2/token`. **The two disagree** (Q4). Scopes are not documented.

**Test orders and sandbox** (`test-webhooks.md`, `post-create-test-order`): `POST /v1/orders/test_order/create` on the sandbox server. The request has no `location_id` or `brand_id`. `test_webhooks` takes delays for `new`, `accepted`, `canceled`, `rejected` and the `rider_*` events. Test orders do not appear on tablets, need no accept or sync status, and "you should use a different webhook URL from production or test orders will land in production". The legacy POS webhook cannot be tested. **No go-live checklist or certification process is in the public docs** (section 8 is therefore our own list).

**Other endpoints seen:** `GET /v2/orders/{order_id}` (1 request per second per order, nothing older than 30 days), a `Get Orders` list (title only seen: a candidate polling fallback, Q8), `POST /v1/orders/:order_id/prep_stage` with `in_kitchen`, `ready_for_collection_soon`, `ready_for_collection`, `collected` (the ready signal "should never be triggered automatically"), Site API under `https://partners.deliveroo.com/api/v1/brands/{brandId}/sites/{siteId}/` (`opening_hours`, `status`, `days_off`, `workload/mode`, `workload/times`), Menu API (`PUT /v1/brands/{brand_id}/menus/{id}`, asynchronous, a `menu.upload_result` webhook, item `unavailable`/`hidden` endpoints, 1 request per minute per site for replace-all, items identified by the partner-supplied id / PLU), and the refund webhook (`refund_id` is the idempotency key, enabled per brand).

## 3. VERIFIED: Talabat (public Partner API)

The public Talabat documentation is the Delivery Hero partner API, written around **Partner Picking and Pelican Picking** (grocery-style picking), plus Promotions, Outlet Management and Catalog. Host `https://talabat.partner.deliveryhero.io`.

- **Auth:** `https://talabat.partner.deliveryhero.io/v2/oauth/token` with `client_id`/`client_secret` from the Account Manager; `Authorization: Bearer`; tokens last 2 hours; up to 10 client ids per chain; one token covers every store in the chain. HTTP method and grant type are not stated.
- **Webhook:** configured in the Partner Portal (Shop Integrations plugin). A secret is **mandatory** and is "any string or a Basic auth value (Base64 of `user:password`)". **This is a shared secret sent with the request, not an HMAC signature.** Partner Picking sends `RECEIVED`, `READY_FOR_PICKUP`, `DISPATCHED`, `CANCELLED` (Pelican sends only `READY_FOR_PICKUP` and `CANCELLED`). A cancellation initiated through the picking solution is not re-sent.
- **Retries:** "If your service does not respond within **10 seconds**, the system retries up to **5 times, 10 seconds apart**. Handle duplicate deliveries." Ordering is not guaranteed (not covered).
- **Routing ids:** `client.store_id` (platform store id), `client.external_partner_config_id` (our own mapping, configurable in the portal), `client.chain_id`. Order ids: `order_id` (UUID, used by GET), `external_order_id` (reconciliation), `order_code` (rider-facing, resets after 9999).
- **Payload groups:** items (`sku`, `barcode`, `name`, `pricing` and `original_pricing` with unit/total price, VAT percent, quantity, weight, discount, status), payment (`sub_total`, `order_total` = what the customer paid, `delivery_fee`, `service_fee`, `discount`, `discounts`, `container_charge`, `total_taxes`, `additional_fees`, `type`), masked customer name/phone/address, `cancellation`, `status`, `sys` timestamps, `promised_for`, `isPreorder`, item-level promotions (sponsor and discount amounts). **`total_taxes` is in the payload; commission is not** ("commission fields" are listed as not covered).
- **Fulfil / cancel:** `PUT /v2/chains/{chain_id}/orders/{order_id}` with `UPDATE_CART`, `READY_FOR_PICKUP` (platform delivery) or `DISPATCHED` (vendor delivery); item statuses `IN_CART`, `NOT_FOUND`, `REPLACED`, `ADDITION`; cancel with a reason `CLOSED`, `ITEM_UNAVAILABLE`, `TOO_BUSY`. 60 requests per minute (GET and PUT together).
- **Outage fallback:** `GET /v2/chains/{chain_id}/orders/{order_id}` (last 60 days) and `GET /v2/chains/{chain_id}/vendors/{vendor_id}?start_time&end_time&page_size&page` (documented as "useful when the webhook is down").
- **Outlet status:** `PUT/GET /v2/chains/{chain_id}/status` with `OPEN`, `CLOSED_TODAY`, `CLOSED_UNTIL` (+ `closed_until`), `CHECKIN`, and `closed_reason` (`TOO_BUSY_NO_DRIVERS`, `TOO_BUSY_KITCHEN`, `UPDATES_IN_MENU`, `TECHNICAL_PROBLEM`, `CLOSED`, `OTHER`, `BAD_WEATHER`, `HOLIDAY_SPECIAL_DAY`).
- **Catalog:** `PUT /v2/chains/{chain_id}/vendors/{vendor_id}/catalog` with `products[{sku, active, price, quantity, maximum_sales_quantity, barcode}]`; asynchronous (`202` + `job_id`, `QUEUED`/`IN_PROGRESS`/`COMPLETED`/`FAILED`, result by webhook or polling). Items are identified by `sku`.
- **Sandbox:** sandbox credentials and sandbox vendor ids are created in the Partner Portal; a "Test Order" button simulates orders; item replacement cannot be tested in the sandbox; live end-to-end testing uses a test store with Talabat teams. No go-live gate is documented.

**NOT in the public docs (so UNVERIFIED, owner-supplied only):** the restaurant-style mandatory items the owner listed (menu push, "food is ready" signal, dynamic prep-time adjustment, branch availability as a dedicated status, stable item ids on menu pushes), the baseline performance numbers (vendor failure rate 2.5% or less, order ingestion success 98.9% or more), and the Golden-tier extras (callback URLs, asynchronous dispatch, order-status events, warning status). The acceptance deadline and any auto-cancel rule are also undocumented (the FAQ itself lists them as questions for the Account Manager).

## 4. Talabat standards (owner supplied) and how the design meets them

| Standard | Where it lives in the design |
|---|---|
| Signed commercial contract | Outside the code. Gate for E3 production. |
| Menu push | `ChannelProvider.pushCatalogue` (capability `catalogueSync`). Implemented by the Talabat simulator provider (section 12); not by the stub. |
| Item availability | `setItemAvailability` (capability `itemAvailability`); the stub implements it. |
| Order endpoint | `ChannelIngestionService.receive()`: the shared, provider-neutral inbox function. The HTTP controller is E2/E3. |
| Branch availability status | `setBranchStatus` (capability `branchStatus`). |
| Food is ready | `markReady` (capability `markReady`); stub implements it. Must be a human action (Deliveroo says so explicitly). |
| Item-level discounts in the order payload | `CanonicalChannelLine.discountMinor`; stored in the canonical snapshot, order-level discount in `order.discountAmount`. |
| Dynamic prep-time adjustment | `adjustPrepTime(minutes)`. |
| Stable item ids on menu pushes | A mapping row (`channelitemmapping`) is keyed by the marketplace's item id and never regenerated; the E3 push must send the same external id for the same product/variant every time. |
| Failure rate ≤ 2.5% and ingestion success ≥ 98.9% | `ChannelIngestionService.stats()` and `GET /channels/stats` (per shop; a platform-wide call is the same function without `shopId`). Success = `processed / (processed + failed + dead)` over a window, `NULL` when nothing finished. Which events Talabat counts as a vendor failure is theirs to define (Q9). |
| Golden: callback URLs, asynchronous dispatch, order-status events | Capabilities `callbackUrls`, `asyncDispatch`, `orderStatusEvents`. Asynchronous dispatch is already the shape of ingestion: acknowledge after the durable write, process after. |
| Golden: warning status | Meaning unknown (Q10). |

## 5. Design

### 5.1 Principles (the owner's rules)

1. The marketplace collects the customer's money. **No gateway charge, ever**: `order.channel` and `order.paymentMethod` carry the provider name, `PaymentsService.generateLink` and `getCheckoutSession` refuse a marketplace order (guard inside both, not only at the edge), no `paymenttransaction` is written.
2. **No customer messaging**: every customer-facing method of `OrderNotificationsService` (`notifyOrderConfirmed`, `notifyOutForDelivery`, `notifySurveyRequest`, `notifySurveyConsentGiven`, `sendDeliveryCode`) returns first when the order's channel is a marketplace, independent of the order having an email or phone. No CRM customer row is created, `customerEmail` is NULL, there is no tracking token, no abandoned-cart, newsletter, survey or conversion event.
3. **Never fabricate**: tax, commission, delivery fee, discount and cash due are NULL when the payload does not state them (NULL means unknown, as with `orderitem.taxRate`). Prices are what the marketplace charged.
4. **Accepted orders are never lost** (5.8).
5. Tenant isolation first (5.3).

### 5.2 Data model (migration `20261110100000_marketplace_channels`, additive)

| Table | Purpose |
|---|---|
| `channelconnection` | One row per `(outlet, provider)` (UNIQUE). `externalLocationId` (routing key: Deliveroo `location_id`, Talabat `store_id`), `externalBrandId`, `externalSiteId` (all nullable; the Deliveroo Sites API is not available to the owner), `credentials` and `webhookSecret` (AES-GCM through `common/crypto.ts`, write-only: the API returns only `hasCredentials`/`hasWebhookSecret`), `enabled` DEFAULT 0, `lastSyncAt/Status/Error`, `locationVerifiedAt/By` (platform-staff confirmation, section 5.3). `routingKey` is a STORED generated column, non-NULL only while enabled with a location id, with a UNIQUE index: **one location can belong to exactly one enabled connection platform-wide** (the `customDomainVerifiedKey` pattern). |
| `channelinboundevent` | The **durable inbox**. UNIQUE `(connectionId, eventId)`. Holds the verified delivery (`payload` JSON, `payloadHash`, `signatureVerified`, `source` webhook/poll), `status` (`received`, `processing`, `processed`, `failed`, `dead`), `attempts`, `nextAttemptAt`, `lockedAt`, `lastError`. Payload is purged 30 days after processing (personal data); the row stays. |
| `channelorder` | The link. UNIQUE `(connectionId, externalOrderId)`. `state` (`needs_mapping`, `pending_acceptance`, `accepted`, `rejected`, `cancelled_upstream`), the marketplace's `externalStatus`, `acceptBy`, `scheduledFor`, `currency`, `commissionAmount` (NULL if unknown), `cashDueAmount`, `priceMismatch` JSON, `canonical` JSON (kept only while waiting for mappings), `orderId` (NULL until the order exists), `alertedAt`, `staleAlertedAt`. |
| `channelitemmapping` | `(shopId, provider, externalItemId)` → product/variant. Never creates a product. |
| `channelunmappeditem`, `channelorderunmapped` | The unmapped-items queue and which waiting orders are blocked on which item. |

`order` is **not altered**. The existing `channel`, `orderType` and `paymentMethod` columns carry the marketplace; commission and external references live in `channelorder`, so no `SELECT *` spread of an order can leak channel internals. `OrdersService.updateItems` and `updateDeliveryFee` refuse a marketplace order (409): re-pricing it would apply this shop's tax and delivery rules to money the aggregator collected.

**Decision (premise correction):** the brief wants an order with unmapped items to stay visible. `orderitem.productId` is NOT NULL with a RESTRICT foreign key, and making it nullable would touch dozens of readers. So an order waiting for mappings has **no `order` row**; it exists as a `channelorder` in `needs_mapping`, is listed with its item names and quantities (no customer data), is alerted on, and keeps its deadline. Resolving the last unmapped item creates the order in one transaction (`ChannelIngestionService.reevaluateWaiting`). The UNIQUE on `channelorder` is per **connection**, not per provider: a global unique would let one tenant pre-empt another tenant's real order by replaying its external id.

### 5.3 Tenant routing and isolation

1. `receive()` asks the provider for the routing key from the **unauthenticated** body (`extractRoutingKey`), looks up `channelconnection.routingKey = '<provider>:<id>'` (at most one enabled row), verifies the signature against **that connection's** secret (and the provider's platform secret if its capabilities say it uses one), and only then trusts anything in the body. The shop is taken from the connection row and stored on the inbox row; the payload can never choose it.
2. Unknown provider, unparseable key, unknown location, disabled connection, no usable secret and bad signature all throw the same `ChannelWebhookRejectedException` (401, identical body). Nothing is written for them.
3. **Who owns a location (review H1).** If the webhook secret is platform-wide (likely for Deliveroo, where an integrator gets one secret) and the API credentials are integrator-level, then "these credentials can see this location" proves nothing about who the location belongs to: the location id is the only tenant discriminator and a merchant could type another merchant's id. So an enabled connection needs ONE of:
   - **Platform-staff verification** (`locationVerifiedAt/By`). Merchants enter the ids and ask for enablement; Requital staff confirm the ids with the marketplace's integration team and record it through the platform-admin tier: `POST /platform-admin/shops/:shopId/channel-connections/:id/verify-location` (and `unverify-location`, which also disables). The route sits behind `PlatformAdminGuard` (404 on failure), staff restate the exact ids they checked (location, brand, site) and the UPDATE matches only if those are still the stored ones, and the platform audit row is written in the **same transaction** (no verification without a record). A merchant has no endpoint that can set it.
   - **A merchant-bound proof**: a provider may declare `capabilities.provesLocationOwnership` only if its `testConnection()` proves that the merchant's own credentials are bound to that location (for example credentials issued per merchant by the marketplace). Until E2 knows that is true for Deliveroo it must NOT declare it, and staff verification is the path. The stub declares it only when a test flips `merchantBoundProof`.
   - The verification is **cleared in the same statement** as any change to the location, brand or site id or to the credentials (a webhook-secret rotation is not an ownership input and does not clear it). Ids cannot change at all while the connection is enabled (the UPDATE itself carries `AND enabled = 0`).
   - **Enabling is atomic**: after the network `testConnection()`, a single conditional UPDATE restates every value that was tested (ids, credentials, webhook secret, and the verification or the merchant-bound flag) and affects a row only if all still match; zero rows is a 409. A concurrent edit during the test round trip therefore cannot enable an unchecked connection. Tested deterministically (an id or credential swapped inside `testConnection`) and with parallel enable and edit.
   - UNIQUE `routingKey` still stops a second enabled claim of the same location (409, generic message).
   - A provider's message is capped, stripped of any credential value, and only then stored as `lastError` or shown.
4. The feature flag gates **creating and enabling** a connection and nothing else: switching it off must not make the platform drop orders the marketplace has already accepted (tested).

### 5.4 Provider interface (`channels/channel.types.ts`)

`ChannelProvider` = `name`, `capabilities`, **inbound** (`extractRoutingKey`, `verifyWebhook`, `parseEvent`, optional `platformWebhookSecrets`), and **outbound, all optional and guarded by capability flags**: `testConnection`, `acceptOrder`, `rejectOrder`, `substituteItem`, `removeItem`, `markReady`, `setItemAvailability`, `setBranchStatus`, `pushCatalogue`, `adjustPrepTime`, `fetchOrderStatus`, `listOpenOrders` (the polling fallback). Capabilities: `acceptReject`, `substituteItems`, `removeItem`, `markReady`, `itemAvailability`, `branchStatus`, `catalogueSync`, `prepTimeAdjust`, `fetchOrderStatus`, `pollOrders`, `callbackUrls`, `asyncDispatch`, `orderStatusEvents`, `provesLocationOwnership`, `platformWebhookSecret`.

`parseEvent` returns a **canonical** result (`order_new`, `order_status`, `ignored`) and nothing else crosses the boundary. A canonical order is integer minor units in its own currency, `null` for every figure the marketplace did not state, a `handover` (`marketplace_courier`, `merchant_delivery`, `customer_pickup`), lines with the marketplace item id, unit price including modifiers (before discount), optional line discount/tax/note, totals (incl. `commissionMinor`, `cashDueMinor`), minimal customer, `acceptBy`, `scheduledFor`. The core re-validates every canonical order (`assertCanonicalOrder`): a provider bug lands in the dead letter, never in an order.

`handover` decides `order.orderType`: `marketplace_courier` and `customer_pickup` become `pickup` so a marketplace order never reaches the driver-dispatch lists; `merchant_delivery` becomes `delivery`.

Registry: `ChannelProviderRegistry` (same shape as `PaymentProviderRegistry`). E2/E3 register from their own modules. `StubChannelProvider` (`stub_marketplace`) is deterministic, offline, HMAC-signed like Deliveroo (`<id> + " " + body`), exposes call logs and failure injection, and is registered only when `NODE_ENV !== 'production'`.

### 5.5 Ingestion state machine

```
receive() ──verify──► inbox row (received) ──ACK──► process (CAS claim)
                                                      │
                 order_new ──► channelorder INSERT (UNIQUE arbiter)
                                 ├─ all items mapped ► order + lines + stock hold ► pending_acceptance
                                 └─ unmapped items   ► needs_mapping (no order)   ─ map ► pending_acceptance
 pending_acceptance ──merchant accept (provider call, then CAS)──► accepted (order confirmed)
                    ──merchant reject / marketplace rejected / auto-reject──► rejected (order cancelled, stock released)
 any open state     ──marketplace canceled──► cancelled_upstream (order cancelled through OrdersService.cancel)
 order_status before order.new ► inbox `failed`, retried with back-off (never dropped)
```

Inbox statuses: `received` → `processing` (CAS claim, stale lock reclaimed after 5 minutes) → `processed` | `failed` (back-off 5s, 15s, 30s, 60s, 2m, 5m, 10m, 15m, then every 15m) → `dead` after 12 attempts or at once for a deterministic parse error. `dead` rows keep their payload and are replayable (`POST /channels/inbox/replay`, shop-scoped).

Order creation is one transaction: channelorder INSERT (arbiter) → stock via `consumeForOrderItems` → `withShopOrderNumber` order INSERT → `orderitem` rows → `recordOrderConsumption` → link update → alert job on the same connection (`JobsService.enqueue(..., {tx})`). All pool reads (mapping lookup, `resolveOrderItems`, recipient lookup) happen **before** the transaction (the nested-pool rule; `check-nested-pool` passes).

### 5.6 Stock decision (evidence)

Mirrors "Stock policy by path": storefront checkout and draft orders reserve at creation, admin orders at confirm. A marketplace order is a **sale the customer has already paid the aggregator for**, so it holds stock from arrival like checkout: `marketplace` channels are added to `IMMEDIATE_STOCK_RESERVATION_CHANNELS`, which (a) makes the pending→confirmed move skip a second decrement and (b) makes a cancel from `pending` restock. The difference from checkout: **no floor** (`allowNegative`, `throwOnInsufficientStock: false`). Refusing an order the marketplace has already taken because a count is stale would lose a sale, and the merchant can reject it from the desk. The consumption record (`orderstockconsumption`) is written, so cancel/return release exactly what was taken. Tested: ledger conservation (`SUM(stockmovement.delta) = outletingredientstock`) after create, cancel, reject and a stock-negative order.

### 5.7 Money, tax, commission, payment status, customer data

- `order.total` = the marketplace's stated total (`totalMinor`; E2/E3 must document which vendor field they map: Deliveroo `total_price` vs `partner_order_total`, Q5). Line `priceAtPurchase` = the payload unit price. `taxAmount`, `deliveryFee`, `discountAmount` come from the payload or are NULL. `orderitem.taxRate/taxClassId` stay NULL (never the shop's class). Commission → `channelorder.commissionAmount` (NULL if unknown). KWD three-decimal amounts verified exactly.
- `paymentStatus`: `paid` (the marketplace collected) unless the payload says cash is due on delivery (`cashDueMinor > 0`), then `unpaid`. INFERRED; Q6.
- Price mismatch: the payload price always wins. Per mapped line, when the order currency equals the shop currency and the payload unit price differs from the catalogue price, a `priceMismatch` entry (`payloadMinor`, `catalogMinor`) is stored and shown in the desk. It is information (modifiers legitimately change a line price), never an error and never a re-price.
- Customer data (minimal, justified): no `customer` row (a CRM row would invite marketing and merge/LTV logic), `customerId` NULL, only name/phone/address when the payload sent them, otherwise `''` (NOT NULL columns), notes into `deliveryNotes`. The inbox payload is purged after 30 days (`PAYLOAD_RETENTION_DAYS`); `channelorder.canonical` is cleared the moment the order exists.

### 5.8 Accepted orders are never lost

1. **Durable inbox row first, acknowledgement second.** `receive()` returns only after the INSERT has committed. A crash after that leaves a `received` row and the sweep (every minute, cross-instance lock) processes it. A crash mid-processing leaves a `processing` row with a stale lock and the sweep reclaims it.
2. **Idempotent twice over**: UNIQUE `(connectionId, eventId)` for the delivery, UNIQUE `(connectionId, externalOrderId)` as the arbiter for the order (tested with 8 concurrent deliveries). Injection-proved: with the unique index dropped the concurrency test fails.
3. **Out-of-order and early status events** fail into the retry, they are not dropped.
4. **Outage fallback**: `listOpenOrders` (capability `pollOrders`) is polled every 2 minutes per enabled connection and its results go through the same inbox (`source = 'poll'`). Talabat documents `GET .../vendors/{vendor_id}` for this; the Deliveroo `Get Orders` details were not read (Q8).
5. **Stale sweep**: an order still waiting past `acceptBy` (or 15 minutes after receipt when there is no deadline) is first reconciled through `fetchOrderStatus` if the provider has it, otherwise the merchant is alerted **once** (`channelorder:<id>:stale-alert`). An order the marketplace accepted whose Requital order is still `pending` after 5 minutes is repaired (confirmed).
6. **Merchant alert** reuses the platform WhatsApp alert job (`send_merchant_whatsapp_alert`) to the outlet's WhatsApp, with no customer data in the text. It is enqueued inside the order transaction, so it exists if and only if the order does.
7. SLO hooks: `stats()`; every state change is audit-logged (`channel_order.*`, `channel.*`).

### 5.9 Admin API (`/channels`)

Connections CRUD, `POST /channels/connections/:id/enabled`, `POST .../test`, mappings, `GET /channels/unmapped-items`, `POST /channels/unmapped-items/:id/resolve`, `GET /channels/providers`, `GET /channels/stats`, `POST /channels/inbox/replay`: **admin only**. `GET /channels/orders`, `POST /channels/orders/:id/accept|reject`: admin, branch and order_manager (**deviation from "admin only"**: acceptance has a 7-minute deadline and is done by whoever is on shift). A branch user is pinned to their outlet by an explicit comparison (another outlet's order is a 404), and `orders.manage`/`orders.view` are checked at the order's outlet for restrict-only branch roles; the list asserts `orders.view` when an outlet is resolved. Accept and reject call the marketplace **first** and change state by CAS only on success, so a provider failure (502) changes nothing and a repeat is safe. `OutletsService.remove` refuses an outlet that has a connection, and deleting a connection is refused while it has marketplace orders or any inbox row that is not `processed` (the delete cascades to the inbox). `POST /channels/inbox/replay` requires an explicit list of 1 to 200 valid ids (empty, missing or partly invalid is a 400, never "everything"). Platform staff additionally have `GET /platform-admin/shops/:shopId/channel-connections`, `verify-location` and `unverify-location`.

**Generic order routes and marketplace orders (review L4).** Accepting and refusing must tell the marketplace, so `PATCH /orders/:id/status` to `confirmed` or `cancelled`, `POST /orders/:id/cancel` and the bulk status change are refused with 409 for a marketplace order and point to the Marketplace desk (the channel services pass an internal `channelDesk` option). The kitchen steps (preparing, out for delivery, delivered) stay open: blocking them would stop the workflow. The alternative, reflecting a generic cancel back to the marketplace, was rejected because it would hide a marketplace call behind an unrelated button. `channel` on `POST /orders` cannot be a marketplace name in any spelling (DTO and service, review M2), so the hand-made path cannot trigger the stock hold, the payment block or the messaging block.

### 5.10 Retention and field widths (review M3, M4)

- Every free-text field the ingestion writes is cut to the real column width **in characters, on code point boundaries, dropping lone surrogates** (`clip`): `customerName` and `customerPhone` VARCHAR(191), `customerAddress` and `deliveryNotes` TEXT (65,535 bytes: cut at 10,000 characters), `orderitem.note` VARCHAR(255), `channelorder.displayId` VARCHAR(64), unmapped item name VARCHAR(255), error text VARCHAR(500). `assertCanonicalOrder` no longer rejects on text length (only ids, which cannot be truncated, and figures). An accepted order is never dead-lettered for length.
- Inbox payloads (customer details) are purged 30 days after processing, and also for `failed` and `dead` rows 30 days after receipt. `channelorder.canonical` is cleared when the order is created and when the link is closed without one.
- A sweep blanks `customerName`, `customerPhone`, `customerAddress`, `deliveryNotes`, `receiverMessage` and `orderitem.note` of a marketplace order 30 days after it was delivered or cancelled (time of the last `order.status_changed` audit row, else creation). The order, items and totals stay. Idempotent. **Not covered:** an invoice generated for such an order keeps its own frozen snapshot of the customer block (Q12).
- A marketplace order is never reported to an ad platform (`ConversionEventsService`, at enqueue and at send). The stub is registered only when `NODE_ENV` is `test` or `development`, or `ENABLE_STUB_CHANNEL=1`.

## 6. Test coverage (E1)

`backend/test/marketplace-channels.e2e-spec.ts` (72 tests, stub provider) and `backend/src/channels/channels.spec.ts` (20 unit tests). Covered: default off and the flag; secrets never returned and stored encrypted; failing connection test blocks enabling; indistinguishable rejection of seven bad-delivery shapes; vendor X only creates orders in X's shop (same external id in two shops); a second shop cannot claim a location (409) or read/accept/reject/delete across tenants; a status event for A cannot touch B; creation (channel, payment method, no charge, no customer row, no tracking token, NULL tax and commission, KWD exact); per-shop numbers; handover to order type; cash due; stock hold and ledger conservation; duplicates (same id, new id, 8 concurrent); unmapped items (visible, alerted, resolve creates the order, foreign product refused); price mismatch; accept (idempotent, no double decrement), failing provider call, reject, upstream cancel after accept and while pending, auto-reject, tablet acceptance, delivered-then-cancelled, accept racing a rejection, out-of-order status; branch outlet scoping and restricted role; no customer email/WhatsApp/survey even with an address on the order (control proves the assertion can fail); an unpaid marketplace order still cannot be charged; no re-pricing; durable-inbox crash recovery, stale lock reclaim, dead letter and shop-scoped replay, polling dedupe, stale-order alert once and settle by marketplace answer, confirm repair, flag-off keeps receiving, SLO stats, connection/outlet deletion rules, payload purge.

Review round (H1, M1 to M4, L1 to L4) added: staff verification (required to enable, exact ids, audited, platform-only, cleared by id or credential change, secret rotation keeps it), the enable race (id or credential swapped inside the connection test, and parallel enable plus edit), a failed cancel finished by the inbox retry and by the sweep, `orderId` read after closing, reserved channel names, over-long values (emoji, 400 to 50,000 characters), retention (dead payload purge, canonical cleared, closed-order scrub with an open and a recent control), connection delete guard, no ad-platform report, stale-alert rollback, replay validation, generic cancel and confirm refused, credential value never in `lastError`, and the stub allow-list.

Injection proofs (revert, see the named test fail, restore): signature check removed → "SAME response" test fails; customer-notification guard removed → "never enqueues a customer email" fails (an email job appears); payment-link and checkout-session guards removed → "UNPAID marketplace order" fails; marketplace channels dropped from the stock-hold list → upstream-cancel restock fails (stock 8, expected 10); upstream cancel not calling `OrdersService.cancel` → order stays `confirmed`; `findLink` not scoped by connection → "a status event for A cannot touch B" fails; UNIQUE `(connectionId, externalOrderId)` dropped and the short-circuit disabled → both duplicate tests fail (3 and 5 links).

## 7. What the owner could not obtain, and what that blocks

`DELIVEROO_SANDBOX_BRAND_ID` and `SITE_ID` do not exist because the **Sites API is not enabled** for the owner's integration. Rider status, Sites, Promotions and reports are unavailable until production access. The design **does not depend on any of them**: routing uses the `location_id` carried in the order itself; Site API calls (`setBranchStatus`, `adjustPrepTime` via `workload`) stay unimplemented capabilities until access exists; the sandbox test order does not take a location or brand in its request, so how a test order is routed to a location is unknown (Q2).

## 8. Deliveroo go-live scenario checklist

Deliveroo publishes no go-live list in its public docs, so this is **our own** list derived from the documented flows. "E1" is the stub test that covers the equivalent behaviour in the framework; "E2" is the test in `backend/test/marketplace-deliveroo.e2e-spec.ts` (signed fixtures, fake sandbox), named after the scenario.

| # | Scenario | E1 stub test | E2 test |
|---|---|---|---|
| 1 | `order.new` (placed, ASAP) creates the order and alerts the merchant | creation; unmapped alert | S01 order.new (placed, ASAP) creates the order, holds stock and alerts the merchant |
| 2 | Accept → 204; `order.status_update accepted` confirms the order | accepting confirms; tablet acceptance | S02 accept sends PATCH accepted, and order.status_update accepted confirms the order once |
| 3 | Reject with each `reject_reason` | rejecting tells the marketplace | S03 reject sends each documented reject_reason |
| 4 | No answer within 7 minutes (UAE) → `rejected` arrives; order cancelled, stock released | auto-reject | S04 no answer within the UAE 7-minute window |
| 5 | Customer cancel before accept | cancellation while pending | S05 customer cancel before accept cancels the order and restocks |
| 6 | Cancel after accept; `200` acknowledged | upstream cancel after accept | S06 cancel after accept is acknowledged with 200 |
| 7 | Scheduled order: accept, then `confirmed` before `start_preparing_at`; `confirm_at` deadline | stub: `scheduledConfirm` desk, sweep and opt-in tests in `marketplace-followups.e2e-spec.ts` | S07 scheduled order: accept, then the desk confirm sends `PATCH confirmed` (409 is success only if Deliveroo shows `confirmed`); S07b 503 retry and the default alert-only sweep (section 14) |
| 8 | Same delivery twice (same GUID) | same delivery twice | S08 the same delivery twice (same GUID) |
| 9 | Redelivery with a new GUID | NEW delivery id | S09 a redelivery with a new GUID |
| 10 | Concurrent duplicates | concurrent duplicate | S10 eight concurrent duplicates |
| 11 | Status before `order.new` | out-of-order | S11 a status event before order.new is retried, not dropped |
| 12 | Bad HMAC, missing headers, wrong secret | SAME response | S12 bad HMAC, missing headers and wrong secret (same 401) |
| 13 | Unknown `location_id` | SAME response | S13 an unknown location id (same 401) |
| 14 | Another tenant's location / secret | tenant isolation block | S14 another tenant's secret / location |
| 15 | Null or unknown `pos_item_id` | unmapped items | S15 null or unknown pos_item_id |
| 16 | Item-level and basket-level promotions | not covered (discount mapping is provider-side) | S16 item and basket discounts |
| 17 | Nested modifiers folded into the line price | not covered (provider-side) | S17 nested modifiers folded into the unit price |
| 18 | Each `fulfillment_type` → handover | handover to order type | S18 each fulfillment_type maps to an order type |
| 19 | Two currencies (AED, KWD) exact | KWD exact | S19 AED and KWD exact |
| 20 | Our server returns 5xx → Deliveroo retries (6 min ASAP / 30 min scheduled) with no duplicate | durable inbox; concurrent duplicates | S20 our server fails with 5xx, Deliveroo retries |
| 21 | Total outage of our webhook, recovery by polling `Get Orders` | polling dedupe | S21 total webhook outage recovered by polling Get Orders |
| 22 | `409 invalid_status_transition` on accept is treated as success | not covered (stub has no 409) | S22 409 invalid_status_transition on accept |
| 23 | `503 order_not_ready` with `Retry-After` on accept is retried | not covered | S23 503 order_not_ready on accept is retried |
| 24 | Rate limit 5/min per order on accept/reject | not covered | S24 5-per-minute-per-order limit |
| 25 | Token expiry (300 s) and refresh | not covered | S25 token cached, refreshed after 300 s |
| 26 | Remake orders (`remake_details`) | not covered | S26 a remake order |
| 27 | Variable-weight items | not covered | S27 variable-weight item |
| 28 | `ready_for_collection` signal is a human action | markReady capability only | S28 ready_for_collection is a human action |
| 29 | Cash due on delivery | cash due stays unpaid | S29 cash due on delivery |
| 30 | Refund webhook (idempotent on `refund_id`) | not covered (E1 has no refund handling) | S30 refund webhook: NOT BUILT (a refund delivery is refused and writes nothing) |

## 9. What to request from Deliveroo's integration team

1. Enable the **Sites API** and give the `brand_id`, `site_id` and the `location_id` of each, for sandbox and production (the owner's blocker).
2. Confirm which suite a florist / gift retailer belongs to (Partner Platform Order API or Retail Platform Picking API) and enable it.
3. The webhook secret model: one per integration or per brand/site, rotation, and separate sandbox and production secrets.
4. ~~Which OAuth token URL is correct (the docs list two), and the scopes.~~ Resolved for the sandbox (section 14.1): the `auth-sandbox` host is correct. Still ask for the production token URL and the exact scope list.
5. Whether the order payload can carry **tax (VAT) and commission**, which total to use (`total_price` or `partner_order_total`), how fees are attributed, and where commission is reported (statement or reports API). The v2 schema has neither.
6. The acceptance window per market (docs say 7 minutes in UAE and Kuwait), what exactly happens on timeout, the "three auto-rejections close the site" rule, and whether auto-accept is permitted.
7. Whether the sequence GUID repeats on a retry, the response timeout they apply, and how "up to 6 minutes (ASAP) / 30 minutes (scheduled)" relate to the circuit breaker.
8. The semantics, filters and rate limits of `Get Orders` for use as a polling fallback.
9. The go-live process: required scenarios, who certifies, expected duration of production access, and whether sandbox test orders can be routed to a chosen `location_id`.
10. Access to Rider Status, Promotions and reports, and the refund webhook enablement for the brand.
11. Menu/Catalogue expectations for item availability, and stable `pos_item_id` rules.
12. Customer-data rules: which customer fields we may store and for how long.
13. Substitution and remake handling for non-food retail.
14. (E2) For the sandbox: the **webhook secret binding** (which brand/site/integration a secret signs for, and whether it is one value for all our merchants), the **API scopes** granted to our client, and a way to **simulate an order for a chosen `location_id`** (the test-order request has no location, Q2).
15. (E2) **Go-live scenario sign-off**: Deliveroo to review section 8 (and section 13's list of what is not built) and say which scenarios they certify.
16. (E2) Whether `GET /v2/brand/{brand}/restaurant/{restaurant}/orders` takes the order `location_id` as `restaurant_id`, and whether `live_orders` is still experimental.
17. (E2) Whether scheduled orders need the `confirmed` step before `start_preparing_at`, and what happens if they are not confirmed (auto-reject?).
18. (E2) Whether the Menu API (`PUT /v1/brands/{brand}/menus/{id}`) accepts an empty `mealtimes`, and what `tax_rate` must be for a UAE florist (we refuse to invent one).
19. (E2) The meaning of `fulfillment_type` values `autonomous`, `table_service` and `catering` for a gift retailer.

## 10. Open questions for the owner

- **Q1** Which Deliveroo suite applies to the merchants (Order API for restaurants, or Picking for retail)? The framework supports both; E2 must pick one first.
- **Q2** How is a sandbox test order tied to a location when the request has no `location_id`?
- **Q3** Auto-accept: should a connection accept orders automatically? E1 builds none: acceptance is always a person, with an alert. Auto-accept would remove the 7-minute risk but also remove the merchant's ability to refuse.
- **Q4** Two different OAuth token URLs in the docs. **Resolved for the sandbox (2026-10-22, section 14.1):** the documented `auth-sandbox.developers.deliveroo.com` host accepted the owner's new sandbox credentials; the Cognito URL was never needed and the earlier `invalid_client` (13.8) was the old credentials. The production token URL is still unconfirmed.
- **Q5** Tax and commission: until Deliveroo supplies them, orders have NULL tax and commission, and invoices for them would show no tax breakdown. Is that acceptable, or must Requital derive VAT (which the rules forbid us to fabricate)?
- **Q6** Cash-due orders are marked `unpaid`; is that how the merchant wants them reconciled?
- **Q7** Reports and the dashboard include marketplace orders in sales and AOV (they are ordinary order rows). Should they be separated by channel, and should commission reduce reported revenue?
- **Q8** Polling fallback details for Deliveroo.
- **Q9** For Talabat's 2.5% / 98.9% numbers: what do they count as a vendor failure and an ingestion success, over what window?
- **Q10** What is Talabat's "warning status"?
- **Q11** Returns and refunds on marketplace orders. A return today would try a provider refund (none exists, so it falls back to manual), a gift card or store credit. Marketplace refunds belong to the marketplace; E1 does not block them.
- **Q12** Slider dispatch and invoices can still be triggered by hand on a marketplace order. Block them?
- **Q13** Resolved by the review: merchants enter ids, platform staff verify them (section 5.3). Decision needed: should staff also be the only ones able to type the ids (like `sliderAccountId`)? That would remove the typing step but not the verification.
- **Q14** The orders desk is open to branch and order_manager roles (a deliberate deviation from "admin only").

## 10b. E2 gate (carried forward from the security review)

E2 and E3 are not mergeable unless all of these hold:
1. **Ownership proof is merchant-bound or platform-verified** (section 5.3). Deliveroo credentials are likely integrator-level: do not declare `provesLocationOwnership` unless `testConnection` proves a per-merchant binding.
2. **Enable stays atomic** (the conditional UPDATE); no provider code may flip `enabled`.
3. **The public webhook route has a per-IP throttle and a body cap** (the core also rejects bodies over 1 MB), is `@Public()`, and returns the core's identical 401 unchanged.
4. **HMAC is computed over the raw `Buffer`**, never over re-serialised JSON.
5. **`extractRoutingKey` and `parseEvent` use the same JSON parse and never read a second location id** (for example from a different field) than the one the signature protected.
6. **Polling event ids are deterministic** (stable per order and status), or a repeated poll creates new inbox rows.
7. **`testConnection` never echoes credentials**; the core also redacts known credential values from the message, but the provider must not rely on that.

### Open items from the second review (not blocking E1)

- **Poll-failure demotion has no retry path.** A poll that fails records `lastSyncStatus = 'failed'` (message redacted) and is retried at the next tick, but nothing escalates a connection that fails for hours. E2 should alert the merchant and staff after N consecutive failed polls.
- **`reconcileOne`** no longer treats "accepted by the marketplace while still `needs_mapping`" as settled (fixed: the merchant still gets the stale alert). An order the marketplace accepted but that has no `order` row yet remains the merchant's to map.
- **Residual PII copies** that retention does not reach: an invoice or packing slip generated for a marketplace order keeps its own frozen customer block, and a Slider dispatch of a marketplace order sends the customer's phone and address to the courier and stores them on `externaldelivery`. Q12 (block both for marketplace orders) is the clean answer.
- **E2/E3 must keep `provesLocationOwnership` false** unless the credentials are provably per-merchant; staff verification is the default.
- **Status events whose location does not match the order's connection** are already harmless (lookups are per connection), but E2 should log a mismatch between the event's location id and the stored order's, which would indicate a routing bug.
- **Body cap and throttle** belong to the public route (E2/E3); the core only rejects bodies over 1 MB.
- **Replay and timestamps:** neither marketplace documents a timestamp in its signature, so a captured valid delivery can be replayed. The inbox UNIQUE and the order UNIQUE make a replay a no-op for orders; a replayed status event is applied by CAS and is idempotent. E2 should still reject deliveries whose own timestamp, if any, is stale.
- Credentials and the webhook secret of an enabled connection cannot be replaced or cleared (disable first); a connection can only be deleted while disabled, with no marketplace orders and no unprocessed inbox row, enforced in the DELETE statement itself so an inbound delivery cannot race it; generic-route locks and the retention scrub apply only to orders that have a `channelorder` link; commission is visible to admins only.

## 11. Hand-off for E2, E3, E4

- **E2 (Deliveroo): BUILT, see section 13.** The original brief follows for reference: implement `ChannelProvider` (HMAC `X-Deliveroo-Hmac-Sha256` over `guid + " " + raw body`, `extractRoutingKey` = `body.location_id`, `parseEvent`, `acceptOrder`/`rejectOrder` with the 204/409/503 rules and the 5-per-minute limit, `testConnection` that **proves** the location is visible to the credentials, `fetchOrderStatus`, `listOpenOrders`, `platformWebhookSecrets()` from `DELIVEROO_*_WEBHOOK_SECRET` if the secret is platform-wide). Add the public controller `POST /channels/deliveroo/webhook` that reads the raw body, calls `ChannelIngestionService.receive({ provider, rawBody, headers })` (no `processInline`), returns 200 only when it resolves, and lets `ChannelWebhookRejectedException` through unchanged. Throttle it by IP, never by connection id. Derive `acceptBy` from `status_log.placed.at` plus the market window. Fill section 8.
- **E3 (Talabat):** built behind a simulator, see section 12. The webhook credential is a shared string or Basic auth header, not an HMAC: `verifyWebhook` compares it in constant time; the routing key is `client.store_id` / `client.external_partner_config_id`; delivery ids are not documented (the core falls back to the body hash, so a changed redelivery of the same order is a new inbox row but the same `channelorder`).
- **E4 (admin UI):** every field comes from the `/channels` endpoints above; credentials are write-only; show `acceptBy` as a countdown, `priceMismatch`, the unmapped queue with waiting orders, `lastError`, and `GET /channels/stats`.
- Production steps for E1: none. Deploy migrate then backend; nothing is registered in production, so nothing can be enabled.

## 12. Talabat behind a simulator (E3)

**Nothing here talks to Talabat.** No request was made to Talabat, no credential exists, and no date or commitment is implied. `backend/src/channels/providers/talabat/` holds a provider (`talabat-channel.provider.ts`), a payload parser (`talabat-payload.ts`) and an in-memory fake of the Partner API (`talabat-simulator.ts`). The provider's only transport is that fake: there is **no HTTP client in the folder** (a unit test scans for `fetch`, `http(s)`, `axios`, `undici`, `XMLHttpRequest`, WebSocket and the Talabat hostnames, and fails if one appears). It is registered only where the stub channel is (`NODE_ENV` test or development, or `ENABLE_STUB_CHANNEL=1`), so in production `talabat` is an unknown provider and a connection cannot even be created.

**Real connection is impossible by construction, in three layers:** (1) not registered in production; (2) credentials carry an optional `apiBase`, and anything other than the literal `simulator` makes `testConnection` (and every other call) refuse before a single request, so enabling answers 400 and the connection stays disabled; (3) even the simulator refuses an account without a signed contract (the VERIFIED prerequisite), wrong credentials, or a store that is not part of the chain. A real transport would be a new, separately reviewed change.

### 12.1 What is modelled, VERIFIED versus INFERRED

| Item | Label | Source / note |
|---|---|---|
| Host, OAuth token path, 2-hour token, one token per chain | VERIFIED | Section 3. The simulator mints a 2h token and refuses another chain's. The provider caches and refreshes 5 minutes early. |
| Webhook is a shared secret or a Basic value, not an HMAC | VERIFIED | `verifyWebhook` compares in constant time over fixed-size digests, so the secret's length does not leak. |
| The secret arrives in the `Authorization` header (raw or `Basic <value>`) | **INFERRED** | The docs say the secret is "sent with the request" but not in which header. Accepted: the value itself or `Basic <value>`. |
| Retries (10 s, 5 times) and duplicate delivery | VERIFIED | Delivery ids are undocumented, so the core's body-hash fallback makes an identical retry a duplicate; a changed redelivery of one order is a new inbox row but never a second order (tested). |
| Order events `RECEIVED`, `READY_FOR_PICKUP`, `DISPATCHED`, `CANCELLED` | VERIFIED | That the event is carried in a top-level `status` field is **INFERRED**. Any other value is processed as "ignored", visible in the inbox, and does not count against ingestion success. |
| Field names: `order_id`, `external_order_id`, `order_code`, `client.store_id`, `items[].sku`, `pricing`, `original_pricing`, `payment.sub_total/order_total/delivery_fee/discount/total_taxes/type`, `customer`, `cancellation`, `sys`, `promised_for`, `isPreorder` | VERIFIED (names) | Section 3. |
| `pricing.discount` is the TOTAL discount on the line; `original_pricing.unit_price` is the price before a promotion; money as decimal numbers in major units | **INFERRED** | Read as exact decimal strings (never floats). `original_pricing` absent: the stated `pricing.unit_price` is the unit price. |
| A top-level `currency` (or `payment.currency`) | **INFERRED** | The documented field list names no currency. Without one the order is dead-lettered visibly (`currency is missing from the order`) rather than guessed. Q15. |
| `delivery_type` = `PLATFORM_DELIVERY` / `VENDOR_DELIVERY` / `PICKUP` | **INFERRED** | The docs distinguish READY_FOR_PICKUP (platform delivery) from DISPATCHED (vendor delivery) but name no payload field. Unknown or absent maps to the marketplace courier, the safe answer (never reaches the driver-dispatch lists). |
| Cash payment: `payment.type` containing "cash" means cash due = order total | **INFERRED** | Anything else leaves cash due NULL. |
| Routing key | VERIFIED field | `client.store_id` only. `external_partner_config_id` is deliberately not read (one location id per request, review rule 5). |
| `PUT /orders/{id}` with `UPDATE_CART`, `READY_FOR_PICKUP`, `DISPATCHED`, cancel with `CLOSED`/`ITEM_UNAVAILABLE`/`TOO_BUSY`; 60 requests per minute for GET and PUT together | VERIFIED | The simulator enforces the 60-per-minute window and the platform/vendor delivery split. |
| "Accept" as `UPDATE_CART` confirming the cart | **INFERRED** | Talabat documents no separate accept call. Reject = a cancel with the closest documented reason. If Talabat has no accept step the capability should become local-only. Q16. |
| Outage fallback `GET .../vendors/{vendor_id}` and `GET .../orders/{order_id}` | VERIFIED | Polling ids are `poll:<order_id>:<status>`, deterministic. |
| Outlet status `OPEN`, `CLOSED_TODAY`, `CLOSED_UNTIL`, `CHECKIN` and `closed_reason` | VERIFIED | `setBranchStatus`: open, closed (today, or until a time), busy (`TOO_BUSY_KITCHEN`). |
| Catalog push, asynchronous, keyed by `sku` | VERIFIED | The sku sent is the mapping's `externalItemId`: the same product is always the same sku across renames and price changes (stable ids, tested). Availability is a partial catalog update (`active` only), which the simulator allows for an existing sku. That partial updates are accepted is **INFERRED**. |
| Dynamic prep-time adjustment | **INFERRED** | Owner supplied; no public endpoint. The simulator takes whole minutes 1 to 240 (an arbitrary sane bound, not a Talabat rule). |
| Food is ready | VERIFIED statuses, INFERRED mapping | A person's action, never automatic: platform delivery sends READY_FOR_PICKUP, vendor delivery sends DISPATCHED. |
| Signed contract before any credential | Owner supplied (INFERRED to be enforced by Talabat) | The simulator refuses a token without one. |
| Item-level discounts in the order payload | Owner supplied; the docs show per-item discount and promotion fields | Captured: see 12.2. |
| Failure rate <= 2.5% and ingestion success >= 98.9% | Owner supplied (INFERRED), definitions unknown (Q9) | See 12.3. |
| Acceptance deadline | **Not documented** | `acceptBy` is always NULL (never invented); the core's 15-minute stale alert covers it. |
| Commission | **Not in the order payload** | Always NULL. |

### 12.2 Rules the provider keeps

- **Item-level discounts are captured, never invented.** The line's stated discount goes into the new nullable `orderitem.marketplaceDiscountAmount` (migration `20261112100000`, additive, no backfill; NULL means the payload did not say, never zero). `priceAtPurchase` stays the price before the discount and the order total is what Talabat says the customer paid. The E1 core used to drop the line discount when it cleared the canonical snapshot; this is the one change to core. The line tax stays NULL (a VAT percent is a rate, not an amount); the order tax is `payment.total_taxes` when stated.
- **Minimal customer data:** name and the customer's comment are kept; a phone and address only when the merchant delivers the order itself (`VENDOR_DELIVERY`). For a marketplace courier or pickup they are never stored.
- `provesLocationOwnership` is **false** and stays false: one token covers every store of a chain (VERIFIED), so working credentials say nothing about who owns a store. Requital staff verify the store id with Talabat before it can be enabled; the platform-wide one-enabled-owner-per-store index still applies.
- No gateway charge, no marketing (conversion events), per-shop order numbers, idempotency, and unmapped items visible are all the E1 core's behaviour and are re-asserted for Talabat's shape in `test/marketplace-talabat.e2e-spec.ts`.
- Messages returned to the merchant never contain a credential (tested with a wrong secret).
- **Only three things are fatal when parsing an order:** the unit price of a line, `payment.order_total` and the currency. Every informational figure (line discount, sub-total, delivery fee, order discount, tax) that cannot be read (negative, "5%", exponent form, text) becomes NULL, so an order Talabat has already sent is never dead-lettered over a figure we only display. A line discount larger than unit price x quantity cannot be true and is stored NULL (no flag column exists; the order is still created and the stated order total stays authoritative).
- A token is cached per credentials (hash of client id, secret and chain id), not per connection row, so changed credentials never reuse an old token. A polling event id hashes an order id longer than 100 characters so the 191-character inbox cut can never remove the status suffix.
- **Excess precision is rounded silently.** `decimalToMinor` rounds half up past the currency's decimals (a 2-decimal amount like `10.505` in AED becomes 1051). That is the shared helper's documented behaviour; no marketplace amount is rejected for it and nothing records that rounding happened.
- **Invoices (Q12):** an invoice or packing slip generated for a Talabat order is arithmetic over `priceAtPurchase` (the price BEFORE the line discount) and the order's own totals. With item-level discounts and no order-level discount stated, the printed lines can add up to more than the order total, because `marketplaceDiscountAmount` is not read by the invoice renderer. Block invoices for marketplace orders (Q12) or teach the renderer the line discount before a merchant relies on one.
- **Retention:** the inbox payload (including a vendor-delivery customer's phone and address) is kept until the 30-day purge (section 5.10); the minimal-data rule above governs what is written to the order, not to the inbox payload.

### 12.3 Ingestion success and failure rate

`GET /channels/stats/connections?sinceMinutes=` (admin, shop-scoped on both tables) returns one row per connection of the shop, with traffic or not: `received`, `processed`, `failed` (retrying plus dead), `dead`, `inFlight`, `ingestionSuccessPct`, `failurePct` (one decimal), and `meetsIngestionTarget` (>= 98.9) and `meetsFailureTarget` (<= 2.5), each NULL when nothing has finished (no data is not a pass). `GET /channels/stats?connectionId=` gives the same numbers for one connection of the shop (a foreign id matches no rows). Both come from `channelinboundevent` only; a retrying `failed` row counts as a failure until it is processed, which is the conservative reading. Note the two targets are not complements (success >= 98.9 means failure <= 1.1 under this definition), so both are reported. What Talabat itself counts as a vendor failure (for example rejections or auto-cancels, which are order outcomes and not inbox outcomes) is theirs to define (Q9); no order-outcome metric is built until it is.

### 12.4 What to request from Talabat (no dates implied)

1. A **signed commercial contract** (the prerequisite for everything below).
2. **Partner API credentials** (client id and secret per chain) and the exact OAuth call (method, grant type; Q4 style ambiguity applies here too).
3. A **sandbox**: sandbox credentials and vendor ids, a way to create test orders that reach a webhook URL we give them, and a way to test item replacement (the public docs say it cannot be tested in the sandbox).
4. The **webhook specification**: the exact header that carries the shared secret, the payload schema per event (including the status field name, the currency field, the delivery-type field, the exact `pricing.discount` semantics), whether a delivery id exists, and the retry and ordering guarantees.
5. The **acceptance model**: is there an accept step, a deadline, an auto-cancel rule; the meaning of "warning status".
6. The **restaurant-style endpoints** the owner listed (menu push, food is ready, branch availability, dynamic prep time): paths, bodies, limits. The public docs describe grocery picking only.
7. How a **store id is bound to a merchant**, so staff verification can be done (or replaced by a per-merchant credential, which is the only thing that could make `provesLocationOwnership` true).
8. The **definition and window** of the 2.5% failure and 98.9% ingestion targets.

### 12.5 Open questions added by E3

- **Q15** Where does a Talabat order state its currency? Until answered the simulator carries `currency` and a real payload without it would dead-letter.
- **Q16** Does Talabat have an accept step? If not, accepting should become a local state change and the capability `acceptReject` should only cover the reject (cancel) call.
- **Q17** The E1 core never calls `markReady`, `setItemAvailability`, `setBranchStatus`, `pushCatalogue` or `adjustPrepTime`; E3 implements them on the provider (tested against the simulator) but no admin endpoint invokes them yet. They need E4 endpoints (with audit logging, `orders.manage`, and "food is ready" as a deliberate human action) before a merchant can use them.
- **Q18** `ENABLE_STUB_CHANNEL=1` also registers the Talabat simulator. It is harmless (simulator only) but should not be set in production.

## 13. E2: what was built (Deliveroo, SANDBOX ONLY)

Branch `feat/marketplace-deliveroo`. Everything ships disabled: the provider is registered, but a shop needs the `marketplace_channels` flag, a connection, staff verification of its location and `enabled = 1`; no production host exists in the code.

### 13.1 Files

- `backend/src/channels/providers/deliveroo/deliveroo-channel.provider.ts`: the `ChannelProvider` (webhook verification, routing key, `parseEvent`, accept/reject, status fetch, mark ready, availability, catalogue push, polling, test connection).
- `.../deliveroo-order.mapper.ts`: pure Deliveroo order to canonical order.
- `.../deliveroo-api.client.ts`: OAuth client-credentials client with token cache, hard-coded sandbox hosts and a host allow-list checked before every request.
- `.../deliveroo-webhook.controller.ts`: `POST /channels/deliveroo/webhook`.
- `backend/src/channels/channel-sweep.service.ts` (+ migration `20261111100000_channel_poll_failures`, additive `channelconnection.pollFailures`): poll-failure escalation.
- Tests: `deliveroo.spec.ts` (44 unit), `backend/test/marketplace-deliveroo.e2e-spec.ts` (45), fixtures `backend/test/helpers/deliveroo-fixtures.ts` (a throw-away fake secret; nothing real).

### 13.2 Webhook route

Public (`@Public`), per-source-IP throttle (240/min, never per connection or location), 100 KB body cap (Express answers 413 first; the handler repeats the cap), raw `Buffer` required. It calls `ChannelIngestionService.receive()` with no `processInline`, answers a bare `200 {received:true}` for a new AND a duplicate delivery, and lets the core's identical 401 through for every refusal.

Order of checks: (1) the two headers must be well formed (guid `[A-Za-z0-9._:-]{1,128}`, signature 64 hex), which refuses before any database read; (2) route by `body.order.location_id` only, through the E1 enabled unique `routingKey`; (3) HMAC-SHA256 over `guid + " " + raw bytes` against the connection's own secret, or, ONLY for a connection that has no secret of its own, the platform secret `DELIVEROO_SANDBOX_WEBHOOK_SECRET` (review M1: the core no longer unions them, so a holder of the shared secret cannot sign for a connection that has its own; the platform secret is also OFF in production unless `DELIVEROO_ALLOW_PLATFORM_WEBHOOK_SECRET=1`, and enabling a connection without its own secret is refused while no usable platform secret exists), compared in constant time with no early exit; (4) a signed-time check (review L3: a body with no parseable `status_log` is refused too); (5) the durable inbox INSERT; (6) the 200. Processing happens after, through the E1 inbox.

- **VERIFIED:** header names, signing string, single-space separator, raw-bytes requirement (`securing-webhooks.md`); envelope `{event, body:{order}}` (the order sits at `body.order`, so the E1 hand-off line "`extractRoutingKey` = `body.location_id`" was imprecise: the real path is `body.order.location_id`).
- **Whitespace in the guid is refused**: the guid is joined to the body with a space, so a guid containing a space would let one signed pair pose as another with a different event id.
- **Event id = `<guid>:<first 32 hex of sha256(body)>`.** Deliveroo does not say whether the sequence guid is unique per delivery, so a guid shared by two different events must never make the second a duplicate; a retry of the same delivery (same guid, same bytes) still collapses on the inbox UNIQUE, and a redelivery under a new guid collapses on the order UNIQUE and the idempotent status CAS.
- **Replay (INFERRED window).** Deliveroo documents no timestamp in the signature. The newest `status_log.at` inside the signed body must be no older than 2 hours and no more than 10 minutes in the future (Deliveroo retries for at most 30 minutes, VERIFIED), else the delivery is refused with the same 401. This bounds replay of an old capture; it does not stop an immediate replay, which the inbox UNIQUE makes a no-op.
- `provesLocationOwnership` is **false**. The credentials are probably integrator-level, so enabling needs platform-staff verification (`verify-location`); `testConnection` obtains a token and, when the brand id is set, lists that location's live orders, and always answers `provesLocation: false`. It never echoes a credential.
- Polling event ids are `poll:<order id>:<status>` (deterministic). A polled order whose own `location_id` differs from the connection's is dropped and logged (this is the "event location vs stored location" mismatch log from the second review).

Other review fixes: the provider declares `displayName = 'Deliveroo'` and `credentialFields` (`clientId`, `clientSecret`); a connection missing either key fails `testConnection` and is never completed from the platform sandbox credentials (those apply only to a connection with neither key, and never in production); brand, site and location ids must match `^[A-Za-z0-9][A-Za-z0-9._:-]*$` in the connection DTOs and in the provider (L1: `.` and `..` can never become a path segment); an unknown or disabled location runs one dummy HMAC comparison so timing does not say which locations exist (L4, best effort, the decrypt of a real secret is still extra); the poll-failure alert is wrapped so it cannot abort the polling loop (L5).

### 13.3 Outbound calls (sandbox)

Hosts: `https://auth-sandbox.developers.deliveroo.com/oauth2/token`, `https://api-sandbox.developers.deliveroo.com/order`, `.../menu`. Credentials: the connection's own `clientId`/`clientSecret` win; otherwise the platform `DELIVEROO_SANDBOX_CLIENT_ID`/`_SECRET` (never a mix). Token cached until 30 s before `expires_in`, one shared request for concurrent callers, one retry after a 401. Errors shown to a merchant carry only a status and Deliveroo's short error code.

| Call | Endpoint | Status |
|---|---|---|
| accept / reject | `PATCH /v1/orders/{id}`; reasons `closing_early|busy|ingredient_unavailable|other` (anything else is `other` with a capped note); 204 ok; 409 is success only if a `GET /v2/orders/{id}` shows the wanted state; 503 `order_not_ready` retried after `Retry-After` (cap 10 s, 3 attempts); 5 per minute per order enforced locally | VERIFIED (`patch-order`) |
| status | `GET /v2/orders/{id}` | VERIFIED |
| polling | `GET /v2/brand/{brand}/restaurant/{restaurant}/orders?live_orders=true`, `next` cursor, 3 pages max | path and params VERIFIED; `restaurant_id` = order `location_id` INFERRED; `live_orders` is marked experimental |
| ready for collection | `POST /v1/orders/{id}/prep_stage {stage, occurred_at}` | body VERIFIED; same order server INFERRED. Human action only: nothing calls it automatically |
| item availability | `POST /menu/v1/brands/{brand}/menus/{menu}/item_unavailabilities/{site}` `{item_unavailabilities:[{item_id,status}]}` | VERIFIED (menu id `requital-c<connection id>`, stable) |
| catalogue push | `PUT /menu/v1/brands/{brand}/menus/{menu}` | path and required fields VERIFIED; empty `mealtimes` and the **omitted `tax_rate`** are INFERRED (a tax rate is never invented, so Deliveroo may refuse the push) |

Since the E5 follow-up (section 14), `markReady` and `setItemAvailability` have desk and admin routes; `pushCatalogue` is still not called by anything (deferred, section 14.5).

### 13.4 Order mapping (`body.order`)

VERIFIED fields as in section 2. Choices: `totalMinor` = `total_price` (Q5, INFERRED); line unit price = `item.total_price` (per unit including modifiers, before discount, VERIFIED) except that a quantity above 1 whose `total_price` equals the computed unit price times quantity is the documented test-order shape and the computed price is used; modifiers are folded in and listed in the line note; `pos_item_id` null gets a stable `name:<hash>` id so it can be mapped once and never becomes a product; tax and commission are NULL (absent from the schema); delivery fee only from `delivery.delivery_fee`; `acceptBy` = placed time + 7 minutes (AE, KW and unknown markets) or 10 (other markets) for ASAP orders only, derived from the market prefix of the order id (the prefix is VERIFIED as `{market}:{uuid}`; the unknown-market choice is INFERRED); a scheduled order gets no invented deadline. `order.new` that is already `accepted` (tablet flow) creates the order then confirms it. A status event carries the full order only if it maps, so an unmappable cancellation still applies.

### 13.5 NOT built (and why)

- **Item removal and substitution** (`removeItem`, `substituteItems` stay false): documented only in the Picking API (Retail suite, Q1), keyed on order-item ids the Order API webhook does not carry. Not guessed.
- **Branch status, prep-time adjustment** (Site API not enabled for the owner).
- **Scheduled `confirmed` step**: built in the E5 follow-up, see section 14.2. What Deliveroo does with an accepted scheduled order that is never confirmed is still unknown (request 17).
- **Refund webhook** (S30).
- Auto-accept (Q3), unchanged.
- Poll-failure staff alerting beyond a structured `error` log line (there is no platform notification channel); the merchant gets one WhatsApp alert per streak of 5 failed polls.

### 13.6 Injection proofs (revert, see the named test fail, restore)

- **Signature check removed** (`verifyWebhook` accepting any signature): "S12 bad HMAC, missing headers and wrong secret all get the SAME 401", "S14 another tenant" and "the platform webhook secret works ... and a wrong one does not" fail.
- **Idempotency** (event id made random per delivery): "S08 the same delivery twice (same GUID)" fails (two inbox rows; the order UNIQUE alone still made one order, which is why the test also counts inbox rows).
- **Tenant routing** (routing key read from a top-level `location_id` before `body.order.location_id`): "the routing key is body.order.location_id and nothing else" fails (the delivery is routed to B with A's secret and refused).

### 13.7 Residual risks

- (L2) `testConnection` can be run before staff verification, so a merchant can use the platform's sandbox credentials to list a location's live orders (brand and location they typed) in the sandbox. Recorded only; production credentials are never used by this code. Consider requiring verification before the test.

- The throttle is per source IP and the real Deliveroo egress addresses are unknown; `TRUST_PROXY` must be on in production for `req.ip` to be the client (see CLAUDE.md, N6c) before this route is meaningful.
- A body between 100 KB and 1 MB is refused by the parser (413) and only recovered by polling.
- The staleness window (2 h) and the 240/min throttle are INFERRED numbers.
- Credentials are likely integrator-level: tenant isolation rests entirely on the staff-verified `location_id`; do not set `provesLocationOwnership` without a per-merchant proof.

### 13.8 Live sandbox smoke (2026-10-21, one call, no secret printed)

One form-encoded client-credentials POST to `https://auth-sandbox.developers.deliveroo.com/oauth2/token` with the owner's sandbox client id and secret (a script that printed only presence booleans and the HTTP status): **HTTP 400, error code `invalid_client`**, no token. Both values were checked for stray whitespace, quotes and newlines (none). So the request shape and host answer, but **these credentials are not accepted by that host**. Most likely candidates, none verified: they belong to the other token URL the docs list (`deliveroo-api.auth.eu-west-1.amazoncognito.com`, Q4; not called because it is not a documented sandbox host), or the sandbox client is not yet enabled for the integration. Request 4 in section 9 is therefore blocking for any outbound sandbox call; inbound (webhook) handling does not depend on it. No order, accept or menu call was made against the real sandbox. **Superseded by section 14.1: the owner then supplied new credentials and the same host answered 200.**

## 14. F/E5: Deliveroo follow-ups (still disabled by default, fakes only)

Branch `feat/deliveroo-followups`. Nothing here makes a real call: every outbound path is exercised against the stub provider or the fake `fetch` the Deliveroo e2e already injects. The feature flag, staff verification and `enabled = 0` defaults are unchanged.

### 14.1 Step 0: sandbox token retest (2026-10-22)

ONE client-credentials request to the documented sandbox token host `https://auth-sandbox.developers.deliveroo.com/oauth2/token` with the owner's new sandbox credentials returned **HTTP 200**, `token_type` `Bearer`, `expires_in` 300, and **no `scope` field in the response body**. The JWT's `scope` claim is `https://api-dp.deliveroo.net/api_access`. No credential or token is recorded here or anywhere in the repository.

- **Q4 is resolved for the sandbox:** the `auth-sandbox` host is the right one. The earlier `invalid_client` (section 13.8) was therefore the old credentials, not the token URL; the Cognito URL was never needed and was never called. The production token URL is still not confirmed.
- The scope names are not in the body, so which API suites the client is enabled for cannot be read from the token response; only the single claim above is known.
- The supported read-only calls (`listOpenOrders`, the list inside `testConnection`) need a **brand id and a location or site id, which we still do not have** (the Sites API is not enabled for the integration). Nothing further was called: no order, accept, menu or site request.

Requests list (section 9) after this: item 4 is answered for the sandbox; item 1 (brand, site and location ids) is now the blocker for every further sandbox step.

### 14.2 Scheduled-order confirm

A scheduled order has a second step after acceptance: `PATCH /v1/orders/{id}` with `{"status": "confirmed"}` (the `confirmed` status and the accepted-then-confirmed transition are VERIFIED, section 2). Requital naming trap: `order.status = 'confirmed'` on OUR order is set at **acceptance**, not at this step; the marketplace confirm is recorded only on `channelorder.confirmedAt`.

- **Data** (migration `20261121100000`, additive): `channelorder.confirmBy`, `confirmedAt`, `confirmClaimedAt`, `confirmAttempts`, `readyClaimedAt`, `readyAt` (NULL = unknown or not done) and `channelconnection.autoConfirmScheduled` (default 0). `CanonicalChannelOrder.confirmBy` is optional; the ingestion INSERT stores it.
- **Mapper:** `confirmBy = confirm_at`, falling back to `start_preparing_at`, for a non-ASAP order only; an ASAP order has none. **UNVERIFIED: which payload field is the real deadline** (the docs say "confirm before `start_preparing_at`" and also mention `confirm_at`). The fallback errs towards alerting early.
- **Provider:** capability `scheduledConfirm` and `confirmScheduledOrder`, implemented on Deliveroo with the existing `patchStatus(..., {status: 'confirmed'}, ['confirmed'])`, so 409 `invalid_status_transition` is success only if `GET /v2/orders/{id}` already shows `confirmed`, and 503 `order_not_ready` keeps its `Retry-After` retry.
- **DEFAULT behaviour (owner decision): alert, do not confirm.** The sweep step `confirmScheduled` sends ONE WhatsApp alert to the outlet (job key `channelorder:<id>:confirm-alert`, so once however often it runs) when an accepted, unconfirmed scheduled order is within `CONFIRM_LEAD_MINUTES` (30) of `confirmBy`, and the merchant presses **Confirm scheduled order** on the desk (`POST /channels/orders/:id/confirm-scheduled`: marketplace first, then a CAS on `confirmedAt IS NULL`, audit `channel_order.scheduled_confirmed`, 502 and no change on a provider failure, 409 without the capability). The lead time, the 24 hour give-up window and the claim back-off are **UNVERIFIED** numbers (Deliveroo publishes none).
- **Opt-in `autoConfirmScheduled` (OFF):** per connection, set by the merchant admin (`PATCH /channels/connections/:id`, refused for a provider without the capability, confirm dialog in the UI because it is a commitment to prepare the order). When on, the same step confirms instead of alerting, on an enabled connection only, at most 3 orders and 30 seconds per tick (provider calls hold the 55 second sweep lock), at most 5 attempts per order (`confirmAttempts`), then it stops and the single alert goes out; only providers that declare `scheduledConfirm` are selected, and a suspended shop is skipped. **The `marketplace_channels` flag does not stop an opted-in auto-confirm** (an order already accepted is never abandoned because the flag was switched off), the same as the polling step. The alert scan skips outlets with no number to alert and looks past 200 candidates, so an unreachable outlet cannot starve the others.
- **Keyed on `confirmedAt`, never on `externalStatus`** (a late `accepted` event overwrites `externalStatus`). A CAS claim (`confirmClaimedAt`, stale after 120 seconds, which is also the back-off after a failure) is taken BEFORE the provider call; a `confirmed` status event from the tablet also sets `confirmedAt`.
- UNVERIFIED and open: what Deliveroo does with an accepted scheduled order that is never confirmed (request 17), and the lead time.

### 14.3 Desk and admin routes

All copy the `accept`/`reject` pattern: `load()` is shop-scoped, a branch user of another outlet gets 404 by an explicit comparison, `orders.manage` is asserted at the order's outlet, the provider is called first and a failure (502) changes nothing, and every success writes an audit row.

| Route | Roles | Behaviour |
|---|---|---|
| `POST /channels/orders/:id/ready` | admin, branch, order_manager | Accepted order with a Requital order only; claims (`readyClaimedAt`), calls `markReady`, sets `readyAt` by CAS, audit `channel_order.marked_ready` only for the press whose CAS affected the row; a repeat or a concurrent press does not call again. **A deliberate human action** (confirm dialog in the UI); nothing in the sweep calls it. Capability gate: 409 for a provider without `markReady`. |
| `POST /channels/orders/:id/confirm-scheduled` | same | Section 14.2. |
| `POST /channels/connections/:id/availability` | admin | `{items: [{externalItemId, available}]}`, 1 to 200. Needs the flag, an enabled connection, brand AND site ids, the `itemAvailability` capability, and every item id must be one of THIS shop's `channelitemmapping` rows for the provider (400 otherwise, nothing sent). Audit `channel.availability_set`. **The Sites API is not enabled, so this is exercised against the fake only.** |
| `POST /channels/connections/:id/prep-time` | admin | Capability-gated: 409 for a provider without `prepTimeAdjust` (Deliveroo has none we can use). |
| `GET /channels/providers` | admin, branch, order_manager | Now readable by the desk roles (names and capabilities only) so the desk knows which buttons to draw. |

### 14.4 Staff verification

- **Merchant:** `POST /channels/connections/:id/request-verification` (admin, flag required, a location id required, 409 if already verified). One UPDATE decides "once per 24 hours" on `verificationNotifiedAt`, which only a request writes (a PATCH can never reset it, so repeating the stored id cannot re-trigger the staff notification); the loser gets 429. `verificationRequestedAt` (what the merchant sees and the staff queue lists, migration `20261121110000`) is cleared only when an id actually changes or credentials are replaced. Audit `channel.verification_requested`.
- **Staff notification (owner decision: no new channel):** `GET /platform-admin/channel-connections/pending-verification` is a cross-shop list (connections requested and not verified, oldest first, capped at 100, no secrets) shown at the top of Platform > Shops, plus one structured `error` log line and one capture through the existing `ERROR_TRACKING_WEBHOOK_URL` provider per accepted request (ids only).
- **Platform view:** `GET /platform-admin/shops/:shopId/channel-connections` now returns outlet name, provider display name, `locationVerifiedAt/By` and `verificationRequestedAt` on top of the merchant fields; the merchant view only gained `verificationRequestedAt` and `autoConfirmScheduled`.
- **Admin UI** (`ChannelConnectionsCard` on `/platform/shops/[shopId]`): the three ids are read-only text, a required "I confirmed these ids with the marketplace" tick enables Verify, the call restates ALL THREE ids exactly as displayed, a 409 says the ids changed and offers Reload (nothing is verified), and removing a verification asks first because it also turns the connection off.

### 14.5 Deferred

- **`pushCatalogue`** stays unrouted: the Menu API call replaces the whole menu (destructive) and is limited to 1 request per minute per site, and the empty-`mealtimes` and omitted-`tax_rate` assumptions in 13.3 are unverified. It needs the owner's decision on tax and a dry-run design first.
- Prep-time: the route exists but no provider implements it.
- Item removal and substitution, refunds and branch status are as in 13.5.
