# PAY-1 investigation: Apple Pay / Google Pay wallet buttons

Branch `docs/pay-1-wallet-investigation`, 2026-10-08. Investigation only: no code, no migration.
Audit item: `docs/plans/product-capability-audit.md:935` (PAY-1, wallet buttons on PDP and checkout via Stripe Payment Request; PAY-11 is the PDP "buy now" built on it, line 945).

Labels: **VERIFIED** = read in this repo (file:line). **INFERRED** = Stripe/Apple/Google behaviour from documentation as I know it. There was no live Stripe access, and every INFERRED line needs a one-time check on a real Stripe account before anything is promised to a merchant.

## Verdict

1. **Wallets themselves: FITS the hosted-redirect design with configuration and a live check only, no code.** Our Checkout Session already uses `payment_method_types: ['card']`, and Stripe-hosted Checkout shows Apple Pay and Google Pay under `card` on a supporting device with no domain registration (INFERRED). The owner action is to confirm on the real account (Dashboard wallet toggles, one real device test on `testadmin`), not to change code.
2. **On-site wallet buttons on the PDP/cart/checkout (what PAY-1/PAY-11 literally describe): DOES NOT FIT the existing design without owner decisions.** It needs a second Stripe integration shape (PaymentIntent or embedded session), a publishable-key credential the platform does not store, Apple Pay domain registration for every shop host, a CSP change, and a new webhook/reconciliation branch. Stop here and decide; effort and options below.
3. **No small, behaviour-neutral groundwork step exists** that I would recommend implementing now (see "Groundwork").

## 1. What exists today (VERIFIED)

- Order first, pay second. `PublicService.createOrder` writes the order (stock reserved with a CAS floor, discount redeemed, gift card claimed) in a transaction, then calls `provider.createCheckoutSession(...)` (`backend/src/public/public.service.ts:2041-2069`). The storefront does `window.location.href = res.checkoutUrl` (`storefront/lib/useCheckoutForm.ts:271-275`; the payment-link page does the same, `storefront/app/[shop]/pay/page.tsx:70-71`).
- `StripePaymentProvider.createCheckoutSession` (`backend/src/payments/providers/stripe-payment.provider.ts:58-91`): `mode: 'payment'`, **`payment_method_types: ['card']`** (line 64), one `price_data` line "Order #id", `unit_amount: toMinorUnits(amount, currency)` (line 75), `metadata: { orderId }`, success/cancel URLs from `storefrontUrl(shop, ...)`. No `payment_intent_data`, no `ui_mode`, no `automatic_payment_methods`.
- Amount and currency are server-side only. Storefront: `amount: remainderTotal` (order total minus gift card) and `currency: shop.currency` (`public.service.ts:2049-2051`; `remainderTotal` at 1713). The client sends no price. Tax, delivery, discount and gift card are already folded into `orderTotal` before this point. There is no store-credit concept in the backend (grep found none).
- Per-shop credentials: `PROVIDER_CREDENTIAL_FIELDS.stripe` is **only `secretKey` and `webhookSecret`** (`payments/provider-credentials.ts:63-66`). No publishable key exists anywhere, per shop or as an env var. `resolvePublicWidgetKey` (`payment-settings.service.ts:218`) is typed `'tabby' | 'tamara'` and cannot return a Stripe key as written. Keys are the merchant's own Stripe account (bring-your-own-keys, `clientFor(secretKey)`, lines 32-45), with `STRIPE_SECRET_KEY` as platform fallback. This is not Stripe Connect.
- Webhook: only `checkout.session.completed` (-> paid + `advanceOrderStatus: 'confirmed'`) and `checkout.session.async_payment_failed` are handled (lines 151-183). `providerReference` is the **event id**; idempotency is the unique `(gateway, gatewayReference)` index (`payments.service.ts:325-361`). `chargeReference` is the PaymentIntent id, stored as `providerChargeReference` and used by `refunds.create({ payment_intent })` (lines 187-198).
- Reconciliation: `retrieveSessionOutcome` calls `stripe.checkout.sessions.retrieve(order.paymentSessionId)` (lines 104-121); the sweep selects on `paymentSessionId IS NOT NULL` (`payment-reconciliation.service.ts:85-100`).
- Storefront CSP (`storefront/next.config.ts:66-91`): `default-src 'self'`; `script-src` lists Maps and the four analytics hosts; `connect-src` the same; **there is no `frame-src`** (falls back to `default-src 'self'`). `js.stripe.com`, `api.stripe.com`, `hooks.stripe.com` appear nowhere. Today the storefront never touches Stripe origin-side; it only navigates away.
- `proxy.ts` matcher (`storefront/proxy.ts:126`) excludes `_next/static`, `_next/image`, `favicon.ico`, `robots.txt`, `sitemap.xml`, `store-not-found`, `api/` only. `/.well-known/...` is **not** excluded, so on a hostname-resolved request it would be rewritten onto `/{slug}/.well-known/...` and 404. `storefront/public/` has no `.well-known`. `deploy/Caddyfile` forwards everything on `*.requital.io` and the on-demand custom-domain block straight to :3002, with no special path handling.
- Consent: `lib/consent.ts` is the switch for "everything non-essential" and `lib/analytics.ts` injects scripts only after "accepted". It is scoped to analytics/ad pixels.

