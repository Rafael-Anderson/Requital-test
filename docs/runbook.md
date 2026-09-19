# Requital Operations Runbook

Phase 4 (ops foundations). Covers backup/restore and the per-migration rollback reference for `backend/`'s MySQL database. Nothing here requires (or should ever be given) real production credentials in this file — every command is parameterized by env vars.

## Backup

### What runs, and when

`/etc/cron.d/requital-backup` on the production VPS runs `tools/backup-cron.sh` **daily at 23:00 UTC = 03:00 Asia/Dubai** as the `deploy` user, appending one line per run to `/home/deploy/backups/backup.log`. The live cron file is mirrored in the repo at **`deploy/requital-backup.cron`** (same convention as `deploy/Caddyfile`); install or update it with:

```bash
scp deploy/requital-backup.cron root@<VPS_HOST>:/etc/cron.d/requital-backup
ssh root@<VPS_HOST> 'chown root:root /etc/cron.d/requital-backup && chmod 644 /etc/cron.d/requital-backup'
```

The live filename must have **no extension** — cron ignores anything in `/etc/cron.d` whose name contains a dot. Plain cron, not a systemd timer: `cron` is already active on this box, nothing else here is a systemd unit (the app itself runs under PM2), and a `/etc/cron.d` file is the one shape that is both greppable on the box and diffable in the repo.

03:00 Gulf time is the merchants' overnight trough, not ours — the VPS clock is UTC, so the crontab hour is 23.

### What each run does

1. `tools/backup-db.sh` dumps the database (`mysqldump`, see below) into `/home/deploy/backups`.
2. `gzip -t` on the result — a truncated dump is caught here rather than at restore time.
3. `rclone copy` of every `*.sql.gz` in that directory to `<bucket>/daily/`. Copying the whole directory rather than only tonight's file means a run whose upload failed is caught up by the next one, at no cost (rclone skips what is already there).
4. On Sundays only, tonight's dump is **also** copied to `<bucket>/weekly/`.
5. `rclone delete --min-age 14d <bucket>/daily` and `--min-age 56d <bucket>/weekly`.
6. Only then, local dumps older than 7 days are deleted. **A dump is never deleted from the only place it exists** — if the off-host copy failed, the run exits non-zero and prunes nothing.

Every failure path logs `FAILED: <reason>` and exits non-zero. If `BACKUP_S3_BUCKET` is not configured the run logs `WARNING:` three times, keeps the local dump, prunes nothing, and exits 0.

### Credentials

The DB password is **not** duplicated anywhere: `backup-cron.sh` reads `DATABASE_URL` out of the app's own `backend/.env`, so a rotation is a one-file change.

Off-host credentials live in **`/home/deploy/.requital-backup.env`** (owned by `deploy`, mode 600, not in the repo), in the same env-var shape as the app's storage provider (`backend/src/storage/storage-provider.factory.ts`) but under deliberately separate `BACKUP_S3_*` names, because this is a **separate bucket with its own key** — the app must not be able to delete the backups, and a leak on either side must not reach the other:

```bash
BACKUP_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
BACKUP_S3_BUCKET=requital-db-backups
BACKUP_S3_REGION=auto            # optional, defaults to auto
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
BACKUP_S3_PROVIDER=Other         # optional; rclone's S3 provider hint
```

`rclone` (apt, already installed on the VPS) does the transfer, configured entirely from the environment — there is no `rclone.conf`, and no credential ever appears in `ps`. The key needs Put/List/Delete on that one bucket and nothing else; it does **not** need CreateBucket (`NO_CHECK_BUCKET` is set).

`BACKUP_S3_TYPE` exists only to point the same code path at a local directory (`BACKUP_S3_TYPE=local`, bucket = a path) for a dry run without touching real object storage. Leave it unset in production.

### The dump itself

`tools/backup-db.sh` is unchanged in shape: it parses `DATABASE_URL`, writes `requital-<dbname>-<YYYYMMDDHHMMSS>.sql.gz`, passes the password via `MYSQL_PWD` (never a `--password=` flag, so it stays out of `ps`/shell history), and uses `--single-transaction` (consistent snapshot, no table locks — every table is InnoDB) plus `--routines --triggers` (none exist today; this keeps the dump complete if any are added).

