# U4: real reviews only (handoff note, coordinator deletes before merge)

Branch `feat/real-reviews`. Migration `20261023100000_survey_publish_consent`.

## What and why
The Bloom template shipped three invented testimonials (named people, 5 stars) that were copied into every shop created from it. Market and Heritage shipped invented ratings and counts, Heritage an invented history. A shopper saw those as fact. Now the Testimonials section renders ONLY reviews a customer agreed to publish and the merchant switched on.

## Fabricated content removed (`backend/src/themes/templates.ts`)
- Bloom: 3 quotes ("Arrived exactly on time...", "The gift box is gorgeous...", "So easy to personalise...") with authors and ratings; heading "What our customers say" now "Customer reviews"; trust item "Thousands of 5-star gifts" now "Personalised gift notes".
- Market: trust item "Rated 4.8 / 5" and rating badge 4.8 "2,000+ reviews" (count-up) removed.
- Heritage: rating badge 4.9 "Trusted by thousands", trust item "Established 1985", hero "Traditional florists since 1985", "A family business for four decades" replaced with neutral copy.
- Not changed, only reported: Market newsletter heading "Get 10% off your first order" is an offer no discount backs (not social proof, so out of scope). Dashboard "Experience Rating" is a hardcoded `0.0` / "No reviews yet" (`admin/app/dashboard/page.tsx:112-118`; its comment says no review model exists, which is stale now that surveys exist). Test fixtures (`rating_badge` 4.8 in admin/storefront/backend specs) are fixtures, left.
- Clean: DEFAULT_THEME_CONFIG (no testimonials section), `e2e/seed.ts`, `backend/scripts/seed.ts`, structured data (`storefront/lib/structured-data.test.ts:90` asserts no aggregateRating). Historical plan docs under docs/plans quote the old strings; left as history.
- `rating_badge` and `trust_item` remain available blocks: a merchant types their own real numbers. Templates just no longer ship any.

## What real feedback existed (evidence)
- Table `surveyresponse` (`backend/prisma/migrations/20260802190000_*/migration.sql:40-59`): id, shopId, orderId (unique), token (unique), rating INT NULL, comment TEXT NULL, respondedAt, createdAt. `SurveyresponseRow` at `backend/src/db/types.ts:139`.
- Created on delivered status by `OrderNotificationsService.notifySurveyRequest` (`order-notifications.service.ts:156-217`), gated by the `customer_survey` flag (`feature-keys.ts:46`, `shop.customerSurveyEnabled`).
- Public by-token endpoints `GET /public/surveys/lookup`, `POST /public/surveys/submit` (`public-survey.controller.ts`, `public.service.ts` lookupSurvey/submitSurvey). DTO: rating 1-5, comment max 2000.
- Storefront form `storefront/app/[shop]/survey/page.tsx`. Admin only surfaced it inside the order modal (`admin/components/OrderDetailModal.tsx:414-421`); there was no list of feedback.
- Premise corrections: the "legacy manual items" are `testimonial` blocks inside `sections[].blocks[]`, not `settings.items`. Block settings validation is shallow (`theme-config.validation.ts`), so old blocks already validate; a new spec pins it. The submit path had a check-then-update race on `respondedAt`; now `UPDATE ... WHERE respondedAt IS NULL` (single shot, so consent cannot be overwritten).

