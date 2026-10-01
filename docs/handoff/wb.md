# WB: Settings IA restructure (audit §14.4), hand-off notes

Branch `feat/settings-ia`, off `origin/main` at b61fb5e3. Frontend only (admin/ + one docs line). No backend API change, no migration, no dependency change.

## 1. Premise check (§14 inventory vs. the code as of b61fb5e3)

Verified = read in code. Everything not listed here matched the audit.

| Audit claim | Finding |
|---|---|
| "22 shop-wide fields in the outlet tabs" (§14.2, P1) | **23.** `SHOP_WIDE_FIELD_LABELS` in the deleted `admin/lib/shop-wide-fields.ts` had 23 keys: `taxOnDelivery` was added after the audit (Phase 2a-tax T1). Real list below. |
| Basic Info carries 4 shop-wide fields | 5 (`allowSameDayOrders`, `allowNextDayOrders`, `taxRate`, `taxInclusive`, `taxOnDelivery`). Delivery 11 and Pickup 7 are correct. 5+11+7 = 23. |
| `OutletBasicInfoTab.tsx` Order Setting / `OutletDeliveryTab.tsx` Delivery Settings (l.175) + Operation Settings (l.196) / `OutletPickupTab.tsx` Pickup Settings (l.155) + Preparation Time Settings (l.176) | Confirmed (pre-change line numbers). |
| "Allow WhatsApp Notifications" is in Business Information | Already moved to Store Configuration's "Coming Soon" card (see the comment in `store-configuration/page.tsx`). Not touched. |
| Failed Jobs needs a merchant-facing endpoint | Exists: `GET /jobs/failed`, retry `POST /jobs/:id/retry`, dismiss `DELETE /jobs/:id`, all `@Roles('admin')` (`backend/src/jobs/jobs.controller.ts:20-25`). `GET /webhook-log` is `@Roles('admin')` too (`webhook-log.controller.ts:10-15`). Diagnostics uses only these. |
| Store Configuration "disappears as a name" (§14.6) | **Not done, deliberately.** After moving currency, tax label and the 3 display settings out, Store Configuration still holds business type, default language, default delivery fee, business hours, external delivery, cart disabling, post-purchase survey and the Coming Soon card. The brief gives those no new home (Checkout / Operations groups are not in scope), so the page and its route stay, with a "Moved" card pointing at the two new homes. |
| `/settings` and `/settings/business` are two redirects | `/settings` is now a landing page. `/settings/business` still redirects to Business Information (kept for bookmarks). |
| Integrations tabs: Delivery, Payments, Messaging, Webhooks | Now also Analytics & Pixels (W2), and the Webhooks tab is labelled "Incoming Webhooks". Untouched, except that its table now comes from the shared `WebhookActivityPanel` (same output). |
| The three orphaned display settings | Verified: `productDisplayOrientation`, `productImageZoomEnabled`, `showCollectionMenu` ("Storefront Display" card of Store Configuration). Storefront consumers: `collections/[slug]/page.tsx`, `ProductDetailClient.tsx`, `ShopLayoutClient.tsx`. |
| AccountSetup deep-links into `/settings/business/domain` (`AccountSetup.tsx:103`) | Domain did not move, so the link is unchanged and still correct. Only the comment in `useAccountSetupForm.ts` and `docs/runbook.md:285` named the old "Business Settings" label; both fixed. |

### The 23 shop-wide fields and where each now lives (all still written with `PATCH /shop`)

| Field(s) | Old home | New home |
|---|---|---|
| `taxRate`, `taxInclusive`, `taxOnDelivery` | Outlet > Basic Info > Order Setting | Settings > Selling > Money & Tax |
| `allowSameDayOrders`, `allowNextDayOrders` | Outlet > Basic Info > Order Setting | Settings > Fulfilment > Delivery > Order Dates |
| `deliveryPaymentCardOnline`, `deliveryPaymentCashOnDelivery`, `deliveryPaymentCardOnDelivery`, `deliveryHours` | Outlet > Delivery > Delivery Settings | Fulfilment > Delivery |
| `deliveryTimeSlotGapMinutes`, `deliveryPreparationTimeMinutes`, `deliveryPreparationPlusDeliveryTimeMinutes`, `estimatedDeliveryTimeFrom/To/Unit`, `sameDayCutoffTime` | Outlet > Delivery > Operation Settings | Fulfilment > Delivery |
| `pickupPaymentCardOnline`, `pickupPaymentCashOnPickup`, `pickupPaymentCardOnPickup`, `pickupHours` | Outlet > Pickup > Pickup Settings | Fulfilment > Pickup |
| `pickupTimeSlotGapMinutes`, `pickupPreparationTimeMinutes`, `pickupPreparationPlusTimeMinutes` | Outlet > Pickup > Preparation Time Settings | Fulfilment > Pickup |

Also moved out of Store Configuration: `currency`, `taxDisplayText` (to Money & Tax) and `productDisplayOrientation`, `productImageZoomEnabled`, `showCollectionMenu` (to Storefront > Display).