- **`--no-tablespaces` was added 2026-09-19.** The app's DB user (`shop_app`) has no `PROCESS` privilege, so without it every otherwise-successful run printed `mysqldump: Error: 'Access denied; you need (at least one of) the PROCESS privilege(s)' ... when trying to dump tablespaces` to stderr while still exiting 0 with a complete dump. Verified byte-identical output with and without the flag against production. It matters now that this runs unattended: a job that prints `Error:` every night is a job nobody can read a real failure out of.
- Verified against production 2026-09-19: 76 `CREATE TABLE` statements, including `_migrations` (the tracking table `scripts/migrate.ts` uses). There is no `_prisma_migrations` table any more.
- Run it by hand any time: `DATABASE_URL="mysql://user:pass@host:port/dbname" tools/backup-db.sh [output-dir]` (output-dir defaults to `./backups`).

## Restore

### Drill (restore into a scratch database)

`tools/restore-db.sh` restores a dump into a **scratch** database and then prints row counts, so the drill verifies itself. Run it after any change to the backup path, and periodically regardless — a backup nobody has restored is a hypothesis, not a backup.

```bash
ssh -i ~/.ssh/hostinger_vps root@<VPS_HOST> 'sudo -u deploy bash -lc "
  DBURL=\$(grep -m1 ^DATABASE_URL= /home/deploy/requital/backend/.env | cut -d= -f2-)
  DUMP=\$(ls -t /home/deploy/backups/*.sql.gz | head -1)
  DATABASE_URL=\$DBURL RESTORE_DATABASE_URL=\${DBURL%/*}/shop_manager_drill \
    /home/deploy/requital/tools/restore-db.sh \$DUMP
"'
```

- The target database is created if absent. `shop_app` was granted rights on **`shop_manager_drill`** specifically (2026-09-19, `GRANT ALL PRIVILEGES ON \`shop_manager_drill\`.* TO \`shop_app\`@\`localhost\``) so the drill needs no root MySQL access; it holds no rights on any other database, so a typo'd target name fails instead of creating something.
- The script **refuses** to run when the target database name matches the one the app is configured to use, unless `ALLOW_PRODUCTION_RESTORE=yes` is also set. That is the one deliberate difference between a drill and the real thing.
- Compare its output against production before calling the drill passed:
  ```bash
  MYSQL_PWD=... mysql --table -u shop_app -h 127.0.0.1 shop_manager -e "
    SELECT (SELECT COUNT(*) FROM \`_migrations\`) migrations, (SELECT COUNT(*) FROM \`shop\`) shops,
           (SELECT COUNT(*) FROM \`order\`) orders, (SELECT COUNT(*) FROM \`product\`) products;"
  ```
- Drop the scratch database when finished (the script prints the command).

**Last drill: 2026-09-19.** A 136 KB dump restored in **3 seconds**; `tables/migrations/shops/outlets/orders/customers/products` came back `76/97/11/11/13/3/32`, identical to production, newest migration `20260917120000_product_estimated_delivery_time_override`, and the first four `shop` rows matched by name/subdomain.

### The real thing (restoring over production)

```bash
# 1. Confirm what you are about to overwrite. This is destructive — every table
#    in the dump is dropped and recreated.
echo "$DATABASE_URL"

# 2. Stop the app first, so nothing writes into a half-restored schema.
sudo -u deploy pm2 stop requital-backend

# 3. Restore. Same script, same parsing, with the guard explicitly waived.
ALLOW_PRODUCTION_RESTORE=yes RESTORE_DATABASE_URL="$DATABASE_URL" \
  /home/deploy/requital/tools/restore-db.sh /home/deploy/backups/requital-<db>-<timestamp>.sql.gz

# 4. Reconcile the migration state. The dump contains `_migrations` as a real
#    table, so this is normally a no-op — but if the dump predates migrations
#    that have since landed, this applies them.
cd /home/deploy/requital/backend && sudo -u deploy npm run db:migrate

# 5. Start the app and check it.
sudo -u deploy pm2 start requital-backend && sudo -u deploy pm2 logs requital-backend --lines 50 --nostream
```

**There is no Prisma here.** Migrations are hand-authored SQL applied by `npm run db:migrate` (`backend/scripts/migrate.ts`), tracked in a plain `_migrations` table — `npx prisma migrate status` / `prisma migrate deploy` do not exist in this project and never should be run against it (this section used to say otherwise; corrected 2026-09-19).

**Never** restore into a database with `--shadow-database-url` involved anywhere in the same session — see CLAUDE.md's existing warning; that flag is unrelated to restore but has previously caused real data loss in this project when confused with a normal connection string.

