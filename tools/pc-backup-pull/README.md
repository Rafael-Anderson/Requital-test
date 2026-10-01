# Off-host backup pull (Windows PC)

Nightly production database dumps are written on the VPS by
`/etc/cron.d/requital-backup` → `tools/backup-cron.sh`, into
`/home/deploy/backups/requital-shop_manager-YYYYMMDDHHMMSS.sql.gz`.

That cron's own off-host step has been a no-op in production: with no
`BACKUP_S3_BUCKET` in `/home/deploy/.requital-backup.env` it logs
`WARNING: ... exists on this VPS ONLY` and skips both the `rclone` copy *and* the
local prune. So every dump lived in exactly one place, on the machine whose loss
is the reason backups exist. This tool is the second place.

**Pull, not push.** The PC reaches into the VPS; the VPS holds no credential for
the PC and cannot initiate anything. Compromising the VPS therefore does not get
an attacker into the backup copy, and does not let them delete it.

## How it works

```
Windows PC                                     VPS
-----------                                    ---
Task Scheduler 04:30 Dubai
  └─ Pull-RequitalBackups.ps1
       ssh requital-backup-pull list     ──►  forced command:
       ssh requital-backup-pull sum <f>  ──►  /usr/local/bin/requital-backup-serve
       ssh requital-backup-pull get <f>  ──►  (list | sum | get, nothing else)
       │
       ├─ sha256 (Get-FileHash) == remote sum
       ├─ gzip decompresses end to end
       ├─ decompressed head looks like a mysqldump
       └─ only then: <name>.part → <name>
```

A download lives under `<name>.sql.gz.part` until all three checks pass. `.part`
does not match the dump-name pattern, so a partial file is invisible to retention
and to anything else reading the folder — a truncated dump can never masquerade as
a good one.

## What is where

| Thing | Path |
|---|---|
| Dumps, log, success marker | `C:\RequitalBackups` |
| Installed scripts (run by the tasks) | `C:\ProgramData\Requital\backup-pull` |
| SSH private key | `%USERPROFILE%\.ssh\requital_backup_pull` |
| SSH host alias | `%USERPROFILE%\.ssh\config` → `requital-backup-pull` |
| Scheduled tasks | `Requital Backup Pull`, `Requital Backup Freshness Check` |
| Server-side serve script | `/usr/local/bin/requital-backup-serve` (root:root, 0755) |
| Server-side key grant | one line in `/home/deploy/.ssh/authorized_keys` |

The scheduled tasks deliberately point at `C:\ProgramData\...`, **not** at this
repo: a task wired into a git working tree breaks the moment someone switches
branch.

## Install / reproduce

```powershell
# 1. copy the scripts out of the repo to the install path
$dst = 'C:\ProgramData\Requital\backup-pull'
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item .\tools\pc-backup-pull\*.ps1 $dst -Force
icacls $dst /inheritance:r /grant:r "$env:USERDOMAIN\$env:USERNAME:(OI)(CI)F"

# 2. register both scheduled tasks (safe to re-run; it replaces them)
& $dst\Install-Tasks.ps1 -BackupRoot 'C:\RequitalBackups' -ScriptRoot $dst

# 3. one manual run to prove it end to end
& $dst\Pull-RequitalBackups.ps1 -BackupRoot 'C:\RequitalBackups'
```

The SSH key and the server-side grant are **not** created by these scripts —
they are one-time setup, documented in `docs/runbook.md`.

## The two tasks

**`Requital Backup Pull`** — daily 04:30 local (this PC is UTC+4, so 04:30 Dubai),
about 90 minutes after the 23:00 UTC dump. Starts as soon as possible after a
missed start, retries 3 times at 10-minute intervals, and only runs when a network
is available.

**`Requital Backup Freshness Check`** — daily 12:00 local. Alerts visibly if the
newest dump is older than 30 hours, or `last-success.txt` is older than 36 hours.
Two separate tests because they fail differently: the first catches "the server
stopped producing / we stopped being able to fetch", the second catches "the pull
itself is erroring" (it refuses to touch the marker on a failed run).