## 2. Q1: does hosted Checkout already give wallets?

INFERRED, high confidence: yes.
- Apple Pay and Google Pay are card-backed wallets in Stripe. On Stripe-hosted Checkout they are offered automatically when `card` is an allowed method and the device/browser qualifies (Safari with a Wallet card for Apple Pay; Chrome signed in with a saved card for Google Pay). `payment_method_types: ['card']` therefore does not suppress them.
- Wallet visibility is governed by the Dashboard's Payment methods > Wallets switches (on by default) and by the account's country/currency eligibility, not by anything we pass.
- Apple Pay on `checkout.stripe.com` needs **no domain registration**, because the page is Stripe's domain. Domain registration only matters when the wallet renders on our own origin.
- What we do not get: the wallet is reached after a redirect, not as a button on the PDP/cart, and the customer has already filled the whole checkout form (name, phone, address, region, slot). So hosted wallets raise conversion at the payment step but remove no form friction.
- Switching `payment_method_types` to dynamic payment methods (omit it) would also enable whatever else the account has on (Link, other local methods). That is a behaviour change on every Stripe shop, so it is not a free groundwork step.

Cheap check for the owner (no code): on `testadmin`, with Stripe test keys, place an order from an iPhone (Safari, Wallet card) and from desktop Chrome (Google Pay card) and confirm the wallet button is on the hosted page. Also confirm in the Dashboard that Apple Pay and Google Pay are enabled. This answers the question on the real account, which I cannot.

## 3. Q2: what an on-site Express Checkout Element (ECE) needs

Options, smallest first (all INFERRED as to Stripe specifics):

- **A. ECE + PaymentIntent.** Backend creates a PaymentIntent with `amount = toMinorUnits(remainderTotal, order.currency)`, `metadata.orderId`, returns `client_secret`; storefront mounts ECE and calls `stripe.confirmPayment`. Needs new `createPaymentIntent` on the provider interface (Stripe-only, optional method like `retrieveSessionOutcome`), new webhook branch, new reconcile branch.
- **B. Embedded Checkout (`ui_mode: 'embedded'`).** Still a Checkout Session, so webhook event (`checkout.session.completed`), `metadata`, `retrieveSessionOutcome` and refunds are **unchanged**. Needs only: `return_url` instead of success/cancel, `client_secret` returned instead of `url`, stripe.js on the page, publishable key, CSP, and Apple Pay domain registration. It shows an in-page form with wallets, not detached "express buttons". Smallest backend delta of the on-site options.
- **C. Checkout Sessions with Elements / ECE (`ui_mode: 'custom'`).** Newer API shape; same session-based webhook/reconcile benefit as B with true express buttons. I am least sure of its current availability in the pinned `stripe` package (`^22.3.2`, `backend/package.json:50`); check before choosing.

