param(
  [Parameter(Mandatory=$true)][string]$BackupFile,
  [switch]$ConfirmIsolatedTarget
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $ConfirmIsolatedTarget) {
  throw "Restore is fail-closed. Re-run with -ConfirmIsolatedTarget after confirming the target is a NEW empty recovery database/branch."
}
if (-not (Test-Path $BackupFile)) { throw "Backup file not found: $BackupFile" }

$targetUrl = $env:VYNDI_RESTORE_DATABASE_URL
if ([string]::IsNullOrWhiteSpace($targetUrl)) {
  throw "VYNDI_RESTORE_DATABASE_URL is required. It must point to a NEW isolated recovery database."
}
$productionUrl = $env:VYNDI_BACKUP_DATABASE_URL
if (-not [string]::IsNullOrWhiteSpace($productionUrl) -and $targetUrl -eq $productionUrl) {
  throw "Refusing restore: target URL equals the production/backup source URL."
}

$pgRestore = Get-Command pg_restore -ErrorAction SilentlyContinue
if (-not $pgRestore) {
  throw "pg_restore was not found in PATH. Install the free PostgreSQL client tools and rerun."
}

Write-Host "Validating backup archive..."
& $pgRestore.Source --list "$BackupFile" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Backup archive validation failed." }

Write-Host "Restoring into isolated target..."
& $pgRestore.Source --exit-on-error --no-owner --no-privileges --dbname="$targetUrl" "$BackupFile"
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with exit code $LASTEXITCODE." }

Write-Host ""
Write-Host "VYNDI isolated restore completed."
Write-Host "Next mandatory steps: repository migrations -> H2 hash/lineage validation -> Golden Order -> runtime health -> authenticated smoke -> Admin Recovery Centre validation."
