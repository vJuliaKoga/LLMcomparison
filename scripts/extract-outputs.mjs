/**
 * extract-outputs.mjs
 *
 * promptfoo の evaluation-results.json から各モデルの出力を抽出し、
 * results/{model_name}/{test_description}.txt  (全出力)
 * results/{model_name}/{test_description}.java (Javaコードブロックのみ)
 * として保存する。
 *
 * Usage:
 *   node scripts/extract-outputs.mjs [results/evaluation-results.json]
 */

import fs from "node:fs";
import path from "node:path";

const RESULTS_PATH = process.argv[2] ?? "./results/evaluation-results.json";
const OUTPUT_BASE = "./results";

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * provider ID からディレクトリ名に使えるモデル名を生成する。
 * 例: "openrouter:meta-llama/llama-4-scout:free" -> "llama-4-scout"
 *     "openrouter:google/gemini-2.0-flash-exp:free" -> "gemini-2.0-flash-exp"
 */
function toModelDirName(providerId) {
  return (
    providerId
      // "openrouter:" プレフィックスを除去
      .replace(/^openrouter:/, "")
      // ":free" / ":nitro" 等のサフィックスを除去
      .replace(/:[^/]+$/, "")
      // "organization/" プレフィックスを除去（最後の / 以降だけ残す）
      .replace(/^.*\//, "")
      // Windows/Linux ファイルシステムで使えない文字を "_" に置換
      .replace(/[<>:"/\\|?*]/g, "_")
  );
}

/**
 * テスト説明文をファイル名として安全な文字列に変換する。
 * 日本語はそのまま許容（Windowsでも問題なし）。
 */
function toSafeFilename(description) {
  return description
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") // 制御文字・禁止文字
    .replace(/\s+/g, "_")
    .slice(0, 100); // 長すぎるパスを防ぐ
}

/**
 * LLM 出力から ```java ... ``` ブロックを抽出する。
 * 複数ブロックがある場合は結合して返す。
 */
function extractJavaBlocks(text) {
  const matches = [...text.matchAll(/```java\s*([\s\S]*?)\s*```/gm)];
  if (matches.length === 0) return null;
  return matches.map((m) => m[1]).join("\n\n");
}

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------

if (!fs.existsSync(RESULTS_PATH)) {
  console.error(`❌ File not found: ${RESULTS_PATH}`);
  console.error("先に promptfoo eval を実行してください。");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));

// promptfoo の出力構造は version によって異なるため両方に対応
// v3: { evalId, results: { version, results: [...], ... } }
// v2: { results: [...], ... }
const allResults =
  raw?.results?.results ?? // v3
  raw?.results ?? // v2 flat
  [];

if (!Array.isArray(allResults) || allResults.length === 0) {
  console.error("❌ 結果が見つかりません。evaluation-results.json の構造を確認してください。");
  process.exit(1);
}

console.log(`📂 Results path : ${path.resolve(RESULTS_PATH)}`);
console.log(`📦 Total entries: ${allResults.length}\n`);

let saved = 0;
let skipped = 0;

for (const result of allResults) {
  // provider ID
  const providerId =
    result?.provider?.id ?? result?.provider ?? "(unknown-provider)";

  // テスト説明（description は testCase 配下にある場合もある）
  const description =
    result?.testCase?.description ??
    result?.description ??
    `test_${saved + skipped}`;

  // LLM の出力テキスト
  const output = result?.response?.output ?? result?.output ?? "";

  if (!output) {
    console.warn(`⚠️  Skip (no output): [${providerId}] ${description}`);
    skipped++;
    continue;
  }

  const modelDir = toModelDirName(providerId);
  const filename = toSafeFilename(description);
  const dirPath = path.join(OUTPUT_BASE, modelDir);

  fs.mkdirSync(dirPath, { recursive: true });

  // --- 全出力を .txt として保存 ---
  const txtPath = path.join(dirPath, `${filename}.txt`);
  fs.writeFileSync(txtPath, output, "utf8");

  // --- Java コードブロックを .java として保存 ---
  const javaCode = extractJavaBlocks(output);
  let javaSaved = false;
  if (javaCode) {
    const javaPath = path.join(dirPath, `${filename}.java`);
    fs.writeFileSync(javaPath, javaCode, "utf8");
    javaSaved = true;
  }

  console.log(
    `✅ [${modelDir}] ${filename}.txt${javaSaved ? " + .java" : " (no Java block)"}`
  );
  saved++;
}

console.log(`\n📊 Saved: ${saved}  Skipped: ${skipped}`);
console.log(`📁 Output base: ${path.resolve(OUTPUT_BASE)}/`);
console.log(`\n次のステップ:`);
console.log(`  node validation/validate-output.mjs results/<model>/<test>.txt`);
