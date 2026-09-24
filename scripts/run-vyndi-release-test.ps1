param(
  [string]$BaseUrl = "https://vyndios.shyamsundhar1982.workers.dev",
  [string]$Email,
  [string]$ExpectedSha = "",
  [switch]$Headed,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

Require-Command "node"
Require-Command "npm"

if (-not $Email) {
  $Email = Read-Host "VYNDI authorised email"
}
if (-not $Email) {
  throw "An authorised VYNDI email is required."
}

$securePassword = Read-Host "VYNDI password" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  if (-not $plainPassword) {
    throw "A VYNDI password is required."
  }

  if (-not $SkipInstall) {
    if (-not (Test-Path "node_modules")) {
      Write-Host "Installing repository dependencies with npm ci..."
      npm ci
      if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
    }
    Write-Host "Ensuring Playwright Chromium is installed..."
    npx playwright install chromium
    if ($LASTEXITCODE -ne 0) { throw "Playwright Chromium installation failed." }
  }

  $env:VYNDI_TEST_BASE_URL = $BaseUrl.TrimEnd("/")
  $env:VYNDI_TEST_EMAIL = $Email
  $env:VYNDI_TEST_PASSWORD = $plainPassword
  $env:VYNDI_TEST_EXPECTED_SHA = $ExpectedSha
  $env:VYNDI_TEST_HEADED = if ($Headed) { "1" } else { "0" }

  Write-Host ""
  Write-Host "1/2 Running isolated Golden Order authority test..."
  npm run test:golden-order:core
  if ($LASTEXITCODE -ne 0) { throw "Golden Order authority test failed." }

  Write-Host ""
  Write-Host "2/2 Running authenticated production Playwright smoke..."
  npm run test:browser:production
  if ($LASTEXITCODE -ne 0) { throw "Production Playwright smoke failed." }

  Write-Host ""
  Write-Host "VYNDI release test PASS. Evidence is under .grok/evidence/."
}
finally {
  if ($ptr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
  Remove-Item Env:VYNDI_TEST_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:VYNDI_TEST_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:VYNDI_TEST_BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VYNDI_TEST_EXPECTED_SHA -ErrorAction SilentlyContinue
  Remove-Item Env:VYNDI_TEST_HEADED -ErrorAction SilentlyContinue
  $plainPassword = $null
}
