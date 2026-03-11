import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, "schema.json");

function parseArgs(argv) {
  const options = {
    inputPath: null,
    json: false,
    requireSelfCheck: false,
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--require-self-check") {
      options.requireSelfCheck = true;
      continue;
    }
    if (!options.inputPath) {
      options.inputPath = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.inputPath) {
    throw new Error(
      "Usage: node validate-output.mjs <llm-output.txt> [--json] [--require-self-check]"
    );
  }

  return options;
}

function normalizeText(text) {
  return String(text || "").replace(/\r\n/g, "\n");
}

function cleanSectionContent(text) {
  return String(text || "")
    .replace(/^\ufeff/, "")
    .replace(/^\s+|\s+$/g, "");
}

function findLabeledSectionMatches(text) {
  return [...text.matchAll(/^\((A|B|C|D)\)[^\n]*$/gm)];
}

function extractSectionByNamedHeading(text, headingPatterns) {
  const normalized = normalizeText(text);

  for (const pattern of headingPatterns) {
    const match = pattern.exec(normalized);
    if (!match || match.index == null) {
      continue;
    }

    const start = match.index + match[0].length;
    const tail = normalized.slice(start);
    const nextHeading = tail.search(/^\((A|B|C|D)\)[^\n]*$/m);
    const content = nextHeading >= 0 ? tail.slice(0, nextHeading) : tail;
    return cleanSectionContent(content);
  }

  return "";
}

function extractJavaCode(text) {
  const normalized = normalizeText(text);
  const javaFence = /```java\s*([\s\S]*?)\s*```/im.exec(normalized);
  const genericFence = /```\s*([\s\S]*?)\s*```/m.exec(normalized);
  const match = javaFence ?? genericFence;

  if (!match || match.index == null) {
    throw new Error("Missing code fence.");
  }

  const fenceText = match[0];
  const code = cleanSectionContent(match[1] ?? "");
  const imports = [...code.matchAll(/^import\s+([^;]+);$/gm)].map((m) => m[1].trim());
  const annotations = [
    ...new Set([...code.matchAll(/@(BeforeEach|AfterEach|Test)\b/g)].map((m) => m[1])),
  ];
  const publicClassName =
    (code.match(/\bpublic\s+class\s+([A-Za-z_][A-Za-z0-9_]*)\b/) || [])[1] ?? null;
  const testCount = (code.match(/@Test\b/g) || []).length;

  const fenceStart = match.index;
  const fenceEnd = fenceStart + fenceText.length;
  const beforeFence = cleanSectionContent(normalized.slice(0, fenceStart));
  const afterFence = cleanSectionContent(normalized.slice(fenceEnd));

  return {
    code,
    testCount,
    hasJavaFence: Boolean(javaFence),
    publicClassName,
    imports,
    annotations,
    beforeFence,
    afterFence,
  };
}

function inferSections(text, java) {
  const normalized = normalizeText(text);
  const sections = { A: "", B: "", C: "", D: "" };

  const labeled = findLabeledSectionMatches(normalized);
  for (let i = 0; i < labeled.length; i++) {
    const current = labeled[i];
    const next = labeled[i + 1];
    const key = current[1];
    const start = current.index;
    const end = next ? next.index : normalized.length;
    sections[key] = cleanSectionContent(normalized.slice(start, end));
  }

  if (!sections.A && /(?:テストケースID|Test Case ID)\s*[:：]\s*TC-\d{3}/i.test(java.beforeFence)) {
    sections.A = java.beforeFence;
  }

  if (!sections.B) {
    const namedB = extractSectionByNamedHeading(normalized, [
      /^\(B\)[^\n]*$/im,
      /^\*{1,2}\s*仕様と実装の不整合・不足情報\s*\*{1,2}\s*$/im,
      /^#+\s*仕様と実装の不整合・不足情報\s*$/im,
      /^仕様と実装の不整合・不足情報\s*[:：]?\s*$/im,
    ]);
    if (namedB) {
      sections.B = namedB;
    }
  }

  if (!sections.D) {
    const namedD = extractSectionByNamedHeading(normalized, [
      /^\(D\)[^\n]*$/im,
      /^\*{1,2}\s*自己検証\s*\*{1,2}\s*$/im,
      /^#+\s*自己検証\s*$/im,
      /^自己検証\s*[:：]?\s*$/im,
    ]);
    if (namedD) {
      sections.D = namedD;
    }
  }

  return sections;
}

function normalizeCategory(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) {
    return "";
  }

  if (["正常系", "正常", "normal", "positive", "success"].includes(value)) {
    return "正常系";
  }
  if (["異常系", "異常", "error", "negative", "failure"].includes(value)) {
    return "異常系";
  }
  if (["境界値", "境界", "boundary", "edge", "edge case"].includes(value)) {
    return "境界値";
  }
  if (["セキュリティ", "security", "security test", "脆弱性"].includes(value)) {
    return "セキュリティ";
  }

  return String(rawValue || "").trim();
}

function normalizePriority(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) {
    return "";
  }

  if (["高", "high", "p1", "critical"].includes(value)) {
    return "高";
  }
  if (["中", "medium", "mid", "p2"].includes(value)) {
    return "中";
  }
  if (["低", "low", "p3"].includes(value)) {
    return "低";
  }

  return String(rawValue || "").trim();
}

