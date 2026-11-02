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

## Client IP behind the proxies (`TRUST_PROXY`)

**Status (owner-confirmed 2026-10-22): `TRUST_PROXY=loopback` IS set in production.** The steps below are kept as the reference for a fresh host and for re-verification; step 1's external-reachability check (nothing may accept connections on :3000 or :3002 from outside) is a standing requirement, because with trust on, a client that can reach :3002 directly can choose its own IP. `INTERNAL_API_URL` on the VPS is not confirmed.

Without this the backend sees every request from `127.0.0.1` (Caddy, or the storefront's Next server), so every per-IP throttle (`/auth/login`, `/auth/refresh` and the other 5 per minute routes, signup, MFA, the 404 log, surveys) is **one shared bucket for all users**, and Settings > Security shows a useless IP. `TRUST_PROXY` (backend env, read once at start) tells Express which direct peers may report the client's address in `X-Forwarded-For`. Code: `backend/src/common/trust-proxy.ts` (parser), `AppModule.onModuleInit` (applies it, in `main.ts` and in the e2e harness alike), `common/client-ip-throttler.guard.ts` (throttle key).

### The exact value

```
TRUST_PROXY=loopback
```

in `/home/deploy/requital/backend/.env`, then `sudo -u deploy pm2 restart requital-backend`. That single value is correct for **both** entry paths, which hit the same backend process:

| Path | Hops | Backend's socket peer | `X-Forwarded-For` the backend receives | `req.ip` |
|---|---|---|---|---|
| A. admin browser to `api.requital.io` | client, Caddy, backend | 127.0.0.1 (Caddy) | `<client>` (Caddy overwrites whatever the client sent) | `<client>` |
| B. storefront browser to `*.requital.io` or a custom domain, `/api/*` rewrite | client, Caddy, Next :3002, backend (over `INTERNAL_API_URL`, see below) | 127.0.0.1 (Next) | `<client>` (Next 16 adds nothing; it forwards Caddy's header untouched) | `<client>` |

Express takes the right-most `X-Forwarded-For` entry that is not trusted. With only loopback trusted, the proxy's own entries are skipped and the first non-loopback address wins, and anything a client typed sits to the left of what Caddy wrote, so it is never reached. **Do not use a hop count here:** `1` happens to work for both chains today (each has exactly one entry plus the socket), but a hop count believes whoever is on the socket, including a request that reached port 3000 directly, and it silently breaks if a proxy ever appends a hop. `loopback` is the same for both chains and refuses a non-local peer outright.

Accepted syntax (anything else, `true`, `*`, `0.0.0.0/0`, `::/0`, a range wider than IPv4 /8 or IPv6 /16, a hop count over 10, makes the backend refuse to start with a message naming `TRUST_PROXY`): a hop count 1 to 10, or a comma-separated list of `loopback`, `linklocal`, `uniquelocal`, addresses and CIDR ranges. Unset, or blank, means no trust: `req.ip` is the socket address and a forwarded header is ignored (exactly the behaviour before this existed).

### What this relies on (verified 2026-10-04 with Caddy v2.10.0 and Next 16.3.0 on local ports, see docs/handoff/n6c.md)

- **Caddy overwrites `X-Forwarded-For`** for any client that is not in `trusted_proxies` (the default is none), writing the client's socket address. A spoofed `X-Forwarded-For` from the internet never reaches the backend. `X-Real-IP`, `Forwarded` and `CF-Connecting-IP` are **not** touched by Caddy and arrive client-controlled; the backend never reads them. **Do not add `trusted_proxies` to the Caddyfile for the DNS-only setup**: it makes Caddy keep a client's own header.
- **The Next `/api/*` rewrite adds no `X-Forwarded-For`** (`proxy-request.js` does not set httpxy's `xfwd`; it only sets `x-forwarded-host`). It copies the incoming header through, so the value Caddy wrote reaches the backend. If a future Next release starts appending the peer, that peer is `127.0.0.1`, which `loopback` skips, so the result is unchanged.
- **The backend and the storefront server must not be reachable from the internet on :3000 and :3002.** :3000 is safe even if open (a non-loopback peer is not trusted, so its header is ignored). **:3002 is not**: Next forwards a client's own `X-Forwarded-For` untouched and the backend then sees loopback as the peer, so a client that can reach :3002 directly could choose its IP. Whether the VPS firewalls these ports is **not recorded in this repo (INFERRED: closed, because Caddy is the only listener the docs describe)**. Check it from outside before enabling: `curl -m 5 http://187.52.114.246:3002/` and `:3000`, both must fail to connect. If either answers, bind the app to 127.0.0.1 or firewall it first.
- **Cloudflare is not recorded either.** INFERRED not proxying the storefront hosts (a proxied wildcard record needs a Cloudflare Enterprise plan, custom domains point at the VPS directly, and the wildcard certificate is issued by DNS-01, not through the proxy). If `api.requital.io` or another host turns out to be proxied, Caddy sees a Cloudflare edge address as the client and the session IP column will show Cloudflare addresses after the deploy. The fix is both of: Caddy global option `servers { trusted_proxies static <Cloudflare IPv4 and IPv6 ranges from cloudflare.com/ips> }` (Caddy then appends instead of overwriting, producing `client-spoof, real-client, edge`, verified locally with a stand-in range), and `TRUST_PROXY=loopback,<the same ranges>` on the backend. Then the right-most address outside both lists is the real client and everything to its left is ignored. The ranges change rarely but they do change; keep the two lists identical.

### Production values (what each app needs)

| App | File on the VPS | Variable | Production value | Needed at |
|---|---|---|---|---|
| backend | `/home/deploy/requital/backend/.env` | `TRUST_PROXY` | `loopback` | runtime (restart) |
| storefront | `/home/deploy/requital/storefront/.env.local` | `NEXT_PUBLIC_API_URL` | `https://api.requital.io` (unchanged; public, inlined in the browser bundle for image URLs) | **build** |
| storefront | `/home/deploy/requital/storefront/.env.local` | `INTERNAL_API_URL` | `http://127.0.0.1:3000` (origin only: no path, no trailing path, no credentials; the app refuses anything else) | **build AND runtime** |

### Why the storefront needs `INTERNAL_API_URL` (W7)

`storefront/next.config.ts` rewrites `/api/*` to the backend. When that destination was `NEXT_PUBLIC_API_URL` (`https://api.requital.io`), the Next server's own hop left the VPS and re-entered Caddy, which overwrites `X-Forwarded-For` with the peer it sees: the VPS's public address. Every storefront API call (customer login, signup, checkout, survey, 404 log, all the per-IP throttles) then shared one bucket and every shopper session recorded the VPS address. With `INTERNAL_API_URL=http://127.0.0.1:3000` the Next server calls the backend directly: the backend's peer is loopback (trusted) and the `X-Forwarded-For` Caddy wrote for the real client passes through Next untouched, so `req.ip` is the shopper.

- **Unset or blank falls back to `NEXT_PUBLIC_API_URL`**, so dev, CI and e2e (which set only `NEXT_PUBLIC_API_URL`) are unchanged.
- **The rewrite is baked at build time.** `rewrites()` is evaluated by `next build` and written to `.next/routes-manifest.json`; `next start` serves that manifest and never re-reads the variable for it. Verified 2026-10-11 (Next 16.3.0): built with `NEXT_PUBLIC_API_URL=https://api.example.test INTERNAL_API_URL=http://127.0.0.1:3000`, the manifest holds `"destination": "http://127.0.0.1:3000/:path*"`; starting that build with a different `NEXT_PUBLIC_API_URL` and `INTERNAL_API_URL` unset still sent `/api/*` to 127.0.0.1:3000 and nothing to the new value. **The storefront must therefore be rebuilt, not just restarted**, and the variable must be in the environment `next build` runs in (`.env.local` is read by both build and `next start`).
- The same variable is read at **runtime** by the Next server's own fetches (SSR/RSC calls in `lib/api.ts`, `proxy.ts` domain resolve and the redirect map). Those now go straight to loopback too (no TLS or Caddy hairpin). `resolveImageUrl` and every browser-visible URL keep the public origin.
- **Not changed, by decision:** those server-side fetches carry no browser address, so they share one bucket (now keyed `127.0.0.1`, before the VPS address) of the global default per route. Forwarding the incoming request's `X-Forwarded-For` on them would need `headers()` in every server component (it forces dynamic rendering of pages that are static today) and would make the backend believe a header that a client could choose if :3002 were ever reachable from outside. It stays a latent per-route ceiling, not a regression. `proxy.ts` could do it cheaply if it ever matters.
- Tests: `backend/test/storefront-api-ip-chain.e2e-spec.ts` runs the real backend and a real `next dev` of `storefront/` behind a stand-in for Caddy (overwrites `X-Forwarded-For`) and asserts, with the variable set: the session IP and throttle bucket are the real client's, a forged header is overwritten, two clients get separate buckets, the public-origin Caddy sees zero requests; with it unset: the fallback works; and, as the regression proof, that the old shape puts every shopper on the VPS address and one bucket. `storefront/lib/api-origin.test.ts` covers the selection and validation.

### Server-side storefront fetches (SSR, `proxy.ts`)

`getShop` and the other server-component fetches, the domain resolver and the redirect map are made by the Next server with no browser attached, to `INTERNAL_API_URL` (or `NEXT_PUBLIC_API_URL` when that is unset). They arrive from loopback and, without `INTERNAL_API_SECRET`, share **one** bucket per route of the global 100 per minute default across every shop's page renders.

**`INTERNAL_API_SECRET` (F10, optional, off when unset).** Set the SAME value (at least 32 random characters; the backend refuses to start with a shorter one) in `backend/.env` and `storefront/.env.local`, restart the backend, rebuild and restart the storefront. The storefront then signs each of those calls with `X-Internal-Auth: t=<unix>,sig=HMAC_SHA256(secret, METHOD\nPATH\nt)` and `ClientIpThrottlerGuard` gives a verified call its own bucket: per visitor address for the host lookup and redirect map (the right-most `X-Forwarded-For` entry, which Caddy writes, sent as `X-Internal-Client-IP` and believed only when the signature checks out), per signed path for server-rendered reads. The signature grants a different throttle bucket and NOTHING else: no authentication, no tenant access, no guard skipped. It is honoured ONLY for GET requests to the read-only public routes the storefront server itself reads (`/domains/resolve`, `/public/shops/sitemap`, and `/public/<slug>` plus its `theme-config`, `outlets`, `products`, `collections`, `brands`, `menu`, `templates`, `policy-pages`, `regions`, `redirects/map`, `discounts/auto` and similar catalogue reads; allowlist `INTERNAL_BUCKET_ROUTES` in `backend/src/common/internal-auth.ts`). Every other request (auth, signup, password reset, every POST, discount and gift-card validation, order and survey token lookups, geocoding, delivery quotes) stays on the client-IP bucket even when the header verifies. A holder of the secret can therefore pick their bucket, and so is effectively exempt from the per-IP limit, on those public read-only routes only; replay inside the 60 second window is equally harmless. A missing, forged, expired, wrong-path or malformed header is simply ignored. **`:3002` must stay unreachable from the internet** (a client that could reach it directly could choose its own forwarded address). Rotation: change the value in both files and restart both apps; during the gap the storefront's calls are unsigned, which is exactly today's behaviour. The value is never logged or put in a response.

`proxy.ts` no longer turns a throttled or failing backend into a 404: only a backend 404 means an unknown host. A 429 or 5xx serves the last known good subdomain (up to 5 minutes), else answers 503 with `Retry-After` (the backend's own value when present) and `Cache-Control: no-store`. A resolved host is cached for 30 seconds, so the lookup rate is bounded by hosts, not page views. Caddy's on-demand TLS `ask` (`GET /domains/verify`) is a separate caller on its own per-route bucket: a throttled ask is a non-2xx, which Caddy treats as "no certificate this time" and retries on the next handshake.

### Deploy

1. Check :3000 and :3002 are unreachable from outside (above).
2. (Applied in production.) Add `TRUST_PROXY=loopback` to `backend/.env`; `sudo -u deploy pm2 restart requital-backend`; check the logs for a clean start. No Caddy reload and no storefront or admin rebuild is needed: Caddy already overwrites the header and the Next rewrite already forwards it. The Caddyfile and next.config.ts have no functional change in this PR.
3. **Storefront internal origin (W7). Hard gate: step 1 must have PASSED, because from now on the storefront forwards the client's X-Forwarded-For untouched to a backend that trusts loopback, so a publicly reachable :3002 would let anyone choose their throttle bucket. Do this only after step 2 (the backend already trusts loopback), in this order:** add `INTERNAL_API_URL=http://127.0.0.1:3000` to `storefront/.env.local` (keep `NEXT_PUBLIC_API_URL` as it is), then `cd /home/deploy/requital/storefront && sudo -u deploy npm ci && sudo -u deploy npm run build`, then `sudo -u deploy pm2 restart requital-storefront`. A restart without the rebuild changes nothing for the rewrite. Verify: `grep -o '"destination": "http[^"]*path\*"' .next/routes-manifest.json` shows `http://127.0.0.1:3000/:path*`; then repeat the chain B throttle check below from two networks (a shopper on network 2 must not be limited by network 1's failures) and look at Settings > Security / a customer session: the IP is the shopper's, not the VPS address. Rollback: remove the variable, rebuild, restart. Optional defence in depth (owner decision, not done here): start the storefront with `next start -H 127.0.0.1` so :3002 only listens on loopback; Caddy proxies to localhost, check that it resolves to the same address family.
4. Verify (both chains, no debug endpoint exists and none should be added):
   - **Chain A:** sign in to the admin as `testadmin` (shop 1) from a phone on mobile data and from the office network. Settings > Security shows each device's own public address (compare with what an IP-echo site reports for that network), not `127.0.0.1`, not the VPS address, not a Cloudflare range.
   - **Chain B and the throttle:** from network 1 send six wrong customer logins to the test shop, `for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{"email":"nobody@example.com","password":"wrong-password-1"}' https://<testadmin-host>/api/public/<testadmin-slug>/auth/login; done`: the first five are 400/401, the sixth is 429. Immediately repeat once from network 2 (a phone on mobile data): that must be 400/401, not 429. If network 2 is limited too, the header is not being honoured (check step 1 and the Caddyfile for a stray `trusted_proxies`).
   - **Spoof check:** `curl -H 'X-Forwarded-For: 6.6.6.6' ...` on the same login from network 1 must still be the limited one (429 after the five).

### Rollback

Remove `TRUST_PROXY` from `backend/.env` and `sudo -u deploy pm2 restart requital-backend`. Behaviour returns to the previous one (one shared bucket, proxy address in the session list). Nothing else changed, nothing to migrate.

### Known limits

An IPv6 client is throttled per /64 (so it cannot rotate addresses to escape a limit), which means two users on the same /64 share a bucket. The session list IP column records the full address. Per-account protections (the progressive login delay, the MFA lockout) never depended on the IP and are unchanged.

## Google Maps key setup (checkout map, address pickers, delivery-zone map)

The storefront (checkout and saved addresses) and the admin (outlet address, delivery zones) load the Google Maps JavaScript API with one browser key, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, set in `storefront/.env.local` and `admin/.env.local`. This is the standing procedure; check it whenever a custom domain is added or the key is rotated.

### What the key must allow

- **Application restriction: HTTP referrers.** The allowed list must contain, exactly:
  - `*.requital.io/*` (every merchant subdomain storefront)
  - `requital.io/*`
  - `admin.requital.io/*`
  - one `https://<domain>/*` for **each verified merchant custom domain**. Get the list with `SELECT customDomain FROM shop WHERE customDomainStatus = 'verified' ORDER BY customDomain;` (a `pending`, `verifying` or `failed` claim is not served, so it needs no referrer yet).
- **API restrictions: only Maps JavaScript API and Places API.** The Geocoder used for pin-drag reverse lookups is part of the Maps JavaScript API, so it needs no entry of its own. Do not enable the Geocoding API for this key.
- **Billing must be linked** to the Google Cloud project. There are two different failures: a project with no billing account at all shows Google's own error dialog (`BillingNotEnabledMapError`), while a key that is valid but whose project has billing trouble can render a grey watermarked map ("For development purposes only") with no error at all. Neither is a code problem.
- **The key is baked into the JavaScript at build time** (`NEXT_PUBLIC_*`). A changed or rotated key does nothing until both apps are rebuilt and restarted (`npm ci && npm run build` in `admin/` and `storefront/`, then `pm2 restart requital-admin requital-storefront`). Changing the restrictions in Google Cloud needs no rebuild and applies within a few minutes.
- **Before telling a merchant their custom domain is live, add its `https://<domain>/*` referrer.** The domain verifies and serves on our side first; the map only starts working once Google allows that origin. A custom-domain shop with a missing referrer takes orders normally (the typed-address fallback below) but shows no map.

### What a shopper sees when Maps fails

Nothing alarming and nothing from Google. The map area becomes "Map unavailable. You can type your address below.", "Use my location" keeps working, and "Find on map" looks the typed address up through our own geocode endpoint (OpenStreetMap Nominatim, one lookup per button press). Checkout stays completable: on an outlet with a delivery radius the server geocodes the typed address and applies the radius to it (an address outside it is still refused); if the lookup finds nothing the order is accepted and flagged **"Address not verified on a map, please confirm with the customer"** on the admin order card, the order detail and the packing slip. Phone the customer for those orders before dispatch.

### How a merchant (and we) find out

- An admin sees a banner on every admin page: "Google Maps is not working for your store (code). Contact Requital support." It has two sources:
  - **This browser's own admin Maps loader** (a real, logged-in admin whose map actually failed). It shows immediately and says nothing about visitors.
  - **Reports sent by the shop's own storefront visitors** (`POST /public/:shopSlug/maps-error`, read back by `GET /shop/maps-health`). This is what catches a referrer problem on a connected custom domain, which the admin cannot see. The banner then says "Reported by visitors on <host>" and offers **Mark resolved**.
- The visitor beacon is unauthenticated, so it is deliberately hard to use as a nuisance: only the four codes below, only from the shop's own verified hosts, throttled to 20 per minute per IP, and it shows in the banner only once a problem has been reported **at least 3 times over at least 60 minutes**, within the **last 7 days**. **Mark resolved** (admin only, audit logged as `maps_health.resolved`) zeroes that code and host's count, so only reports after it count again; if the problem really persists, three more reports over an hour bring it back.
- The throttle and the one-row-per-code-and-host bound assume `TRUST_PROXY=loopback` is set in production (see the "Client IP behind the proxies" section above). Without it every visitor shares one bucket and the beacon throttle is meaningless.
- **Privacy note for the owner:** in the typed-address fallback the shopper's typed delivery address (plus the chosen region) is sent to OpenStreetMap Nominatim by our backend to find coordinates, both from the "Find on map" button and, on a radius outlet, when the order is placed. The privacy policy should mention OpenStreetMap geocoding.
- **Manual-address pricing rule:** while Maps is down and no pin exists, the delivery zone is matched by name and region only, never by a zone's map circle, in the quote and in the order alike (the quote cannot geocode, the order can, and a geocoded point matching a circle would otherwise charge a different fee than the one quoted). The geocoded point is used only for the delivery-radius check. An outlet that has zones but none match the typed address then charges the shop default fee on an unverified address (the order is flagged so the merchant confirms it before dispatch); a matched zone's minimum order still applies.
- To look yourself: `SELECT s.subdomain, m.code, m.host, m.hitCount, m.lastSeenAt FROM mapserrorlog m JOIN shop s ON s.id = m.shopId ORDER BY m.lastSeenAt DESC;`

### Triage

| Code or symptom | Meaning | Fix |
|---|---|---|
| `RefererNotAllowedMapError` | The page's address is not in the key's allowed referrers. The `host` column says which one. | Add `https://<host>/*` (or the platform wildcard above) to the key's HTTP referrers in Google Cloud. No rebuild. |
| `BillingNotEnabledMapError` | The Google Cloud project has no active billing account. | Link or fix billing on the project. No rebuild. |
| `InvalidKeyMapError` | The key in the build is wrong, deleted or malformed. | Set the right `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in both apps, rebuild and restart both. |
| `ApiNotActivatedMapError` | Maps JavaScript API (or Places API) is not enabled for the project, or is excluded by the key's API restriction. | Enable it on the project and make sure the key's API restriction lists Maps JavaScript API and Places API. No rebuild. |
| Banner shows "load failed" | The Maps script itself did not load (network, ad blocker, or the key's host is blocked). | Usually the viewer's browser. If every visitor is affected, check outbound access to `maps.googleapis.com`. |
| Grey overlay with a repeating "For development purposes only" watermark, no error | Key is valid but the project's billing is not in good standing. | Fix billing. This produces no error code, so no banner appears. |
| Map fine for shoppers, banner shows on a custom domain only | That domain's referrer is missing (the report names the host). | Add its referrer. |

Visitor reports leave the banner 7 days after the last one, or at once when an admin marks them resolved; the rows themselves stay until the shop is deleted. An admin can also dismiss the banner for the session.

## Shop owner lost their two-factor (platform-admin recovery)

**This is the only way a sole shop admin recovers.** If a shop's only admin loses their authenticator device AND their recovery codes, nobody else in that shop can reset them (a same-shop admin can reset a colleague, never themselves), so a Requital platform admin must do it. Until you press the button the shop is locked out of its own admin. Because the reset hands account access to whoever asks convincingly, it is a social-engineering target: do the checklist below first, every time, no exceptions for urgency.

### Before you press Reset: verify the person (all of these)

1. **Out of band.** Contact the owner on a channel you already held before this request (the phone number or email on the signed Requital contract or billing record), never on the details supplied by the requester and never over the channel the request arrived on. A requester who pushes urgency ("my shop is down, do it now") is a reason to slow down, not to hurry.
2. **Match the shop.** The requester states, unprompted, details you compare with the platform record: shop name and subdomain, the owner's registered email, the country and currency, roughly when the shop was created.
3. **Proof of ownership.** At least one of: the last order (number and approximate total) as seen in the platform shop detail, a recent billing or payout document in the owner's name, or a live video call where they show a government ID matching the owner of record.
4. **Know who the user is.** Pick the exact user in the Staff two-factor card by email. For a non-owner staff member, the shop's own admin should ask, not the staff member; only reset a staff member at the request of a verified shop admin.
5. **Write down** who verified, how, and the ticket reference, in your support ticket (the audit log below records the action, not your verification).

### What the reset does

On `/platform/shops/<id>`, card **Staff two-factor**, Reset two-factor, confirm. In one transaction it:

- deletes the user's authenticator secret and all recovery codes;
- revokes every session of that user (signed out everywhere at once, even a tab that is open);
- marks the user as **must set up two-factor again**: after signing in with their password they can reach only the two-factor setup page until they enrol, even when the shop does not require two-factor (a user who had no second factor is not forced into one);
- queues an email to the user: "two-factor was reset by Requital support" (no codes in it);
- writes a platform audit log entry. The audit entry is part of the same transaction: if it cannot be written, nothing is reset and you see an error. Try again.

It does **not**: change the password, change the shop-wide two-factor setting, touch any other user, or end an impersonation session (those expire on their own within an hour). It never shows you a secret or a code; the response is only "success". A user id from another shop gets the same 404 as one that does not exist.

### What the user sees next

An email saying support reset their two-factor. On the next sign-in (password only) they are taken to Settings > Security with a notice that two-factor is required on their account, and every other page answers 403 until they scan a new QR code and confirm. They get new recovery codes. Tell them to store the codes somewhere other than the phone that holds the authenticator.

### Checking it in the audit log

Platform > Audit log (or `GET /platform-admin/audit-log?shopId=<id>`): action `shop.user_2fa_reset`, the shop id, and metadata `{ userId, role, wasEnrolled, sessionsRevoked }` (never a secret). The shop's own Activity log does not show it (it records shop users as actors and a platform admin is not one); the email to the user is the shop-side trail.

### If a platform admin loses their own two-factor

The platform tier has no one above it in the UI: from `backend/` on the server run `npm run db:reset-platform-2fa -- <email>` (needs database access and writes no audit row, so note it in the ticket), then enrol again. If `PLATFORM_REQUIRE_2FA` is on, an unenrolled platform admin can reach only the enrolment page, which is also why this endpoint is unreachable to them.

## Deploy via GitHub Actions

A deploy can be started from the GitHub Actions tab instead of a person with an SSH key at a keyboard. The manual path in CLAUDE.md ("VPS deploy") stays valid and is the fallback. Everything privileged is one SSH call into a script on the VPS that runs the whole procedure with hard gates (`tools/deploy/deploy.sh`). Nothing here is deployed or created by merging the code: the one-time setup below is yours to do, and every VPS and runner behaviour in this section was tested against fakes only (see "Not verified" at the end).

### How it works

1. **Actions > Deploy > Run workflow** (branch `main` only), pick a `mode` and a full 40-character `sha` that is on `main`:
   - `dry-run` (the default): runs every read-only gate on the VPS and changes nothing except a log file and a marker file.
   - `deploy`: the real thing. The VPS refuses it unless a successful dry-run of the SAME sha finished in the last 24 hours (marker `/home/deploy/deploy-logs/dryrun-ok-<sha>`, consumed by the real run).
   - `status`: prints the tail of the newest deploy log and the last `DEPLOY_RESULT`. No CI gate, no deploy.
   - `rollback`: CODE-ONLY rollback to `sha` (use the `PREVIOUS_SHA` a deploy printed).
2. The **gate** job (no secrets) checks that the run is on `main`, that `sha` is an ancestor of `main`, and that the five required CI checks succeeded on it: `backend (tsc, unit, e2e)`, `admin (tsc, lint, vitest, build)`, `storefront (tsc, lint, vitest, build)`, `guardrails (outlet-scoping, page-width, sendEmail)`, `e2e (playwright)`.
3. The **deploy** job waits for a reviewer to approve the `production` environment, then opens one SSH connection with a key that can run exactly `deploy <sha> [--dry-run] [--ci-verified]`, `rollback <sha>` or `status`, and streams the output.
4. The VPS holds **no GitHub token**. It cannot check CI itself, so a real deploy requires the `--ci-verified` flag that only the workflow's gate job sends. There is deliberately no token path.

What `deploy.sh` does, in order (it stops at the first failed gate, and all of these also run in a dry-run up to step 5):

| Step | What |
|---|---|
| 1 | Preflight: running as `deploy`, tools present, 2 GB free, all three pm2 processes online, database reachable |
| 2 | Working tree must be completely clean (untracked files count) |
| 3 | `git fetch`; the sha must be an ancestor of `origin/main`; production HEAD must be an ancestor of the sha; equal means "already deployed" when the last real run for that sha ended OK (or nothing is recorded), **RESUME** when it failed at step 10 or later, and a refusal when it failed earlier (see "HEAD already equals the sha" below) |
| 4 | `--ci-verified` present (real run), a fresh dry-run marker for this sha (real run) |
| 5 | Plan: which apps changed, pending migrations (a migration that sorts before the last applied one is flagged), `.env` fingerprints |
| 6 | Backup with `tools/backup-db.sh`, `gzip -t`, restore into a scratch database, require `rows before <= restored <= rows after` |
| 7 | BEFORE row hashes of the protected tables (an MD5 per row over explicit columns, bounded by the max id captured now; plus count and XOR totals for the log), plus the billing flag matrix from the PIN's own script |
| 8 | `git merge --ff-only` to the sha |
| 9 | Backend `npm ci`, `db:migrate`, build, `dist/main.js` assertion; AFTER row hashes are compared row by row, and an unexplained change STOPS the run before any restart (see "Protected rows" below) |
| 10 | Storefront (`INTERNAL_API_URL=http://127.0.0.1:3000`, routes-manifest assertion) and admin builds. All builds finish before any restart |
| 11 | `pm2 restart` backend, storefront, admin (only rebuilt apps), each with an online and health wait |
| 12 | Redirect-map smoke, new `Cannot find module` in the logs is fatal, `backup.log` check |
| 13 | `.env` fingerprints must be unchanged |
| 14 | Prints `PREVIOUS_SHA=`, `NEW_SHA=`, `BACKUP_FILE=` and `DEPLOY_RESULT=OK` (or `FAILED step=<n>`, or `REFUSED`) |

Not automated, on purpose: the authenticated `testadmin` smoke needs a temporary staff user on production, so it stays a manual step that needs your approval each time.

Logs are in `/home/deploy/deploy-logs/` (mode 600, secrets redacted). The run keeps going on the VPS if your connection or the workflow drops; run `status` to see how it ended. Only one deploy or rollback can run at a time (`/home/deploy/.requital-deploy.lock`).

**Rollback is code-only.** `rollback.sh` resets the checkout to the earlier commit, rebuilds all three apps and restarts them. It does NOT restore the database: migrations here are additive, so the previous code runs against the migrated schema, and restoring a dump would also discard every order placed since the backup. A database restore stays a human decision; see "Restore" and "Migration rollback reference" in this file before doing one.

### One-time setup (you do this; nothing has been created for you)

You need: the existing root SSH access to the VPS that you use today, and admin rights on the GitHub repository. These commands are for Windows PowerShell with the built-in OpenSSH client (Settings > Apps > Optional features > "OpenSSH Client"). `<VPS_HOST>` is the same address you already use to reach the VPS.

**Prerequisite:** the pull request that adds `tools/deploy/` must be merged to `main` first (the bootstrap copies a file out of `origin/main`).

#### 1. Create a dedicated key on your PC

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\requital_gha_deploy" -C requital-gha-deploy
```

When it asks for a passphrase, **press Enter twice (no passphrase)**. A GitHub runner cannot type a passphrase, so a key that GitHub uses must have none. That is acceptable only because this key is dedicated, can run nothing but the three commands above, and will live ONLY in the GitHub secret: after your first successful dry-run (step 7) delete the local copy (step 7 shows how). If you ever suspect the key leaked, revoke it (see "Revoking access").

Show the PUBLIC key (safe to share):

```powershell
Get-Content "$env:USERPROFILE\.ssh\requital_gha_deploy.pub"
```

Build the exact line you will install on the VPS (copy the single line it prints):

```powershell
$pub = (Get-Content "$env:USERPROFILE\.ssh\requital_gha_deploy.pub").Trim()
"restrict,command=`"/usr/local/sbin/requital-ssh-entry.sh`",no-port-forwarding,no-agent-forwarding,no-pty,no-X11-forwarding $pub"
```

It looks like this (your key differs):

```text
restrict,command="/usr/local/sbin/requital-ssh-entry.sh",no-port-forwarding,no-agent-forwarding,no-pty,no-X11-forwarding ssh-ed25519 AAAA... requital-gha-deploy
```

`command=` forces that script for every connection with this key no matter what the client asks for. The script path is absolute (sshd does not expand `~` in `command=`). `restrict` already disables forwarding and a pty; the explicit options are belt and braces.

#### 2. Install the entry script on the VPS, outside the git tree

Log in as root the way you do today, then run this block. It copies `ssh-entry.sh` out of git into `/usr/local/sbin`, a directory owned by root (and so is its parent), so the file cannot be swapped or renamed from the `deploy` account and a `git merge` cannot change what the key is allowed to run:

```bash
sudo -u deploy git -C /home/deploy/requital fetch origin main
sudo -u deploy git -C /home/deploy/requital show origin/main:tools/deploy/ssh-entry.sh > /usr/local/sbin/requital-ssh-entry.sh
chown root:root /usr/local/sbin/requital-ssh-entry.sh
chmod 755 /usr/local/sbin/requital-ssh-entry.sh
sha256sum /usr/local/sbin/requital-ssh-entry.sh
```

The hash printed must equal this one (also printed in the pull request that introduced the pipeline). If it does not, stop and do not continue:

```text
7b741ffb67fad259ad101fa6b395723dc57f959d0625040e15af5ed422d2e690  /usr/local/sbin/requital-ssh-entry.sh
```

What this does and does not protect: it constrains the holder of THIS key (the GitHub secret). It is not a defence against a compromised `deploy` user, who owns the application, the checkout and `authorized_keys` and can do far more than this script allows anyway.

Only `ssh-entry.sh` is bootstrapped this way. `deploy.sh` is taken from the commit being deployed (extracted with `git archive` on every run), and `rollback.sh` from the checked-out tree. **Whenever `ssh-entry.sh` changes (its sha256 changes) it must be re-copied with the block above and the hash re-checked**; the pull request that changes it prints the new hash, and the test suite fails if the hash in this runbook and the file differ.

The script runs with a fixed `PATH=/usr/local/bin:/usr/bin:/bin` and fixed paths (`/home/deploy/requital`, `/home/deploy/deploy-logs`); nothing in the environment can change them. Check that every tool the deploy needs is reachable from that PATH, and symlink any that are not into `/usr/local/bin` (for example when `pm2` or `node` live under a version manager):

```bash
sudo -u deploy env -i PATH=/usr/local/bin:/usr/bin:/bin sh -c 'for c in git node npm pm2 mysql mysqldump gzip flock curl md5sum; do command -v "$c" || echo "MISSING: $c"; done'
```

Every tool must print a path. Any line starting with `MISSING:` must be fixed before the first dry-run (which would otherwise stop with `required command(s) missing`).

The database URL in `backend/.env` must have its special characters percent-encoded (an `@` in the password is `%40`), as CLAUDE.md already says. The preflight refuses a raw `@` with a clear message, because the backup scripts split the URL at the first `@`.

#### 3. Authorise the key on the VPS

Still on the VPS as root:

```bash
cp -p /home/deploy/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys.bak
nano /home/deploy/.ssh/authorized_keys
```

Go to the end of the file, paste the single line from step 1 as its own new line, then save (Ctrl+O, Enter) and exit (Ctrl+X). Leave the existing lines (for example the backup-pull key) untouched. Then:

```bash
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
grep -c requital-gha-deploy /home/deploy/.ssh/authorized_keys
```

The last command must print `1`.

#### 4. Capture the server's host key (this stops a man-in-the-middle)

On the PC, scan using exactly the same `<VPS_HOST>` you will put in the `DEPLOY_HOST` secret:

```powershell
ssh-keyscan -t ed25519 <VPS_HOST>
```

It prints one line: `<VPS_HOST> ssh-ed25519 AAAA...`. That whole line is the value of the `DEPLOY_KNOWN_HOSTS` secret. Before you trust it, compare fingerprints. On the PC:

```powershell
ssh-keyscan -t ed25519 <VPS_HOST> | ssh-keygen -lf -
```

On the VPS:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

The two `SHA256:...` values must be identical. If they differ, something is between you and the server: stop.

#### 5. Create the GitHub Environment and secrets

In the repository on github.com:

1. **Settings > Environments > New environment**, name it exactly `production`, click **Configure environment**.
2. Tick **Required reviewers**, add yourself (and anyone else allowed to approve a deploy), click **Save protection rules**.
3. Under **Deployment branches and tags** choose **Selected branches and tags**, click **Add deployment branch or tag rule**, enter `main`, and add it.
4. Under **Environment secrets** click **Add environment secret** four times:

| Secret | Value |
|---|---|
| `DEPLOY_SSH_KEY` | the full contents of the private key file, including the `-----BEGIN` and `-----END` lines. Copy it without printing it: `Get-Content "$env:USERPROFILE\.ssh\requital_gha_deploy" -Raw \| Set-Clipboard`, paste into the box, then clear your clipboard |
| `DEPLOY_HOST` | `<VPS_HOST>`, exactly as used in step 4 |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_KNOWN_HOSTS` | the single `ssh-keyscan` line from step 4 |

Environment secrets are only handed to jobs that passed the environment's rules. Put them nowhere else, and make the controls real:

- **The deployment-branches rule is THE control** that keeps code from other branches away from the secrets. The `if: github.ref == 'refs/heads/main'` lines inside `deploy.yml` are not a control: anyone who can push a branch can edit that file on their branch. Only the environment's "selected branches" rule stops a job on another branch from being given the secrets.
- **Prevent self-review.** If more than one person can approve, tick **Prevent self-review** on the environment so whoever starts a run cannot approve it. If you are the only maintainer you cannot enable it without locking yourself out; then the reviewer step is a guard against mistakes, not a second pair of eyes, and the real barriers are the branch rule and branch protection on `main`.
- **Environment secrets only.** The four secrets must be Environment secrets of `production`. Delete any repository-level or organisation-level secret with the same names (**Settings > Secrets and variables > Actions**, tabs "Repository secrets" and, for an organisation, its own Secrets page): those would be handed to workflows regardless of the environment's rules.
- **Plan caveat.** Required reviewers and deployment-branch rules on environments are available for private repositories only on paid GitHub plans (Pro, Team, Enterprise); on the free plan they work for public repositories only. If **Settings > Environments** does not offer them, do not put the key into GitHub until it does.
- **Verify the rule instead of trusting it.** (a) Run the workflow from any branch other than `main` with mode `status`: the jobs must be skipped. (b) That only proves the `if:` lines. To prove the environment rule itself, push a scratch branch on which you delete the two `if: github.ref == 'refs/heads/main'` lines from `deploy.yml`, then dispatch mode `status` from that branch: GitHub must refuse the `deploy` job with a message like "Branch ... is not allowed to deploy to production due to environment protection rules", and no step may run. If the job starts instead, the rule is missing: fix it before going on. Delete the scratch branch afterwards.


#### 6. Check that GitHub's runners can reach port 22

GitHub-hosted runners do not have fixed IP addresses (the published ranges are large and change), so allow-listing them in a firewall is impractical. If the VPS firewall or the hosting provider's firewall only allows your own IP on port 22, the first run will fail at the connection step with `Connection timed out`; that is the test. The protection then rests on three things, so confirm them on the VPS:

```bash
sshd -T | grep -Ei '^(passwordauthentication|kbdinteractiveauthentication)'
fail2ban-client status sshd
```

Both should show password logins disabled (`no`) and fail2ban active. The forced command (step 2) and the single-purpose key (step 1) limit what a connection can do. A self-hosted runner or a VPN is the stronger option later, if you want to close port 22 to the world.

#### 7. First run: dry-run, then deploy

1. Get the full sha of the commit to deploy: `git rev-parse origin/main` or the copy-full-SHA button on the commit in GitHub.
2. **Actions > Deploy > Run workflow**: branch `main`, mode `dry-run` (the default), paste the sha. A reviewer approves the `production` environment. Read the output: it must end with `DRYRUN OK`. (If the VPS is already at that sha it prints `ALREADY DEPLOYED`: pick a newer sha.)
3. Once that dry-run has worked once, delete the local private key copy; GitHub holds the only one:

```powershell
Remove-Item "$env:USERPROFILE\.ssh\requital_gha_deploy"
```

(Keep the `.pub` file if you like.)
4. Run the workflow again with mode `deploy` and the SAME sha, within 24 hours. The output ends with `DEPLOY_RESULT=OK`. Write down `PREVIOUS_SHA`.
5. Do the manual `testadmin` smoke with a temporary staff user, as before, and remove the user afterwards.

Mode `status` shows how the last run ended, which is the thing to run after a dropped connection.

### Operating notes

- **A renamed CI job makes deploys fail closed.** The gate matches the five check names exactly, from the list in `tools/deploy/lib/check-runs.js`. A test (`tools/deploy/test/ci-job-names.test.js`) fails in CI when `ci.yml` and that list disagree, so rename a job and update the list in the same pull request. The same applies to adding a sixth required check.
- **Failure behaviour.** A refusal (`DEPLOY_RESULT=REFUSED`, exit 2) changed nothing. `FAILED step=<n>` after step 8 means the new code is merged on disk; the output ends with the exact rollback instruction. A checksum mismatch at step 9 deliberately restarts nothing, so the old processes keep serving.
- **Protected rows (steps 7 and 9).** Before the migrations the script stores an MD5 per row of the protected tables (orders, order items, payment transactions, shops, customers, gift cards, stock movements, stock consumption) and the money columns of every order; after them it compares row by row. A migration that only adds things must leave those rows alone, but the shop keeps trading during a deploy, so the rules are: (1) an order whose money columns changed in the window counts as edited by the shop, and the replaced item and consumption rows of an edited order are tolerated; but more than max(10, about 1% of the orders) edited orders is NOT trading, it is fatal, and so is anything else that changed; (2) gift cards are tolerated when their `updatedAt` moved; (3) a few changed or deleted customers (merges) are tolerated up to the same cap; (4) columns that a merchant or a customer merge can rewrite without a trace are compared with a cap of their own instead of being ignored: shop currency, timezone, domain type and country (at most 2 shops), `order.customerId` and `giftcard.purchasedByCustomerId` (at most max(100, 5%) rows); (5) shops are otherwise judged on `id` and `subdomain`. Tables without a trustworthy `updatedAt` use only columns that cannot change after creation. Each dump must also match the table's `COUNT(*)` and may not be empty when the table has rows. The dry-run runs every one of these queries once with `LIMIT 1`, so a wrong column name fails the dry-run instead of the real run. The run prints how many rows it tolerated. A STOP leaves the new code merged on disk and the schema migrated while the old processes keep serving: investigate before restarting anything.
- **The billing flag matrix compares the per-shop key intersection, not the whole document (lesson from the first real deploy).** The matrix script runs the `FeaturesService` of the tree it is run from: BEFORE the migrations that is the OLD code (11 feature keys), AFTER it is the NEW code (14). The two documents can never be equal when a release adds a feature key, and the first version of this gate compared them whole, so it stopped at step 9 with "billing flag matrix differs" although no shop's flag had changed. `tools/deploy/lib/matrix-diff.js` now requires: every key present on both sides has the same value for every shop (any change fails, closed); every key that exists only AFTER is `false` for every shop (the new keys are printed); a key that vanished fails; the shop set, the `shop` checksum and the `shopfeatureoverride` checksum are identical; and `shop.suspensionReason` (added and backfilled by the billing migrations, so it is checksummed on its own and only when the column exists) is identical when it exists on both sides, or, when the migration adds it, no suspended shop is left without a reason. On any mismatch the run prints each difference (`MISMATCH shop=<id> feature=<key> before=<x> after=<y>`) BEFORE stopping, and writes both documents to `$LOG_DIR/matrix-<utc>-<sha7>-before.json` and `-after.json` (private mode). The script itself must be run before the migrations only from the old checkout and after them from the new one; running the new code against a pre-billing schema fails on the missing `shopsubscription` table.
- **HEAD already equals the sha (resume rules).** Every REAL run appends one line to `$LOG_DIR/run-state`: `<utc> <sha> REAL <OK|FAILED> step=<n> prev=<the commit that was running before>`. A dry-run or a refusal records nothing. When you run a sha that is already HEAD: if the last real run for it ended **OK** (or nothing is recorded, a manual deploy) the answer is `ALREADY DEPLOYED`; if it **FAILED at step 10 or later** (builds, restarts, smoke: the migrations and the data gates of step 9 had passed) the run goes into **RESUME mode**: no backup, no merge, no migration, no data gates, it rebuilds storefront/admin, restarts the apps that changed since `prev`, smoke-tests and records OK. Resume still needs a fresh dry-run of the sha first, and is refused (nothing changed) when a migration is pending or `backend/dist/main.js` is missing. If it **FAILED at step 9 or earlier** it is never resumed, because the gate that stopped it may be exactly what failed: fix forward with a NEWER commit (its gates run against the already-migrated database) or run `rollback.sh` to `prev` (code only). The deploy that stopped on the matrix is that case. Three more cases are refused, never guessed: a last line of `STARTED` (the run was killed hard, e.g. SIGKILL, OOM or a reboot, which skip every trap; each real run writes `STARTED` before it changes anything), a `ROLLED_BACK` line (written by `rollback.sh` for the commit it rolled back, so a stale `FAILED` line cannot resume it later), and any malformed line; in all of them the state of the services is unknown. A run that failed at **step 13** (`.env` fingerprints changed) is not resumed either, because the resume would take the changed `.env` as its new baseline. A resume starts with the normal preflight, so a pm2 process that is `errored` or `stopped` must be fixed first (`pm2 restart <name>`), or use `rollback.sh`.
- **What the row check does not catch (residuals, stated plainly).** It is a tripwire, not a proof. A damaging migration that touches no more rows than a cap allows (up to 10 or about 1% of the orders, up to 10 or about 1% of the customers, up to 2 shops, up to max(100, 5%) customer references) passes. For a small table the floors dominate: with fewer than about 1000 orders the floor of 10 is more than 1%, and a table of 10 rows or fewer can be rewritten completely and still pass its capped rule. Columns that are not in the hash are not checked at all. The dry-run and the code that runs on the VPS (`deploy.sh`) come from the commit being deployed, so a commit that is already on `main` can weaken its own gates; what stops that is branch protection and review on `main`, not this pipeline. The workflow's CI gate accepts check runs only from the GitHub Actions app (slug `github-actions`, id 15368); that excludes third-party apps and anyone posting a check run through another token, but it does not exclude a malicious change to a workflow in this repository, which still runs as that app. Anyone holding the SSH key can skip the gate job altogether (see "Risks and mitigations").
- **Rollback targets.** `rollback` accepts only commits listed in `/home/deploy/deploy-logs/deployed-shas`, an append-only file written by `deploy.sh`: the commit that is running now is recorded just BEFORE the merge of step 8 (so the rollback command a failed deploy prints is always usable), and the new commit after a successful deploy. A commit that was deployed by hand is not in the file: roll that back by hand, or add a line `<sha> <utc time> manual` yourself. The commit must also still be an ancestor of the checkout's HEAD and reachable from `origin/main`. A rollback is the repair path, so it does not insist on a healthy system: if `git fetch` fails (in the entry script, and again in `rollback.sh`) it warns and carries on with the `origin/main` already on disk, and a pm2 process that is errored or stopped is a warning, not a refusal (only a process that does not exist at all stops it). `deploy.sh` stays strict: all three processes must be online.
- **Manual path.** Everything in CLAUDE.md "VPS deploy" still works unchanged, and `tools/deploy/deploy.sh <sha>` can be run on the VPS by hand as `deploy` (it takes the same lock and writes the same log).
- **Rollback needs `tools/deploy` in the VPS checkout**, which it has after the first deploy that includes the pipeline. Until then use the manual path.
- **The scratch restore needs privileges.** The drill creates a database named like the app database plus `_drill`; the `deploy` database user needs permission to create and drop that one name. If step 6 reports a permission error, grant it once in MySQL as an administrator (the grant is on the `_drill` database only). The failed run changed nothing.

### Risks and mitigations

**What the SSH key can do.** Whoever holds the key (the `DEPLOY_SSH_KEY` secret, or any copy of the private key file) can connect directly, without GitHub in the loop, and run `deploy <sha> --dry-run` followed by `deploy <sha> --ci-verified` for ANY sha that is an ancestor of `origin/main`, and `rollback` to any recorded sha. That bypasses the workflow's gate job and the `production` reviewer entirely. The VPS holds no GitHub token and cannot check CI itself, so `--ci-verified` is advisory on the VPS side: it is a statement by the caller, not a proof. What the key cannot do: run a commit that is not on `origin/main` (the entry script checks), run any other command, get a shell, forward ports.

So a compromise of GitHub Actions, of the repository settings or of the `production` secrets gives an attacker exactly this: the power to deploy or roll back to commits that are already on `main`. What stops bad code from getting onto `main` is branch protection (pull requests and the required checks) and not this pipeline.

Mitigations: keep the key only as an Environment secret of `production` (no repository or organisation copy, and delete the local copy on your PC after the first dry-run); a required reviewer on the environment, and "selected branches: main" as the deployment-branch rule (see step 5); the forced command with `restrict`; the sha-on-`main` and five-green-checks gate in the workflow; the mandatory dry-run; the pinned host key; rotate the key from time to time and whenever someone with access to the repository settings leaves (generate a new key, replace the line in `authorized_keys`, replace the secret); revoke at once by deleting the `authorized_keys` line.

### Revoking access

Delete the `requital-gha-deploy` line from `/home/deploy/.ssh/authorized_keys` on the VPS (`nano`, delete the line, save). The key stops working immediately. Then delete the four secrets and, if you want, the `production` environment on GitHub.

### Not verified

Everything above was tested against fakes and real temporary git repositories, never against the VPS, GitHub or a real SSH connection. In particular unconfirmed: the real VPS paths and pm2 names, the `deploy` database user's rights for the scratch restore, how the VPS's sshd treats `restrict` with `command=`, port 22 reachability from GitHub runners, environment reviewer behaviour, the Actions token reading check runs, a real SSH disconnect during a deploy, build timings, and the shellcheck version on the runner. Treat the first dry-run as the real test.

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
| `20261024100000_user_must_enrol_2fa` | Schema-only, additive | `ALTER TABLE user DROP COLUMN mustEnrol2fa`. A user who was waiting to re-enrol after a platform reset is no longer confined (their 2FA was already removed), so roll the backend back first or support must re-check those users. |
| `20261119100000_maps_degradation` | Schema-only, additive | `DROP TABLE mapserrorlog; ALTER TABLE \`order\` DROP COLUMN addressUnverified`. Orders flagged "address not verified" lose the flag (the packing slip and admin order card stop warning). Roll the backend back first: it inserts `addressUnverified` on every storefront order. |

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

### S1a (2026-10-08): platform-admin reset of a shop user's two-factor

Migration `20261024100000_user_must_enrol_2fa` (additive `user.mustEnrol2fa`, default 0). Deploy order: migrate, backend, admin. No env var. See the recovery section above.

### Added since `b9aed0f7` (the UI fix batch, 2026-10-03)

One migration, additive: `20261023100000_survey_publish_consent` (two nullable columns and one index on `surveyresponse`, no backfill). **Order: migrate, backend, storefront, admin**: the new storefront survey form sends `publishConsent`, which an old backend's whitelist pipe would 400. Production theme data is untouched, but a shop on the Bloom template with the old manual testimonial blocks loses that section (the blocks are ignored, not deleted) until a review is approved under Customers > Reviews. Smoke checks: `GET /public/<testadmin slug>/reviews/featured` returns `[]` or the approved reviews with exactly four keys; Settings > Business > Information on a phone-width window shows the two-column settings with the content skeleton while it loads.
