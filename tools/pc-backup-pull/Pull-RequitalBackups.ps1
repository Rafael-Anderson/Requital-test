<#
.SYNOPSIS
    Pulls Requital's nightly database dumps from the production VPS to this PC.

.DESCRIPTION
    The off-host half of the backup story. The VPS's own cron writes dumps to
    /home/deploy/backups and (today) copies them nowhere, so a lost VPS is a lost
    backup. This script pulls them down over a key that can do nothing else: the
    server side is pinned to the forced command /usr/local/bin/requital-backup-serve,
    which answers only `list`, `sum <file>` and `get <file>`.

    PULL, not push: the VPS holds no credential for this PC and cannot reach it, so
    compromising the VPS does not get an attacker into the backup copy.

    A file is only ever moved into place after it passes three checks:
      1. SHA-256 computed locally matches the server's own `sum`
      2. the gzip stream decompresses end to end
      3. the decompressed head looks like a mysqldump
    Until all three pass the download sits under a .part name, so a partial or
    corrupt file can never appear under a real dump name.

.PARAMETER BackupRoot
    Destination folder. Dumps, the log and last-success.txt all live here.

.PARAMETER SshAlias
    The ~/.ssh/config Host alias to use. Must be the restricted backup key, never
    an admin key.

.PARAMETER KeepNewest
    How many of the newest dumps to keep regardless of weekday.

.PARAMETER KeepSundays
    How many additional Sunday-dated dumps to keep beyond KeepNewest.

.EXAMPLE
    .\Pull-RequitalBackups.ps1 -BackupRoot 'D:\RequitalBackups'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $BackupRoot,

    [string] $SshAlias = 'requital-backup-pull',

    [int] $KeepNewest = 30,

    [int] $KeepSundays = 12
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The dump name shape, matched identically on the server. Anything else is not a
# dump and is never downloaded, hashed, verified or deleted.
$script:NamePattern = '^requital-shop_manager-(\d{14})\.sql\.gz$'

$script:LogPath = $null
$script:Errors = 0
$script:LogWriteFailed = $false

function Write-Log {
    param(
        [Parameter(Mandatory = $true)][string] $Message,
        [ValidateSet('INFO', 'WARN', 'ERROR', 'OK')][string] $Level = 'INFO'
    )
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $line = "$stamp [$Level] $Message"
    if ($Level -eq 'ERROR') { $script:Errors++ }
    switch ($Level) {
        'ERROR' { Write-Host $line -ForegroundColor Red }
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        'OK'    { Write-Host $line -ForegroundColor Green }
        default { Write-Host $line }
    }
    if ($script:LogPath) {
        # A locked or full log must not cost us the backup, but it must not be
        # invisible either: silent log loss is the exact failure mode this tool
        # exists to end. Complain once per run, to the console, then carry on.
        try {
            Add-Content -LiteralPath $script:LogPath -Value $line -Encoding utf8
        } catch {
            if (-not $script:LogWriteFailed) {
                $script:LogWriteFailed = $true
                Write-Host "WARNING: cannot write the log file $($script:LogPath): $($_.Exception.Message)" -ForegroundColor Magenta
            }
        }
    }
}

function Get-DumpTimestampUtc {
    <# Parses the timestamp out of the FILENAME, not the file's mtime: a copied or
       restored file keeps its name but not its mtime, and the name is what the
       server generated. Returns $null if the name is not a dump name. #>
    param([Parameter(Mandatory = $true)][string] $Name)
    $m = [regex]::Match($Name, $script:NamePattern)
    if (-not $m.Success) { return $null }
    try {
        return [datetime]::ParseExact(
            $m.Groups[1].Value, 'yyyyMMddHHmmss',
            [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::AssumeUniversal -bor
            [System.Globalization.DateTimeStyles]::AdjustToUniversal)
    } catch { return $null }
}

function Invoke-ServeText {
    <# Runs one serve command and returns its stdout lines. Throws on non-zero
       exit, with the server's stderr as the message. #>
    param([Parameter(Mandatory = $true)][string] $Command)

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = 'ssh'
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    # .Arguments, not .ArgumentList: ArgumentList is .NET Core only and this runs
    # under Windows PowerShell 5.1. Safe to build by hand because $Command is only
    # ever "list", or a verb plus a name already matched against $NamePattern -
    # there is no quote or space to escape.
    $psi.Arguments = '{0} "{1}"' -f $SshAlias, $Command

    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEnd()
    $err = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) {
        throw "ssh '$Command' exited $($p.ExitCode): $($err.Trim())"
    }
    return $out -split "`r?`n" | Where-Object { $_ -ne '' }
}

