param(
    [string]$ExtractedRoot = "results/extracted",
    [string]$OutputRoot = "reports/playwright-plans",
    [string]$BaseUrl = "http://localhost:8080",
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
$ResolvedOutputRoot = Join-Path $ProjectRoot $OutputRoot

$ExtractActionsModule = Join-Path $ProjectRoot "mcp\junit-validator\tools\extract-actions.mjs"
$PlaywrightBridgeModule = Join-Path $ProjectRoot "scripts\playwright-bridge.mjs"

if (-not (Test-Executable -CommandPath $NodePath)) {
    throw "node が見つかりません: $NodePath"
}

if (-not (Test-Path $ResolvedExtractedRoot)) {
    throw "抽出済みディレクトリが見つかりません: $ResolvedExtractedRoot"
}

if (-not (Test-Path $ExtractActionsModule)) {
    throw "extract-actions.mjs が見つかりません: $ExtractActionsModule"
}

if (-not (Test-Path $PlaywrightBridgeModule)) {
    throw "playwright-bridge.mjs が見つかりません: $PlaywrightBridgeModule"
}

New-Item -ItemType Directory -Force -Path $ResolvedOutputRoot | Out-Null

$javaFiles = Get-ChildItem $ResolvedExtractedRoot -Recurse -Filter "*.java" | Sort-Object FullName
if ($javaFiles.Count -eq 0) {
    throw ".java ファイルが見つかりませんでした: $ResolvedExtractedRoot"
}

Write-Host "Project root  : $ProjectRoot"
Write-Host "Extracted root: $ResolvedExtractedRoot"
Write-Host "Output root   : $ResolvedOutputRoot"
Write-Host "Base URL      : $BaseUrl"
Write-Host "Java files    : $($javaFiles.Count)"
Write-Host ""

$extractNodeCode = @'
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const modulePath = process.argv[1];
const javaPath = process.argv[2];
const outputPath = process.argv[3];

const moduleUrl = pathToFileURL(modulePath).href;
const mod = await import(moduleUrl);
const code = fs.readFileSync(javaPath, "utf8");
const result = mod.extractActions(code);
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");
'@

$rows = @()

Push-Location $ProjectRoot
try {
    foreach ($javaFile in $javaFiles) {
        Write-Host "Checking: $($javaFile.FullName)"

        $relative = $javaFile.FullName.Substring($ResolvedExtractedRoot.Length).TrimStart("\")
        $parts = $relative -split "[\\/]"
        $model = if ($parts.Length -ge 1) { $parts[0] } else { "" }
        $sourceStem = if ($parts.Length -ge 2) { $parts[1] } else { "" }
        $caseName = if ($parts.Length -ge 3) { $parts[2] } else { "" }

        $targetDir = Join-Path $ResolvedOutputRoot (Join-Path $model (Join-Path $sourceStem $caseName))
        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

        $javaBaseName = [System.IO.Path]::GetFileNameWithoutExtension($javaFile.Name)
        $tempActionsJson = Join-Path $targetDir ($javaBaseName + ".json")
        $planPath = Join-Path $targetDir ($javaBaseName + ".playwright-plan.json")

        try {
            & $NodePath -e $extractNodeCode $ExtractActionsModule $javaFile.FullName $tempActionsJson 2>$null
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tempActionsJson)) {
                $rows += [pscustomobject]@{
                    Path            = $javaFile.FullName
                    Model           = $model
                    SourceStem      = $sourceStem
                    Case            = $caseName
                    FileName        = $javaFile.Name
                    PlanPath        = ""
                    TestMethodCount = 0
                    TotalStepCount  = 0
                    Generated       = $false
                    Error           = "extract-actions JSON の生成に失敗しました"
                }
                continue
            }

            & $NodePath $PlaywrightBridgeModule $tempActionsJson $BaseUrl $targetDir 2>$null
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path $planPath)) {
                $rows += [pscustomobject]@{
                    Path            = $javaFile.FullName
                    Model           = $model
                    SourceStem      = $sourceStem
                    Case            = $caseName
                    FileName        = $javaFile.Name
                    PlanPath        = ""
                    TestMethodCount = 0
                    TotalStepCount  = 0
                    Generated       = $false
                    Error           = "playwright plan の生成に失敗しました"
                }
                continue
            }

            $plan = Get-Content $planPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
            $methods = @($plan.test_methods)
            $totalSteps = 0
            foreach ($m in $methods) {
                $totalSteps += [int]$m.total_steps
            }

            $rows += [pscustomobject]@{
                Path            = $javaFile.FullName
                Model           = $model
                SourceStem      = $sourceStem
                Case            = $caseName
                FileName        = $javaFile.Name
                PlanPath        = $planPath
                TestMethodCount = $methods.Count
                TotalStepCount  = $totalSteps
                Generated       = $true
                Error           = ""
            }
        }
        finally {
            if (Test-Path $tempActionsJson) {
                Remove-Item $tempActionsJson -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
finally {
    Pop-Location
}

$summary = [pscustomobject]@{
    総ファイル数     = $rows.Count
    Plan生成成功件数 = ($rows | Where-Object Generated).Count
    Plan生成失敗件数 = ($rows | Where-Object { -not $_.Generated }).Count
    総テストメソッド数  = ($rows | Measure-Object TestMethodCount -Sum).Sum
    総ステップ数     = ($rows | Measure-Object TotalStepCount -Sum).Sum
}

$byModel = $rows |
Group-Object Model |
ForEach-Object {
    [pscustomobject]@{
        モデル名       = $_.Name
        ファイル数      = $_.Count
        Plan生成成功件数 = ($_.Group | Where-Object Generated).Count
        総テストメソッド数  = ($_.Group | Measure-Object TestMethodCount -Sum).Sum
        総ステップ数     = ($_.Group | Measure-Object TotalStepCount -Sum).Sum
    }
} |
Sort-Object モデル名

$errorBreakdown = $rows |
Where-Object { $_.Error } |
Group-Object Error |
Sort-Object Count -Descending |
Select-Object Count, Name

$csvPath = Join-Path $ResolvedOutputRoot "playwright-bridge-summary.csv"
$jsonPath = Join-Path $ResolvedOutputRoot "playwright-bridge-summary.json"

$rows | Export-Csv $csvPath -NoTypeInformation -Encoding UTF8

@{
    summary        = $summary
    byModel        = $byModel
    errorBreakdown = $errorBreakdown
    rows           = $rows
} | ConvertTo-Json -Depth 20 | Set-Content $jsonPath -Encoding UTF8

Write-Host ""
Write-Host "=== 集計結果 ==="
$summary | Format-List

Write-Host ""
Write-Host "=== モデル別集計 ==="
$byModel | Format-Table -AutoSize

Write-Host ""
Write-Host "=== エラー内訳 ==="
$errorBreakdown | Format-Table -AutoSize

Write-Host ""
Write-Host "CSV  : $csvPath"
Write-Host "JSON : $jsonPath"
Write-Host "PLAN : $ResolvedOutputRoot"