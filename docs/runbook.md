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

### The PC copy (off-host pull to a Windows machine)

The VPS cron's own off-host step is a no-op in production: with no `BACKUP_S3_BUCKET` in `/home/deploy/.requital-backup.env` every run logs `WARNING: ... exists on this VPS ONLY` and skips both the `rclone` copy and the local prune. A Windows PC therefore **pulls** the dumps down on its own schedule. Pull, not push: the VPS holds no credential for the PC and cannot reach it, so losing the VPS cannot take the second copy with it.

Where everything lives:

| Thing | Location |
|---|---|
| Dumps + `pull.log` + `last-success.txt` | `C:\RequitalBackups` on the PC |
| Scripts the scheduled tasks run | `C:\ProgramData\Requital\backup-pull` |
| Source of those scripts | `tools/pc-backup-pull/` in this repo |
| SSH private key (no passphrase) | `%USERPROFILE%\.ssh\requital_backup_pull` |
| SSH alias | `requital-backup-pull` in `%USERPROFILE%\.ssh\config` |
| Scheduled tasks | `Requital Backup Pull` (04:30 daily), `Requital Backup Freshness Check` (12:00 daily) |
| Server-side forced command | `/usr/local/bin/requital-backup-serve` (root:root, 0755) |
| Server-side grant | one line in `/home/deploy/.ssh/authorized_keys`, prefixed `restrict,command="/usr/local/bin/requital-backup-serve"` |

The key can do **only** `list`, `sum <file>` and `get <file>`, against filenames matching `^requital-shop_manager-[0-9]{14}\.sql\.gz$`. No shell, no forwarding, no other path. `tools/pc-backup-pull/README.md` has the design, the retention rules, and the accepted at-rest-encryption gap.

#### Restoring from the PC copy

The PC copy is a plain `mysqldump | gzip`, identical in format to what `tools/backup-db.sh` writes — so everything in **Drill** and **The real thing** above applies unchanged once the file is back on a box. Two routes:

```powershell
# On the PC: pick the dump, and verify it before trusting it.
$dump = Get-ChildItem C:\RequitalBackups\*.sql.gz | Sort-Object Name -Descending | Select-Object -First 1
(Get-FileHash $dump.FullName -Algorithm SHA256).Hash
ssh requital-backup-pull "sum $($dump.Name)"   # same hash, if the VPS still exists
```

**Route A — restore on the PC, to inspect it or to serve from it.** Decompress and feed it to a local MySQL, into a clearly named scratch database, never over a real one:

```powershell
$sql = "$env:TEMP\restore.sql"
$fs = [IO.File]::OpenRead($dump.FullName)
$gz = [IO.Compression.GZipStream]::new($fs, [IO.Compression.CompressionMode]::Decompress)
$out = [IO.File]::Create($sql); $gz.CopyTo($out); $out.Dispose(); $gz.Dispose(); $fs.Dispose()

mysql --user=<user> -e "CREATE DATABASE requital_restore_drill CHARACTER SET utf8mb4;"
cmd /c "mysql --user=<user> requital_restore_drill < `"$sql`""
Remove-Item $sql -Force     # the decompressed SQL is plaintext customer PII
```

The dump contains no `CREATE DATABASE` and no `USE`, so it lands in whatever database you point it at. Verify rather than assume: compare `COUNT(*)` for `shop`, `order`, `orderitem` and `invoice` against production, and ideally a `BIT_XOR` row witness too — a count can match while contents differ.

**Route B — ship it back to the VPS and restore there.** This is the real disaster path:

```bash
scp -i ~/.ssh/hostinger_vps /c/RequitalBackups/requital-shop_manager-<ts>.sql.gz root@<VPS_HOST>:/home/deploy/backups/
ssh -i ~/.ssh/hostinger_vps root@<VPS_HOST> 'chown deploy:deploy /home/deploy/backups/requital-shop_manager-<ts>.sql.gz'
```

Then follow **The real thing (restoring over production)** above, unchanged — same script, same `ALLOW_PRODUCTION_RESTORE=yes` guard, same `npm run db:migrate` reconciliation afterwards if the dump predates migrations that have since landed.

**Check the copy is actually current before relying on it.** `last-success.txt` is written only after a fully verified run:

```powershell
Get-Content C:\RequitalBackups\last-success.txt
Get-Content C:\RequitalBackups\pull.log -Tail 20
```

A stale copy is supposed to announce itself at 12:00 daily. Note that the pull task runs with logon type `Interactive`, because S4U registration is refused on this Windows Home install without elevation: **it does not run while nobody is logged on**, and catches up at the next logon instead.

#### Removing the PC backup pull

On the VPS — the grant is what actually revokes access, so do that first:

```bash
# 1. drop the authorized_keys line (identified by its comment, never by position)
ssh -i ~/.ssh/hostinger_vps root@<VPS_HOST> \
  "sudo -u deploy sed -i '/requital-backup-pull@/d' /home/deploy/.ssh/authorized_keys"
