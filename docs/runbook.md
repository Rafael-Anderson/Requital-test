# Requital Operations Runbook

Phase 4 (ops foundations). Covers backup/restore and the per-migration rollback reference for `backend/`'s MySQL database. Nothing here requires (or should ever be given) real production credentials in this file — every command is parameterized by env vars.

## Backup

`tools/backup-db.sh` is a runnable `mysqldump`-based backup script. It reads `DATABASE_URL` (the same connection string the app itself uses — see `common/env-validation.ts`), parses out host/port/user/password/db, and writes a gzip-compressed SQL dump.

```bash
DATABASE_URL="mysql://user:pass@host:port/dbname" tools/backup-db.sh [output-dir]
# output-dir defaults to ./backups
```

- Uses `--single-transaction` (a consistent snapshot without locking tables — every table in this schema is InnoDB) and `--routines --triggers` (there are none today, but this makes the dump complete if any are added later).
- The password is passed to `mysqldump` via the `MYSQL_PWD` environment variable, not a `--password=...` flag, so it never appears in `ps`/shell history.
- Output filename: `requital-<dbname>-<YYYYMMDDHHMMSS>.sql.gz`.
- Verified against the local dev database while writing this runbook: produces a valid gzip archive containing a full `mysqldump` (confirmed 65 `CREATE TABLE` statements — every table plus `_prisma_migrations`).

Run this on a schedule (cron, a CI scheduled workflow, or your hosting provider's own managed-backup feature if using one) and store the output somewhere durable and access-controlled (not committed to the repo, not left on the app server's own disk only) — this script only produces the artifact, it doesn't handle retention/off-host storage, which is an infra decision for wherever this actually deploys.

## Restore

Restoring is the inverse of the backup: decompress and pipe into `mysql`. There is no separate script for this — it's a single, uneventful command, parameterized the same way:

```bash
# 1. Confirm the target database is the one you actually intend to overwrite.
#    This is destructive — every existing row in every table is replaced.
echo "$DATABASE_URL"

# 2. Restore. Same DATABASE_URL shape as the backup script; MYSQL_PWD keeps
#    the password out of shell history the same way.
url="${DATABASE_URL#mysql://}"; credentials="${url%%@*}"; rest="${url#*@}"
DB_USER="${credentials%%:*}"; DB_PASSWORD="${credentials#*:}"
hostport="${rest%%/*}"; DB_NAME="${rest#*/}"
DB_HOST="${hostport%%:*}"; DB_PORT="${hostport#*:}"

MYSQL_PWD="$DB_PASSWORD" gunzip -c requital-<dbname>-<timestamp>.sql.gz \
  | mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" "$DB_NAME"

# 3. Reconcile Prisma's own migration bookkeeping with what the restored
#    dump actually contains — the dump includes _prisma_migrations as a
#    real table, so this is usually a no-op, but always confirm:
cd backend && npx prisma migrate status
```

If `prisma migrate status` reports pending migrations after a restore (the dump predates some migrations that have since been added), run `npx prisma migrate deploy` to bring the restored database up to the current schema — this is exactly the same command CI uses against a clean database, and works identically against a freshly-restored one.

**Never** restore into a database with `--shadow-database-url` involved anywhere in the same session — see CLAUDE.md's existing warning; that flag is unrelated to restore but has previously caused real data loss in this project when confused with a normal connection string.

## Migration rollback reference

This project's migrations are hand-authored `migration.sql` files applied via `prisma migrate deploy` (see CLAUDE.md) — there is no `prisma migrate dev`-generated down migration for any of them, and Prisma itself has no built-in "rollback" command. The table below is the manual down-path for every migration currently in the repo, so a rollback is a deliberate, reviewed action rather than a guess made under pressure.

**Reversibility key:**
- **Schema-only** — a plain `ADD COLUMN`/`CREATE TABLE` with nothing else; reverting is a plain `DROP COLUMN`/`DROP TABLE`. Data loss is limited to whatever was actually stored in the reverted column/table since it was added — there is no way to reconstruct it from the database alone (only from a backup taken before the revert).
- **Data-loss revert** — the migration itself did something that can't be losslessly reversed even in principle (dropped a column that had real data, ran a backfill computing values from other data that's since diverged, narrowed a column that may now hold longer values). Reverting is possible but is explicitly a lossy operation, not just "the usual" column-drop caveat above.
- **No-op / structural** — nothing to revert (e.g. the empty superseded migration from the Phase 2 fix).

