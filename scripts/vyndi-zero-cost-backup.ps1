param(
  [string]$BackupRoot = "$env:USERPROFILE\VYNDI-BACKUPS",
  [string]$SourceSha = "",
  [int]$DailyKeep = 7,
  [int]$WeeklyKeep = 4,
  [int]$MonthlyKeep = 3
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$databaseUrl = $env:VYNDI_BACKUP_DATABASE_URL
if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
  throw "VYNDI_BACKUP_DATABASE_URL is required. Set it only in this terminal/session; never commit it."
}

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
  throw "pg_dump was not found in PATH. Install the free PostgreSQL client tools and rerun."
}

$root = [System.IO.Path]::GetFullPath($BackupRoot)
$daily = Join-Path $root "daily"
$weekly = Join-Path $root "weekly"
$monthly = Join-Path $root "monthly"
$staging = Join-Path $root "staging"
foreach ($path in @($daily,$weekly,$monthly,$staging)) {
  New-Item -ItemType Directory -Force -Path $path | Out-Null
}

$now = [DateTime]::UtcNow
$stamp = $now.ToString("yyyyMMddTHHmmssZ")
$base = "vyndi-$stamp"
$tempDump = Join-Path $staging "$base.dump"
$dailyDump = Join-Path $daily "$base.dump"

Write-Host "Creating PostgreSQL custom-format backup..."
& $pgDump.Source --format=custom --no-owner --no-privileges --file="$tempDump" "$databaseUrl"
if ($LASTEXITCODE -ne 0) {
  Remove-Item -Force -ErrorAction SilentlyContinue $tempDump
  throw "pg_dump failed with exit code $LASTEXITCODE."
}
if (-not (Test-Path $tempDump)) { throw "pg_dump did not create a backup file." }

Move-Item -Force $tempDump $dailyDump
$hash = (Get-FileHash -Algorithm SHA256 -Path $dailyDump).Hash.ToLowerInvariant()
$bytes = (Get-Item $dailyDump).Length

$manifest = [ordered]@{
  format = "PostgreSQL custom format"
  createdAtUtc = $now.ToString("o")
  file = [System.IO.Path]::GetFileName($dailyDump)
  sha256 = $hash
  bytes = $bytes
  sourceSha = $SourceSha
  rpoTargetHours = 24
  credentialIncluded = $false
}
$dailyManifest = Join-Path $daily "$base.json"
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $dailyManifest

if ($now.DayOfWeek -eq [DayOfWeek]::Monday) {
  Copy-Item -Force $dailyDump (Join-Path $weekly "$base.dump")
  Copy-Item -Force $dailyManifest (Join-Path $weekly "$base.json")
}
if ($now.Day -eq 1) {
  Copy-Item -Force $dailyDump (Join-Path $monthly "$base.dump")
  Copy-Item -Force $dailyManifest (Join-Path $monthly "$base.json")
}

function Trim-BackupTier([string]$Path,[int]$Keep) {
  if ($Keep -lt 1) { return }
  $dumps = @(Get-ChildItem -Path $Path -Filter "vyndi-*.dump" -File | Sort-Object LastWriteTimeUtc -Descending)
  if ($dumps.Count -le $Keep) { return }
  foreach ($dump in $dumps[$Keep..($dumps.Count-1)]) {
    $sidecar = [System.IO.Path]::ChangeExtension($dump.FullName,".json")
    Remove-Item -Force $dump.FullName
    Remove-Item -Force -ErrorAction SilentlyContinue $sidecar
  }
}

Trim-BackupTier $daily $DailyKeep
Trim-BackupTier $weekly $WeeklyKeep
Trim-BackupTier $monthly $MonthlyKeep

Write-Host ""
Write-Host "VYNDI backup PASS"
Write-Host "File: $dailyDump"
Write-Host "SHA256: $hash"
Write-Host "Bytes: $bytes"
Write-Host "Retention: $DailyKeep daily / $WeeklyKeep weekly / $MonthlyKeep monthly"
Write-Host ""
Write-Warning "The dump contains operational data. Keep this folder private and use an encrypted Windows volume or encrypted sync storage where available."