function Invoke-ServeToFile {
    <# Streams `get <name>` straight to a file. The raw stdout BaseStream is copied
       to disk rather than passed through a PowerShell pipeline, which would treat
       the bytes as text and corrupt the archive. #>
    param(
        [Parameter(Mandatory = $true)][string] $Command,
        [Parameter(Mandatory = $true)][string] $Destination
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = 'ssh'
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    # .Arguments, not .ArgumentList: ArgumentList is .NET Core only and this runs
    # under Windows PowerShell 5.1. Safe to build by hand because $Command is only
    # ever "list", or a verb plus a name already matched against $NamePattern -
    # there is no quote or space to escape.
    $psi.Arguments = '{0} "{1}"' -f $SshAlias, $Command

    $p = [System.Diagnostics.Process]::Start($psi)
    $fs = [System.IO.File]::Create($Destination)
    try {
        $p.StandardOutput.BaseStream.CopyTo($fs)
    } finally {
        $fs.Dispose()
    }
    $err = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) {
        throw "ssh '$Command' exited $($p.ExitCode): $($err.Trim())"
    }
}

function Test-GzipIntegrity {
    <# Reads the whole gzip stream, so truncation and bit rot both surface here
       rather than at 3am during a restore. Also confirms the decompressed head
       really is a mysqldump: a valid gzip of the wrong content is still a useless
       backup. Returns a result object instead of throwing. #>
    param([Parameter(Mandatory = $true)][string] $Path)

    $bytes = 0L
    $head = ''
    try {
        $fs = [System.IO.File]::OpenRead($Path)
        try {
            $gz = [System.IO.Compression.GZipStream]::new($fs, [System.IO.Compression.CompressionMode]::Decompress)
            try {
                $buffer = [byte[]]::new(1MB)
                while (($read = $gz.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    if ($bytes -eq 0) {
                        $head = [System.Text.Encoding]::ASCII.GetString($buffer, 0, [Math]::Min($read, 200))
                    }
                    $bytes += $read
                }
            } finally { $gz.Dispose() }
        } finally { $fs.Dispose() }
    } catch {
        return [pscustomobject]@{ Ok = $false; Bytes = $bytes; Reason = "gzip stream failed: $($_.Exception.Message)" }
    }

    if ($bytes -eq 0) {
        return [pscustomobject]@{ Ok = $false; Bytes = 0; Reason = 'archive decompressed to zero bytes' }
    }
    if ($head -notmatch 'MySQL dump|CREATE TABLE|SET @@') {
        return [pscustomobject]@{ Ok = $false; Bytes = $bytes; Reason = 'decompressed head does not look like a mysqldump' }
    }
    return [pscustomobject]@{ Ok = $true; Bytes = $bytes; Reason = 'ok' }
}

function Protect-Folder {
    <# Restricts the backup folder to this user. These are customer-PII dumps; on a
       shared machine the default profile ACL is not enough. #>
    param([Parameter(Mandatory = $true)][string] $Path)
    try {
        $me = "$env:USERDOMAIN\$env:USERNAME"
        # Folder only, NO /T. (OI)(CI) are inheritance flags: on a FOLDER they mean
        # "this folder plus everything created under it", but applied directly to a
        # FILE they produce an inherit-only ACE that grants nobody any access - which
        # silently locked this script out of its own log and dumps once. Children get
        # their access by inheriting this ACE, so recursing is both unnecessary and
        # actively harmful.
        & icacls.exe $Path /inheritance:r /grant:r "${me}:(OI)(CI)F" | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Log "icacls returned $LASTEXITCODE while locking $Path" 'WARN' }
    } catch {
        Write-Log "could not lock folder ACL: $($_.Exception.Message)" 'WARN'
    }
}

# ---------------------------------------------------------------------------

if (-not (Test-Path -LiteralPath $BackupRoot)) {
    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
}
$BackupRoot = (Resolve-Path -LiteralPath $BackupRoot).Path
$script:LogPath = Join-Path $BackupRoot 'pull.log'
$markerPath = Join-Path $BackupRoot 'last-success.txt'

Write-Log "=== pull run starting (alias '$SshAlias' -> $BackupRoot) ==="
Protect-Folder -Path $BackupRoot

$pulled = 0
$verifiedThisRun = 0

