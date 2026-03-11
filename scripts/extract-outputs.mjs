/**
 * extract-outputs.mjs
 *
 * promptfoo の evaluation-results*.json から各モデルの出力を抽出し、
 * 解析しやすい .txt / .java / metadata.json / manifest.json を生成する。
 *
 * 主な改善点:
 *   - 単一 JSON だけでなく、ディレクトリ配下の evaluation-results*.json を再帰処理
 *   - repeat 実行でも上書きしにくい保存構造（source JSON ごとのサブディレクトリ）
 *   - public class 名を使って .java を保存し、compile しやすくする
 *   - 同一 description / 同一 class 名の重複にも対応
 *   - 既存ファイルを上書きする場合は archive/ へ退避
 *   - manifest.json を出力して後続の一括検証に使いやすくする
 *   - Cohere の provider.id が chat の場合でも、実モデル名を優先してディレクトリ名を決める
 *
 * Usage:
 *   node scripts/extract-outputs.mjs
 *   node scripts/extract-outputs.mjs ./results
 *   node scripts/extract-outputs.mjs ./results/gemma/evaluation-results-gemma-login_1.json
 *   node scripts/extract-outputs.mjs ./results --output-base ./results/extracted
 *   node scripts/extract-outputs.mjs ./results --no-archive
 */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_INPUT = "./results";
const DEFAULT_OUTPUT_BASE = "./results/extracted";
const TIMESTAMP = makeTimestamp(new Date());
const COHERE_CHAT_FALLBACK_MODEL = "command-r7b-12-2024";

function makeTimestamp(date) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function parseArgs(argv) {
  const opts = {
    inputPath: DEFAULT_INPUT,
    outputBase: DEFAULT_OUTPUT_BASE,
    archive: true,
    verbose: true,
  };

  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--output-base") {
      opts.outputBase = argv[++i] ?? opts.outputBase;
      continue;
    }
    if (arg.startsWith("--output-base=")) {
      opts.outputBase = arg.slice("--output-base=".length);
      continue;
    }
    if (arg === "--no-archive") {
      opts.archive = false;
      continue;
    }
    if (arg === "--quiet") {
      opts.verbose = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    rest.push(arg);
  }

  if (rest[0]) {
    opts.inputPath = rest[0];
  }

  return opts;
}

function printHelp() {
  console.log(`Usage:
  node scripts/extract-outputs.mjs [inputPath] [--output-base <dir>] [--no-archive] [--quiet]

Examples:
  node scripts/extract-outputs.mjs
  node scripts/extract-outputs.mjs ./results
  node scripts/extract-outputs.mjs ./results/gemma/evaluation-results-gemma-login_1.json
  node scripts/extract-outputs.mjs ./results --output-base ./results/extracted
`);
}

function log(message, verbose = true) {
  if (verbose) {
    console.log(message);
  }
}

function warn(message) {
  console.warn(message);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function isJsonResultFile(filePath) {
  const base = path.basename(filePath).toLowerCase();
  return base.endsWith(".json") && base.startsWith("evaluation-results");
}

function collectResultFiles(inputPath) {
  if (!fs.existsSync(inputPath)) {
    fail(`❌ File or directory not found: ${inputPath}`);
  }

  const stat = fs.statSync(inputPath);
  if (stat.isFile()) {
    if (!isJsonResultFile(inputPath)) {
      fail(`❌ Not a promptfoo result file: ${inputPath}`);
    }
    return [path.resolve(inputPath)];
  }

  const files = [];
  walkDir(inputPath, files);
  files.sort((a, b) => a.localeCompare(b, "ja"));
  return files;
}

function walkDir(dirPath, out) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, out);
      continue;
    }
    if (entry.isFile() && isJsonResultFile(fullPath)) {
      out.push(path.resolve(fullPath));
    }
  }
}