## Built
- Migration: `surveyresponse.publishConsent TINYINT NULL` (NULL unknown/legacy, 1 agreed, 0 declined), `featuredAt DATETIME(3) NULL`, index `(shopId, featuredAt)`. No backfill. `db/types.ts` updated by hand.
- Survey form: unchecked-by-default checkbox "You may show my feedback on the store's website."; new form always sends true/false so unticked stores 0; an older client omitting the field stores NULL.
- `backend/src/reviews/`: `ReviewsService` with ONE eligibility rule (`ELIGIBLE_SQL`: consent = 1, answered, rating present, non-empty trimmed comment) used by both the toggle's atomic conditional UPDATE and the public read. A row forced to `featuredAt` without consent is still not served. Admin-only `GET /reviews`, `PATCH /reviews/:id/featured` (404 cross-tenant, 409 ineligible, `review.featured`/`review.unfeatured` audit entries). Public `GET /public/:shopSlug/reviews/featured?limit=1..12&minRating=1..5` via `PublicService.resolveShop` + `assertPublished`; returns exactly `{name, rating, comment, date}` (first name + last initial, comment capped 600 code points, control chars stripped).
- PDPL: account anonymisation (`customer-account.service.ts`) now sets `publishConsent = 0, featuredAt = NULL` on that customer's survey rows, so their review stops being served.
- Storefront `TestimonialsSection`: fetches the endpoint; legacy `testimonial` blocks ignored, never deleted; nothing rendered with zero reviews (live), explanatory card in the editor preview; settings `maxItems` (3-12, default 6) and `minRating` (optional). Comment is a React text node, no `dangerouslySetInnerHTML`.
- Admin: Customers > Reviews tab (`/customers/reviews`, admin only; list with rating, comment, date, consent state, "Show on store" Toggle disabled with a visible explanation when not allowed). Theme editor `TestimonialsSettings` gets max/min controls and an explainer; manual testimonial blocks are no longer addable (catalog `["heading"]`); an existing one shows a "no longer shown" notice. The registry (`settings-registry.ts`) is settings-only and the page is not under /settings, so no registry entry was needed.

## Tests (all green)
- Backend unit 95 suites / 1432 tests; e2e 121 suites / 1521 tests, run twice on a fresh DB (migrated from empty, 125 migrations); `test/reviews.e2e-spec.ts` is 14 tests (consent recorded 1/0/NULL, single-shot submit, gate 409s for NULL/0/empty/blank/no comment, exact key set + no private data, XSS payload inert, read-time re-check with forced `featuredAt`, withdrawn consent, limit/minRating bounds, 404 unknown/unpublished/suspended, PDPL anonymisation, cross-tenant write and read, admin-only: anon 401, viewer and order_manager 403). No exact-count assertions on shared data.
- Storefront vitest 97 files / 791 tests; admin 108 files / 715 tests. tsc clean in all three; `npm run build` clean for backend, admin, storefront.
- Lint delta: backend 260 (+0), admin 88 (+0), storefront 33 (+0). All `tools/check-*.js` pass and `logical-properties-codemod.js --check` passes (22 documented exceptions, none new).
- Injection proofs (each reverted, failed for the stated reason, restored): drop consent from `ELIGIBLE_SQL` (fails gate + read-time tests); drop shopId from toggle lookup/UPDATE (fails cross-tenant write); drop shopId from the public read (4 failures); add `customerPhone` to output (fails exact-key test); drop `featuredAt IS NOT NULL` on read (fails unfeatured-never-served); storefront checkbox default true (2 failures); live empty branch rendering the card (2 failures); `dangerouslySetInnerHTML` on the comment (XSS test fails); rendering legacy blocks (fails ignore test); re-adding "Established 1985" to a template (fails the no-fabrication test).

## Screenshots (`docs/handoff/u4-shots/`, WebP, viewport only, 390x844 and 1440x900)
`before-survey-*`, `before-testimonials-*` (origin/main storefront against the same backend and a published Bloom theme carrying the three legacy blocks: shows them rendering), `after-survey-*`, `after-testimonials-*` (legacy blocks ignored, two real approved reviews), `after-admin-reviews-*`. No before for the admin Reviews page (it did not exist). Seed data in the shots is dev-only rows in `rq_u4`, not shipped.

## Unverified / limits
- Not run: Playwright e2e suite (coordinator does), an `/security-review`.
- A customer cannot withdraw consent after submitting except by deleting their account (no customer-facing edit path exists for a submitted survey). The admin can always switch a review off.
- The theme editor preview of an UNPUBLISHED shop shows the empty-state card even if approved reviews exist (the public endpoint 404s for unpublished shops by design).
- Shot sections: the dev "1 Issue" Next overlay appears on main too.
- Customer data export (PDPL) was not checked for survey rows.

## Deploy notes
Order: migrate, backend, storefront, admin (the new storefront survey form sends `publishConsent`; an old backend's whitelist pipe would 400 it). Production theme data is untouched: saved Bloom themes keep their old `testimonial` blocks, which are ignored at render and kept; those shops' section disappears until a review is approved. Migration is additive, so rollback is dropping the two columns and the index (see docs/runbook.md pattern).
