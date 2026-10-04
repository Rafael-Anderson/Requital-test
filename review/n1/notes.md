# N1 hand-off: remove fake data (branch fix/remove-fake-data)

No migration. The coordinator deletes this note and the shots before merge.

## (a) Dashboard Experience Rating

Premise correction: the card's comment ("no review/rating model exists") was stale; `surveyresponse.rating` (1..5) has existed since 20260802190000. Only one place shows the card, `admin/app/dashboard/page.tsx` (the simple-mode `SimpleDashboard` never had a rating card).

- Backend: `GET /dashboard/summary` gains `experienceRating: { average: number | null, count: number }` (`backend/src/dashboard/dashboard.service.ts`, new 9th query in `getSummary`'s `Promise.all`).
- Answered = `respondedAt IS NOT NULL AND rating IS NOT NULL`.
- Date basis (decision): the ORDER's `createdAt`, `>= from AND < toExclusive` from `resolveRange` (UTC+4 UAE day boundaries), the same basis as revenue (`revenueAndCount`), total orders, stages, channels and outlet counts in the same method. NOT `respondedAt`. A review of an order placed in the period counts even if answered later; an answer given in the period for an older order does not.
- Outlet basis (decision): `o.outletId = ?` through the joined order, where `outletId = resolveOutletFilter(ctx, requested)` (branch pinned, admin optional), the same `outletConditionSql` shape as the other figures, and the same `assertPermission('dashboard.view')` gate that already runs first in `getSummary`.
- Tenant scope: `s.shopId = ? AND o.shopId = ?` plus the join `o.id = s.orderId AND o.shopId = s.shopId`; all bound to `ctx.shopId`.
- Rounding: `backend/src/dashboard/experience-rating.ts` `averageRatingOneDecimal(sum, count)`, integer arithmetic only, `floor((20*sum + count) / (2*count)) / 10`, round half up (4.25 -> 4.3), NULL when count is 0 (never 0.0). Cancelled orders are not excluded (same as total orders; the Reviews list does not exclude them either).
- Timezone gap (hardcoded UTC+4) left as is, per the brief.
- Admin: card shows `4.3` with `12 reviews` (`1 review` singular); `No reviews yet` only when the period has none. `DashboardSummary.experienceRating` is required in `admin/lib/types.ts`.

## (b) Market newsletter copy

`backend/src/themes/templates.ts`: Market's "Get 10% off your first order / Delivery updates and seasonal offers." is now "Stay in the loop / Sign up for news and updates from the shop." Templates are only read by `themes.service.ts:275` (`POST /themes { fromTemplate }`, cloned into a NEW unpublished row); no migration or script rewrites stored configs, so saved themes keep whatever text they already have.
`templates.spec.ts` gained "ships no offer, guarantee, delivery-speed or urgency promise" over every string in every template (offers, % off, free-*, guarantee, same/next-day, within N, nationwide, early access, urgency, best sellers). Injection-proved: the pre-change templates fail it on "Same-day delivery before 6pm", "Free gift wrap on every order" and "Nationwide delivery", and the Market newsletter string alone fails on "Get 10% off your first order".

## (c) Whole-repo sweep (found / decision)

Method: case-insensitive greps over backend/src, backend/scripts, storefront app/components/lib/public, admin app/components/lib, e2e, tools for: guarantee/money back, same/next-day and "within N min", free-*, % off/first order/coupon, customers/counters/"thousands"/"trusted by"/"as seen"/award, ratings/stars/reviews counts, recently purchased/viewing now/selling fast/only N left/limited/hurry, countdown/setInterval/Date.now timers, authentic/premium/nationwide/worldwide, "since/established", JSX text literals in the storefront, email subjects/bodies, seeds, defaults in `themes/constants.ts` and `useThemeEditor.ts`. Evidence of a clean result: no countdown, no "recently purchased"/"X people viewing", no counters, no "as seen in", no awards, no hardcoded testimonial, no `aggregateRating` anywhere outside this list.

| # | file:line (before) | rendered to customers? | decision |
|---|---|---|---|
| 1 | `backend/src/themes/templates.ts` Market newsletter "Get 10% off your first order" | yes (once a merchant creates and publishes a Market theme) | REMOVED, generic subscribe copy |
| 2 | templates.ts Market announcement "Same-day delivery before 6pm" | yes (same) | REMOVED (announcement section hidden, as Atelier and Heritage already do) |
| 3 | templates.ts Market hero "Fresh flowers, delivered today" and CTA "Shop best sellers" | yes (same) | REMOVED, "Fresh flowers for every occasion" / "Shop now" |
| 4 | templates.ts Market trust bar "Same-day delivery", "Freshness guarantee" | yes (same) | REMOVED; now "Secure checkout" and "Order tracking" (both real: HTTPS checkout, `/orders/track`) |
| 5 | templates.ts Bloom announcement "Free gift wrap on every order" | yes (same) | REMOVED (section hidden) |
| 6 | templates.ts Bloom trust bar "Next-day delivery", "Personalised gift notes", "Happiness guarantee" | yes (same) | REMOVED; same two real items as Market |
| 7 | templates.ts Bloom newsletter "Join the club / Early access to new gifts and seasonal drops." | yes (same) | REMOVED ("early access" is a perk nothing implements); "Stay in touch / News about new gifts and seasonal arrivals." |
| 8 | templates.ts Heritage trust bar "Nationwide delivery" and image_text "across the country" | yes (same) | REMOVED (coverage is set by delivery zones, not by copy) |
| 9 | templates.ts Heritage newsletter "...news and offers." | yes (same) | REMOVED the word "offers" |
| 10 | templates.ts Atelier image_text "...made to order in our studio the morning of delivery." | yes (same) | REMOVED the time-bound claim |
| 11 | `admin/lib/useThemeEditor.ts` default new trust_bar items "Same-day delivery" and "100% fresh guarantee" (every merchant who adds a Trust bar section gets these, live on their storefront) | yes | REMOVED; defaults are now "Secure checkout" and "Order tracking" |
| 12 | `storefront/components/TrustStrip.tsx` (mounted on the legacy homepage, i.e. every shop without a published Sections theme): "Fast delivery / Delivered fresh to your door", "Secure checkout / Your payment is protected", "Thoughtfully packaged / Ready to gift, every time" | yes, to every legacy-homepage visitor | REMOVED (component deleted, mount removed). "Your payment is protected" is also false for a cash-on-delivery shop. Visible change for legacy-homepage shops: the band between hero and collections is gone |
| 13 | `storefront/components/home-layouts/ClassicHero.tsx` fallback "Thoughtfully curated, delivered to your door." when the shop has no description | yes (legacy hero, themed branch) | REMOVED; the paragraph now renders only when `shop.description` is set |
| 14 | `storefront/lib/delivery-time.ts` + PDP "Delivered in 30-60 minutes" | yes | LEFT, verified real: it renders `shop.estimatedDeliveryTime*` or the per-product override, editable at admin Settings > Fulfilment > Delivery. CAVEAT (inferred from the migration, not changed): the shop columns are `NOT NULL DEFAULT 30/60/'minutes'` (migration 20260723180000), so a merchant who never opened that form still shows 30-60 minutes. Fixing needs a nullable column (a migration) and an owner decision, so it is a follow-up |
| 15 | `storefront/lib/stock-label.ts` "Only N left" (N <= 5), "In stock", "Out of stock" | yes | LEFT, tied to the real `outletingredientstock` quantity (`public.service.ts` `shadowStockByProduct`). Not verified: the public `stockQuantity` is not gated by `trackInventory`, so an untracked product that happens to own a stock row would also show it |
| 16 | `TrustBarSection` `rating_badge` block (merchant-typed rating number and label) | yes, only if a merchant adds one | LEFT: merchant-authored content, nothing in any template or default creates one (U4 already removed the template ones). Owner decision whether to wire it to the real survey average or retire the block |
| 17 | Admin theme builder placeholders ("Same-day delivery", "1,200+ reviews", SEO and hero-text examples) | no (merchant-only greyed example text) | LEFT |
| 18 | PDP "Secure checkout", "Delivery available at checkout", "Pickup available at checkout" | yes | LEFT: derived from the shop's real outlet delivery and pickup flags; "Secure checkout" is the platform's own checkout (HTTPS, hosted gateways) |
| 19 | Collection page "Best Selling" sort | yes | LEFT, real (`salesCount`) |
| 20 | Gift-card line "Delivered by email, no shipping required" | yes | LEFT, true by feature |
| 21 | Transactional emails (abandoned cart, survey, back in stock, gift card) | yes | LEFT, no offer, urgency or statistic; hardcoded "(c) 2026 Requital" footer year is stale-able but not a claim |
| 22 | `FREE_SHIPPING` discount type | yes (only when the merchant creates such a discount) | LEFT, real feature (`discount.type`) |
| 23 | Seeds (`backend/scripts/seed.ts`, `e2e/seed.ts`), `DEFAULT_THEME_CONFIG` | n/a | clean, nothing to change |
| 24 | Existing tests that use "Same-day delivery" as arbitrary fixture text (TrustBarSection.test, validation spec, seo.test, theme e2e) | no | LEFT, they assert rendering of arbitrary merchant text |

Not changed (needs a decision): the PDP delivery-time default (14), the `rating_badge` block (16).

## Verification

- Backend (rebased on c30da2c1): `tsc -p tsconfig.json` clean, build ok, unit 96 suites / 1440 tests, e2e 1527 passed twice in a row (run 1 had one failure, `bio-links` expecting `localhost:3002`, caused only by my `.env` STOREFRONT_URL=3301; fixed the env, not the code).
- Admin: tsc clean, vitest 115 files / 759 tests, build ok, lint delta +0 (87). Storefront: tsc clean, vitest 101 files / 811 tests, build ok, lint delta +0 (33).
- Guardrails: every tools/check-*.js exit 0, check-nested-pool --self-test, logical-properties --check.
- Injection proofs (a): dropping the shop scope fails 5 of 6 e2e (wrong averages/counts), dropping the period filter fails all 6 (counts include out-of-period rows), dropping the outlet filter fails 2 (admin outlet and branch pin). Admin: restoring the hardcoded card fails the 3 new page tests ("4.3" missing, "0.0" present). (b): pre-change templates fail the new spec on 3 strings; the Market newsletter string alone fails 1.
- Shots in `docs/handoff/n1-shots/` (WebP, 390x844 and 1440x900): `before-*` from origin/main's admin build, `after-*` from this branch; `*-with-reviews` = 4 answered surveys (5,4,4,4 -> 4.3, "4 reviews"), `*-no-reviews`. The before card reads "0.0 / No reviews yet" in both states.

VERIFIED: everything above was run. INFERRED: the PDP 30-60 minute default (14) and the untracked-product stock label (15) are read from code/migrations, not exercised on a live shop.