### RPO / RTO — what this setup actually gives us

Measured, not estimated, from the 2026-09-19 drill on a 136 KB compressed dump:

- **RPO (worst-case data loss): up to 24 hours,** plus however long a failed run goes unnoticed. One scheduled snapshot a day and no binlog shipping means everything written since the last 03:00 Gulf-time dump is gone. A merchant placing orders at 22:00 loses a full day's orders in a total-loss scenario.
- **RTO (time to a serving database): a few minutes** — 3 seconds of `mysql` restore, plus fetching the dump from object storage (seconds at this size), plus the pm2 stop/start and a look at the logs. The restore itself is not the bottleneck at this data size and will not be for a long time; deciding to restore is.
- **Failure detection depends on one env var being set.** A failed run writes `FAILED:` to `/home/deploy/backups/backup.log`, exits non-zero, and posts to `ERROR_TRACKING_WEBHOOK_URL` if that is configured in `backend/.env` (see **Error alerting** below). Cron mail is not configured on this box, so with that var unset the log is the only signal. Check it after any VPS work:
  ```bash
  ssh -i ~/.ssh/hostinger_vps root@<VPS_HOST> 'tail -20 /home/deploy/backups/backup.log'
  ```
- Retention gives **14 daily + 8 weekly** restore points, so the oldest recoverable state is roughly two months back.

Not covered by this, deliberately: uploaded images and other files on the VPS disk (the app still uses local storage, not S3, for uploads), and point-in-time recovery between snapshots.

## Error alerting

Two independent things can fail quietly on this box: the API throwing 5xx, and the nightly backup job. Both now post to **one** webhook URL, set once.

### The env var

`ERROR_TRACKING_WEBHOOK_URL` in **`/home/deploy/requital/backend/.env`** on the VPS (the same file that holds `DATABASE_URL`). Optional: unset means the app logs unhandled exceptions to its own structured log and nothing else, which is the behaviour this had until 2026-09-19.

```bash
ssh -i ~/.ssh/hostinger_vps root@<VPS_HOST>
sudo -u deploy tee -a /home/deploy/requital/backend/.env <<'EOF'
ERROR_TRACKING_WEBHOOK_URL=https://hooks.slack.com/services/T000/B000/xxxxxxxx
EOF
sudo -u deploy pm2 restart requital-backend
```

The restart is required for the API half: `resolveErrorTrackingProvider()` reads the var once at bootstrap. The backup job reads the file on every run, so it needs no restart.

### Getting a URL, whichever chat app you already use

**Slack** — api.slack.com/apps → Create New App → From scratch → pick the workspace → Incoming Webhooks → toggle on → "Add New Webhook to Workspace" → choose the channel. Copy the `https://hooks.slack.com/services/...` URL. No paid plan, no marketplace review, works on a free workspace.

**Discord** — Server Settings → Integrations → Webhooks → New Webhook → pick the channel → Copy Webhook URL. You get `https://discord.com/api/webhooks/...`.

Use a channel someone actually watches. A webhook posting into a muted channel is the same as no webhook.

### What gets sent

`HttpErrorTrackingProvider` builds one payload per captured error:

```json
{
  "message": "Cannot read properties of undefined (reading id)",
  "stack": "TypeError: ...\n    at OrdersService.confirm (...)",
  "requestId": "a1b2c3d4",
  "shopId": 12,
  "route": "/orders/:id/status",
  "method": "PATCH",
  "capturedAt": "2026-09-19T12:00:00.000Z"
}
```

Message and stack both go through `redact()` first. There is deliberately **no request body** in the payload (see `error-tracking.interface.ts` — a body can carry a password or payment field, so the interface has nowhere to put one).

Slack and Discord both reject that object: Slack needs a `text` key and answers `invalid_payload`, Discord needs `content` and answers 400. So `webhook-payload.ts` detects those two destinations **from the URL hostname** and sends a rendered message instead:

```
🚨 Requital backend error
PATCH /orders/:id/status  |  shop 12  |  req a1b2c3d4
Cannot read properties of undefined (reading id)
```
```
    at OrdersService.confirm (/app/dist/orders/orders.service.js:214:33)
    ...
```

