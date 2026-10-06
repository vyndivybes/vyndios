param(
  [string]$BaseUrl = "https://vyndios.vayushastr.workers.dev",
  [string]$Email,
  [string]$ExpectedSha = "",
  [switch]$Headed,
  [switch]$SkipInstall,
  [switch]$NonInteractive,
  [switch]$SetupOnly,
  [ValidateRange(15, 900)]
  [int]$SetupTimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Invoke-BoundedProcess {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [int]$TimeoutSeconds,
    [string]$Description
  )
  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -NoNewWindow -PassThru
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    try { & taskkill.exe /PID $process.Id /T /F | Out-Null }
    catch { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    throw "$Description timed out after $TimeoutSeconds seconds."
  }
  if ($process.ExitCode -ne 0) {
    throw "$Description failed with exit code $($process.ExitCode)."
  }
}

function Test-ChromiumLaunch {
  param([int]$TimeoutSeconds = 30)
  $probePath = Join-Path (Get-Location) ".vyndi-playwright-probe-$PID.mjs"
  @'
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
await browser.close();
'@ | Set-Content -Path $probePath -Encoding UTF8
  try {
    Invoke-BoundedProcess -FilePath "node" -ArgumentList @($probePath) -TimeoutSeconds $TimeoutSeconds -Description "Playwright Chromium launch check"
    return $true
  }
  catch {
    Write-Host "Chromium launch preflight failed: $($_.Exception.Message)"
    return $false
  }
  finally {
    Remove-Item $probePath -Force -ErrorAction SilentlyContinue
  }
}

Require-Command "node"
Require-Command "npm.cmd"
Require-Command "npx.cmd"

$ptr = [IntPtr]::Zero
$plainPassword = $null

try {
  $chromiumReady = Test-ChromiumLaunch -TimeoutSeconds 30
  if (-not $chromiumReady) {
    if ($SkipInstall) {
      throw "Playwright Chromium cannot launch and -SkipInstall was supplied. Install the browser/runtime dependencies before retrying."
    }
    if (-not (Test-Path "node_modules")) {
      Write-Host "Installing repository dependencies with bounded npm ci..."
      Invoke-BoundedProcess -FilePath "npm.cmd" -ArgumentList @("ci") -TimeoutSeconds $SetupTimeoutSeconds -Description "npm ci"
    }
    Write-Host "Installing Playwright Chromium with a bounded setup window..."
    Invoke-BoundedProcess -FilePath "npx.cmd" -ArgumentList @("playwright", "install", "chromium") -TimeoutSeconds $SetupTimeoutSeconds -Description "Playwright Chromium installation"
    if (-not (Test-ChromiumLaunch -TimeoutSeconds 30)) {
      throw "Playwright Chromium is installed but still cannot launch. Check missing Windows runtime/browser dependencies on this runner."
    }
  }

  if ($SetupOnly) {
    Write-Host "Playwright Chromium setup preflight PASS."
    return
  }

  if (-not $Email) {
    $Email = $env:VYNDI_TEST_EMAIL
  }
  if (-not $Email) {
    if ($NonInteractive) {
      throw "VYNDI_TEST_EMAIL is required in -NonInteractive mode."
    }
    $Email = Read-Host "VYNDI authorised email"
  }
  if (-not $Email) {
    throw "An authorised VYNDI email is required."
  }

  $plainPassword = $env:VYNDI_TEST_PASSWORD
  if (-not $plainPassword) {
    if ($NonInteractive) {
      throw "VYNDI_TEST_PASSWORD is required in -NonInteractive mode."
    }
    $securePassword = Read-Host "VYNDI password" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }
  if (-not $plainPassword) {
    throw "A VYNDI password is required."
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
