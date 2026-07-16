$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot "dist"
$target = Join-Path $projectRoot "chrome-extension"

if (-not (Test-Path -LiteralPath $source)) {
  throw "Build output folder not found: $source"
}

if (-not (Test-Path -LiteralPath (Join-Path $source "manifest.json"))) {
  throw "Build output is missing manifest.json. Run vite build first."
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force

Write-Host "Synced dist to chrome-extension."
