param(
    [string]$InputPath = "results",
    [string]$OutputBase = "results/extracted",
    [switch]$CleanOutput
)

$ErrorActionPreference = "Stop"

function Test-CommandExists {
    param([string]$CommandName)
    return [bool](Get-Command $CommandName -ErrorAction SilentlyContinue)
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ExtractScript = Join-Path $ProjectRoot "scripts\extract-outputs.mjs"
$ResolvedInputPath = Join-Path $ProjectRoot $InputPath
$ResolvedOutputBase = Join-Path $ProjectRoot $OutputBase

if (-not (Test-CommandExists "node")) {
    throw "node が見つかりません。Node.js をインストールしてください。"
}

if (-not (Test-Path $ExtractScript)) {
    throw "extract-outputs.mjs が見つかりません: $ExtractScript"
}

if (-not (Test-Path $ResolvedInputPath)) {
    throw "入力パスが見つかりません: $ResolvedInputPath"
}

if ($CleanOutput -and (Test-Path $ResolvedOutputBase)) {
    Write-Host "Removing existing output: $ResolvedOutputBase"
    Remove-Item $ResolvedOutputBase -Recurse -Force
}

Write-Host "Project root : $ProjectRoot"
Write-Host "Input path   : $ResolvedInputPath"
Write-Host "Output base  : $ResolvedOutputBase"
Write-Host ""

Push-Location $ProjectRoot
try {
    & node $ExtractScript $ResolvedInputPath --output-base $ResolvedOutputBase
    if ($LASTEXITCODE -ne 0) {
        throw "extract-outputs.mjs failed with exit code $LASTEXITCODE"
    }

    $ManifestPath = Join-Path $ResolvedOutputBase "manifest.json"
    if (Test-Path $ManifestPath) {
        Write-Host ""
        Write-Host "Done."
        Write-Host "Manifest: $ManifestPath"
    } else {
        Write-Warning "manifest.json が見つかりません: $ManifestPath"
    }
}
finally {
    Pop-Location
}