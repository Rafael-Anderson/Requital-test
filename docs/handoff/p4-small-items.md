# p4-small-items: fix/external-delivery-coming-soon

VERIFIED: `shop.externalDeliveryEnabled` has no reader. Grep over backend/admin/storefront/e2e: only the migration column, `db/types.ts`, `update-shop.dto.ts`, the write in `shop.service.ts:222` (update), admin type + this page. Public shop payload is an explicit field list (`public.service.ts:311`), storefront never references it.
Change: admin Store Configuration page, checkbox moved from its own "Delivery & Fulfillment" card (now empty, removed) into the "Coming Soon" card. Payload/endpoint unchanged (still saved). Test added in `page.test.tsx`; injection-proof: reverting page.tsx fails it ("Unable to find a label ... External delivery enabled" inside Coming Soon).
For the coordinator: CLAUDE.md's Feature flags section still says externalDeliveryEnabled "should move under Coming Soon"; update once merged.
Checks: admin tsc clean, vitest 97 files / 678 tests pass, build ok, lint baseline 86 -> 86 (+0), check-page-width clean.
