param(
    [string]$ResultsRoot = "reports/playwright-results",
    [string]$ReportDir = "reports"
)

$ErrorActionPreference = "Stop"

function Get-FeatureName {
    param([string]$SourceStem, [string]$MetaFeature)

    if (-not [string]::IsNullOrWhiteSpace($MetaFeature)) {
        return $MetaFeature
    }

    $lower = $SourceStem.ToLower()
    if ($lower -match "login") { return "ログイン" }
    if ($lower -match "rbac") { return "監査ログ" }
    if ($lower -match "transfer") { return "振込" }
    return "不明"
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ResolvedResultsRoot = Join-Path $ProjectRoot $ResultsRoot
$ResolvedReportDir = Join-Path $ProjectRoot $ReportDir

if (-not (Test-Path $ResolvedResultsRoot)) {
    throw "Playwright result ディレクトリが見つかりません: $ResolvedResultsRoot"
}

New-Item -ItemType Directory -Force -Path $ResolvedReportDir | Out-Null

$resultFiles = Get-ChildItem $ResolvedResultsRoot -Recurse -Filter "*.playwright-result.json" | Sort-Object FullName
if ($resultFiles.Count -eq 0) {
    throw "playwright-result.json が見つかりませんでした: $ResolvedResultsRoot"
}

Write-Host "Project root : $ProjectRoot"
Write-Host "Results root : $ResolvedResultsRoot"
Write-Host "Report dir   : $ResolvedReportDir"
Write-Host "Result files : $($resultFiles.Count)"
Write-Host ""

$fileRows = @()
$methodRows = @()

foreach ($file in $resultFiles) {
    Write-Host "Checking: $($file.FullName)"

    $obj = Get-Content $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100

    $relative = $file.FullName.Substring($ResolvedResultsRoot.Length).TrimStart("\")
    $parts = $relative -split "[\\/]"
    $model = if ($parts.Length -ge 1) { $parts[0] } else { "" }
    $sourceStem = if ($parts.Length -ge 2) { $parts[1] } else { "" }
    $caseName = if ($parts.Length -ge 3) { $parts[2] } else { "" }

    $meta = $obj.meta
    $summary = $obj.summary
    $methodResults = @($obj.method_results)
    $commonFailures = $obj.common_failures

    $feature = Get-FeatureName -SourceStem $sourceStem -MetaFeature ([string]$meta.feature)

    foreach ($m in $methodResults) {
        $locatorFailures = @($m.locator_failures)
        $methodRows += [pscustomobject]@{
            Path            = $file.FullName
            Model           = $model
            SourceStem      = $sourceStem
            Case            = $caseName
            Feature         = $feature
            PlanPath        = [string]$meta.plan_path
            MethodName      = [string]$m.name
            Status          = [string]$m.status
            TotalSteps      = [int]$m.total_steps
            ExecutedSteps   = [int]$m.executed_steps
            FailedStepSeq   = if ($null -eq $m.failed_step_seq) { "" } else { [string]$m.failed_step_seq }
            FailedTool      = [string]$m.failed_tool
            LocatorFailures = ($locatorFailures -join " | ")
            Notes           = [string]$m.notes
        }
    }

    $commonFailedTools = @($commonFailures.failed_tools)
    $commonLocatorFailures = @($commonFailures.locator_failures)

    $fileRows += [pscustomobject]@{
        Path            = $file.FullName
        Model           = $model
        SourceStem      = $sourceStem
        Case            = $caseName
        Feature         = $feature
        PlanPath        = [string]$meta.plan_path
        ExecutedAt      = [string]$meta.executed_at
        BaseUrl         = [string]$meta.base_url
        OverallStatus   = [string]$obj.overall_status
        TotalMethods    = [int]$summary.total_methods
        PassMethods     = [int]$summary.pass_methods
        FailMethods     = [int]$summary.fail_methods
        BlockedMethods  = [int]$summary.blocked_methods
        TotalSteps      = [int]$summary.total_steps
        ExecutedSteps   = [int]$summary.executed_steps
        PassedSteps     = [int]$summary.passed_steps
        FailedSteps     = [int]$summary.failed_steps
        BlockedSteps    = [int]$summary.blocked_steps
        FailedTools     = ($commonFailedTools -join " | ")
        LocatorFailures = ($commonLocatorFailures -join " | ")
        Notes           = [string]$obj.notes
    }
}

$summaryObj = [pscustomobject]@{
    総結果ファイル数     = $fileRows.Count
    pass件数       = ($fileRows | Where-Object { $_.OverallStatus -eq "pass" }).Count
    fail件数       = ($fileRows | Where-Object { $_.OverallStatus -eq "fail" }).Count
    blocked件数    = ($fileRows | Where-Object { $_.OverallStatus -eq "blocked" }).Count
    partial件数    = ($fileRows | Where-Object { $_.OverallStatus -eq "partial" }).Count
    総メソッド数       = ($fileRows | Measure-Object TotalMethods -Sum).Sum
    総ステップ数       = ($fileRows | Measure-Object TotalSteps -Sum).Sum
    実行済みステップ数    = ($fileRows | Measure-Object ExecutedSteps -Sum).Sum
    成功ステップ数      = ($fileRows | Measure-Object PassedSteps -Sum).Sum
    失敗ステップ数      = ($fileRows | Measure-Object FailedSteps -Sum).Sum
    blockedステップ数 = ($fileRows | Measure-Object BlockedSteps -Sum).Sum
}

$byModel = $fileRows |
Group-Object Model |
ForEach-Object {
    [pscustomobject]@{
        モデル名         = $_.Name
        結果ファイル数      = $_.Count
        pass件数       = ($_.Group | Where-Object { $_.OverallStatus -eq "pass" }).Count
        fail件数       = ($_.Group | Where-Object { $_.OverallStatus -eq "fail" }).Count
        blocked件数    = ($_.Group | Where-Object { $_.OverallStatus -eq "blocked" }).Count
        partial件数    = ($_.Group | Where-Object { $_.OverallStatus -eq "partial" }).Count
        総メソッド数       = ($_.Group | Measure-Object TotalMethods -Sum).Sum
        総ステップ数       = ($_.Group | Measure-Object TotalSteps -Sum).Sum
        成功ステップ数      = ($_.Group | Measure-Object PassedSteps -Sum).Sum
        失敗ステップ数      = ($_.Group | Measure-Object FailedSteps -Sum).Sum
        blockedステップ数 = ($_.Group | Measure-Object BlockedSteps -Sum).Sum
    }
} |
Sort-Object モデル名

$byFeature = $fileRows |
Group-Object Feature |
ForEach-Object {
    [pscustomobject]@{
        Feature      = $_.Name
        結果ファイル数      = $_.Count
        pass件数       = ($_.Group | Where-Object { $_.OverallStatus -eq "pass" }).Count
        fail件数       = ($_.Group | Where-Object { $_.OverallStatus -eq "fail" }).Count
        blocked件数    = ($_.Group | Where-Object { $_.OverallStatus -eq "blocked" }).Count
        partial件数    = ($_.Group | Where-Object { $_.OverallStatus -eq "partial" }).Count
        総メソッド数       = ($_.Group | Measure-Object TotalMethods -Sum).Sum
        総ステップ数       = ($_.Group | Measure-Object TotalSteps -Sum).Sum
        成功ステップ数      = ($_.Group | Measure-Object PassedSteps -Sum).Sum
        失敗ステップ数      = ($_.Group | Measure-Object FailedSteps -Sum).Sum
        blockedステップ数 = ($_.Group | Measure-Object BlockedSteps -Sum).Sum
    }
} |
Sort-Object Feature

$failedToolBreakdown = $methodRows |
Where-Object { $_.FailedTool } |
Group-Object FailedTool |
Sort-Object Count -Descending |
Select-Object Count, Name

$locatorFailureBreakdown = $methodRows |
Where-Object { $_.LocatorFailures } |
ForEach-Object {
    foreach ($loc in ($_.LocatorFailures -split " \| ")) {
        if (-not [string]::IsNullOrWhiteSpace($loc)) {
            [pscustomobject]@{ Locator = $loc }
        }
    }
} |
Group-Object Locator |
Sort-Object Count -Descending |
Select-Object Count, Name

$methodStatusBreakdown = $methodRows |
Group-Object Status |
Sort-Object Count -Descending |
Select-Object Count, Name

$fileCsvPath = Join-Path $ResolvedReportDir "playwright-mcp-summary.csv"
$methodCsvPath = Join-Path $ResolvedReportDir "playwright-mcp-methods.csv"
$jsonPath = Join-Path $ResolvedReportDir "playwright-mcp-summary.json"

$fileRows | Export-Csv $fileCsvPath -NoTypeInformation -Encoding UTF8
$methodRows | Export-Csv $methodCsvPath -NoTypeInformation -Encoding UTF8

@{
    summary                 = $summaryObj
    byModel                 = $byModel
    byFeature               = $byFeature
    methodStatusBreakdown   = $methodStatusBreakdown
    failedToolBreakdown     = $failedToolBreakdown
    locatorFailureBreakdown = $locatorFailureBreakdown
    files                   = $fileRows
    methods                 = $methodRows
} | ConvertTo-Json -Depth 50 | Set-Content $jsonPath -Encoding UTF8

Write-Host ""
Write-Host "=== 集計結果 ==="
$summaryObj | Format-List

Write-Host ""
Write-Host "=== モデル別集計 ==="
$byModel | Format-Table -AutoSize

Write-Host ""
Write-Host "=== Feature 別集計 ==="
$byFeature | Format-Table -AutoSize

Write-Host ""
Write-Host "=== Method status 内訳 ==="
$methodStatusBreakdown | Format-Table -AutoSize

Write-Host ""
Write-Host "=== Failed tool 内訳 ==="
$failedToolBreakdown | Format-Table -AutoSize

Write-Host ""
Write-Host "=== Locator failure 内訳 ==="
$locatorFailureBreakdown | Format-Table -AutoSize

Write-Host ""
Write-Host "FILES CSV  : $fileCsvPath"
Write-Host "METHOD CSV : $methodCsvPath"
Write-Host "JSON       : $jsonPath"