Any **other** host still receives the raw JSON object, unchanged — that is what Sentry's generic ingestion, PagerDuty's Events API or a custom collector want, and nothing about pointing this at one of those has changed. A Slack webhook proxied through your own domain is the case hostname detection cannot see; it would fall back to the JSON shape, which is the safe direction to be wrong in.

### What triggers a send

Only a genuinely unhandled exception or a 5xx (`AllExceptionsFilter`). A routine 400/401/404 is expected traffic and is not an incident, so it is never forwarded. Delivery is fire-and-forget: a failed POST to the webhook logs a warning and never affects the request that triggered it.

The nightly backup (`tools/backup-cron.sh`) reads the same var out of `backend/.env` and posts a one-line failure message through the same Slack/Discord/generic branch. It fires only on a `FAILED:` path, never on a successful run, and `curl` is capped at 10 seconds so a hung webhook cannot hang the cron job. A missing off-host bucket is a `WARNING`, not a failure, so it does **not** alert — that state is visible in `backup.log` and is expected until the bucket exists.

### Checking it works

There is no "send test alert" command. The honest test is to point it at your own channel and confirm the next real 5xx shows up; failing that, a manual POST proves the URL itself:

```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{"text":"Requital webhook test","content":"Requital webhook test"}' \
  "$ERROR_TRACKING_WEBHOOK_URL"
```

(That test payload carries both keys on purpose so the one command works against Slack or Discord. The app itself always sends exactly one.)

## Migration rollback reference

This project's migrations are hand-authored `migration.sql` files applied by `npm run db:migrate` (`backend/scripts/migrate.ts`, see CLAUDE.md) — nothing generates a down migration for any of them, and the runner has no "rollback" command. The table below is the manual down-path for every migration currently in the repo, so a rollback is a deliberate, reviewed action rather than a guess made under pressure.

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

## Triage: custom domain connected but no cert

Symptom: a merchant connected a custom domain (Settings > Business Settings >
Domain shows it as **Verified**), but visiting `https://<domain>` fails the TLS
handshake (`SSL_ERROR_*`, `ERR_SSL_PROTOCOL_ERROR`, or a browser "can't
establish a secure connection"). Plain `http://<domain>` may redirect fine.

Custom domains get their cert via Caddy **on-demand TLS**, gated by the `ask`
endpoint (`deploy/Caddyfile` global block → `GET /domains/verify`). A missing
cert means one of: the `ask` gate said no, DNS isn't actually pointed at the
box, or ACME failed and Caddy is in its short failure-backoff window.

Work through it in this order:

1. **Is the `ask` gate open?**
   `curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/domains/verify?domain=<domain>'`
   Must be `200`. If `404`, the backend does not consider the domain verified —
   check the shop row:
   `SELECT customDomain, customDomainStatus, customDomainVerifiedAt FROM shop WHERE customDomain = '<domain>';`
   `customDomainStatus` must be `verified`. If it's `pending`/`verifying`/`failed`,
   the merchant needs to finish (or retry) verification in the admin UI — this is
   not a cert problem, it's a verification-state problem.

2. **Does DNS actually reach the box?**
   `dig +short <domain>` — the A/AAAA (or the CNAME target's A) must resolve to
   the VPS IP (`187.52.114.246`). Caddy cannot obtain a cert for a name whose
   HTTP-01 challenge won't route back to it. A merchant who verified the TXT
   record but never pointed the apex/`www` record at us lands here.

3. **What does Caddy say?**
   `journalctl -u caddy --since '30 min ago' | grep -iE '<domain>|on_demand|obtain|acme'`
   Look for `obtaining certificate`, `certificate obtained successfully`, or an
   ACME error (rate limit, DNS, challenge failure).

4. **Force a fresh attempt.** Caddy caches a recent on-demand *failure* in
   memory for a short window (~1 min) and won't re-hit ACME on every handshake
   during it. After fixing the underlying cause (step 1 or 2):
   `systemctl reload caddy` (clears the in-memory on-demand caches), then
   `curl -kv https://<domain> 2>&1 | grep -E 'SSL connection|subject:|issuer:'`
   a couple of times — the first call triggers issuance, the second should show
   a real Let's Encrypt cert.

5. **Let's Encrypt rate limits.** If `journalctl` shows `too many certificates`
   or `rateLimited`, the domain (or its registered domain) hit an LE limit —
   nothing to do but wait it out (the failed-validation limit resets in an hour;
   the certs-per-domain limit is weekly). Do **not** keep reloading Caddy in a
   loop; that makes it worse.
