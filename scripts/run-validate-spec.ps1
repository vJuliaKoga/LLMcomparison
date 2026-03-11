param(
    [string]$ExtractedRoot = "results/extracted",
    [string]$ReportDir = "reports",
    [switch]$SkipCommonFeature,
    [string]$NodePath = "node"
)

$ErrorActionPreference = "Stop"

function Test-Executable {
    param([string]$CommandPath, [string]$VersionArg = "--version")
    try {
        $null = & $CommandPath $VersionArg 2>$null
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ResolvedExtractedRoot = Join-Path $ProjectRoot $ExtractedRoot
$ResolvedReportDir = Join-Path $ProjectRoot $ReportDir
$ValidateSpecModule = Join-Path $ProjectRoot "mcp\junit-validator\tools\validate-spec.mjs"

if (-not (Test-Executable -CommandPath $NodePath)) {
    throw "node が見つかりません: $NodePath"
}

if (-not (Test-Path $ResolvedExtractedRoot)) {
    throw "抽出済みディレクトリが見つかりません: $ResolvedExtractedRoot"
}

if (-not (Test-Path $ValidateSpecModule)) {
    throw "validate-spec.mjs が見つかりません: $ValidateSpecModule"
}

New-Item -ItemType Directory -Force -Path $ResolvedReportDir | Out-Null

$metadataFiles = Get-ChildItem $ResolvedExtractedRoot -Recurse -Filter "metadata.json" | Sort-Object FullName
if ($metadataFiles.Count -eq 0) {
    throw "metadata.json が見つかりませんでした: $ResolvedExtractedRoot"
}

Write-Host "Project root  : $ProjectRoot"
Write-Host "Extracted root: $ResolvedExtractedRoot"
Write-Host "Report dir    : $ResolvedReportDir"
Write-Host "Metadata files: $($metadataFiles.Count)"
Write-Host ""

$nodeCode = @'
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const modulePath = process.argv[1];
const txtPath = process.argv[2];
const feature = process.argv[3] ?? "";
const outputPath = process.argv[4];

const moduleUrl = pathToFileURL(modulePath).href;
const mod = await import(moduleUrl);

const txt = fs.readFileSync(txtPath, "utf8");
const result = mod.validateSpec(txt, feature);
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");
'@

$rows = @()

Push-Location $ProjectRoot
try {
    foreach ($metaFile in $metadataFiles) {
        $meta = Get-Content $metaFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 20
        $feature = [string]$meta.feature
        $txtPath = [string]$meta.output_txt_path

        if ([string]::IsNullOrWhiteSpace($txtPath) -or -not (Test-Path $txtPath)) {
            $rows += [pscustomobject]@{
                Model                 = ""
                Feature               = $feature
                Path                  = $txtPath
                Valid                 = $false
                CoverageIssueCount    = 0
                CoverageIssues        = ""
                TestabilityIssueCount = 0
                TestabilityIssues     = ""
                AllIssues             = ""
                Error                 = "output_txt_path not found"
            }
            continue
        }

        if ($SkipCommonFeature -and $feature -eq "共通") {
            continue
        }

        Write-Host "Checking: $txtPath"

        $relative = $txtPath.Substring($ResolvedExtractedRoot.Length).TrimStart("\")
        $parts = $relative -split "[\\/]"
        $model = if ($parts.Length -ge 1) { $parts[0] } else { "" }

        $tempJson = Join-Path ([System.IO.Path]::GetTempPath()) ("validate-spec-" + [System.Guid]::NewGuid().ToString() + ".json")

        try {
            & $NodePath -e $nodeCode $ValidateSpecModule $txtPath $feature $tempJson 2>$null

            if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tempJson)) {
                $rows += [pscustomobject]@{
                    Model                 = $model
                    Feature               = $feature
                    Path                  = $txtPath
                    Valid                 = $false
                    CoverageIssueCount    = 0
                    CoverageIssues        = ""
                    TestabilityIssueCount = 0
                    TestabilityIssues     = ""
                    AllIssues             = ""
                    Error                 = "validate-spec.mjs の実行に失敗しました"
                }
                continue
            }

            $raw = Get-Content $tempJson -Raw -Encoding UTF8
            $obj = $raw | ConvertFrom-Json -Depth 50
            $issues = @($obj.issues)

            $coverageIssues = @(
                $issues | Where-Object {
                    $_ -notmatch "^テスト可能性:"
                }
            )

            $testabilityIssues = @(
                $issues | Where-Object {
                    $_ -match "^テスト可能性:"
                }
            )

            $rows += [pscustomobject]@{
                Model                 = $model
                Feature               = $feature
                Path                  = $txtPath
                Valid                 = [bool]$obj.valid
                CoverageIssueCount    = $coverageIssues.Count
                CoverageIssues        = ($coverageIssues -join " | ")
                TestabilityIssueCount = $testabilityIssues.Count
                TestabilityIssues     = ($testabilityIssues -join " | ")
                AllIssues             = ($issues -join " | ")
                Error                 = ""
            }
        }
        finally {
            if (Test-Path $tempJson) {
                Remove-Item $tempJson -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
finally {
    Pop-Location
}

$summary = [pscustomobject]@{
    総件数               = $rows.Count
    通過件数              = ($rows | Where-Object Valid).Count
    エラー件数             = ($rows | Where-Object { -not $_.Valid }).Count
    Coverage不足あり件数    = ($rows | Where-Object { $_.CoverageIssueCount -gt 0 }).Count
    Testability不足あり件数 = ($rows | Where-Object { $_.TestabilityIssueCount -gt 0 }).Count
}

$coverageBreakdown = $rows |
Where-Object { $_.CoverageIssues } |
ForEach-Object {
    foreach ($issue in ($_.CoverageIssues -split " \| ")) {
        if (-not [string]::IsNullOrWhiteSpace($issue)) {
            [pscustomobject]@{ 内容 = $issue }
        }
    }
} |
Group-Object 内容 |
Sort-Object Count -Descending |
Select-Object Count, Name

$testabilityBreakdown = $rows |
Where-Object { $_.TestabilityIssues } |
ForEach-Object {
    foreach ($issue in ($_.TestabilityIssues -split " \| ")) {
        if (-not [string]::IsNullOrWhiteSpace($issue)) {
            [pscustomobject]@{ 内容 = $issue }
        }
    }
} |
Group-Object 内容 |
Sort-Object Count -Descending |
Select-Object Count, Name

$byFeature = $rows |
Group-Object Feature |
ForEach-Object {
    [pscustomobject]@{
        Feature               = $_.Name
        Files                 = $_.Count
        ValidCount            = ($_.Group | Where-Object Valid).Count
        ErrorCount            = ($_.Group | Where-Object { -not $_.Valid }).Count
        CoverageIssueCount    = ($_.Group | Where-Object { $_.CoverageIssueCount -gt 0 }).Count
        TestabilityIssueCount = ($_.Group | Where-Object { $_.TestabilityIssueCount -gt 0 }).Count
    }
} |
Sort-Object Feature

$byModel = $rows |
Group-Object Model |
ForEach-Object {
    [pscustomobject]@{
        Model                 = $_.Name
        Files                 = $_.Count
        ValidCount            = ($_.Group | Where-Object Valid).Count
        ErrorCount            = ($_.Group | Where-Object { -not $_.Valid }).Count
        CoverageIssueCount    = ($_.Group | Where-Object { $_.CoverageIssueCount -gt 0 }).Count
        TestabilityIssueCount = ($_.Group | Where-Object { $_.TestabilityIssueCount -gt 0 }).Count
    }
} |
Sort-Object Model

$csvPath = Join-Path $ResolvedReportDir "validate-spec-summary.csv"
$jsonPath = Join-Path $ResolvedReportDir "validate-spec-summary.json"

$rows | Export-Csv $csvPath -NoTypeInformation -Encoding UTF8

@{
    summary              = $summary
    coverageBreakdown    = $coverageBreakdown
    testabilityBreakdown = $testabilityBreakdown
    byFeature            = $byFeature
    byModel              = $byModel
    rows                 = $rows
} | ConvertTo-Json -Depth 10 | Set-Content $jsonPath -Encoding UTF8

Write-Host ""
Write-Host "=== 集計結果 ==="
$summary | Format-List

Write-Host ""
Write-Host "=== Coverage 不足内訳 ==="
$coverageBreakdown | Format-Table -AutoSize

Write-Host ""
Write-Host "=== Testability 不足内訳 ==="
$testabilityBreakdown | Format-Table -AutoSize

Write-Host ""
Write-Host "=== Feature 別 ==="
$byFeature | Format-Table -AutoSize

Write-Host ""
Write-Host "=== モデル別 ==="
$byModel | Format-Table -AutoSize

Write-Host ""
Write-Host "CSV : $csvPath"
Write-Host "JSON: $jsonPath"