# 2. confirm only the original deploy key is left
ssh -i ~/.ssh/hostinger_vps root@<VPS_HOST> 'ssh-keygen -lf /home/deploy/.ssh/authorized_keys'
# 3. remove the forced-command script
ssh -i ~/.ssh/hostinger_vps root@<VPS_HOST> 'rm -f /usr/local/bin/requital-backup-serve'
```

On the PC:

```powershell
Unregister-ScheduledTask -TaskName 'Requital Backup Pull' -Confirm:$false
Unregister-ScheduledTask -TaskName 'Requital Backup Freshness Check' -Confirm:$false
Remove-Item "$env:USERPROFILE\.ssh\requital_backup_pull","$env:USERPROFILE\.ssh\requital_backup_pull.pub" -Force
# then delete the `Host requital-backup-pull` block from %USERPROFILE%\.ssh\config
Remove-Item 'C:\ProgramData\Requital\backup-pull' -Recurse -Force
# C:\RequitalBackups holds the only off-host copy of customer data. Deleting it is
# a deliberate decision, not cleanup:
#   Remove-Item 'C:\RequitalBackups' -Recurse -Force
```

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
| `20261001100000_region_table_and_seed` / `20261001110000_region_columns_and_backfill` / `20261002100000_order_emirate_nullable` | Schema-only (+ a re-runnable backfill) | Drop `deliveryzoneregion`, the `regionId` columns and `shop.countryCode`, then `region`. The backfill only filled NULL `regionId`s from the old `emirate` strings, which were kept until the contract migration below, so nothing is lost. |
| `20261003100000_drop_emirate_columns` | Reversible for every mapped row; lossy otherwise | Re-add `emirate VARCHAR(191) NULL` to `order`, `draftorder`, `outlet` and refill it: `UPDATE \`order\` o JOIN region r ON r.id = o.regionId SET o.emirate = r.nameEn` (same for the other two). That is lossless for every row that had a region, which the migration's own guard guarantees is every row that had a value: it REFUSES to run while any row holds an `emirate` with no `regionId`. Restoring a pre-migration backup is still the safer route. |
| `20261004100000_shop_feature_override` | Schema-only, additive | `DROP TABLE shopfeatureoverride`. Nothing references it; roll the backend code back first (it queries the table). Dropping it discards every platform override, and every shop then follows its own column again. |
| `20261005100000_shop_analytics` | Data-loss revert | `DROP TABLE shopanalytics` destroys every merchant's pixel ids and the encrypted Meta CAPI token (they must be re-entered). Roll the backend and storefront back first. |
| `20261005110000_order_attribution` | Data-loss revert | `ALTER TABLE \`order\` DROP COLUMN attributionJson` destroys the captured UTM/click-id/consent data (there is no way to reconstruct it). Roll the backend back first. |
| `20261006100000_credit_notes` | Data-loss revert | `DROP TABLE creditnote` destroys every issued credit note and its number; the `invoicecounter` row of type `CREDIT_NOTE` would restart at 1 if recreated, colliding with numbers already handed out. Restore from a backup instead. |
| `20261008100000_metafields` | Data-loss revert | `DROP TABLE metafieldvalue, metafielddefinition` destroys every custom field definition and value. Roll the backend, admin and storefront back first. |
| `20261009100000_payment_reconciliation_state` | Schema-only, additive | `DROP TABLE paymentreconciliation`. Roll the backend back first (the sweep queries it). Dropping it only forgets which orders were already checked; the next tick re-asks Stripe about up to 50 recent unpaid orders, which is idempotent (mark-paid dedupes on `paymenttransaction`). |
| `20261010100000_order_stock_consumption` | Data-loss revert | `DROP TABLE orderstockconsumption` and `ALTER TABLE \`order\` DROP COLUMN consumptionRecordedAt` destroy the record of what every recorded order took out of stock; orders then fall back to today's recipe-driven restock, which is exactly the F10 bug (a cancel or return restocks from the current recipe, not what was consumed). Roll the backend back first, and prefer restoring from a backup. |
| `20261020100000_suppliers` | Data-loss revert | `DROP TABLE supplieritem, suppliercontact, supplier` (children first). Destroys every supplier, contact and per-supplier catalogue row. Purchase orders reference `supplier` with `RESTRICT`, so if `20261020110000` is applied, revert that one first. Roll the backend and admin back first. The free-text `ingredient.supplier` and `product.vendor` columns were never touched. |
| `20261020110000_purchase_orders` | Data-loss revert | `DROP TABLE purchaseorderreceiptline, purchaseorderreceipt, purchaseorderline, purchaseorder, purchaseordercounter` (children first). Destroys every PO, receipt and captured receipt cost. **It does not reverse stock**: received quantities already sit in `outletingredientstock` and `stockmovement` (type `PURCHASE_RECEIPT`), which stay correct and conserved without the PO tables. Restore from a backup rather than dropping if any PO was received. Roll the backend and admin back first. |
| `20261021100000_refreshtoken_session_meta` | Schema-only, additive | `ALTER TABLE refreshtoken DROP COLUMN userAgent, DROP COLUMN ip`. Roll the backend back first (rotation inserts them). Only the session list's device and address columns are lost. |
| `20261021110000_two_factor` | Data-loss revert | `DROP TABLE userrecoverycode, usertotp, platformadminrecoverycode, platformadmintotp` and `ALTER TABLE shop DROP COLUMN require2fa`. Every enrolled user and platform admin silently loses their second factor and must re-enrol; a shop that required 2FA stops requiring it. Roll the backend, admin and platform admin back first so no login path still expects a factor. |
| `20261022100000_url_redirects` | Data-loss revert | `DROP TABLE notfoundlog, urlredirect`. Destroys every merchant's redirect map and the 404 report; the old URLs 404 again until re-imported. Roll the storefront back first (its proxy fetches the map) or it simply sees no redirects. |
| `20261023100000_survey_publish_consent` | Schema-only, additive | `ALTER TABLE surveyresponse DROP INDEX <the (shopId, featuredAt) index>, DROP COLUMN featuredAt, DROP COLUMN publishConsent`. Every featured review goes offline and every recorded consent is lost, so a re-migrated shop must re-collect consent. Roll the storefront and admin back first (the survey form sends `publishConsent`). |