try {
    $remote = @(Invoke-ServeText -Command 'list' | Where-Object { $_ -match $script:NamePattern } | Sort-Object)
    Write-Log "server lists $($remote.Count) dump(s)"
    if ($remote.Count -eq 0) { throw 'server listed no dumps at all - refusing to treat this as success' }

    $localNames = @(
        Get-ChildItem -LiteralPath $BackupRoot -File -Filter '*.sql.gz' -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty Name
    )
    $missing = @($remote | Where-Object { $localNames -notcontains $_ })
    Write-Log "$($localNames.Count) already local, $($missing.Count) to fetch"

    foreach ($name in $missing) {
        $final = Join-Path $BackupRoot $name
        # .part never matches the dump pattern, so an abandoned partial is invisible
        # to retention and to every consumer of this folder.
        $part = "$final.part"
        try {
            if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force }

            $remoteSum = (Invoke-ServeText -Command "sum $name" | Select-Object -First 1).Trim().ToLowerInvariant()
            if ($remoteSum -notmatch '^[0-9a-f]{64}$') { throw "server returned a malformed sha256: '$remoteSum'" }

            Invoke-ServeToFile -Command "get $name" -Destination $part
            $size = (Get-Item -LiteralPath $part).Length

            $localSum = (Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($localSum -ne $remoteSum) {
                throw "sha256 mismatch (remote $remoteSum / local $localSum) - download discarded"
            }

            $gz = Test-GzipIntegrity -Path $part
            if (-not $gz.Ok) { throw "gzip verification failed: $($gz.Reason)" }

            Move-Item -LiteralPath $part -Destination $final -Force
            $pulled++
            $verifiedThisRun++
            Write-Log "$name pulled ($size bytes, sha256 ok, gzip ok, $($gz.Bytes) bytes uncompressed)" 'OK'
        } catch {
            Write-Log "$name FAILED: $($_.Exception.Message)" 'ERROR'
            if (Test-Path -LiteralPath $part) {
                try { Remove-Item -LiteralPath $part -Force } catch { }
            }
        }
    }

    # --- retention ------------------------------------------------------------
    # Deleting a backup is the one irreversible thing here, so it needs positive
    # evidence that the pull side is healthy. Without it we keep everything: an
    # over-full backup folder is a nuisance, an empty one is the disaster.
    $allowPrune = $false
    $pruneReason = ''
    if ($verifiedThisRun -gt 0) {
        $allowPrune = $true
        $pruneReason = "$verifiedThisRun file(s) pulled and verified this run"
    } else {
        $newest = Get-ChildItem -LiteralPath $BackupRoot -File -Filter '*.sql.gz' |
            Where-Object { $_.Name -match $script:NamePattern } |
            Sort-Object -Property @{ e = { Get-DumpTimestampUtc $_.Name } } -Descending |
            Select-Object -First 1
        if ($newest) {
            $age = (Get-Date).ToUniversalTime() - (Get-DumpTimestampUtc $newest.Name)
            if ($age.TotalHours -lt 48) {
                # "Verified" has to mean verified, so re-check it rather than assume.
                $check = Test-GzipIntegrity -Path $newest.FullName
                if ($check.Ok) {
                    $allowPrune = $true
                    $pruneReason = "$($newest.Name) is $([math]::Round($age.TotalHours,1))h old and re-verified ok"
                } else {
                    $pruneReason = "newest local dump failed re-verification: $($check.Reason)"
                }
            } else {
                $pruneReason = "newest local dump is $([math]::Round($age.TotalHours,1))h old (>= 48h)"
            }
        } else {
            $pruneReason = 'no local dumps at all'
        }
    }

    if (-not $allowPrune) {
        Write-Log "retention SKIPPED - $pruneReason; nothing deleted" 'WARN'
    } else {
        $dumps = @(
            Get-ChildItem -LiteralPath $BackupRoot -File -Filter '*.sql.gz' |
                Where-Object { $_.Name -match $script:NamePattern } |
                ForEach-Object {
                    [pscustomobject]@{
                        File = $_
                        Name = $_.Name
                        Stamp = Get-DumpTimestampUtc $_.Name
                    }
                } | Sort-Object -Property Stamp -Descending
        )

        $keep = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($d in ($dumps | Select-Object -First $KeepNewest)) { [void]$keep.Add($d.Name) }

        # Sunday dumps beyond the newest N: a cheap weekly ladder, so a fault that
        # went unnoticed for a month is still recoverable from before it started.
        $sundays = @(
            $dumps | Where-Object { -not $keep.Contains($_.Name) -and $_.Stamp.DayOfWeek -eq 'Sunday' } |
                Select-Object -First $KeepSundays
        )
        foreach ($d in $sundays) { [void]$keep.Add($d.Name) }

        $prune = @($dumps | Where-Object { -not $keep.Contains($_.Name) })
        Write-Log "retention: $($dumps.Count) dump(s) local; keeping $($keep.Count) (newest $KeepNewest + $($sundays.Count) Sunday); pruning $($prune.Count) - $pruneReason"
        foreach ($d in $prune) {
            try {
                Remove-Item -LiteralPath $d.File.FullName -Force
                Write-Log "pruned $($d.Name)"
            } catch {
                Write-Log "could not prune $($d.Name): $($_.Exception.Message)" 'ERROR'
            }
        }
    }
} catch {
    Write-Log "run aborted: $($_.Exception.Message)" 'ERROR'
}

$localFinal = @(
    Get-ChildItem -LiteralPath $BackupRoot -File -Filter '*.sql.gz' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match $script:NamePattern }
)
Write-Log "run complete: $pulled pulled, $($localFinal.Count) dump(s) held locally, $script:Errors error(s)"

if ($script:Errors -eq 0 -and $localFinal.Count -gt 0) {
    # Only a clean run touches the marker - Task 2 watches it, and a marker written
    # on a partly failed run is exactly the silent failure this exists to catch.
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    Set-Content -LiteralPath $markerPath -Encoding utf8 -Value @(
        $stamp
        "pulled=$pulled"
        "local_dumps=$($localFinal.Count)"
        "newest=$(($localFinal | Sort-Object -Property @{ e = { Get-DumpTimestampUtc $_.Name } } -Descending | Select-Object -First 1).Name)"
    )
    Write-Log "last-success.txt updated ($stamp)" 'OK'
    exit 0
}

Write-Log 'run had errors - last-success.txt deliberately NOT updated' 'ERROR'
exit 1
