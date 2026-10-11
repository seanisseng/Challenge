#requires -Version 5.1
<#
.SYNOPSIS
    Stop the Challenge scavenger hunt stack.

.DESCRIPTION
    Stops the local Supabase containers and frees the backend (:8000) and
    frontend (:5173) ports. Also close the spawned dev windows manually if
    they are still open.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step($message) { Write-Host "`n==> $message" -ForegroundColor Cyan }

# --- Supabase --------------------------------------------------------------
Write-Step 'Stopping Supabase'
Push-Location (Join-Path $root 'backend')
try {
    npx --yes supabase@latest stop
    if ($LASTEXITCODE -ne 0) { Write-Host "  'supabase stop' returned exit $LASTEXITCODE" -ForegroundColor Yellow }
} finally {
    Pop-Location
}

# --- Dev servers -----------------------------------------------------------
foreach ($port in 8000, 5173) {
    Write-Step "Freeing port $port"
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
        Write-Host '  nothing listening'
        continue
    }
    foreach ($connection in $connections) {
        try {
            $proc = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "  stopping $($proc.ProcessName) (PID $($proc.Id))"
                Stop-Process -Id $proc.Id -Force
            }
        } catch {
            Write-Host "  could not stop PID $($connection.OwningProcess)" -ForegroundColor Yellow
        }
    }
}

Write-Host ''
Write-Host 'Stack stopped.' -ForegroundColor Green