Item by item:

| Topic | Finding |
|---|---|
| Amount source | Must be the server's `remainderTotal` / order total, read from the stored order, never the client. Same rule as today (`public.service.ts:2049`). The payment-link path charges `Number(order.total)` and `shopCurrency` (`payments.service.ts:171-174`), see Pre-existing issues. |
| Where the intent/session is created | Inside the same post-commit step as today's `createCheckoutSession` (after the order exists). So the order exists before the wallet sheet opens. A wallet tap on the PDP would need an order for a cart that has no address yet. |
| Express buttons skip the form | The wallet sheet returns name/email/phone/shipping address, but our order needs `regionId`, delivery zone/fee, delivery date and slot, outlet, receiver message. An express button on the PDP/cart therefore needs: delivery fee quoted server-side from the wallet address (zone matching, `resolveDeliveryFee`), the slot/date requirement relaxed or collected afterwards, and an order created from wallet data. That is the large part (PAY-11), not stripe.js. A button placed at the existing checkout step, after the form, is bounded. |
| stripe.js and CSP | Requires `script-src https://js.stripe.com`, `frame-src https://js.stripe.com https://hooks.stripe.com` (a new directive, today absent), `connect-src https://api.stripe.com` (plus Stripe's telemetry/network hosts, check the current CSP page). Global header (a static header cannot vary per shop), same known tradeoff as `ANALYTICS_*`. |
| Consent banner | **Decision: stripe.js is functional/essential, not analytics, so it is not consent-gated.** It is necessary to take a payment the customer is actively making, and the rule in `lib/consent.ts` is about analytics and ad scripts. Document it next to `ANALYTICS_*`. Mitigation: load it only on the checkout (or PDP-express) page, never site-wide, and never for shops without a Stripe publishable key. Note Stripe's own docs ask to load stripe.js from `js.stripe.com` on every page for fraud signals; loading only on pay pages is supported but weaker for Radar. Owner call. |
| Publishable key | New credential. Per-shop `publishableKey` field in `PROVIDER_CREDENTIAL_FIELDS.stripe` (plain, public by design, like Tabby/Tamara `publicKey`), a platform `STRIPE_PUBLISHABLE_KEY` env fallback, and exposure via a Stripe-typed sibling of `resolvePublicWidgetKey` that returns it only when Stripe is the active, enabled card processor. Mismatch risk: publishable key from one account with a secret key from another makes the intent unconfirmable, so validate the `pk_`/`sk_` pair (same mode, same account via a server-side `accounts.retrieve`) at save time. |
| Apple Pay domain verification | Stripe needs each domain that shows Apple Pay registered on the Stripe account that owns the payment (Payment method domains / Apple Pay domains API, with that account's secret key) and `/.well-known/apple-developer-merchantid-domain-association` served from that host. The file is, to my knowledge, the same static file for all accounts (INFERRED). Our hosts: (a) `{sub}.requital.io` wildcard, (b) each `verified` custom domain. Consequences below. |
| Webhook idempotency | See risk R2: a bare PaymentIntent fires `payment_intent.succeeded` only; a Checkout Session's PI **also** fires it. If both events are subscribed, two different event ids -> two `paymenttransaction` rows for one payment, because the unique key is the event id. Needs a filter (ignore intents that belong to a session) or a unique on `providerChargeReference` per order. Option B/C avoid it. |
| Reconciliation | `retrieveSessionOutcome` would be handed a `pi_...` id and call `checkout.sessions.retrieve`, which errors every tick (caught per row, `payment-reconciliation.service.ts:150-160` pattern, but it wastes the 50-row budget). Option A needs an id-prefix branch to `paymentIntents.retrieve`. Option B/C: none. The `getCheckoutSession` payment-link path re-mints a session per visit and clears `paymentreconciliation` (`payments.service.ts:171-203`); an intent/embedded flow must keep one id per order or copy that reset. |
| Refunds | Unchanged: `providerChargeReference` is the PaymentIntent id in every option (`stripe-payment.provider.ts:187-198`). With Option A, set it from the succeeded event's `data.object.id`. |

### Apple Pay domains for every shop host

- **`{shop}.requital.io`**: the platform account (`STRIPE_SECRET_KEY` fallback) would register `requital.io` (INFERRED: Stripe's payment-method-domain registration covers subdomains of a registered parent; confirm, because if not it is one API call per shop at signup). The wildcard cert and Caddy block already serve every subdomain from :3002, so serving the file is a Next concern, not Caddy.
- **Shops with their own Stripe keys (BYO, the common merchant path here)**: the shop's own account must register the shop's host using the shop's own secret key. That means a platform step "register this host with this shop's Stripe account" (a call at key-save time and again on domain change), not a one-time global setup.
- **Verified custom domains** (`customDomainStatus = 'verified'`, e.g. `irmain.com`): each needs registering on the owning account after verification, and unregistering/re-registering on disconnect. The existing verify/disconnect hooks in `shop/` are the natural trigger. A domain that is `pending` must not be registered.
- **Serving the file**: add `storefront/public/.well-known/apple-developer-merchantid-domain-association` (no extension, so set the content type; Next serves `public/` files at the root) **and** add `.well-known/` to the `proxy.ts` matcher exclusions, otherwise the hostname rewrite sends it to `/{slug}/.well-known/...` (`proxy.ts:126`). `redirect-rules.ts` already blocks `/_next`, `/api` etc. as redirect sources; `.well-known` would need adding there so a merchant redirect cannot shadow the file. Caddy needs no change.
- Google Pay needs no domain registration with Stripe (INFERRED).
- Stripe Connect is not in use, so there is no platform-level "one registration for all merchants" shortcut. Moving to Connect would change account ownership, payouts and the webhook model, and is out of scope.

### 3-decimal currencies and wallet availability

- Our conversion is `toMinorUnits` with factor 1000 for KWD/BHD/OMR (`backend/src/common/currency-minor-units.ts:39-45`), and the e2e test pins **33091** for 33.091 KWD (`backend/test/kwd-end-to-end.e2e-spec.ts:58`).
- INFERRED, and potentially a bug on the existing hosted path: Stripe documents that for three-decimal currencies (BHD, KWD, OMR, JOD, TND) the API amount must be divisible by 10 (the last digit must be 0), so 33091 would be rejected for a KWD checkout, while 33090 is accepted. If true, every KWD/BHD/OMR Stripe checkout whose total has a non-zero third decimal fails today. Verify with a Stripe test-mode request before relying on KWD/BHD/OMR via Stripe at all. This is independent of wallets and should be settled first.
- Stripe merchant-country availability matters more than wallet support: INFERRED that of the six Gulf countries only the UAE is a Stripe-supported business country. A Saudi/Kuwaiti/Qatari/Bahraini/Omani merchant bringing their own Stripe keys is unlikely to exist; their Stripe route is the platform (UAE) account presenting in a foreign currency, where presentment-currency and wallet support are decided by Stripe per account and currency. Apple Pay and Google Pay are available to UAE accounts; behaviour for presentment in SAR/KWD/QAR/BHD/OMR needs a per-currency live check (INFERRED, not confirmed). Apple Pay/Google Pay *customer* availability in all six countries is not the constraint; the account and currency are.

## 4. Q3: other gateways

Tabby, Tamara and PayPal are unaffected. They are separate hosted/redirect providers with their own credentials, webhooks and (Tabby/Tamara) status-advancing events; nothing in options A-C touches `PaymentProviderRegistry` entries other than `stripe`. The audit's "Tabby/Tamara equivalents" do not exist as wallet features. Nomod is a structural stub with no UI (audit §D17); reviving Nomod for bundled wallets is a different decision from this one.

## 5. Risks

- **R1 (pre-existing, verify first):** three-decimal Stripe amounts with a non-zero last digit are probably rejected (above).
- **R2:** double-recording if `payment_intent.succeeded` is added next to `checkout.session.completed` (event-id unique key does not dedupe across event types).
- **R3:** reconciliation poisoning: a `pi_` id in `paymentSessionId` makes `sessions.retrieve` fail every tick.
- **R4:** CSP widening is global, and `frame-src` is new. Apple Pay inside an iframe is a known friction (Stripe's embedded/ECE iframes handle it, but a stray Permissions-Policy would break it; none is set today, VERIFIED by reading `next.config.ts`).
- **R5:** domain registration drift: a verified custom domain disconnected or re-pointed leaves a stale registration; a key rotation on the shop's Stripe account loses all registrations.
- **R6:** publishable/secret key mismatch from two different accounts.
- **R7:** abandoned wallet sheets: the order is created before the sheet opens and reserves stock (same property as today's redirect; the existing `pending` abandoned-order behaviour applies).
- **R8:** an express button that bypasses the checkout form must still go through the server for delivery fee, region validation (`RegionsService.resolveForShop`), slot validation (`assertValidTimeSlot`), discount eligibility and the per-customer limit; any shortcut here is a money/tenant-isolation hole.
- **R9:** this touches money, auth-adjacent credentials and CSP, so a build of it needs the coordinator's independent `/security-review`.

## 6. Pre-existing issues found on the way (not fixed, not part of PAY-1)

- Payment-link path charges `order.shopCurrency` (live shop currency) not `order.currency` (`payments.service.ts:174`), contradicting the "currency is captured per order" rule from A1/A6. Reachable only after a shop changes currency with an unpaid linked order.
- `paymenttransaction.amount` is inserted from `order.total` (`payments.service.ts:333-334`), not the amount actually charged. On a gift-card partial order the charge is `remainderTotal` but the row records the larger total.
- `getCheckoutSession` uses `Number(order.total)` while the storefront path uses `remainderTotal`; harmless today only because gift cards are storefront-only.

## 7. Effort estimate

- Hosted wallets (part 1): 0.5 day of owner/ops verification, 0 code. If `testadmin` test shows no wallet button: investigate account country/wallet toggle, still no code.
- Option B (embedded Checkout, form-step wallets): about 4-6 days: publishable-key credential + validation + public exposure, provider `ui_mode` branch and return handling, storefront Stripe element + CSP, `.well-known` file + proxy exclusion, domain registration service + hooks on verify/disconnect/key-save, tests, security review.
- Option A: B plus webhook/reconcile branches and R2 guards: about 6-8 days.
- Express buttons on the PDP/cart (PAY-11): add 8-12 days for server-quoted delivery from the wallet address and the no-form order path; not recommended until B ships and the owner decides the slot/region rules for express orders.

## 8. Groundwork

**None recommended.** The one obvious tweak (dropping `payment_method_types: ['card']` for dynamic methods) changes what every Stripe shop offers and is not behaviour-neutral. A publishable-key admin stub would add a field nothing reads (the repo avoids speculative settings: see the "Coming Soon" and dead-boolean rules in CLAUDE.md). Do not implement anything yet.

## 9. Owner decisions needed

1. Is hosted-page wallets (part 1) enough for now? If yes, close PAY-1 after the live device check.
2. If on-site wanted: B (embedded, recommended: unchanged webhook/reconcile/refund) vs A vs C, and form-step only vs PDP/cart express.
3. Is stripe.js treated as essential (loaded on pay pages only, no consent gate)? Recommended yes.
4. Who owns Apple Pay domain registration for BYO-key shops (platform automation at key-save/verify time, or the merchant)?
5. Confirm the three-decimal Stripe amount rule (R1) before any KWD/BHD/OMR merchant is promised Stripe.
