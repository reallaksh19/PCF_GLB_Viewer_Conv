param(
  [Parameter(Mandatory = $true)]
  [string]$TargetRoot
)

$ErrorActionPreference = 'Stop'
$portRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $portRoot 'manifest\port-manifest.json'
$anchorsPath = Join-Path $portRoot 'manifest\anchors.json'

if (!(Test-Path $manifestPath)) { throw "Manifest not found: $manifestPath" }
if (!(Test-Path $TargetRoot)) { throw "Target root not found: $TargetRoot" }

$manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
$anchors = $null
if (Test-Path $anchorsPath) {
  $anchors = Get-Content -Path $anchorsPath -Raw | ConvertFrom-Json
}

function Get-Sha256([string]$path) {
  if (!(Test-Path $path)) { return '' }
  return (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$failures = @()

$allFiles = @()
foreach ($m in @($manifest.modules)) { $allFiles += @($m.files) }
$allFiles += @($manifest.overlayFiles)

foreach ($f in $allFiles) {
  $rel = [string]$f.path
  $expected = [string]$f.sha256
  $full = Join-Path $TargetRoot $rel
  if (!(Test-Path $full)) {
    $failures += "Missing file: $rel"
    continue
  }
  $actual = Get-Sha256 -path $full
  if ($actual -ne $expected.ToLowerInvariant()) {
    $failures += "Hash mismatch: $rel"
  }
}

if ($anchors -ne $null) {
  foreach ($anchor in @($anchors.anchors)) {
    $rel = [string]$anchor.path
    $full = Join-Path $TargetRoot $rel
    if (!(Test-Path $full)) {
      $failures += "Anchor file missing: $rel"
      continue
    }
    $text = Get-Content -Path $full -Raw
    foreach ($needle in @($anchor.mustContain)) {
      if ($text -notlike "*${needle}*") {
        $failures += "Anchor missing in ${rel}: $needle"
      }
    }
  }
}

if ($failures.Count -gt 0) {
  Write-Host 'Port verification failed:' -ForegroundColor Red
  $failures | ForEach-Object { Write-Host " - $_" }
  exit 1
}

Write-Host 'Port verification passed.' -ForegroundColor Green

