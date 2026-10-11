#requires -Version 5.1
<#
.SYNOPSIS
    Start the full Challenge scavenger hunt stack:
    database (Supabase) + backend (FastAPI/uvicorn) + frontend (Vite).

.DESCRIPTION
    Runs the whole local development stack. The database is started in this
    console; the backend and frontend each get their own PowerShell window so
    their logs stay readable and keep running after this script exits.

    Env files (.env) are NOT created here. The script only warns if they are
    missing -- copy the matching .env.example and fill in values from
    `npx supabase status -o env`.

.PARAMETER SkipInstall
    Skip creating the backend venv / pip install and the frontend npm install.
    Use this on repeat runs once dependencies are already installed.

.PARAMETER SkipDb
    Skip `supabase start` (e.g. when the database is already running).

.EXAMPLE
    .\start.ps1
    .\start.ps1 -SkipInstall
#>
[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipDb
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

function Test-DockerReady {
    try { docker info *> $null; return ($LASTEXITCODE -eq 0) }
    catch { return $false }
}

# --- 1. Docker preflight ---------------------------------------------------
Write-Step 'Checking Docker'
if (-not (Test-DockerReady)) {
    Write-Warn 'Docker is not running. Attempting to start Docker Desktop...'
    $dockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path -LiteralPath $dockerDesktop) {
        Start-Process -FilePath $dockerDesktop | Out-Null
        $deadline = (Get-Date).AddSeconds(180)
        while (-not (Test-DockerReady) -and (Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 5
            Write-Host '.' -NoNewline
        }
        Write-Host ''
    } else {
        Write-Warn "Docker Desktop not found at: $dockerDesktop"
    }
    if (-not (Test-DockerReady)) {
        throw 'Docker daemon is not available. Start Docker Desktop manually and re-run this script.'
    }
}
Write-Host 'Docker is ready.' -ForegroundColor Green

# --- 2. Database -----------------------------------------------------------
if ($SkipDb) {
    Write-Step 'Skipping database (-SkipDb)'
} else {
    Write-Step 'Starting Supabase (database, auth, storage, realtime)'
    Push-Location $backendDir
    try {
        npx --yes supabase@latest start
        if ($LASTEXITCODE -ne 0) { throw "'supabase start' failed (exit $LASTEXITCODE)." }
    } finally {
        Pop-Location
    }
}

# --- 3. Env file reminder (no auto-generation) -----------------------------
$missingEnv = @()
if (-not (Test-Path -LiteralPath (Join-Path $backendDir '.env')))  { $missingEnv += 'backend\.env' }
if (-not (Test-Path -LiteralPath (Join-Path $frontendDir '.env'))) { $missingEnv += 'frontend\.env' }
if ($missingEnv.Count -gt 0) {
    Write-Warn ('Missing env file(s): ' + ($missingEnv -join ', '))
    Write-Note 'Copy the matching .env.example to .env and fill in values.'
    Write-Note 'Get them with:  cd backend; npx supabase status -o env'
    Write-Note 'Continuing; the app may fail to connect until these exist.'
}

# --- 4. Backend dependencies -----------------------------------------------
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

# --- 5. Frontend dependencies ----------------------------------------------
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

# --- 6. Launch backend + frontend in separate windows ----------------------
Write-Step 'Launching backend and frontend in separate windows'

$backendCmd = "`$Host.UI.RawUI.WindowTitle='Challenge - Backend'; " +
              "Set-Location -LiteralPath '$backendDir'; " +
              "& '$activate'; " +
              "uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

$frontendCmd = "`$Host.UI.RawUI.WindowTitle='Challenge - Frontend'; " +
               "Set-Location -LiteralPath '$frontendDir'; " +
               "npm run dev"

Start-Process -FilePath 'powershell' -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $backendCmd
Start-Process -FilePath 'powershell' -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $frontendCmd

Write-Host ''
Write-Host 'Stack starting:' -ForegroundColor Green
Write-Host '  Backend  -> http://127.0.0.1:8000/health  (and /docs)'
Write-Host '  Frontend -> http://localhost:5173'
Write-Host '  Studio   -> http://127.0.0.1:54323'
Write-Host ''
Write-Note 'Close the two spawned windows to stop the app servers.'
Write-Note 'Run .\stop.ps1 to stop Supabase and free the ports.'