function parseTestCases(sectionA) {
  const body = cleanSectionContent(sectionA)
    .replace(/^\(A\)[^\n]*\n?/, "")
    .trim();

  if (!body) {
    return [];
  }

  const chunks = body
    .split(/(?=(?:テストケースID|Test Case ID)\s*[:：]\s*TC-\d{3})/gi)
    .map((s) => s.trim())
    .filter(Boolean);

  const cases = [];
  for (const chunk of chunks) {
    const id = (chunk.match(/(?:テストケースID|Test Case ID)\s*[:：]\s*(TC-\d{3})/i) || [])[1];
    if (!id) {
      continue;
    }

    const categoryRaw =
      (chunk.match(/(?:カテゴリ|Category)\s*[:：]\s*(?:\[)?([^\]\n\r]+)(?:\])?/i) || [])[1] ?? "";
    const priorityRaw =
      (chunk.match(/(?:優先度|Priority)\s*[:：]\s*(?:\[)?([^\]\n\r]+)(?:\])?/i) || [])[1] ?? "";

    const preconditions =
      (chunk.match(/(?:前提条件|Preconditions?)\s*[:：]\s*([\s\S]*?)\n(?:テスト手順|Test Steps?)\s*[:：]/i) || [])[1]?.trim() ?? "";
    const stepsRaw =
      (chunk.match(/(?:テスト手順|Test Steps?)\s*[:：]\s*([\s\S]*?)\n(?:期待結果|Expected Results?)\s*[:：]/i) || [])[1]?.trim() ?? "";
    const expected =
      (chunk.match(/(?:期待結果|Expected Results?)\s*[:：]\s*([\s\S]*?)\n(?:実装根拠|Implementation Rationale|Rationale)\s*[:：]/i) || [])[1]?.trim() ?? "";
    const evidence =
      (chunk.match(/(?:実装根拠|Implementation Rationale|Rationale)\s*[:：]\s*([\s\S]*)$/i) || [])[1]?.trim() ?? "";

    const steps = stepsRaw
      .split(/\n(?:\d+[.)]\s*|[-*]\s*)/g)
      .map((s) => s.trim())
      .filter(Boolean);

    cases.push({
      id,
      category: normalizeCategory(categoryRaw),
      priority: normalizePriority(priorityRaw),
      preconditions,
      steps,
      expected,
      evidence,
    });
  }

  return cases;
}

function detectMode(cases, java) {
  if (cases.length > 0) {
    return "legacy";
  }
  if (java.code) {
    return "current";
  }
  throw new Error("Unable to detect output format.");
}

function buildParsedObject(text) {
  const java = extractJavaCode(text);
  const sections = inferSections(text, java);
  const cases = parseTestCases(sections.A);
  const mode = detectMode(cases, java);

  return {
    mode,
    sections,
    cases,
    java: {
      code: java.code,
      testCount: java.testCount,
      hasJavaFence: java.hasJavaFence,
      publicClassName: java.publicClassName,
      imports: java.imports,
      annotations: java.annotations,
    },
  };
}

function validateSchema(parsed) {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const ok = validate(parsed);

  if (!ok) {
    const details = (validate.errors ?? [])
      .map((err) => `- ${err.instancePath || "(root)"} ${err.message}`)
      .join("\n");
    throw new Error(`Schema validation failed:\n${details}`);
  }
}

function collectWarnings(parsed, options) {
  const warnings = [];

  if (options.requireSelfCheck && !parsed.sections.D) {
    throw new Error('Missing "(D) 自己検証" section');
  }

  return warnings;
}

function ruleChecks(parsed) {
  const code = parsed.java.code;
  const requiredSnippets = [
    "org.junit.jupiter",
    "WebDriver",
    "WebDriverWait",
    "@BeforeEach",
    "@Test",
  ];

  const missingSnippets = requiredSnippets.filter((snippet) => !code.includes(snippet));
  if (missingSnippets.length > 0) {
    throw new Error(`Missing required Java snippets: ${missingSnippets.join(", ")}`);
  }

  if (parsed.mode === "current") {
    if (!parsed.sections.B) {
      throw new Error('Missing "(B) 仕様と実装の不整合・不足情報" section');
    }
    if (parsed.java.testCount < 2) {
      throw new Error(`Too few @Test methods: ${parsed.java.testCount} (expected >= 2)`);
    }
  }

  if (parsed.mode === "legacy") {
    if (!parsed.sections.A) {
      throw new Error('Missing "(A)" section or equivalent legacy test case block');
    }

    if (parsed.java.testCount < 3) {
      throw new Error(`Too few @Test methods: ${parsed.java.testCount} (expected >= 3)`);
    }

    if (parsed.cases.length < 15) {
      throw new Error(`Test case count too low: ${parsed.cases.length} (expected >= 15)`);
    }

    const countByCategory = parsed.cases.reduce((acc, testCase) => {
      acc[testCase.category] = (acc[testCase.category] || 0) + 1;
      return acc;
    }, {});

    for (const category of ["正常系", "異常系", "境界値", "セキュリティ"]) {
      if ((countByCategory[category] || 0) < 3) {
        throw new Error(
          `Category "${category}" too few: ${countByCategory[category] || 0} (expected >= 3)`
        );
      }
    }

    const ids = parsed.cases.map((testCase) => testCase.id);
    const duplicateId = ids.find((value, index) => ids.indexOf(value) !== index);
    if (duplicateId) {
      throw new Error(`Duplicate test case id found: ${duplicateId}`);
    }
  }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const inputPath = path.resolve(options.inputPath);
    const text = fs.readFileSync(inputPath, "utf8");

    const parsed = buildParsedObject(text);
    validateSchema(parsed);
    const warnings = collectWarnings(parsed, options);
    ruleChecks(parsed);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            valid: true,
            mode: parsed.mode,
            warnings,
            parsed,
          },
          null,
          2
        )
      );
      return;
    }

    console.log(`OK Output structure validated. mode=${parsed.mode}`);
    if (warnings.length > 0) {
      console.log("WARNINGS:");
      for (const warning of warnings) {
        console.log(`- ${warning}`);
      }
    }
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    process.exit(1);
  }
}

main();