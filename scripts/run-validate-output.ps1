param(
    [string]$ExtractedRoot = "results/extracted",
    [string]$ReportDir = "reports",
    [switch]$RequireSelfCheck
)

$ErrorActionPreference = "Stop"

function Test-CommandExists {
    param([string]$CommandName)
    return [bool](Get-Command $CommandName -ErrorAction SilentlyContinue)
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ValidatorScript = Join-Path $ProjectRoot "validation\validate-output.mjs"
$ResolvedExtractedRoot = Join-Path $ProjectRoot $ExtractedRoot
$ResolvedReportDir = Join-Path $ProjectRoot $ReportDir

if (-not (Test-CommandExists "node")) {
    throw "node が見つかりません。Node.js をインストールしてください。"
}

if (-not (Test-Path $ValidatorScript)) {
    throw "validate-output.mjs が見つかりません: $ValidatorScript"
}

if (-not (Test-Path $ResolvedExtractedRoot)) {
    throw "抽出済みディレクトリが見つかりません: $ResolvedExtractedRoot"
}

New-Item -ItemType Directory -Force -Path $ResolvedReportDir | Out-Null

$files = Get-ChildItem $ResolvedExtractedRoot -Recurse -Filter "output.txt" | Sort-Object FullName
if ($files.Count -eq 0) {
    throw "output.txt が見つかりませんでした: $ResolvedExtractedRoot"
}

Write-Host "Project root  : $ProjectRoot"
Write-Host "Extracted root: $ResolvedExtractedRoot"
Write-Host "Report dir    : $ResolvedReportDir"
Write-Host "Files         : $($files.Count)"
Write-Host ""

$rows = @()

Push-Location $ProjectRoot
try {
    foreach ($f in $files) {
        Write-Host "Checking: $($f.FullName)"

        $args = @($ValidatorScript, $f.FullName, "--json")
        if ($RequireSelfCheck) {
            $args += "--require-self-check"
        }

        $raw = (& node @args 2>&1 | Out-String).Trim()

        $relative = $f.FullName.Substring($ResolvedExtractedRoot.Length).TrimStart("\")
        $parts = $relative -split "[\\/]"
        $model = if ($parts.Length -ge 1) { $parts[0] } else { "" }
        $sourceStem = if ($parts.Length -ge 2) { $parts[1] } else { "" }
        $caseName = if ($parts.Length -ge 3) { $parts[2] } else { "" }

        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
            $rows += [pscustomobject]@{
                Path                 = $f.FullName
                Model                = $model
                SourceStem           = $sourceStem
                Case                 = $caseName
                Valid                = $false
                Mode                 = ""
                WarningCount         = 0
                MissingSelfCheck     = $false
                MissingSectionB      = $false
                Warnings             = ""
                Error                = $raw
            }
            continue
        }

        $obj = $raw | ConvertFrom-Json -Depth 20
        $warnings = @($obj.warnings)

        $rows += [pscustomobject]@{
            Path                 = $f.FullName
            Model                = $model
            SourceStem           = $sourceStem
            Case                 = $caseName
            Valid                = [bool]$obj.valid
            Mode                 = [string]$obj.mode
            WarningCount         = $warnings.Count
            MissingSelfCheck     = ($warnings -contains 'Missing "(D) 自己検証" section')
            MissingSectionB      = ($warnings -contains 'Missing "(B) 仕様と実装の不整合・不足情報" section')
            Warnings             = ($warnings -join " | ")
            Error                = ""
        }
    }
}
finally {
    Pop-Location
}

$summary = [pscustomobject]@{
    TotalFiles            = $rows.Count
    ValidCount            = ($rows | Where-Object Valid).Count
    ErrorCount            = ($rows | Where-Object { -not $_.Valid }).Count
    CurrentModeCount      = ($rows | Where-Object { $_.Mode -eq "current" }).Count
    LegacyModeCount       = ($rows | Where-Object { $_.Mode -eq "legacy" }).Count
    WarningAnyCount       = ($rows | Where-Object { $_.WarningCount -gt 0 }).Count
    MissingSelfCheckCount = ($rows | Where-Object MissingSelfCheck).Count
    MissingSectionBCount  = ($rows | Where-Object MissingSectionB).Count
}

$warningBreakdown = $rows |
    Where-Object { $_.Warnings } |
    ForEach-Object {
        foreach ($w in ($_.Warnings -split " \| ")) {
            if (-not [string]::IsNullOrWhiteSpace($w)) {
                [pscustomobject]@{ Warning = $w }
            }
        }
    } |
    Group-Object Warning |
    Sort-Object Count -Descending |
    Select-Object Count, Name

$byModel = $rows |
    Group-Object Model |
    ForEach-Object {
        [pscustomobject]@{
            Model                = $_.Name
            Files                = $_.Count
            ValidCount           = ($_.Group | Where-Object Valid).Count
            ErrorCount           = ($_.Group | Where-Object { -not $_.Valid }).Count
            MissingSelfCheck     = ($_.Group | Where-Object MissingSelfCheck).Count
            MissingSectionB      = ($_.Group | Where-Object MissingSectionB).Count
        }
    } |
    Sort-Object Model

$csvPath = Join-Path $ResolvedReportDir "validate-output-summary.csv"
$jsonPath = Join-Path $ResolvedReportDir "validate-output-summary.json"

$rows | Export-Csv $csvPath -NoTypeInformation -Encoding UTF8

@{
    summary = $summary
    warningBreakdown = $warningBreakdown
    byModel = $byModel
    rows = $rows
} | ConvertTo-Json -Depth 10 | Set-Content $jsonPath -Encoding UTF8

Write-Host ""
Write-Host "=== Summary ==="
$summary | Format-List

Write-Host ""
Write-Host "=== Warning breakdown ==="
$warningBreakdown | Format-Table -AutoSize

Write-Host ""
Write-Host "=== By model ==="
$byModel | Format-Table -AutoSize

Write-Host ""
Write-Host "CSV : $csvPath"
Write-Host "JSON: $jsonPath"