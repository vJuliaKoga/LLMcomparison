$ErrorActionPreference = 'Stop'

Set-Location "C:\Users\juria.koga\Documents\Github\LLM-test-evaluation"

$feature = "login"
$repeat = 10
$promptRoot = ".\prompts\split"
$resultRoot = ".\results"
$model = "glm"

$config = Join-Path (Join-Path $promptRoot $model) ("promptfoo-{0}-{1}.yaml" -f $model, $feature)
if (-not (Test-Path $config)) { throw "Config not found: $config" }

$outDir = Join-Path $resultRoot $model
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

for ($runIndex = 1; $runIndex -le $repeat; $runIndex++) {
    $outFile = Join-Path $outDir ("evaluation-results-{0}-{1}_{2}.json" -f $model, $feature, $runIndex)
    Write-Host ""; Write-Host ("=== model={0} feature={1} run={2} (overwrite) ===" -f $model, $feature, $runIndex)
    Write-Host $outFile
    npx promptfoo eval -c $config --output $outFile
    if ($LASTEXITCODE -ne 0) {
        Write-Warning ("promptfoo eval failed: model={0}, run={1}" -f $model, $runIndex)
    }
}
