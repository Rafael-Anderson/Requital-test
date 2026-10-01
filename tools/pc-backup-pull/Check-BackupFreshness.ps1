<#
.SYNOPSIS
    Warns, visibly, when the local Requital backup copy has gone stale.

.DESCRIPTION
    The failure this exists to catch is silence. The VPS's own off-host copy was
    skipped for weeks and the only trace was a WARNING line in a log nobody opened,
    so "the pull broke" must produce something a human actually sees.

    Two independent staleness tests, because they fail differently:
      * newest dump older than -MaxDumpAgeHours  -> the server stopped producing,
        or we stopped being able to fetch
      * last-success.txt older than -MaxSuccessAgeHours -> the pull itself is
        erroring (it refuses to touch the marker on a failed run)

    Notifications use only what ships with Windows: a toast via the WinRT
    ToastNotificationManager, falling back to a WinForms dialog if toasts are
    unavailable. No modules to install.

.PARAMETER BackupRoot
    The folder Pull-RequitalBackups.ps1 writes to.

.EXAMPLE
    .\Check-BackupFreshness.ps1 -BackupRoot 'D:\RequitalBackups'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $BackupRoot,

    [int] $MaxDumpAgeHours = 30,

    [int] $MaxSuccessAgeHours = 36,

    # For testing the alert path without waiting for a real outage.
    [switch] $ForceAlert
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$NamePattern = '^requital-shop_manager-(\d{14})\.sql\.gz$'
$logPath = Join-Path $BackupRoot 'pull.log'

function Write-CheckLog {
    param([string] $Message, [string] $Level = 'INFO')
    $line = "$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')) [$Level] freshness-check: $Message"
    Write-Host $line
    try { Add-Content -LiteralPath $logPath -Value $line -Encoding utf8 } catch { }
}

function Show-Alert {
    param([string] $Title, [string] $Body)

    # A toast is only worth attempting if toasts are actually switched on. This PC
    # had HKCU ToastEnabled = 0, and the WinRT call still "succeeded" while nothing
    # whatsoever appeared on screen - a silent alert is worse than no alert, because
    # it reads as healthy in the log. So check the setting first and drop straight
    # to the dialog when notifications are off.
    $toastsOn = $true
    try {
        $reg = Get-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\PushNotifications' -ErrorAction SilentlyContinue
        if ($null -ne $reg -and $null -ne $reg.ToastEnabled -and [int]$reg.ToastEnabled -eq 0) { $toastsOn = $false }
        $reg2 = Get-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Notifications\Settings' -ErrorAction SilentlyContinue
        if ($null -ne $reg2 -and $null -ne $reg2.NOC_GLOBAL_SETTING_TOASTS_ENABLED -and [int]$reg2.NOC_GLOBAL_SETTING_TOASTS_ENABLED -eq 0) { $toastsOn = $false }
    } catch { }
    if (-not $toastsOn) {
        Write-CheckLog 'Windows notifications are disabled for this user - using a dialog instead of a toast' 'WARN'
    }

    # Preferred when available: a real Windows toast. It lands in Notification
    # Centre, so it survives being missed on screen.
    try {
        if (-not $toastsOn) { throw 'toasts disabled by user setting' }
        [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
        [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
        $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
        $xml = @"
<toast scenario="reminder">
  <visual><binding template="ToastGeneric">
    <text>$([System.Security.SecurityElement]::Escape($Title))</text>
    <text>$([System.Security.SecurityElement]::Escape($Body))</text>
  </binding></visual>
</toast>
"@
        $doc = [Windows.Data.Xml.Dom.XmlDocument]::new()
        $doc.LoadXml($xml)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show(
            [Windows.UI.Notifications.ToastNotification]::new($doc))
        Write-CheckLog 'alert shown via Windows toast' 'WARN'
        return
    } catch {
        Write-CheckLog "toast unavailable ($($_.Exception.Message)); falling back to dialog" 'WARN'
    }

    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($Body, $Title,
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
        Write-CheckLog 'alert shown via WinForms dialog' 'WARN'
    } catch {
        Write-CheckLog "COULD NOT SHOW ANY ALERT: $($_.Exception.Message)" 'ERROR'
    }
}

$problems = @()
$nowUtc = (Get-Date).ToUniversalTime()

if (-not (Test-Path -LiteralPath $BackupRoot)) {
    $problems += "backup folder is missing: $BackupRoot"
} else {
    $dumps = @(
        Get-ChildItem -LiteralPath $BackupRoot -File -Filter '*.sql.gz' -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match $NamePattern }
    )
    if ($dumps.Count -eq 0) {
        $problems += 'no dumps in the local backup folder at all'
    } else {
        $newest = $dumps | Sort-Object -Property @{ e = {
            [datetime]::ParseExact([regex]::Match($_.Name, $NamePattern).Groups[1].Value,
                'yyyyMMddHHmmss', [System.Globalization.CultureInfo]::InvariantCulture,
                [System.Globalization.DateTimeStyles]::AssumeUniversal -bor
                [System.Globalization.DateTimeStyles]::AdjustToUniversal)
        } } -Descending | Select-Object -First 1
        $stamp = [datetime]::ParseExact([regex]::Match($newest.Name, $NamePattern).Groups[1].Value,
            'yyyyMMddHHmmss', [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::AssumeUniversal -bor
            [System.Globalization.DateTimeStyles]::AdjustToUniversal)
        $ageH = [math]::Round(($nowUtc - $stamp).TotalHours, 1)
        if ($ageH -gt $MaxDumpAgeHours) {
            $problems += "newest dump is ${ageH}h old (limit ${MaxDumpAgeHours}h): $($newest.Name)"
        } else {
            Write-CheckLog "newest dump $($newest.Name) is ${ageH}h old - within ${MaxDumpAgeHours}h"
        }
    }

    $marker = Join-Path $BackupRoot 'last-success.txt'
    if (-not (Test-Path -LiteralPath $marker)) {
        $problems += 'last-success.txt is missing - no pull has ever fully succeeded'
    } else {
        $mAgeH = [math]::Round(($nowUtc - (Get-Item -LiteralPath $marker).LastWriteTimeUtc).TotalHours, 1)
        if ($mAgeH -gt $MaxSuccessAgeHours) {
            $problems += "last successful pull was ${mAgeH}h ago (limit ${MaxSuccessAgeHours}h)"
        } else {
            Write-CheckLog "last-success.txt is ${mAgeH}h old - within ${MaxSuccessAgeHours}h"
        }
    }
}

if ($ForceAlert) { $problems += 'forced test alert (-ForceAlert) - not a real staleness condition' }

if ($problems.Count -gt 0) {
    $body = ($problems -join "`n") + "`n`nFolder: $BackupRoot"
    Write-CheckLog "STALE: $($problems -join ' | ')" 'ERROR'
    Show-Alert -Title 'Requital backup copy is stale' -Body $body
    exit 1
}

Write-CheckLog 'backup copy is fresh' 'OK'
exit 0
