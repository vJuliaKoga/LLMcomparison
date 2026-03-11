$ErrorActionPreference = 'Stop'

Set-Location "C:\Users\juria.koga\Documents\Github\LLM-test-evaluation"

$feature = "login"
$repeat = 10
$promptRoot = ".\prompts\split"
$resultRoot = ".\results"
$model = "mistral"

$config = Join-Path (Join-Path $promptRoot $model) ("promptfoo-{0}-{1}.yaml" -f $model, $feature)
if (-not (Test-Path $config)) { throw "Config not found: $config" }

$outDir = Join-Path $resultRoot $model
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$regex = [regex]::new(("^evaluation-results-{0}-{1}_(\d+)\.json$" -f [regex]::Escape($model), [regex]::Escape($feature)))
$existing = Get-ChildItem -Path $outDir -File -ErrorAction SilentlyContinue | ForEach-Object {
    $m = $regex.Match($_.Name)
    if ($m.Success) { [int]$m.Groups[1].Value }
}

$maxExisting = if ($existing) { ($existing | Measure-Object -Maximum).Maximum } else { 0 }
$startIndex = $maxExisting + 1
$remaining = $repeat - $maxExisting
if ($remaining -le 0) { Write-Host ("Already have {0} runs. Nothing to do." -f $maxExisting); exit 0 }

for ($i = 0; $i -lt $remaining; $i++) {
    $runIndex = $startIndex + $i
    $outFile = Join-Path $outDir ("evaluation-results-{0}-{1}_{2}.json" -f $model, $feature, $runIndex)
    Write-Host ""; Write-Host ("=== model={0} feature={1} run={2} ===" -f $model, $feature, $runIndex)
    Write-Host $outFile
    npx promptfoo eval -c $config --output $outFile
    if ($LASTEXITCODE -ne 0) { Write-Warning ("promptfoo eval failed: model={0}, run={1}" -f $model, $runIndex) }
}
