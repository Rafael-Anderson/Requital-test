<#
.SYNOPSIS
    Creates (or recreates) the two Scheduled Tasks that run the off-host backup pull.

.DESCRIPTION
    Reproducible on purpose: tasks poked into existence by hand in the GUI are tasks
    nobody can rebuild after a reinstall. Re-running this script is safe - each task
    is unregistered and registered again.

    Task 1  Requital Backup Pull        daily 04:30 local (= Dubai on this PC)
    Task 2  Requital Backup Freshness   daily 12:00 local, visible alert if stale

    Task 1 is attempted with -LogonType S4U first, which runs without a stored
    password and without the user being logged on. S4U needs the "Log on as a batch
    job" right, which Windows Home does not always grant, so the script falls back
    to Interactive and TELLS YOU which one it got. Do not assume unattended works:
    read the output.

.PARAMETER BackupRoot
    Destination folder for dumps (passed through to both scripts).

.PARAMETER ScriptRoot
    Where the installed copies of the .ps1 files live. This should NOT be the git
    working tree - a task pointing into a checkout breaks the moment you switch
    branch.

.EXAMPLE
    .\Install-Tasks.ps1 -BackupRoot 'D:\RequitalBackups' -ScriptRoot 'C:\ProgramData\Requital\backup-pull'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $BackupRoot,
    [Parameter(Mandatory = $true)][string] $ScriptRoot,
    [string] $PullTaskName = 'Requital Backup Pull',
    [string] $CheckTaskName = 'Requital Backup Freshness Check',
    [string] $PullAt = '04:30',
    [string] $CheckAt = '12:00'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pullScript = Join-Path $ScriptRoot 'Pull-RequitalBackups.ps1'
$checkScript = Join-Path $ScriptRoot 'Check-BackupFreshness.ps1'
foreach ($s in @($pullScript, $checkScript)) {
    if (-not (Test-Path -LiteralPath $s)) { throw "missing installed script: $s (copy the repo folder to -ScriptRoot first)" }
}

$me = "$env:USERDOMAIN\$env:USERNAME"
$psExe = Join-Path $PSHOME 'powershell.exe'

function Remove-TaskIfPresent {
    param([string] $Name)
    if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
        Write-Host "removed existing task '$Name'"
    }
}

# --- Task 1: the pull -------------------------------------------------------
Remove-TaskIfPresent -Name $PullTaskName

$pullAction = New-ScheduledTaskAction -Execute $psExe `
    -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -BackupRoot "{1}"' -f $pullScript, $BackupRoot)

$pullTrigger = New-ScheduledTaskTrigger -Daily -At $PullAt

$pullSettings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -DontStopOnIdleEnd

$unattended = $false
try {
    # S4U = run whether or not the user is logged on, with no password stored.
    $p = New-ScheduledTaskPrincipal -UserId $me -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -TaskName $PullTaskName -Action $pullAction -Trigger $pullTrigger `
        -Settings $pullSettings -Principal $p `
        -Description 'Pulls Requital production DB dumps from the VPS and verifies them (off-host backup copy).' | Out-Null
    $unattended = $true
    Write-Host "registered '$PullTaskName' with logon type S4U - runs WITHOUT an interactive login" -ForegroundColor Green
} catch {
    Write-Warning "S4U registration failed: $($_.Exception.Message)"
    $p = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $PullTaskName -Action $pullAction -Trigger $pullTrigger `
        -Settings $pullSettings -Principal $p `
        -Description 'Pulls Requital production DB dumps from the VPS and verifies them (off-host backup copy). Interactive logon required.' | Out-Null
    Write-Host "registered '$PullTaskName' with logon type Interactive - ONLY runs while $me is logged on" -ForegroundColor Yellow
}

# --- Task 2: the freshness alert --------------------------------------------
# Deliberately Interactive: its whole job is to put something on a screen, which
# needs a session to put it in. StartWhenAvailable covers a missed midday run.
Remove-TaskIfPresent -Name $CheckTaskName

$checkAction = New-ScheduledTaskAction -Execute $psExe `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -BackupRoot "{1}"' -f $checkScript, $BackupRoot)

Register-ScheduledTask -TaskName $CheckTaskName `
    -Action $checkAction `
    -Trigger (New-ScheduledTaskTrigger -Daily -At $CheckAt) `
    -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)) `
    -Principal (New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited) `
    -Description 'Shows a Windows notification if the local Requital backup copy has gone stale.' | Out-Null
Write-Host "registered '$CheckTaskName' (interactive - a notification needs a logged-on session)" -ForegroundColor Green

Write-Host ''
Get-ScheduledTask -TaskName $PullTaskName, $CheckTaskName |
    Select-Object TaskName, State, @{ n = 'LogonType'; e = { $_.Principal.LogonType } } |
    Format-Table -AutoSize

Write-Host ("unattended-after-reboot for the pull task: {0}" -f $(if ($unattended) { 'YES (S4U)' } else { 'NO - needs interactive login' }))