### Logon type: interactive only

`Install-Tasks.ps1` tries `-LogonType S4U` first — run whether or not the user is
logged on, with no stored password. On this PC (Windows 11 Home, non-elevated)
registration returns **Access is denied**, and the script falls back to
`Interactive` and says so. Consequence, stated plainly:

> **The pull does not run while nobody is logged on.** After a restart it runs at
> the next logon (`StartWhenAvailable` fires the missed 04:30), not before.

To get true unattended operation, re-run `Install-Tasks.ps1` from an **elevated**
PowerShell; S4U registration needs elevation. Read its output rather than assuming
— it prints which logon type it actually got.

The freshness check is intentionally `Interactive` regardless: its job is to put
something on a screen, which needs a session to put it in.

### Notifications

The alert prefers a Windows toast, but checks `HKCU\...\PushNotifications\ToastEnabled`
first. On this PC that value is `0` — notifications are switched off for the user,
and the WinRT call still reports success while nothing appears on screen. A silent
alert is worse than no alert, because the log then reads as healthy. So when
notifications are off it drops straight to a modal `MessageBox`, which cannot be
suppressed. No third-party modules either way.

## Self-test

```powershell
.\Pull-RequitalBackups.ps1 -SelfTest
```

Assertion-based, no framework, no network, no server, and no real dump touched. It
exists because the branch that *deletes* backups is the one a real run never
exercises: the folder holds 24 dumps, all inside "newest 30", so the Sunday ladder
and the prune set would otherwise ship unexecuted. It covers the 30+12 selection on
120 synthetic daily dumps, the under-the-limit and empty cases, dump-name parsing
(including rejecting `.part`), and `Test-GzipIntegrity` accepting a good archive
while rejecting both a truncated one and a valid gzip of the wrong content.

## Retention

Keeps the newest **30** dumps, plus up to **12** Sunday-dated dumps older than
those — a weekly ladder, so a fault that went unnoticed for a month is still
recoverable from before it started. Nothing else is ever deleted.

Pruning is gated. It only happens when the run has positive evidence that pulling
works: either it pulled and verified at least one file this run, or the newest
local dump is under 48 hours old *and* passes re-verification on the spot. Failing
that, retention is skipped and logged, and nothing is deleted. An over-full backup
folder is a nuisance; an empty one is the disaster.

## Known gap: the backup folder is not encrypted at rest

**Backup folder is on an unencrypted drive: customer PII at rest; mitigations
applied: ACL-locked, non-synced, indexing off, bounded retention.**

`C:` is fully decrypted with BitLocker protection off, confirmed with
`manage-bde -status`, and the owner has decided not to enable it. The dumps
contain customer names, phone numbers, email addresses and delivery addresses, so
this is a real and accepted exposure: anyone with physical access to this PC, or
administrator rights on it, can read production customer data. The mitigations
above reduce the blast radius; they do not encrypt anything.

What the mitigations actually are:

- **ACL-locked** — `C:\RequitalBackups`, `C:\ProgramData\Requital\backup-pull` and
  `%USERPROFILE%\.ssh` each have inheritance removed and grant only
  `RAFAEL\Rohaan Ahmed`. Administrators and SYSTEM were removed as well. (Note
  that a local administrator can still take ownership; this raises the bar, it is
  not a boundary.)
- **Non-synced** — `C:\RequitalBackups` is outside the user profile, outside
  OneDrive, and outside Desktop/Documents/Pictures. OneDrive known-folder backup
  is off on this PC and no other sync client is running, so the dumps are not
  copied to any cloud.
- **Indexing off** — the folder carries the `NotContentIndexed` attribute, so
  Windows Search does not index dump contents.
- **Bounded retention** — 30 daily + 12 Sunday caps how much PII sits at rest
  instead of letting it accumulate indefinitely.

## Removing all of this

See the "Removing the PC backup pull" subsection in `docs/runbook.md`.

## Restoring from this copy

See the "Restoring from the PC copy" subsection in `docs/runbook.md`.
