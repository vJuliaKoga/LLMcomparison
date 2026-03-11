param(
    [string]$ExtractedRoot = "results/extracted",
    [string]$ReportDir = "reports",
    [string]$Classpath = "",
    [string]$LibDir = "",
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
$CompileModule = Join-Path $ProjectRoot "mcp\junit-validator\tools\compile.mjs"

if (-not (Test-Executable -CommandPath $NodePath)) {
    throw "node が見つかりません: $NodePath"
}

if (-not (Test-Executable -CommandPath "javac" -VersionArg "-version")) {
    Write-Warning "javac が見つかりません。実行しても skipped が多発します。"
}

if (-not (Test-Path $ResolvedExtractedRoot)) {
    throw "抽出済みディレクトリが見つかりません: $ResolvedExtractedRoot"
}

if (-not (Test-Path $CompileModule)) {
    throw "compile.mjs が見つかりません: $CompileModule"
}

New-Item -ItemType Directory -Force -Path $ResolvedReportDir | Out-Null

$javaFiles = Get-ChildItem $ResolvedExtractedRoot -Recurse -Filter "*.java" | Sort-Object FullName
if ($javaFiles.Count -eq 0) {
    throw ".java ファイルが見つかりませんでした: $ResolvedExtractedRoot"
}

$resolvedClasspath = $Classpath

if ($LibDir) {
    $resolvedLibDir = Join-Path $ProjectRoot $LibDir
    if (-not (Test-Path $resolvedLibDir)) {
        throw "LibDir が見つかりません: $resolvedLibDir"
    }

    $jars = Get-ChildItem $resolvedLibDir -Recurse -Filter "*.jar" | Select-Object -ExpandProperty FullName
    if ($jars.Count -gt 0) {
        $jarClasspath = ($jars -join [IO.Path]::PathSeparator)
        if ([string]::IsNullOrWhiteSpace($resolvedClasspath)) {
            $resolvedClasspath = $jarClasspath
        }
        else {
            $resolvedClasspath = $resolvedClasspath + [IO.Path]::PathSeparator + $jarClasspath
        }
    }
}

Write-Host "Project root  : $ProjectRoot"
Write-Host "Extracted root: $ResolvedExtractedRoot"
Write-Host "Report dir    : $ResolvedReportDir"
Write-Host "Java files    : $($javaFiles.Count)"
Write-Host "Classpath set : $([bool](-not [string]::IsNullOrWhiteSpace($resolvedClasspath)))"
Write-Host ""

$nodeCode = @'
import { pathToFileURL } from "node:url";

const modulePath = process.argv[1];
const javaPath = process.argv[2];
const classpath = process.argv[3] ?? "";

const moduleUrl = pathToFileURL(modulePath).href;
const mod = await import(moduleUrl);

const result = await mod.compile(javaPath, classpath);
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

        $raw = (& $NodePath -e $nodeCode $CompileModule $javaFile.FullName $resolvedClasspath 2>&1 | Out-String).Trim()

        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
            $rows += [pscustomobject]@{
                Path       = $javaFile.FullName
                Model      = $model
                SourceStem = $sourceStem
                Case       = $caseName
                FileName   = $javaFile.Name
                Status     = "error"
                ErrorCount = 0
                Errors     = ""
                Output     = ""
                ExecError  = $raw
            }
            continue
        }

        $obj = $raw | ConvertFrom-Json -Depth 20
        $errors = @($obj.errors)

        $rows += [pscustomobject]@{
            Path       = $javaFile.FullName
            Model      = $model
            SourceStem = $sourceStem
            Case       = $caseName
            FileName   = $javaFile.Name
            Status     = [string]$obj.status
            ErrorCount = $errors.Count
            Errors     = ($errors -join " | ")
            Output     = [string]$obj.output
            ExecError  = ""
        }
    }
}
finally {
    Pop-Location
}

$summary = [pscustomobject]@{
    総ファイル数    = $rows.Count
    コンパイル成功件数 = ($rows | Where-Object { $_.Status -eq "ok" }).Count
    コンパイル失敗件数 = ($rows | Where-Object { $_.Status -eq "error" }).Count
    スキップ件数    = ($rows | Where-Object { $_.Status -eq "skipped" }).Count
}

$errorBreakdown = $rows |
Where-Object { $_.Errors } |
ForEach-Object {
    foreach ($issue in ($_.Errors -split " \| ")) {
        if (-not [string]::IsNullOrWhiteSpace($issue)) {
            [pscustomobject]@{ 内容 = $issue }
        }
    }
} |
Group-Object 内容 |
Sort-Object Count -Descending |
Select-Object Count, Name

$byModel = $rows |
Group-Object Model |
ForEach-Object {
    [pscustomobject]@{
        モデル名      = $_.Name
        ファイル数     = $_.Count
        コンパイル成功件数 = ($_.Group | Where-Object { $_.Status -eq "ok" }).Count
        コンパイル失敗件数 = ($_.Group | Where-Object { $_.Status -eq "error" }).Count
        スキップ件数    = ($_.Group | Where-Object { $_.Status -eq "skipped" }).Count
    }
} |
Sort-Object モデル名

$csvPath = Join-Path $ResolvedReportDir "compile-summary.csv"
$jsonPath = Join-Path $ResolvedReportDir "compile-summary.json"

$rows | Export-Csv $csvPath -NoTypeInformation -Encoding UTF8

@{
    summary        = $summary
    errorBreakdown = $errorBreakdown
    byModel        = $byModel
    rows           = $rows
} | ConvertTo-Json -Depth 10 | Set-Content $jsonPath -Encoding UTF8

Write-Host ""
Write-Host "=== 集計結果 ==="
$summary | Format-List

Write-Host ""
Write-Host "=== エラー内訳 ==="
$errorBreakdown | Format-Table -AutoSize

Write-Host ""
Write-Host "=== モデル別集計 ==="
$byModel | Format-Table -AutoSize

Write-Host ""
Write-Host "CSV : $csvPath"
Write-Host "JSON: $jsonPath"