function readJson(jsonPath) {
  try {
    return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch (err) {
    throw new Error(`JSON parse failed: ${jsonPath} (${err.message})`);
  }
}

function extractAllResults(raw) {
  const results = raw?.results?.results ?? raw?.results ?? [];
  return Array.isArray(results) ? results : [];
}

function toSafeFilename(value, fallback = "untitled") {
  const sanitized = String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return sanitized || fallback;
}

function extractJavaBlocks(text) {
  const javaMatches = [...String(text).matchAll(/```java\s*([\s\S]*?)\s*```/gim)];
  if (javaMatches.length > 0) {
    return javaMatches.map((m) => m[1].trim()).filter(Boolean);
  }

  const genericMatches = [...String(text).matchAll(/```\s*([\s\S]*?)\s*```/gm)];
  const javaLike = genericMatches
    .map((m) => m[1].trim())
    .filter(Boolean)
    .filter((block) => /\bpublic\s+class\b|\b@Test\b|\bWebDriver\b|org\.junit\./.test(block));

  return javaLike;
}

function extractPublicClassName(javaCode) {
  const m = String(javaCode).match(/\bpublic\s+class\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
  return m?.[1] ?? null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function archiveIfExists(filePath, archiveRoot, enabled) {
  if (!enabled || !fs.existsSync(filePath)) {
    return null;
  }

  ensureDir(archiveRoot);
  const parsed = path.parse(filePath);
  const archivedName = `${parsed.name}.${TIMESTAMP}${parsed.ext}`;
  const archivedPath = path.join(archiveRoot, archivedName);
  fs.renameSync(filePath, archivedPath);
  return archivedPath;
}

function writeFileWithArchive(filePath, content, { archiveRoot, archiveEnabled }) {
  ensureDir(path.dirname(filePath));
  const archivedPath = archiveIfExists(filePath, archiveRoot, archiveEnabled);
  fs.writeFileSync(filePath, content, "utf8");
  return archivedPath;
}

function summarizeResponseOutput(output) {
  const text = String(output || "");
  return {
    hasJavaFence: /```java/i.test(text),
    hasAnyFence: /```/.test(text),
    hasSelfValidationSection: text.includes("(D) 自己検証"),
    testAnnotationCount: (text.match(/@Test\b/g) || []).length,
  };
}

function buildCaseDirName({ index }) {
  const idx = String(index + 1).padStart(3, "0");
  return `case-${idx}`;
}

function pickFirstNonEmpty(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function buildGenericModelCandidates(result) {
  const provider = typeof result?.provider === "object" && result?.provider !== null ? result.provider : {};
  const vars = result?.vars ?? result?.testCase?.vars ?? {};

  return [
    provider?.model,
    provider?.modelName,
    provider?.model_name,
    provider?.config?.model,
    provider?.config?.modelName,
    provider?.config?.model_name,
    provider?.config?.modelId,
    provider?.config?.model_id,
    result?.model,
    result?.modelName,
    result?.model_name,
    vars?.model,
    vars?.modelName,
    vars?.model_name,
  ].filter((value) => value !== null && value !== undefined);
}

function buildCohereHintStrings(result, sourceJsonPath) {
  const provider = typeof result?.provider === "object" && result?.provider !== null ? result.provider : {};

  return [
    provider?.id,
    provider?.label,
    provider?.config?.label,
    provider?.config?.name,
    typeof result?.provider === "string" ? result.provider : "",
    sourceJsonPath,
  ].filter((value) => value !== null && value !== undefined);
}

function isLikelyCohere(result, sourceJsonPath) {
  const joined = buildCohereHintStrings(result, sourceJsonPath)
    .map((value) => String(value).toLowerCase())
    .join("\n");

  return joined.includes("cohere") || joined.includes("command-r");
}

function extractGenericModelSlug(candidate) {
  const text = String(candidate || "").trim();
  if (!text) {
    return null;
  }

  const directPatterns = [
    /(command-r7b-12-2024)/i,
    /(command-r-plus(?:-[a-z0-9._-]+)*)/i,
    /(command-r(?:-[a-z0-9._-]+)+)/i,
    /(gemma-[a-z0-9._-]+)/i,
    /(llama-[a-z0-9._-]+)/i,
    /(gpt-[a-z0-9._-]+)/i,
  ];

  for (const pattern of directPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return toSafeFilename(match[1].toLowerCase(), "unknown-provider");
    }
  }

  return null;
}

function extractCohereModelSlugFromHints(result, sourceJsonPath) {
  const hints = buildCohereHintStrings(result, sourceJsonPath);
  for (const hint of hints) {
    const text = String(hint || "").trim();
    if (!text) {
      continue;
    }

    const direct = text.match(/(command-r7b-12-2024)/i) || text.match(/(command-r(?:-[a-z0-9._-]+)+)/i);
    if (direct?.[1]) {
      return toSafeFilename(direct[1].toLowerCase(), COHERE_CHAT_FALLBACK_MODEL);
    }

    const labelLike = text
      .toLowerCase()
      .replace(/[()]/g, " ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (labelLike === "command-r7b-12-2024") {
      return labelLike;
    }
  }

  return null;
}

function fallbackModelDirFromProviderId(providerId) {
  return String(providerId || "unknown-provider")
    .replace(/^openrouter:/, "")
    .replace(/:[^/]+$/, "")
    .replace(/^.*\//, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .trim() || "unknown-provider";
}

function resolveModelDirName(result, sourceJsonPath) {
  const providerId = result?.provider?.id ?? result?.provider ?? "unknown-provider";
  const genericCandidates = buildGenericModelCandidates(result);

  for (const candidate of genericCandidates) {
    const explicit = extractGenericModelSlug(candidate);
    if (explicit) {
      return explicit;
    }
  }

  const fallback = fallbackModelDirFromProviderId(providerId);
  const fallbackSafe = toSafeFilename(fallback, "unknown-provider");

  if (isLikelyCohere(result, sourceJsonPath)) {
    const cohereExplicit = extractCohereModelSlugFromHints(result, sourceJsonPath);
    if (cohereExplicit) {
      return cohereExplicit;
    }

    if (["chat", "cohere"].includes(fallbackSafe.toLowerCase())) {
      return COHERE_CHAT_FALLBACK_MODEL;
    }
  }

  return fallbackSafe;
}

function normalizeEntry(result, index, sourceJsonPath) {
  const providerId = result?.provider?.id ?? result?.provider ?? "unknown-provider";
  const providerLabel = pickFirstNonEmpty([
    result?.provider?.label,
    result?.provider?.config?.label,
    result?.provider?.config?.name,
  ]) || null;
  const description = result?.testCase?.description ?? result?.description ?? `test_${index + 1}`;
  const output = result?.response?.output ?? result?.output ?? "";
  const feature = result?.vars?.feature ?? result?.testCase?.vars?.feature ?? null;
  const specification = result?.vars?.specification ?? result?.testCase?.vars?.specification ?? null;
  const uiContext = result?.vars?.ui_context ?? result?.testCase?.vars?.ui_context ?? null;
  const modelDir = resolveModelDirName(result, sourceJsonPath);

  return {
    sourceJsonPath,
    providerId,
    providerLabel,
    modelDir,
    description,
    output,
    feature,
    specification,
    uiContext,
    sourceIndex: index,
  };
}

function processSingleEntry(entry, sourceStem, outputBase, options) {
  if (!entry.output) {
    return {
      status: "skipped",
      reason: "no_output",
      entry,
    };
  }

  const caseDir = path.join(
    outputBase,
    entry.modelDir,
    sourceStem,
    buildCaseDirName({ index: entry.sourceIndex })
  );
  ensureDir(caseDir);

  const archiveDir = path.join(caseDir, "archive");
  const txtPath = path.join(caseDir, "output.txt");
  writeFileWithArchive(txtPath, entry.output, {
    archiveRoot: archiveDir,
    archiveEnabled: options.archive,
  });

  const javaBlocks = extractJavaBlocks(entry.output);
  const javaFiles = [];
  const javaClassNames = [];

  for (let i = 0; i < javaBlocks.length; i++) {
    const block = javaBlocks[i];
    const className = extractPublicClassName(block);
    const fallbackName = `ExtractedTest${String(i + 1).padStart(2, "0")}`;
    const baseName = className || fallbackName;
    const fileName = `${baseName}.java`;
    const javaPathBase = path.join(caseDir, fileName);
    let javaPath = javaPathBase;

    if (fs.existsSync(javaPath)) {
      const parsed = path.parse(javaPathBase);
      javaPath = path.join(caseDir, `${parsed.name}__${String(i + 1).padStart(2, "0")}${parsed.ext}`);
    }

    writeFileWithArchive(javaPath, block + "\n", {
      archiveRoot: archiveDir,
      archiveEnabled: options.archive,
    });

    javaFiles.push(path.resolve(javaPath));
    javaClassNames.push(className);
  }

  const metadata = {
    source_json_path: path.resolve(entry.sourceJsonPath),
    source_json_file: path.basename(entry.sourceJsonPath),
    source_json_stem: sourceStem,
    entry_index: entry.sourceIndex,
    provider_id: entry.providerId,
    provider_label: entry.providerLabel,
    model_dir: entry.modelDir,
    description: entry.description,
    feature: entry.feature,
    specification: entry.specification,
    ui_context: entry.uiContext,
    output_txt_path: path.resolve(txtPath),
    java_paths: javaFiles,
    java_public_class_names: javaClassNames.filter(Boolean),
    java_block_count: javaBlocks.length,
    summary: summarizeResponseOutput(entry.output),
    extracted_at: new Date().toISOString(),
  };

  const metadataPath = path.join(caseDir, "metadata.json");
  writeFileWithArchive(metadataPath, JSON.stringify(metadata, null, 2) + "\n", {
    archiveRoot: archiveDir,
    archiveEnabled: options.archive,
  });

  return {
    status: "saved",
    entry,
    caseDir: path.resolve(caseDir),
    txtPath: path.resolve(txtPath),
    metadataPath: path.resolve(metadataPath),
    javaFiles,
    javaBlockCount: javaBlocks.length,
  };
}

function processResultFile(jsonPath, outputBase, options) {
  const raw = readJson(jsonPath);
  const allResults = extractAllResults(raw);
  const sourceStem = path.basename(jsonPath, path.extname(jsonPath));

  if (allResults.length === 0) {
    return {
      jsonPath: path.resolve(jsonPath),
      sourceStem,
      totalEntries: 0,
      saved: 0,
      skipped: 0,
      items: [],
      warnings: ["No results found in JSON"],
    };
  }

  const items = [];
  let saved = 0;
  let skipped = 0;

  for (let i = 0; i < allResults.length; i++) {
    const entry = normalizeEntry(allResults[i], i, jsonPath);
    const item = processSingleEntry(entry, sourceStem, outputBase, options);
    items.push(item);
    if (item.status === "saved") {
      saved++;
    } else {
      skipped++;
    }
  }

  return {
    jsonPath: path.resolve(jsonPath),
    sourceStem,
    totalEntries: allResults.length,
    saved,
    skipped,
    items,
    warnings: [],
  };
}

function writeManifest(outputBase, manifest) {
  ensureDir(outputBase);
  const manifestPath = path.join(outputBase, "manifest.json");
  const archiveDir = path.join(outputBase, "archive");
  archiveIfExists(manifestPath, archiveDir, true);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifestPath;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputFiles = collectResultFiles(options.inputPath);

  if (inputFiles.length === 0) {
    fail(`❌ No evaluation-results*.json found under: ${options.inputPath}`);
  }

  ensureDir(options.outputBase);

  log(`📂 Input : ${path.resolve(options.inputPath)}`, options.verbose);
  log(`📁 Output: ${path.resolve(options.outputBase)}`, options.verbose);
  log(`🧾 JSON files found: ${inputFiles.length}\n`, options.verbose);

  const fileReports = [];
  let totalEntries = 0;
  let totalSaved = 0;
  let totalSkipped = 0;

  for (const jsonPath of inputFiles) {
    const report = processResultFile(jsonPath, options.outputBase, options);
    fileReports.push(report);
    totalEntries += report.totalEntries;
    totalSaved += report.saved;
    totalSkipped += report.skipped;

    log(`▶ ${path.basename(jsonPath)}`, options.verbose);
    if (report.warnings.length > 0) {
      for (const message of report.warnings) {
        warn(`  ⚠️  ${message}`);
      }
    }

    for (const item of report.items) {
      if (item.status === "saved") {
        const javaInfo = item.javaBlockCount > 0 ? ` + ${item.javaBlockCount} java` : " (no java)";
        log(`  ✅ ${path.relative(options.outputBase, item.caseDir)}${javaInfo}`, options.verbose);
      } else {
        warn(`  ⚠️  skipped: ${item.entry.description} (${item.reason})`);
      }
    }

    log("", options.verbose);
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    input_path: path.resolve(options.inputPath),
    output_base: path.resolve(options.outputBase),
    total_json_files: inputFiles.length,
    total_entries: totalEntries,
    total_saved: totalSaved,
    total_skipped: totalSkipped,
    files: fileReports.map((report) => ({
      json_path: report.jsonPath,
      source_stem: report.sourceStem,
      total_entries: report.totalEntries,
      saved: report.saved,
      skipped: report.skipped,
      warnings: report.warnings,
      items: report.items.map((item) =>
        item.status === "saved"
          ? {
              status: item.status,
              case_dir: item.caseDir,
              txt_path: item.txtPath,
              metadata_path: item.metadataPath,
              java_paths: item.javaFiles,
              source_index: item.entry.sourceIndex,
              description: item.entry.description,
              model_dir: item.entry.modelDir,
              feature: item.entry.feature,
            }
          : {
              status: item.status,
              reason: item.reason,
              source_index: item.entry.sourceIndex,
              description: item.entry.description,
              model_dir: item.entry.modelDir,
              feature: item.entry.feature,
            }
      ),
    })),
  };

  const manifestPath = writeManifest(options.outputBase, manifest);

  console.log(`📊 Entries: ${totalEntries} / Saved: ${totalSaved} / Skipped: ${totalSkipped}`);
  console.log(`📝 Manifest: ${path.resolve(manifestPath)}`);
  console.log(`\n次の例:`);
  console.log(`  node validation/validate-output.mjs <.../output.txt>`);
  console.log(`  MCP validate_syntax で <.../SecureBankLoginTest.java> を検証`);
  console.log(`  MCP validate_spec で <.../output.txt> と feature を検証`);
}

main();