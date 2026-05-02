param(
  [Parameter(Mandatory = $true)]
  [string]$TargetRoot,
  [ValidateSet('dry-run','apply')]
  [string]$Mode = 'dry-run',
  [string[]]$Modules = @()
)

$ErrorActionPreference = 'Stop'
$portRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $portRoot 'manifest\port-manifest.json'
$payloadRoot = Join-Path $portRoot 'payload\current'
$reportDir = Join-Path $portRoot 'reports'
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null

if (!(Test-Path $manifestPath)) {
  throw "Manifest not found: $manifestPath"
}
if (!(Test-Path $TargetRoot)) {
  throw "Target root not found: $TargetRoot"
}

$manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
$selected = @($manifest.modules)
if ($Modules.Count -gt 0) {
  $selected = @($manifest.modules | Where-Object { $Modules -contains $_.id })
}

if ($selected.Count -eq 0) {
  throw "No modules selected for apply."
}

$results = @()

function Copy-OverlayFile([string]$relPath) {
  $src = Join-Path $payloadRoot $relPath
  $dst = Join-Path $TargetRoot $relPath
  if (!(Test-Path $src)) {
    return [pscustomobject]@{ path = $relPath; status = 'missing-source' }
  }
  if ($Mode -eq 'dry-run') {
    return [pscustomobject]@{ path = $relPath; status = 'would-copy' }
  }
  $dstDir = Split-Path -Parent $dst
  New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
  Copy-Item -Path $src -Destination $dst -Force
  return [pscustomobject]@{ path = $relPath; status = 'copied' }
}

foreach ($module in $selected) {
  $patchRel = [string]$module.patchFile
  $patchPath = Join-Path $portRoot $patchRel
  $moduleResult = [ordered]@{
    moduleId = [string]$module.id
    patch = $patchRel
    patchStatus = 'skipped'
    overlays = @()
  }

  if (Test-Path $patchPath) {
    if ($Mode -eq 'dry-run') {
      $moduleResult.patchStatus = 'would-apply'
    } else {
      $gitAvailable = $null -ne (Get-Command git -ErrorAction SilentlyContinue)
      if ($gitAvailable) {
        $patchContent = Get-Content -Path $patchPath -Raw
        if ($patchContent.Trim().Length -gt 0) {
          Push-Location $TargetRoot
          try {
            $tempPatch = Join-Path ([System.IO.Path]::GetTempPath()) ("port-" + [System.Guid]::NewGuid().ToString('N') + '.patch')
            Set-Content -Path $tempPatch -Value $patchContent -Encoding UTF8
            git apply --whitespace=nowarn $tempPatch
            Remove-Item -Force $tempPatch
            $moduleResult.patchStatus = 'applied'
          } catch {
            $moduleResult.patchStatus = "patch-failed: $($_.Exception.Message)"
          } finally {
            Pop-Location
          }
        } else {
          $moduleResult.patchStatus = 'empty-patch'
        }
      } else {
        $moduleResult.patchStatus = 'git-not-found'
      }
    }
  } else {
    $moduleResult.patchStatus = 'patch-missing'
  }

  foreach ($file in @($module.files)) {
    $moduleResult.overlays += Copy-OverlayFile -relPath ([string]$file.path)
  }

  $results += [pscustomobject]$moduleResult
}

foreach ($overlay in @($manifest.overlayFiles)) {
  $results += [pscustomobject]@{
    moduleId = 'overlay-only'
    patch = ''
    patchStatus = 'n/a'
    overlays = @(
      Copy-OverlayFile -relPath ([string]$overlay.path)
    )
  }
}

$report = [ordered]@{
  timestamp = (Get-Date).ToUniversalTime().ToString('o')
  mode = $Mode
  targetRoot = $TargetRoot
  modules = $results
}

$reportPath = Join-Path $reportDir ("port-apply-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
$report | ConvertTo-Json -Depth 10 | Set-Content -Path $reportPath -Encoding UTF8
Write-Host "Port apply report: $reportPath"
