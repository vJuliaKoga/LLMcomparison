param(
    [string]$ExtractedRoot = "results/extracted",
    [string]$ReportDir = "reports"
)

$ErrorActionPreference = "Stop"

function Test-CommandExists {
    param([string]$CommandName)
    return [bool](Get-Command $CommandName -ErrorAction SilentlyContinue)
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ResolvedExtractedRoot = Join-Path $ProjectRoot $ExtractedRoot
$ResolvedReportDir = Join-Path $ProjectRoot $ReportDir
$ValidateSyntaxModule = Join-Path $ProjectRoot "mcp\junit-validator\tools\validate-syntax.mjs"

if (-not (Test-CommandExists "node")) {
    throw "node が見つかりません。Node.js をインストールしてください。"
}

if (-not (Test-Path $ResolvedExtractedRoot)) {
    throw "抽出済みディレクトリが見つかりません: $ResolvedExtractedRoot"
}

if (-not (Test-Path $ValidateSyntaxModule)) {
    throw "validate-syntax.mjs が見つかりません: $ValidateSyntaxModule"
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

const moduleUrl = pathToFileURL(modulePath).href;
const mod = await import(moduleUrl);

const code = fs.readFileSync(javaPath, "utf8");
const result = mod.validateSyntax(code);
console.log(JSON.stringify(result, null, 2));
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

        $raw = (& node -e $nodeCode $ValidateSyntaxModule $javaFile.FullName 2>&1 | Out-String).Trim()

        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
            $rows += [pscustomobject]@{
                Path         = $javaFile.FullName
                Model        = $model
                SourceStem   = $sourceStem
                Case         = $caseName
                FileName     = $javaFile.Name
                Valid        = $false
                TestCount    = 0
                ErrorCount   = 0
                WarningCount = 0
                Errors       = ""
                Warnings     = ""
                Error        = $raw
            }
            continue
        }

        $obj = $raw | ConvertFrom-Json -Depth 20
        $errors = @($obj.errors)
        $warnings = @($obj.warnings)

        $rows += [pscustomobject]@{
            Path         = $javaFile.FullName
            Model        = $model
            SourceStem   = $sourceStem
            Case         = $caseName
            FileName     = $javaFile.Name
            Valid        = [bool]$obj.valid
            TestCount    = [int]$obj.testCount
            ErrorCount   = $errors.Count
            WarningCount = $warnings.Count
            Errors       = ($errors -join " | ")
            Warnings     = ($warnings -join " | ")
            Error        = ""
        }
    }
}
finally {
    Pop-Location
}

$summary = [pscustomobject]@{
    総ファイル数      = $rows.Count
    構文チェック通過件数  = ($rows | Where-Object Valid).Count
    構文チェック失敗件数  = ($rows | Where-Object { -not $_.Valid }).Count
    Warningあり件数 = ($rows | Where-Object { $_.WarningCount -gt 0 }).Count
    平均          = if ($rows.Count -gt 0) { [math]::Round((($rows | Measure-Object TestCount -Average).Average), 2) } else { 0 }
}

$errorBreakdown = $rows |
Where-Object { $_.Errors } |
ForEach-Object {
    foreach ($issue in ($_.Errors -split " \| ")) {
        if (-not [string]::IsNullOrWhiteSpace($issue)) {
            [pscustomobject]@{ Issue = $issue }
        }
    }
} |
Group-Object Issue |
Sort-Object Count -Descending |
Select-Object Count, Name

$warningBreakdown = $rows |
Where-Object { $_.Warnings } |
ForEach-Object {
    foreach ($issue in ($_.Warnings -split " \| ")) {
        if (-not [string]::IsNullOrWhiteSpace($issue)) {
            [pscustomobject]@{ Issue = $issue }
        }
    }
} |
Group-Object Issue |
Sort-Object Count -Descending |
Select-Object Count, Name

$byModel = $rows |
Group-Object Model |
ForEach-Object {
    [pscustomobject]@{
        モデル名        = $_.Name
        ファイル数       = $_.Count
        構文チェック通過件数  = ($_.Group | Where-Object Valid).Count
        構文チェック失敗件数  = ($_.Group | Where-Object { -not $_.Valid }).Count
        Warningあり件数 = ($_.Group | Where-Object { $_.WarningCount -gt 0 }).Count
        平均          = [math]::Round((($_.Group | Measure-Object TestCount -Average).Average), 2)
    }
} |
Sort-Object モデル名

$csvPath = Join-Path $ResolvedReportDir "validate-syntax-summary.csv"
$jsonPath = Join-Path $ResolvedReportDir "validate-syntax-summary.json"

$rows | Export-Csv $csvPath -NoTypeInformation -Encoding UTF8

@{
    summary          = $summary
    errorBreakdown   = $errorBreakdown
    warningBreakdown = $warningBreakdown
    byModel          = $byModel
    rows             = $rows
} | ConvertTo-Json -Depth 10 | Set-Content $jsonPath -Encoding UTF8

Write-Host ""
Write-Host "=== 集計結果 ==="
$summary | Format-List

Write-Host ""
Write-Host "=== エラー内訳 ==="
$errorBreakdown | Format-Table -AutoSize

Write-Host ""
Write-Host "=== Warning内訳 ==="
$warningBreakdown | Format-Table -AutoSize

Write-Host ""
Write-Host "=== モデル別集計 ==="
$byModel | Format-Table -AutoSize

Write-Host ""
Write-Host "CSV : $csvPath"
Write-Host "JSON: $jsonPath"