## 2. Payload equivalence (the "moving the UI must not change what is sent" requirement)

Before deleting the old tabs I ran them in a scratch vitest, made a representative edit and captured the `updateShop()` payload. Those literals are now the expected values in `admin/components/ShopFulfilmentForms.test.tsx` (Delivery, Pickup, Order Dates) and `app/settings/selling/money-tax/page.test.tsx`.

* Delivery and Pickup: byte-identical payload (same keys, same value shapes, `sameDayCutoffTime: ""` still sent as `null`, hours still the merged 7-day object).
* **One intentional difference, called out for review:** the old Basic Info "Order Setting" saved `{allowSameDayOrders, allowNextDayOrders, taxRate, taxInclusive, taxOnDelivery}` in one request. Those now come from two pages, so each page sends its own subset (`{allowSameDayOrders, allowNextDayOrders}` from Delivery > Order Dates; `{currency, taxRate, taxInclusive, taxOnDelivery, taxDisplayText}` from Money & Tax). Values and shapes per field are unchanged (`taxRate` still `Number(x) || 0`, `taxDisplayText` still `""` when blank). `PATCH /shop` is a partial update, so nothing else is affected. Currency and the tax label were already sent together with the rest of Store Configuration; they are now sent with the tax fields instead.
* The "This changes every outlet" confirm dialog, `ShopWideChangeModal.tsx`, `lib/shop-wide-fields.ts` and its test are deleted. The outlet tabs no longer import `updateShop` at all.

## 3. Route map (old -> new)

| Old route | Now |
|---|---|
| `/settings` | Landing page (search + grouped cards). Was a redirect. |
| `/settings/business` | Still redirects to `/settings/business/information` |
| `/settings/business/information`, `domain`, `online-presence`, `seo`, `policy-pages`, `tax-classes`, `custom-fields` | Unchanged routes; now listed under the new groups in the sidebar/landing |
| `/settings/business/store-configuration` | Unchanged route, loses 5 fields, gains a "Moved" card linking to Money & Tax and Storefront > Display |
| `/settings/business/payments`, `/settings/business/delivery-providers` | Unchanged: existing `MovedToIntegrations` pointer cards |
| `/settings/jobs` | **Pointer card** (the same `MovedToIntegrations`, now taking optional `message`/`linkLabel` props; default copy unchanged) to `/settings/diagnostics` |
| `/jobs` (next.config redirect) | now redirects to `/settings/diagnostics` (was `/settings/jobs`) |
| Outlet edit > Basic Info "Order Setting" | Read-only "Order and Tax Settings" summary + links to Money & Tax and Fulfilment > Delivery |
| Outlet edit > Delivery "Delivery Settings"/"Operation Settings" | Read-only "Delivery Settings" summary + "Change for all outlets" -> `/settings/fulfilment/delivery` |
| Outlet edit > Pickup | Same -> `/settings/fulfilment/pickup` |
| NEW | `/settings/selling/money-tax`, `/settings/fulfilment/delivery`, `/settings/fulfilment/pickup`, `/settings/storefront/display`, `/settings/diagnostics` |

Navigation: `SettingsTabs` and `BusinessSettingsSubNav` and `business/layout.tsx` are replaced by one grouped sidebar (`SettingsNav`) driven by `lib/settings-registry.ts`, the same registry that feeds the landing page and its search. The sidebar is hidden on the landing page and on the outlet editor (which has its own sidebar). Integrations and Theme appear in the sidebar as links with an arrow; Integrations stays a top-level app.

## 4. Role gating

* Every new route is under `app/settings/`, so it inherits `app/settings/layout.tsx`, which is admin-only. The layout previously rendered children for any user it did not yet know to be a non-admin (loading, or user null). It now renders nothing unless `user.role === 'admin'`, so a new page can never mount and fetch for the wrong role.
* The sidebar's Integrations/Theme links point at areas that are already admin-gated (`integrations/layout.tsx`; `/theme` home tile is `adminOnly`). Backend endpoints used (`/shop`, `/outlets`, `/jobs`, `/webhook-log`) are unchanged and independently `@Roles('admin')`.
* Tested for branch, viewer and order_manager against each new route plus the jobs pointer: nothing renders, no endpoint is called, redirect to `/`.

## 5. Not done / deliberately out of scope

* Notifications matrix, Plan & Billing, Checkout, Operations, Developer, Data & Privacy, Zones & Regions groups: no feature behind them yet; not stubbed.
* Selling > Payments and Fulfilment > Couriers are **links into Integrations**, not merged pages (Integrations stays top-level per §14.6). Payment-method checkboxes cross-link to Integrations > Payments (P2, one direction). The reverse link (Integrations > Payments -> Delivery/Pickup payment methods) is not added: Integrations is "untouched" this pass.
* Dead settings (§14.2 "DEAD") are left where they are and are not indexed by search.
* Theme builder is unchanged.
* The Integrations > Incoming Webhooks tab is kept (it is the in-context view). Diagnostics shows the same data, so the log is now reachable from two places, sharing one component.
* Command palette (Cmd+K) does not yet search individual settings.
* Screenshots could not show a below-the-fold area of the Delivery/Pickup forms beyond the full-page captures; all new/moved surfaces were captured (see PR).

