# Windows PowerShell wrapper for scripts/create-admin.mjs.
#
# The documented one-liner is Unix shell syntax and cannot run in Windows
# PowerShell 5.1: there is no `&&` statement separator and no `VAR=value command`
# prefix. Pasting it there fails outright, which is how an administrator account
# once ended up in the wrong database on a retry.
#
# This wrapper does three things the one-liner cannot:
#   - sets the variables the way PowerShell actually does
#   - reads the password with Read-Host, so it never enters shell history
#   - prints the Supabase project it is about to write to, and waits for a yes
#
#   .\scripts\create-admin.ps1
#   .\scripts\create-admin.ps1 -Username ROMA_jane -Email jane@company.com

param(
  [string]$FullName,
  [string]$Email,
  [string]$Username,
  [switch]$AllowWeakPassword
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Test-Path ".env.local")) {
  Write-Host "`n  ABORTED: .env.local not found - cannot tell which database this would write to.`n" -ForegroundColor Red
  exit 1
}

# Last definition wins, matching how Next.js (dotenv) resolves the file. The .mjs
# scripts take the FIRST, so a duplicated key makes the app and the scripts
# disagree about which database they are on - check for that here rather than
# let it pass silently.
$urlLines = @(Select-String -Path ".env.local" -Pattern '^\s*SUPABASE_URL\s*=\s*(.+)$')
if ($urlLines.Count -eq 0) {
  Write-Host "`n  ABORTED: no SUPABASE_URL in .env.local.`n" -ForegroundColor Red
  exit 1
}
if ($urlLines.Count -gt 1) {
  Write-Host "`n  ABORTED: SUPABASE_URL is defined $($urlLines.Count) times in .env.local." -ForegroundColor Red
  Write-Host "  Next.js would use the last one and this script the first, so they would" -ForegroundColor Red
  Write-Host "  target different databases. Delete the stale line before continuing.`n" -ForegroundColor Red
  exit 1
}

$url = $urlLines[0].Matches[0].Groups[1].Value.Trim().Trim('"', "'")
$ref = ([Uri]$url).Host.Split('.')[0]

Write-Host ""
Write-Host "  This will create an ADMINISTRATOR account in:"
Write-Host "    Supabase project : $ref" -ForegroundColor Yellow
Write-Host ""

if (-not $FullName) { $FullName = Read-Host "  Full name" }
if (-not $Email)    { $Email    = Read-Host "  Email" }
if (-not $Username) { $Username = Read-Host "  Username" }

# Read-Host -AsSecureString keeps the password off the screen and out of history.
$secure = Read-Host "  Password" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
)

Write-Host ""
$answer = Read-Host "  Create '$Username' as administrator in '$ref'? (yes/no)"
if ($answer -ne "yes") {
  Write-Host "`n  Cancelled - nothing was created.`n"
  exit 0
}

$env:ADMIN_FULL_NAME = $FullName
$env:ADMIN_EMAIL     = $Email
$env:ADMIN_USERNAME  = $Username
$env:ADMIN_PASSWORD  = $plain
if ($AllowWeakPassword) { $env:ALLOW_WEAK_PASSWORD = "1" }

try {
  node scripts/create-admin.mjs
}
finally {
  # Do not leave the password sitting in the session for whatever runs next.
  Remove-Item Env:\ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:\ALLOW_WEAK_PASSWORD -ErrorAction SilentlyContinue
  $plain = $null
}
