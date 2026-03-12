このワークスペースのターミナルで次の PowerShell を実行してください。
prompts\split 配下のモデルフォルダ名を拾い、deepseek / gemini / template を除外して、
login 評価を各モデル 10 回ずつ順番に実行してください。
結果は results\<model>\evaluation-results-<model>-login\_<連番>.json に保存し、
既存の \_1, \_2 ... がある場合は続き番号から保存してください。

Set-Location "C:\Users\juria.koga\Documents\Github\LLM-test-evaluation"

$feature    = "login"
$repeat = 10
$promptRoot = ".\prompts\split"
$resultRoot = ".\results"
$exclude = @("deepseek", "gemini", "template")

$models = Get-ChildItem -Path $promptRoot -Directory |
Where-Object { $\_.Name -notin $exclude } |
Sort-Object Name |
Select-Object -ExpandProperty Name

foreach ($model in $models) {
$config = Join-Path (Join-Path $promptRoot $model) ("promptfoo-{0}-{1}.yaml" -f $model, $feature)
if (-not (Test-Path $config)) {
Write-Warning "Config not found: $config"
continue
}

$outDir = Join-Path $resultRoot $model
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$regex = [regex]::new(("^evaluation-results-{0}-{1}_(\d+)\.json$" -f [regex]::Escape($model), [regex]::Escape($feature)))
$existing = Get-ChildItem -Path $outDir -File -ErrorAction SilentlyContinue | ForEach-Object {
    $m = $regex.Match($\_.Name)
if ($m.Success) { [int]$m.Groups[1].Value }
}

if ($existing) {
    $startIndex = (($existing | Measure-Object -Maximum).Maximum + 1)
} else {
$startIndex = 1
}

0..($repeat - 1) | ForEach-Object {
$runIndex = $startIndex + $_
$outFile = Join-Path $outDir ("evaluation-results-{0}-{1}_{2}.json" -f $model, $feature, $runIndex)

    Write-Host ""
    Write-Host ("=== model={0} feature={1} run={2} ===" -f $model, $feature, $runIndex)
    Write-Host $outFile

    npx promptfoo eval `
      -c $config `
      --output $outFile

    if ($LASTEXITCODE -ne 0) {
      Write-Warning ("promptfoo eval failed: model={0}, run={1}" -f $model, $runIndex)
    }