For any "Data-loss revert" row above, the actually-safe rollback procedure is: **restore from a backup taken before the migration was applied** (see Backup/Restore above), not attempt the down-path against a live database that already has real post-migration data in it. The down-paths listed are what you'd run to make the *schema* match a pre-migration state, not to un-lose the data that lived in the tables/columns being dropped.

## Triage: custom domain connected but no cert

Symptom: a merchant connected a custom domain (Settings > Business >
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

## Region contract deploy (dropping `emirate`)

Migration `20261003100000_drop_emirate_columns` removes the free-text `emirate` column from `order`, `draftorder` and `outlet`. It is the only step of the region work that cannot be undone from its own file, so it has a procedure. **Nothing here runs without a person deciding to.**

**First, find out what production is running** (`git -C /home/deploy/requital log --oneline -1`, plus `git status`: never pull over uncommitted work). The order below depends on it, because there is no single-step order that is safe when production predates the region work: the OLD frontends send the `emirate` field (rejected once the contract backend is live), and the NEW frontends call `GET /regions` and read `region` (which an old backend does not have). So the jump is made in three stages, each safe against the other tier as it stands:

| Stage | What | Commit | Why it is safe |
|---|---|---|---|
| 1 | Backend only: migrate, `npm ci`, build, restart | **`e0abedd`** (PR-D merge; has every region migration up to `20261002100000`, NOT the drop) | Still accepts the old `emirate` alias and still returns `emirate`, so the old frontends keep working; adds `/regions` and `region` for the new ones. |
| 2 | admin and storefront: `npm ci`, build, restart. **Do not run `db:migrate`.** | **`b3fa26c`** (main) | They send `regionId` and read `region`, both served by stage 1. |
| 3 | Backend: preflight, migrate (the drop), build, restart | `b3fa26c` | Only now is `emirate` rejected, and no deployed frontend sends it. |

If production already runs `e0abedd` or later with the new frontends, only stage 3 applies; if it already runs `b3fa26c`, nothing is left. Between stages, confirm health before moving on: `pm2 list`, backend logs clean on start, one real storefront checkout (delivery, with a region) and one admin order view.

For each stage that touches the backend:

1. **Fresh dump, validated** (see Backup above): gzip integrity, table count, a scratch-database restore with row counts compared. Take one before stage 1 and another before stage 3.
2. **Per-migration output:** read what `npm run db:migrate` prints for each folder it applies, and stop on any error. A migration that fails is not recorded as applied.
3. **Stage 3 only, before migrating, the read-only preflight:** `npx ts-node -r tsconfig-paths/register scripts/region-backfill.ts` from `backend/`. Every table must report `unmatched=0`; an `unmatched value:` line is an emirate string no region carries, and the script exits 1 (`BLOCKED`). Do not proceed on a non-zero exit: map or correct those rows first. The migration itself refuses in that case (`Column 'unmapped' cannot be null`, nothing dropped, migration not recorded), so this step is about finding out early, not about safety. (A NULL-country shop's historical rows are the ones to expect here.)
4. **Checksums:** the same `order` / money-column checksum query before and after each backend stage, identical; `.env` fingerprint (a hash, never the contents) before and after.
5. **After each restart:** `sudo -u deploy pm2 list` (online, low restart count), backend logs for a clean start, and the scheduled sweeps (custom-domain verification, abandoned-cart recovery, the job queue) running and not erroring.
6. **After stage 3:** `GET /platform-admin/zone-mapping-status` shows which shops are still name-matched. The legacy zone matcher is deleted only when that list is empty, after the notice period (which starts at the stage-3 deploy date).

## Deploy notes: migrations after the region contract (2026-10-01)

Applied in folder order by `npm run db:migrate`: `20261004100000_shop_feature_override`, `20261005100000_shop_analytics`, `20261005110000_order_attribution`, `20261006100000_credit_notes`, `20261008100000_metafields`. All are additive (new tables, one nullable JSON column on `order`), with no backfill and no data touched. Ordering constraints: **backend before storefront** (the storefront now sends `attribution` on checkout and the backend's whitelist pipe would 400 it on an old backend), then admin; the backend registers the `send_conversion_event` job handler on boot, and a job queued by a new process and picked up by an old one is retried with backoff, so a rolling restart is safe. No new environment variables and no new dependencies in any app; the Meta CAPI token reuses `CREDENTIAL_ENCRYPTION_KEY`. Nothing is sent to any third party until a merchant enters ids AND a visitor accepts the cookie banner.

### Added since `9554d7fc` (the P1 to P4 batch)

Two more migrations, in folder order after the five above: `20261009100000_payment_reconciliation_state` (new `paymentreconciliation` table, no backfill) and `20261010100000_order_stock_consumption` (new `orderstockconsumption` table plus a nullable `order.consumptionRecordedAt`; **NULL = legacy order, no backfill**). Both additive. **Migrate before restarting the backend.** Ordering: backend first, then storefront and admin; the storefront `PromoCodeField` and admin `DraftOrderBuilder` now send `items` on the discount validate call and an old backend would 400 it (the new backend still accepts the old shape, so backend-first is always safe). After the restart: confirm the reconciliation sweep logs a clean tick, place and cancel one order on the `testadmin` shop and check `stockmovement` returns the stock, and apply a product-scoped code to a mixed basket and compare validate with the charged total.

### Deploy checksums

Compare `COUNT(*)` plus `BIT_XOR(CAST(CONV(SUBSTRING(MD5(CONCAT_WS('|', <explicit column list>)), 1, 16), 16, 10) AS UNSIGNED))` per table before and after each backend stage. Do **not** use `GROUP_CONCAT`: it truncates at `group_concat_max_len` (default 1024 bytes), so the comparison silently covers only a prefix. Creating any credential or user on production needs the owner's explicit approval first.

### Added since `0c18f157` (the security-review batch)

No new migrations. Backend first, then storefront and admin: the storefront `PromoCodeField` and admin `DraftOrderBuilder` already send `items` on the discount validate call; the validate endpoint now also rejects non-Available products (HTTP 400) and an order that would exceed a code's per-customer limit returns 409. After the restart: place an order with a limited code twice from the `testadmin` shop's storefront (the second must 409), create and return a delivered order, and confirm the reconciliation sweep logs a clean tick. The returns endpoint now needs `orders.manage` at the outlet: a branch role that only had `orders.view` loses the ability to create returns (intended).

### Added since `6b8a5b45` (the INV, STF, ONB batch, 2026-10-03)

Five migrations, in folder order, all additive (new tables, two nullable columns on `refreshtoken`, one `shop.require2fa` default-false): `20261020100000_suppliers`, `20261020110000_purchase_orders`, `20261021100000_refreshtoken_session_meta`, `20261021110000_two_factor`, `20261022100000_url_redirects`. No backfill and no existing row is touched.

**Order: migrate, backend, storefront, admin.** The storefront's `proxy.ts` now fetches `/public/:shopSlug/redirects/map` and the admin sends the new endpoints, so each needs the backend first; the global whitelist pipe would 400 an unknown field on an old backend.

- **Every signed-in staff member refreshes once at deploy.** The access token now carries a `sid` claim and `AuthGuard` checks the live session. A token issued before the deploy (no `sid`, no `imp`) is rejected with 401 and the admin's silent refresh issues a proper one. Impersonation tokens keep working. Expect a short burst of 401 on `/auth/me` in the log right after the restart; it is not an incident.
- **2FA is opt-in.** Nothing changes for a user who has not enrolled. `shop.require2fa` defaults to false. `PLATFORM_REQUIRE_2FA` stays unset until every platform admin has enrolled (see Platform admin below); setting it first would confine the only CLI-seeded admin to enrolment. A platform admin who loses both device and recovery codes: `npm run db:reset-platform-2fa -- <email>` from `backend/` (needs database access; run it deliberately, it writes no audit row).
- **New environment variables** (all optional): `PASSWORD_BREACH_CHECK=off` disables the breached-password lookup (it fails open on any non-answer anyway); `PASSWORD_BREACH_API_URL` overrides the range API base; `PLATFORM_REQUIRE_2FA=1` (above). `PASSWORD_POLICY_IN_TESTS` is a test-only seam, never set it on a server.
- **The password policy is not retroactive.** It applies where a password is chosen (signup, change, reset, invite, customer register and reset), never at login; no existing account is locked out or flagged.
- **Smoke checks after restart:** `GET /public/<testadmin slug>/redirects/map` returns 200 with an `ETag`; a visit to a path with a configured redirect on a hostname-resolved storefront answers 301 with a same-origin or own-host `Location`; log in as `testadmin`, open Settings > Security and confirm the current session is listed. Deploy checksums: the order and money-column checksum is unaffected (no order table changes).
- `GET /purchase-orders` and the supplier pages need no flag: they appear under Inventory for admin and branch staff.

### Added since `b9aed0f7` (the UI fix batch, 2026-10-03)

One migration, additive: `20261023100000_survey_publish_consent` (two nullable columns and one index on `surveyresponse`, no backfill). **Order: migrate, backend, storefront, admin**: the new storefront survey form sends `publishConsent`, which an old backend's whitelist pipe would 400. Production theme data is untouched, but a shop on the Bloom template with the old manual testimonial blocks loses that section (the blocks are ignored, not deleted) until a review is approved under Customers > Reviews. Smoke checks: `GET /public/<testadmin slug>/reviews/featured` returns `[]` or the approved reviews with exactly four keys; Settings > Business > Information on a phone-width window shows the two-column settings with the content skeleton while it loads.