## 6. Edits wanted in files I may not touch

### CLAUDE.md
1. "Admin frontend" > "Integrations app": no change needed.
2. Add a section "Settings information architecture (audit §14.4)": settings navigation is data in `admin/lib/settings-registry.ts` (sidebar, landing page, search); add a page there or it is unreachable. `app/settings/layout.tsx` is the admin-only gate and renders nothing until the user is a known admin. `settings-registry.test.ts` fails if a new `app/settings/**/page.tsx` is not registered or allow-listed.
3. Replace the Tax classes bullet "Admin: Settings > Business Settings > **Tax Classes** ... a 'Tax on delivery fee' toggle beside the existing Tax Rate / Tax Type controls (a shop-wide field, so it goes through the same `ShopWideChangeModal` confirm)" with: Tax Classes stays at `/settings/business/tax-classes` (listed under Selling); Tax Rate / Tax Type / Tax on delivery fee / Tax Display Text / Currency are on Settings > Selling > Money & Tax; the `ShopWideChangeModal` no longer exists.
4. "Tenant isolation" area / any mention of "22 shop-wide fields in the outlet tabs": they are now edited at Settings > Fulfilment > Delivery / Pickup and Selling > Money & Tax; the outlet tabs show read-only summaries (`ShopWideSummary`). `admin/lib/shop-wide-fields.ts` and `ShopWideChangeModal` are deleted.
5. Domains section: "Merchant UI ... Settings -> Business Settings -> Domain" and "`BusinessSettingsSubNav`" wording -> "Settings > Business > Domain" (route unchanged `/settings/business/domain`); `BusinessSettingsSubNav` no longer exists.
6. "Settings/config page layout convention", "Store Configuration 'Coming Soon' toggles", and the Admin lint baseline note: no change. Lint baseline for admin stayed at 86 (+0).
7. Integrations app paragraph: "Incoming Webhooks" is now also shown at Settings > Diagnostics (shared `WebhookActivityPanel`); Failed Jobs moved from a Settings tab to Diagnostics (`/settings/jobs` is a pointer card).
8. next.config note: `/jobs` now redirects to `/settings/diagnostics`.

### docs/plans/product-capability-audit.md
* §14.2 / §14.3 P1: the count is 23, not 22 (`taxOnDelivery`); list in section 1 above. Mark the P1 stopgap ("`fix/shop-wide-scope-warning`") as superseded: the dialog and `shop-wide-fields.ts` are deleted.
* §14.4: record what was built (Landing + search, Money & Tax, Fulfilment Delivery/Pickup, Storefront Display, Diagnostics); and that Store Configuration kept its name because it still holds the unmoved fields.
* §14.5 sequencing / §8 Phase 2c: mark the Settings IA item done except the groups listed in section 5.
* §14.6: the "Store Configuration disappears as a name" row did not happen; the pointer is an in-page "Moved" card instead of a pointer-only route.

### docs/plans/custom-domain-resolver.md (historical record, left as is)
Lines 79/347-348 name `BusinessSettingsSubNav`; it is replaced by `SettingsNav`. Left alone since it is a dated plan; update if you want it current.

## 7. Verification log (what was run)

* `tsc --noEmit` clean; `vitest run` (admin, full) 96 files / 675 tests pass before the last small edits; re-run noted in the PR; `npm run build` (admin) OK, all new routes in the route table.
* `node tools/check-lint-baseline.js admin`: baseline 86, current 86, delta +0. `check-form-width.js`: exits 1 on main with the same findings list; diff of before/after output is empty (no new findings). All other `tools/check-*.js` exit 0.
* Injection proofs (revert, fail, restore, pass):
  1. Layout gate reverted to `user && user.role !== "admin"` -> `renders nothing while the session is still loading` FAILS (1 failed / 29 passed); restored -> 30/30.
  2. Delivery payload `sameDayCutoffTime: sameDayCutoff` (dropping `|| null`) -> `sends a blank cutoff as null` FAILS; restored -> 5/5.
  3. Added an unregistered `app/settings/zzz/page.tsx` -> `every page under app/settings is registered...` FAILS; removed -> 12/12.
* Screenshots: `docs/handoff/wb-screens/*.png`, taken from my own dev servers (backend 3900, admin 3901) against a seeded shop with tax 5% exclusive, a same-day cutoff, 3 webhook-log rows and one dead-letter job. The backend's global throttle returned 429s when I clicked through too fast, which made two early captures show "Loading..." / missing summaries; I re-took them with pauses. Not a product issue, but worth knowing: the Settings pages each call `GET /shop` on mount.
