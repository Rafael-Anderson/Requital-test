# WA: CAT-1 metafields mechanism

Branch `feat/metafields` off origin/main b56766d1. "Verified" = read in code or a test ran; "inferred" = argued only.

## 1. Premise checks
- No metafield code existed (grep over backend/admin/storefront: none). Verified.
- Brief's `key` column: `KEY` is a MySQL reserved word, so the column is `fieldKey` (API still says `key`). `namespace`, `value`, `type` are non-reserved and used unquoted (migration applied fine on MySQL 8.0.46). Migration `20261008100000_metafields`.
- Audit (CAT-1 section) sketches the theme binding as `product.metafields.custom.stem_count` (nested). The brief says keyed `namespace.key`; built the brief's flat shape: `metafields: { "custom.stem_count": value }`. Changing to nested later is a breaking public-DTO change, so Phase 6 should decide before any binding ships.
- PRE-EXISTING BUG (not mine, not fixed): `DELETE /products/:id` on a product that has variants fails with MySQL 1452 ("Cannot add or update a child row ... productvariant") on a clean schema; reproduced with a raw `DELETE FROM product WHERE id=?` in the mysql CLI, no app code involved. Products without variants delete fine. The e2e therefore tests product-delete cleanup on a variant-less product and variant cleanup through the options-wipe and stale-variant paths. Worth a separate ticket.
- Product reads are open to every role, writes admin-only (products.controller.ts); collections same; customers admin+viewer read / admin write; orders per orders.controller.ts role lists; outlets reads open (branch pinned to own), writes admin. The value ACCESS table in `metafields.service.ts` mirrors these exactly; no new permission vocabulary.

## 2. Design decisions
- API: `GET/POST/PATCH/DELETE /metafield-definitions` (reads any role, writes admin), `GET/PUT /metafields/:ownerType/:ownerId` (authz per owner type in the service).
- Owner check first: owner looked up with shopId predicate (404 if absent/foreign), then role table (403), then branch pinning via `resolveOutletFilter` for order/outlet owners plus `assertPermission` (orders.view/orders.manage/outlets.view_own).
- Definition ids validated `WHERE shopId = ? AND id IN`; foreign id => 404; ownerType mismatch => 400. All values validated before any write; writes in one transaction. `null`/omitted value deletes the row.
- type, ownerType, namespace, key are immutable (PATCH rejects them, forbidNonWhitelisted).
- Deletion policy: DELETE definition with stored values is a 409 stating the count; `?deleteValues=true` removes values and definition in one transaction. PATCH of `validation` re-validates every stored value; any failure (removed option, tightened range) is a 409 and nothing changes.
- customer/order definitions can never be `visibleOnStorefront` (400).
- 100 definitions per (shop, ownerType); text 1000, multiline 10000, json 10000 chars cap.
- Orphans: `ownerId` is polymorphic (no FK). Values are deleted with the owner: product (+ its variants) in the delete transaction, stale/wiped variants in the options paths, collection, outlet, and customer anonymisation. Orders are never deleted. Order values are NOT scrubbed on customer anonymisation (orders are retained merchant records, same as the rest of the order; documented decision). Customer values are exported in the PDPL export (`customFields`) and deleted on anonymisation.
- Public: only product values, only `visibleOnStorefront = 1`, one query per list (`loadVisibleProductMetafields`, called from `loadPublicProductsWithRelations`); the field is always present as `{}` when empty. Variant/collection public exposure: not this pass. Hidden values are never selected, so SELECT * spreads cannot leak them.
- Audit log entries record definition ids only (customer values are personal data).

## 3. Admin
- Settings -> Business Settings -> **Custom fields**, route `/settings/business/custom-fields` (page `admin/app/settings/business/custom-fields/page.tsx`, entry added to `BusinessSettingsSubNav.tsx`). WB: move or link this.
- Value editing: `components/MetafieldsFields.tsx` + `lib/useMetafieldEditor.ts`; wired into `ProductFormStepOrganization` (shared by Simple and Advanced modes), `VariantEditModal`, `CollectionFormModal`. Only changed values are sent. Customer/order/outlet values are API-only. Verified by tsc + vitest (jsdom); NOT checked in a live browser.

## 4. Tests
- Backend unit 1112 pass (7 new in metafield-types.spec.ts; customer-account spec mocks extended). Full backend e2e 99 suites / 1202 tests pass (32 new in test/metafields.e2e-spec.ts). Admin vitest 617 pass (new: lib/metafields.test.ts, Organization-step cases).
- Injection proofs (revert, run, restore, run): dropping shopId from product/variant/collection/customer/order/outlet owner lookups each fails the matching cross-tenant test; foreign-definition shop filter (6 failures); ownerType mismatch; hidden-field filter; branch pinning; role matrix; PATCH revalidation; delete protection; anonymise cleanup; export omission; stale-variant, wipe and product cleanup; personal-owner visibility ban; validate-before-write; N+1 (per-product loader gives 5 queries, expected 1). All failed for the claimed reason and passed after restore.
- Migration replayed from empty on rq_wa_scratch: 117 migrations applied.
- Lint delta +0 on backend/admin/storefront; all tools/check-*.js pass (check-form-width still 26 pre-existing findings).

## 5. Edits wanted in CLAUDE.md (coordinator)
Add a "Metafields (CAT-1)" section covering: tables and the fieldKey rename; API surface; owner-check-then-role-table authz; deletion/revalidation policy; cleanup helpers in `metafields/metafield-cleanup.ts` and the polymorphic-no-FK reason; public `metafields["ns.key"]`; customer values in PDPL export/anonymise, order values retained; admin route `/settings/business/custom-fields`; the pre-existing product-with-variants delete failure.
