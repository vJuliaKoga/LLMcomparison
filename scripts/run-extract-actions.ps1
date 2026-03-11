param(
    [string]$ExtractedRoot = "results/extracted",
    [string]$ReportDir = "reports",
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
$ExtractActionsModule = Join-Path $ProjectRoot "mcp\junit-validator\tools\extract-actions.mjs"

if (-not (Test-Executable -CommandPath $NodePath)) {
    throw "node が見つかりません: $NodePath"
}

if (-not (Test-Path $ResolvedExtractedRoot)) {
    throw "抽出済みディレクトリが見つかりません: $ResolvedExtractedRoot"
}

if (-not (Test-Path $ExtractActionsModule)) {
    throw "extract-actions.mjs が見つかりません: $ExtractActionsModule"
}

New-Item -ItemType Directory -Force -Path $ResolvedReportDir | Out-Null

$javaFiles = Get-ChildItem $ResolvedExtractedRoot -Recurse -Filter "*.java" | Sort-Object FullName
if ($javaFiles.Count -eq 0) {
    throw ".java ファイルが見つかりませんでした: $ResolvedExtractedRoot"
}

Write-Host "Project root  : $ProjectRoot"
Write-Host "Extracted root: $ResolvedExtractedRoot"
Write-Host "Report dir    : $ResolvedReportDir"
Write-Host "Java files    : $($javaFiles.Count)"
Write-Host ""

$nodeCode = @'
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

$methodRows = @()
$fileRows = @()

Push-Location $ProjectRoot
try {
    foreach ($javaFile in $javaFiles) {
        Write-Host "Checking: $($javaFile.FullName)"

        $relative = $javaFile.FullName.Substring($ResolvedExtractedRoot.Length).TrimStart("\")
        $parts = $relative -split "[\\/]"
        $model = if ($parts.Length -ge 1) { $parts[0] } else { "" }
        $sourceStem = if ($parts.Length -ge 2) { $parts[1] } else { "" }
        $caseName = if ($parts.Length -ge 3) { $parts[2] } else { "" }

        $tempJson = Join-Path ([System.IO.Path]::GetTempPath()) ("extract-actions-" + [System.Guid]::NewGuid().ToString() + ".json")

        try {
            & $NodePath -e $nodeCode $ExtractActionsModule $javaFile.FullName $tempJson 2>$null

            if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tempJson)) {
                $fileRows += [pscustomobject]@{
                    Path                 = $javaFile.FullName
                    Model                = $model
                    SourceStem           = $sourceStem
                    Case                 = $caseName
                    FileName             = $javaFile.Name
                    TestMethodCount      = 0
                    ActionCount          = 0
                    MethodsWithNoActions = 0
                    WarningCount         = 0
                    Actionable           = $false
                    Error                = "extract-actions.mjs の実行に失敗しました"
                }
                continue
            }

            $result = Get-Content $tempJson -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 50

            $summary = $result.summary
            $testMethods = @($result.testMethods)

            foreach ($m in $testMethods) {
                $actions = @($m.actions)
                $warnings = @($m.warnings)
                $actionTypes = @($actions | ForEach-Object { $_.type }) -join ", "

                $methodRows += [pscustomobject]@{
                    Path         = $javaFile.FullName
                    Model        = $model
                    SourceStem   = $sourceStem
                    Case         = $caseName
                    FileName     = $javaFile.Name
                    TestMethod   = [string]$m.name
                    ActionCount  = $actions.Count
                    WarningCount = $warnings.Count
                    ActionTypes  = $actionTypes
                    Warnings     = ($warnings -join " | ")
                }
            }

            $fileRows += [pscustomobject]@{
                Path                 = $javaFile.FullName
                Model                = $model
                SourceStem           = $sourceStem
                Case                 = $caseName
                FileName             = $javaFile.Name
                TestMethodCount      = [int]$summary.testMethodCount
                ActionCount          = [int]$summary.actionCount
                MethodsWithNoActions = [int]$summary.methodsWithNoActions
                WarningCount         = [int]$summary.warningCount
                Actionable           = ([int]$summary.actionCount -gt 0 -and [int]$summary.methodsWithNoActions -eq 0)
                Error                = ""
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
    総ファイル数          = $fileRows.Count
    アクション抽出成功ファイル数  = ($fileRows | Where-Object { -not $_.Error }).Count
    Actionableファイル数 = ($fileRows | Where-Object Actionable).Count
    総テストメソッド数       = ($fileRows | Measure-Object TestMethodCount -Sum).Sum
    総アクション数         = ($fileRows | Measure-Object ActionCount -Sum).Sum
    アクションなしメソッド数    = ($fileRows | Measure-Object MethodsWithNoActions -Sum).Sum
    Warning総数       = ($fileRows | Measure-Object WarningCount -Sum).Sum
}

$actionTypeBreakdown = $methodRows |
Where-Object { $_.ActionTypes } |
ForEach-Object {
    foreach ($t in ($_.ActionTypes -split ", ")) {
        if (-not [string]::IsNullOrWhiteSpace($t)) {
            [pscustomobject]@{ 種別 = $t }
        }
    }
} |
Group-Object 種別 |
Sort-Object Count -Descending |
Select-Object Count, Name

$warningBreakdown = $methodRows |
Where-Object { $_.Warnings } |
ForEach-Object {
    foreach ($w in ($_.Warnings -split " \| ")) {
        if (-not [string]::IsNullOrWhiteSpace($w)) {
            [pscustomobject]@{ 内容 = $w }
        }
    }
} |
Group-Object 内容 |
Sort-Object Count -Descending |
Select-Object Count, Name

$byModel = $fileRows |
Group-Object Model |
ForEach-Object {
    [pscustomobject]@{
        モデル名            = $_.Name
        ファイル数           = $_.Count
        Actionableファイル数 = ($_.Group | Where-Object Actionable).Count
        総アクション数         = ($_.Group | Measure-Object ActionCount -Sum).Sum
        総Warning数       = ($_.Group | Measure-Object WarningCount -Sum).Sum
        アクションなしメソッド数    = ($_.Group | Measure-Object MethodsWithNoActions -Sum).Sum
    }
} |
Sort-Object モデル名

$fileCsvPath = Join-Path $ResolvedReportDir "extract-actions-files.csv"
$methodCsvPath = Join-Path $ResolvedReportDir "extract-actions-methods.csv"
$jsonPath = Join-Path $ResolvedReportDir "extract-actions-summary.json"

$fileRows | Export-Csv $fileCsvPath -NoTypeInformation -Encoding UTF8
$methodRows | Export-Csv $methodCsvPath -NoTypeInformation -Encoding UTF8

@{
    summary             = $summary
    actionTypeBreakdown = $actionTypeBreakdown
    warningBreakdown    = $warningBreakdown
    byModel             = $byModel
    files               = $fileRows
    methods             = $methodRows
} | ConvertTo-Json -Depth 20 | Set-Content $jsonPath -Encoding UTF8

Write-Host ""
Write-Host "=== 集計結果 ==="
$summary | Format-List

Write-Host ""
Write-Host "=== Action 種別内訳 ==="
$actionTypeBreakdown | Format-Table -AutoSize

Write-Host ""
Write-Host "=== Warning 内訳 ==="
$warningBreakdown | Format-Table -AutoSize

Write-Host ""
Write-Host "=== モデル別集計 ==="
$byModel | Format-Table -AutoSize

Write-Host ""
Write-Host "FILES CSV  : $fileCsvPath"
Write-Host "METHOD CSV : $methodCsvPath"
Write-Host "JSON       : $jsonPath"