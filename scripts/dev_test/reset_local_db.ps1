# reset_local_db.ps1 - MediLog NG local database reset
# Deletes the local SQLite database to clear all demo/test data.
# The app rebuilds the schema (migrations) on next launch.

$dbPath = "$env:APPDATA\MediLogNG\MediLog NG EMR\medilog.db"
$walPath = "$dbPath-wal"
$shmPath = "$dbPath-shm"

Write-Host "=== MediLog NG Local Database Reset ===" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $dbPath) {
    $size = [math]::Round((Get-Item $dbPath).Length / 1KB, 1)
    Write-Host "Found database: $dbPath ($size KB)" -ForegroundColor Yellow
    Remove-Item $dbPath -Force
    Write-Host "Deleted: medilog.db" -ForegroundColor Green
} else {
    Write-Host "No database found at $dbPath" -ForegroundColor Gray
}

if (Test-Path $walPath) { Remove-Item $walPath -Force; Write-Host "Deleted: medilog.db-wal" -ForegroundColor Green }
if (Test-Path $shmPath) { Remove-Item $shmPath -Force; Write-Host "Deleted: medilog.db-shm" -ForegroundColor Green }

$logPath = "$env:APPDATA\MediLogNG\MediLog NG EMR\debug.log"
if (Test-Path $logPath) {
    Remove-Item $logPath -Force
    Write-Host "Deleted: debug.log" -ForegroundColor Green
}

Write-Host ""
Write-Host "Reset complete. Launch the app - schema will rebuild on first run." -ForegroundColor Cyan
Write-Host "Note: Firestore cloud data is NOT touched by this script." -ForegroundColor DarkGray
Write-Host ""
