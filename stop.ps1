#requires -Version 5.1
<#
.SYNOPSIS
    Stop the Challenge scavenger hunt stack.

.DESCRIPTION
    Stops the backend (:8000) and frontend (:5173) dev servers.

    Two passes:
      1. Kill the process trees that start.ps1 recorded in .dev-servers.json.
      2. Fall back to whatever is still bound to ports 8000 / 5173.

    There is no local database container to stop -- the database lives in
    Supabase Cloud and is always available.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$statePath = Join-Path $root '.dev-servers.json'

function Write-Step($message) { Write-Host "`n==> $message" -ForegroundColor Cyan }

function Get-PortOwnerIds {
    param([int]$Port)

    $ids = @()

    # Preferred: the TCP table.
    try {
        $ids += Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess
    } catch { }

    # Fallback: netstat parsing (some environments hide the cmdlet's view).
    if (-not $ids) {
        try {
            $ids += netstat -ano |
                Select-String -Pattern ":$Port\s+\S+\s+LISTENING\s+(\d+)" |
                ForEach-Object { $_.Matches[0].Groups[1].Value }
        } catch { }
    }

    # Fallback: match the dev servers by command line.
    if (-not $ids) {
        try {
            $ids += Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.CommandLine -and
                    $_.CommandLine -match "port\s+$Port|vite" -and
                    ($_.Name -eq 'python.exe' -or $_.Name -eq 'node.exe')
                } |
                Select-Object -ExpandProperty ProcessId
        } catch { }
    }

    return ($ids | Where-Object { $_ -and $_ -ne 0 } | Sort-Object -Unique)
}

# --- 1. Process trees recorded by start.ps1 --------------------------------
if (Test-Path -LiteralPath $statePath) {
    Write-Step 'Stopping recorded dev servers'
    try {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        foreach ($name in 'backend', 'frontend') {
            $procId = $state.$name
            if ($procId) {
                Write-Host "  $name (PID $procId)"
                taskkill /PID $procId /T /F *> $null
            }
        }
    } catch {
        Write-Host "  could not read $statePath : $($_.Exception.Message)" -ForegroundColor Yellow
    }
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
} else {
    Write-Step 'No .dev-servers.json found (was the stack started with start.ps1?)'
}

# --- 2. Port fallback ------------------------------------------------------
foreach ($port in 8000, 5173) {
    Write-Step "Freeing port $port"
    $owners = Get-PortOwnerIds -Port $port
    if (-not $owners) {
        Write-Host '  nothing listening'
        continue
    }
    foreach ($procId in $owners) {
        try {
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            $label = if ($proc) { "$($proc.ProcessName) (PID $procId)" } else { "PID $procId" }
            Write-Host "  stopping $label"
            taskkill /PID $procId /T /F *> $null
        } catch {
            Write-Host "  could not stop PID $procId : $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

Write-Host ''
Write-Host 'Stack stopped.' -ForegroundColor Green