| Migration | Reversible? | Down-path |
|---|---|---|
| `20260709131814_init` | Data-loss revert | `DROP TABLE` on all 8 original tables (`Shop`/`User`/`Product`/`ProductVariant`/`Order`/`OrderItem`/`PaymentTransaction`/`ThemeSettings` — or their lowercase equivalents post-rename). This is the foundation migration; reverting it means destroying the entire database. Restore from backup instead of ever actually running this down-path. |
| `20260709131815_rename_init_tables_to_lowercase` | Schema-only, host-dependent | Down-path is the inverse `RENAME TABLE shop TO Shop, user TO User, ...` for each of the 8 tables — but see CLAUDE.md's own note: this migration is a no-op on Windows (tables were already lowercase) and a real rename only on case-sensitive Linux hosts. The down-path must use the same `information_schema` + `BINARY` guard pattern as the forward migration, or it will fail identically on whichever host type the forward migration was a no-op on. |
| `20260711155854_reconcile_product_category_tags` | Data-loss revert | `DROP TABLE category, productcategory, tag, producttag`, then `ALTER TABLE product ADD COLUMN category ...` back — but the original flat `product.category` string column's data was migrated into the new `category`/`productcategory` join, not preserved verbatim; reverting recreates the column but not its original values. |
| `20260722175919_order_inventory_payments` | Data-loss revert | Drop the 14 added columns; `orderitem.productVariantId` was also dropped by this migration — re-adding it does not restore its prior values. |
| `20260722184029_payment_idempotency_and_order_index` | Schema-only | `DROP INDEX` on the 2 added indexes. No data touched. |
| `20260722204950_order_delivery_and_attribution_fields` | Schema-only | Drop the 4 added columns. |
| `20260722211634_category_slug_and_display_order` | Data-loss revert | Drop the 2 added columns and the index — but a backfill computed initial `slug`/`displayOrder` values; those computed values are lost, not just "empty columns" if later regenerated. |
| `20260722231744_category_image_and_featured` | Schema-only | Drop the 2 added columns. |
| `20260723124502_add_shop_settings_fields` | Schema-only | Drop the 14 added columns. |
| `20260723130425_add_store_configuration_fields` | Schema-only | Drop the 22 added columns. |
| `20260723131441_add_order_delivery_fee` | Schema-only | Drop the added column. |
| `20260723133737_add_shop_social_links` | Schema-only | Drop the added column. |
| `20260723140844_add_outlet_hours_delivery_coords` | No-op / structural | Emptied to a no-op during the Phase 2 CI-pipeline fix (see CLAUDE.md) — its real SQL lives in `20260723150001_outlet_hours_delivery_coords` instead. Nothing to revert here; revert the later migration if needed. |
| `20260723150000_merchant_auth_and_outlets` | Data-loss revert | `DROP TABLE outlet, outletstock`; re-add `product.stockQuantity`/`lowStockThreshold` — but this migration itself moved stock data FROM those product-level columns INTO the new per-outlet `outletstock` rows via a backfill. Reverting loses the per-outlet breakdown; the columns come back empty, not restored to their pre-migration values. Also reverts `order.outletId` from `NOT NULL` back to nullable. |
| `20260723150001_outlet_hours_delivery_coords` | Schema-only | Drop the 7 added columns (the real content of the superseded `20260723140844` above). |
| `20260723150500_user_email_globally_unique` | Schema-only, conditionally blocked | `DROP INDEX` on the unique constraint — but if any two users now legitimately share an email in different shops (impossible while the constraint holds, but check first if reverting long after the fact for some other reason), nothing blocks the drop itself; only re-adding the constraint later could then fail. |
| `20260723160000_outlet_override_expiry_and_delivery_zones` | Schema-only | Drop the 2 added columns. |
| `20260723170000_outlet_basic_info_and_active_flag` | Schema-only | Drop the 4 added columns. |
| `20260723180000_delivery_pickup_business_settings_and_zones` | Data-loss revert | `DROP TABLE deliveryzone`; re-add `outlet.deliveryZones` — the original JSON-blob column this migration replaced with a real table isn't repopulated by reverting. |
| `20260724120000_add_user_name` | Data-loss revert | Drop `user.name` — a backfill populated it (likely from email/a placeholder); the computed values aren't recoverable by re-adding the column. |
| `20260724130000_shop_order_settings` | Schema-only | Drop the 4 added columns. |
| `20260724170000_add_order_payment_method_and_tax` | Schema-only | Drop the 2 added columns. |
| `20260724180000_auth_hardening_and_payment_gateway` | Data-loss revert | `DROP TABLE refreshtoken, authtoken` — every logged-in session and any outstanding password-reset/verification token is destroyed; every user must log in again. |
| `20260724190000_order_tracking_token` | Schema-only | Drop the added column and its index — but any tracking links already emailed to customers stop working immediately. |
| `20260724200000_add_customers` | Data-loss revert | `DROP TABLE customer` — every guest/registered customer record, along with their order-history linkage, is destroyed. |
| `20260724210000_external_delivery` | Schema-only | `DROP TABLE externaldelivery`. |
| `20260724220000_theme_extended_fields` | Schema-only | Drop the 3 added columns. |
| `20260724230000_seo` | Data-loss revert | `DROP TABLE shopseosettings`; a backfill also set initial `product.slug` values — those are lost on revert of the `MODIFY COLUMN` back to its prior nullability/width if products were later renamed to rely on it. |
| `20260725100000_widen_text_columns_and_shop_updated_at` | Data-loss revert (narrowing) | Reverting `product.description`/`shortSummary`/`longSummary` back from `TEXT` to their original narrower type risks a truncation error (or silent truncation, depending on SQL mode) for any row whose content now exceeds the old limit — check `MAX(LENGTH(...))` against the old column's capacity before attempting this. |
| `20260725120000_theme_expanded_fields` | Schema-only | Drop the 4 added columns. |
| `20260725150000_theme_homepage_layout` | Schema-only | Drop the added column. |
| `20260725150500_theme_updated_at` | Schema-only | Drop the added column. |
| `20260725180000_shop_payment_provider` | Data-loss revert | `DROP TABLE shoppaymentprovider` — every shop's configured BNPL provider toggle/credentials-reference is destroyed. |
| `20260725190000_affiliate` | Data-loss revert | `DROP TABLE affiliate, affiliatecode, affiliateorder` — the entire affiliate program's history (codes, attributed orders, commission records) is destroyed. |
| `20260726100000_shop_published` | Data-loss revert | Drop `shop.published` — a backfill computed the initial value per the outlet+product readiness rule (see `shop-published.e2e-spec.ts`'s own regression test of that rule); the historical "was this shop actually live on this date" fact is lost on revert. |
| `20260726120000_bio_link` | Data-loss revert | `DROP TABLE biolink` — every merchant's bio-link page content is destroyed. |
| `20260726140000_bio_link_page_config` | Data-loss revert | `DROP TABLE biolinkpageconfig` — every merchant's bio-page branding/config is destroyed. |
| `20260726150000_product_variants` | Data-loss revert | `DROP TABLE productimage, productoption, productoptionvalue, outletvariantstock`; re-add `product.attributes`/`stockQty`/`priceOverride` — the original flat-attribute/single-stock model this migration replaced is not reconstructed by re-adding the columns empty. |
| `20260726160000_discounts_and_draft_orders` | Data-loss revert | `DROP TABLE discount, discountproduct, discountcategory, discountredemption, draftorder, draftorderitem` — every promo code, its redemption history, and every quote/draft order is destroyed. |
| `20260726170000_default_product_variants_enabled` | Data-loss revert | This migration only ran a backfill (no new column of its own — it set an existing flag's default going forward); there's no column to drop, and the backfilled values can't be un-set to their prior state since the "prior state" was simply unset. |
| `20260726180000_stock_movements` | Data-loss revert | `DROP TABLE stockmovement` — the entire stock-movement audit trail (every stock in/out/adjustment, ever) is destroyed. |
| `20260726190000_order_notes` | Data-loss revert | `DROP TABLE ordernote` — every staff-authored order note is destroyed. |
| `20260726200000_audit_log` | Data-loss revert | `DROP TABLE auditlog` — the entire staff-action audit trail is destroyed. |
| `20260726210000_whatsapp_credentials` | Schema-only | Drop the added column (encrypted credentials blob) — a shop's saved WhatsApp integration would need to be reconfigured from scratch, but no other data is affected. |
| `20260726220000_ingredients` | Data-loss revert | `DROP TABLE ingredient, outletingredientstock` — every raw-material/BOM-component definition and its per-outlet stock is destroyed. |
| `20260726230000_collections` | Data-loss revert | `DROP TABLE collection, collectionproduct` — every marketing collection (manual or rule-based) is destroyed. |
| `20260726231500_order_returns` | Data-loss revert | `DROP TABLE orderreturn, orderreturnitem` — every return/refund record is destroyed. |
| `20260726234500_scan_to_stock` | Data-loss revert | `DROP TABLE scanbatch, scansettings` — every CSV/scan-based stock-import batch history is destroyed. |
| `20260727100000_customer_accounts` | Data-loss revert | `DROP TABLE customerrefreshtoken, customerauthtoken` — every logged-in shopper session and any outstanding customer password-reset token is destroyed; every registered shopper must log in again. |
| `20260727120000_theme_customizer_v2` | Schema-only | Drop the 7 added columns. |
| `20260728090000_growth_features` | Data-loss revert | `DROP TABLE giftcard, giftcardredemption, abandonedcart` — every issued gift card (and its remaining balance!), its redemption history, and every abandoned-cart-recovery record is destroyed. Also reverts `lowStockThreshold` on 3 stock tables from nullable back to non-nullable — any row that now has `NULL` there (meaning "use the shop default") would need a value backfilled again before the `NOT NULL` constraint could be reapplied. |
| `20260729100000_bill_of_materials` | Data-loss revert | `DROP TABLE productingredient` — every product's bill-of-materials (which ingredients + quantities a product consumes) is destroyed. |
| `20260729140000_storefront_footer_announcement_banners` | Data-loss revert | `DROP TABLE policypage, bannerimage` — every merchant-authored policy page (terms/privacy/refund/payment/shipping) and every homepage banner image is destroyed. |
| `20260729180000_header_footer_layout_density` | Schema-only | Drop the 3 added columns. |
| `20260802120000_ingredient_details_and_categories` | Data-loss revert | `DROP TABLE ingredientcategory` — every ingredient category grouping is destroyed. |
| `20260802150000_branch_roles` | Data-loss revert | `DROP TABLE branchrole, useroutletrole` — every branch-specific permission override is destroyed; every affected staff member reverts to their plain shop-wide role, silently changing their effective access. |
| `20260802190000_product_attributes_faqs_cart_survey` | Data-loss revert | `DROP TABLE productattribute, productfaq, surveyresponse`; re-add `shop.disableGoogleMaps` (dropped by this migration, replaced by the Simple/Advanced product editor mode toggle) — the column comes back empty, not restored. Every product's informational attributes/FAQs and every post-purchase survey response are destroyed. |
| `20260803120000_checkout_addon_and_item_notes` | Schema-only | Drop the 2 added columns. |
| `20260803150000_account_setup_wizard_fields` | Schema-only | Drop the 5 added columns. |
| `20260803160000_product_editor_mode` | Data-loss revert | Drop `shop.productEditorMode`/3 others; re-add `shop.productVariantsEnabled`/`productAttributesEnabled`/`productFaqsEnabled` (dropped by this migration) — these come back at their column default, not each shop's actual prior per-shop toggle state. |
| `20260804090000_invoices` | Data-loss revert | `DROP TABLE invoice, invoicecounter` — every generated invoice/packing-slip document and the per-shop invoice-numbering sequence are destroyed; the numbering would restart from 1 if the table is later recreated, potentially colliding with invoice numbers already handed to customers. |
| `20260804110000_customer_data_export_rate_limit` | Schema-only | Drop the added column (`customer.lastDataExportAt`) — only affects the 24h rate limit on the UAE PDPL self-service export, no other data. |
| `20260804120000_notify_subscriptions` | Data-loss revert | `DROP TABLE notifysubscription` — every "notify me when back in stock" subscription is destroyed. |
| `20260805090000_auth_lockout` | Schema-only | Drop `user.failedLoginAttempts`/`lastFailedLoginAt` — only resets every staff account's lockout counter, no other data. |
| `20260805110000_customer_login_lockout` | Schema-only | Drop `customer.failedLoginAttempts`/`lastFailedLoginAt` (the down-path is already spelled out, commented, directly in the migration file itself) — only resets every shopper account's lockout counter, no other data. |

For any "Data-loss revert" row above, the actually-safe rollback procedure is: **restore from a backup taken before the migration was applied** (see Backup/Restore above), not attempt the down-path against a live database that already has real post-migration data in it. The down-paths listed are what you'd run to make the *schema* match a pre-migration state, not to un-lose the data that lived in the tables/columns being dropped.
