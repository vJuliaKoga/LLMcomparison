#!/usr/bin/env bash
# run-pipeline.sh
#
# promptfoo eval → 出力抽出 → validate-output.mjs による型精査
# まで一気通貫で実行するパイプラインスクリプト。
#
# Usage:
#   bash scripts/run-pipeline.sh

set -euo pipefail

RESULTS_JSON="./results/evaluation-results.json"
VALIDATION_SCRIPT="./validation/validate-output.mjs"

# ─── Step 1: promptfoo eval ───────────────────────────────────────────────
echo "=== [1/3] promptfoo eval 実行 ==="
npx promptfoo eval --config prompts/promptfoo.yaml
echo ""

# ─── Step 2: 各モデルの出力を results/{model}/ に保存 ─────────────────────
echo "=== [2/3] 出力の抽出・保存 ==="
node scripts/extract-outputs.mjs "$RESULTS_JSON"
echo ""

# ─── Step 3: validate-output.mjs で型精査 ─────────────────────────────────
echo "=== [3/3] validate-output.mjs による型精査 ==="

PASS=0
FAIL=0

# results/ 直下の各モデルディレクトリを走査
for model_dir in ./results/*/; do
  # evaluation-results.json 自体はスキップ
  [ -d "$model_dir" ] || continue

  for txt_file in "$model_dir"*.txt; do
    [ -f "$txt_file" ] || continue
    echo "--- $txt_file"
    if node "$VALIDATION_SCRIPT" "$txt_file"; then
      PASS=$((PASS + 1))
    else
      FAIL=$((FAIL + 1))
    fi
  done
done

echo ""
echo "=== 型精査 結果サマリ ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  echo "⚠️  一部のファイルが型精査に失敗しました。"
  exit 1
else
  echo "✅ すべて型精査 OK"
fi
