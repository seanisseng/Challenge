#requires -Version 5.1
<#
.SYNOPSIS
    Start the Challenge scavenger hunt stack: backend (FastAPI/uvicorn) and
    frontend (Vite).

.DESCRIPTION
    Runs the whole local development stack against the hosted Supabase project
    configured in backend/.env and frontend/.env. There is no local database
    container to boot -- the database lives in Supabase Cloud.

    The backend and frontend each get their own PowerShell window so their logs
    stay readable and keep running after this script exits.

    Env files (.env) are NOT created here. The script only warns if they are
    missing.

.PARAMETER SkipInstall
    Skip creating the backend venv / pip install and the frontend npm install.
    Use this on repeat runs once dependencies are already installed.

.EXAMPLE
    .\start.ps1
    .\start.ps1 -SkipInstall
#>
[CmdletBinding()]
param(
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$backendDir  = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'
$venvPython  = Join-Path $backendDir '.venv\Scripts\python.exe'
$activate    = Join-Path $backendDir '.venv\Scripts\Activate.ps1'
$nodeModules = Join-Path $frontendDir 'node_modules'

function Write-Step($message) { Write-Host "`n==> $message" -ForegroundColor Cyan }
function Write-Note($message) { Write-Host "    $message" -ForegroundColor DarkGray }
function Write-Warn($message) { Write-Host "!!  $message" -ForegroundColor Yellow }

# --- 1. Python preflight ---------------------------------------------------
Write-Step 'Checking Python'
$pythonVersion = (python --version 2>&1)
if ($LASTEXITCODE -ne 0) {
    throw 'python was not found on PATH. Install Python 3.11+ and re-run this script.'
}
Write-Host "$pythonVersion on PATH." -ForegroundColor Green

# --- 2. Env file reminder (no auto-generation) -----------------------------
$missingEnv = @()
if (-not (Test-Path -LiteralPath (Join-Path $backendDir '.env')))  { $missingEnv += 'backend\.env' }
if (-not (Test-Path -LiteralPath (Join-Path $frontendDir '.env'))) { $missingEnv += 'frontend\.env' }
if ($missingEnv.Count -gt 0) {
    Write-Warn ('Missing env file(s): ' + ($missingEnv -join ', '))
    Write-Note 'Copy the matching .env.example to .env and fill in values.'
    Write-Note 'Supabase keys live in Dashboard -> Project Settings -> API.'
    Write-Note 'Continuing; the app may fail to connect until these exist.'
}

# --- 3. Backend dependencies -----------------------------------------------
if ($SkipInstall) {
    Write-Step 'Skipping backend install (-SkipInstall)'
} else {
    Write-Step 'Installing backend dependencies'
    if (-not (Test-Path -LiteralPath $venvPython)) {
        Write-Note 'Creating backend virtual environment (.venv)'
        python -m venv (Join-Path $backendDir '.venv')
        if ($LASTEXITCODE -ne 0) { throw "Failed to create venv (exit $LASTEXITCODE)." }
    }
    & $venvPython -m pip install --quiet --disable-pip-version-check -r (Join-Path $backendDir 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw "pip install failed (exit $LASTEXITCODE)." }
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "Backend venv is missing at $venvPython. Re-run without -SkipInstall."
}

# --- 4. Frontend dependencies ----------------------------------------------
if ($SkipInstall) {
    Write-Step 'Skipping frontend install (-SkipInstall)'
} elseif (Test-Path -LiteralPath $nodeModules) {
    Write-Step 'Frontend dependencies already present'
} else {
    Write-Step 'Installing frontend dependencies'
    Push-Location $frontendDir
    try {
        npm install --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)." }
    } finally {
        Pop-Location
    }
}

# --- 5. Launch backend + frontend in separate windows ----------------------
Write-Step 'Launching backend and frontend in separate windows'

$backendCmd = "`$Host.UI.RawUI.WindowTitle='Challenge - Backend'; " +
              "Set-Location -LiteralPath '$backendDir'; " +
              "& '$activate'; " +
              "uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

$frontendCmd = "`$Host.UI.RawUI.WindowTitle='Challenge - Frontend'; " +
               "Set-Location -LiteralPath '$frontendDir'; " +
               "npm run dev"

$backendProc  = Start-Process -FilePath 'powershell' -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $backendCmd -PassThru
$frontendProc = Start-Process -FilePath 'powershell' -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $frontendCmd -PassThru

# Record the window PIDs so stop.ps1 can tear down the whole process tree.
$statePath = Join-Path $root '.dev-servers.json'
@{
    backend    = $backendProc.Id
    frontend   = $frontendProc.Id
    started_at = (Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
Write-Note "Recorded dev server PIDs in .dev-servers.json"

Write-Host ''
Write-Host 'Stack starting:' -ForegroundColor Green
Write-Host '  Backend  -> http://127.0.0.1:8000/health  (and /docs)'
Write-Host '  Frontend -> http://localhost:5173'
Write-Host '  Database -> Supabase Cloud (see backend\.env)'
Write-Host ''
Write-Note 'Close the two spawned windows to stop the app servers.'
Write-Note 'Run .\stop.ps1 to free the ports.'
