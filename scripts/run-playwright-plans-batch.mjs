/**
 * Batch runner for Playwright validation plans.
 *
 * Requirements (from docs/Automated/Playwright-mcp用prm.md):
 * - Recursively find all "*.playwright-plan.json" under "reports/playwright-plans"
 * - Skip if corresponding "*.playwright-result.json" exists under "reports/playwright-results" (mirror structure)
 * - Execute plans sequentially, continue on failure
 * - Save one result JSON per plan (always)
 * - Print summary at end
 *
 * Note:
 * - This runner uses the standard Node Playwright API (NOT Playwright MCP)
 * - It focuses on robust execution + recordability rather than perfect semantic fidelity
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const PROJECT_ROOT = process.cwd();

const PLANS_ROOT = path.join(PROJECT_ROOT, "reports", "playwright-plans");
const RESULTS_ROOT = path.join(PROJECT_ROOT, "reports", "playwright-results");

// 실제 테스트対象（ユーザー指示）
const DEFAULT_ACTUAL_BASE_URL = "http://localhost:8080/financial-demo-app.html";

function nowIso() {
  return new Date().toISOString();
}

function toPosix(p) {
  return p.replace(/\\/g, "/");
}

function existsFile(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (ent.isFile() && ent.name.endsWith(".playwright-plan.json")) out.push(full);
  }
  return out;
}

function mirrorResultPath(planPathAbs) {
  const rel = path.relative(PLANS_ROOT, planPathAbs);
  const relResult = rel.replace(/\.playwright-plan\.json$/i, ".playwright-result.json");
  return path.join(RESULTS_ROOT, relResult);
}

function inferFeature(sourceStem, explicitFeature) {
  if (explicitFeature && String(explicitFeature).trim()) return String(explicitFeature);
  const lower = String(sourceStem ?? "").toLowerCase();
  if (lower.includes("login")) return "ログイン";
  if (lower.includes("rbac")) return "監査ログ";
  if (lower.includes("transfer")) return "振込";
  return "不明";
}

function parseMetaFromPlanPath(planPathAbs) {
  const rel = toPosix(path.relative(PLANS_ROOT, planPathAbs));
  const parts = rel.split("/");
  // reports/playwright-plans/<model>/<sourceStem>/<case>/<planBase>.playwright-plan.json
  return {
    model: parts[0] ?? "",
    source_stem: parts[1] ?? "",
    case: parts[2] ?? "",
    plan_base: path.basename(planPathAbs).replace(/\.playwright-plan\.json$/i, ""),
  };
}

function collectCommonFailures(methodResults) {
  // Keep schema compatible with docs/Automated/Playwright-mcp用prm.md:
  //   common_failures: { failed_tools: string[], locator_failures: string[] }
  const failedTools = new Set();
  const locatorFailures = new Set();

  for (const m of methodResults) {
    if (m.failed_tool) failedTools.add(m.failed_tool);
    for (const loc of m.locator_failures ?? []) locatorFailures.add(loc);
  }

  return {
    failed_tools: Array.from(failedTools).sort(),
    locator_failures: Array.from(locatorFailures).sort(),
  };
}

async function safeCount(locator) {
  try {
    return await locator.count();
  } catch {
    return 0;
  }
}

function normalizeNavigateUrl(url, actualBaseUrl) {
  if (!url) return actualBaseUrl;
  if (/^http:\/\/localhost:8080\/?$/i.test(url)) return actualBaseUrl;
  if (/^http:\/\/127\.0\.0\.1:8080\/?$/i.test(url)) return actualBaseUrl;
  return url;
}

async function resolveAndFill(page, selectorHint, elementDesc, value) {
  // Prefer selector_hint if it looks like CSS selector
  if (selectorHint && /^([#.\[])/.test(selectorHint)) {
    const loc = page.locator(selectorHint).first();
    if ((await safeCount(loc)) === 0) throw new Error(`locator_not_found:${selectorHint}`);
    await loc.fill(String(value ?? ""));
    return;
  }

  // Try to extract id="..." from element description
  const id = String(elementDesc ?? "").match(/id=\"([^\"]+)\"/)?.[1];
  if (id) {
    const css = `#${id}`;
    const loc = page.locator(css).first();
    if ((await safeCount(loc)) === 0) throw new Error(`locator_not_found:${css}`);
    await loc.fill(String(value ?? ""));
    return;
  }

  // Fallback: try by label in JP UI
  const labelGuess = String(elementDesc ?? "").includes("username")
    ? "ユーザーID"
    : String(elementDesc ?? "").includes("password")
      ? "パスワード"
      : String(elementDesc ?? "").includes("role")
        ? "役割"
        : String(elementDesc ?? "").includes("mfaCode")
          ? "認証コード（6桁）"
          : null;

  if (labelGuess) {
    const loc = page.getByLabel(labelGuess).first();
    if ((await safeCount(loc)) === 0) throw new Error(`locator_not_found:label(${labelGuess})`);
    await loc.fill(String(value ?? ""));
    return;
  }

  throw new Error("locator_not_resolved");
}

async function resolveAndSelect(page, selectorHint, elementDesc, value) {
  // Prefer selector_hint
  if (selectorHint && /^([#.\[])/.test(selectorHint)) {
    const loc = page.locator(selectorHint).first();
    if ((await safeCount(loc)) === 0) throw new Error(`locator_not_found:${selectorHint}`);
    await loc.selectOption(String(value));
    return;
  }

  const id = String(elementDesc ?? "").match(/id=\"([^\"]+)\"/)?.[1];
  if (id) {
    const css = `#${id}`;
    const loc = page.locator(css).first();
    if ((await safeCount(loc)) === 0) throw new Error(`locator_not_found:${css}`);
    await loc.selectOption(String(value));
    return;
  }

  const loc = page.getByLabel("役割").first();
  if ((await safeCount(loc)) === 0) throw new Error("locator_not_found:label(役割)");
  await loc.selectOption(String(value));
}

async function resolveAndClick(page, selectorHint) {
  // Prefer CSS selectors
  if (selectorHint && /^([#.\[])/.test(selectorHint)) {
    const loc = page.locator(selectorHint).first();
    if ((await safeCount(loc)) === 0) throw new Error(`locator_not_found:${selectorHint}`);
    await loc.click();
    return;
  }

  // Common button names in this demo app
  const preferredNames = [
    "ログイン",
    "認証",
    "振込実行",
    "実行",
    "確認",
    "検索",
    "戻る",
    "ログアウト",
  ];

  for (const name of preferredNames) {
    const b = page.getByRole("button", { name }).first();
    if ((await safeCount(b)) > 0) {
      await b.click();
      return;
    }
  }

  // Generic fallback
  const any = page.getByRole("button").first();
  if ((await safeCount(any)) === 0) throw new Error("locator_not_found:button");
  await any.click();
}

async function verifyTextVisible(page, expectedText) {
  const bodyText = await page.locator("body").innerText();
  if (!bodyText.includes(String(expectedText))) {
    throw new Error(`text_not_visible:${expectedText}`);
  }
}

function toJapaneseNote(err) {
  const msg = String(err?.message ?? err);
  if (msg.startsWith("locator_not_found:")) {
    return `要素が見つかりません: ${msg.replace("locator_not_found:", "")}`;
  }
  if (msg.startsWith("text_not_visible:")) {
    return `テキストが見つかりません: ${msg.replace("text_not_visible:", "")}`;
  }
  if (msg.startsWith("unsupported_tool:")) {
    return `未対応ツールのため失敗: ${msg.replace("unsupported_tool:", "")}`;
  }
  return `ステップ実行エラー: ${msg}`;
}

async function executePlan(page, planPathAbs, options) {
  const { actualBaseUrl } = options;

  const planRaw = fs.readFileSync(planPathAbs, "utf8");
  const plan = JSON.parse(planRaw);

  const { model, source_stem, case: caseName, plan_base } = parseMetaFromPlanPath(planPathAbs);
  const planMeta = plan?._meta ?? {};

  const meta = {
    model,
    source_stem,
    case: caseName,
    feature: inferFeature(source_stem, planMeta.feature),
    plan_path: toPosix(path.relative(PROJECT_ROOT, planPathAbs)),
    executed_at: nowIso(),
    base_url: planMeta.base_url ?? "http://localhost:8080",
  };

  const summary = {
    total_methods: 0,
    pass_methods: 0,
    fail_methods: 0,
    blocked_methods: 0,
    total_steps: 0,
    executed_steps: 0,
    passed_steps: 0,
    failed_steps: 0,
    blocked_steps: 0,
  };

  const method_results = [];

  const testMethods = Array.isArray(plan.test_methods) ? plan.test_methods : [];
  summary.total_methods = testMethods.length;

  for (const method of testMethods) {
    const steps = Array.isArray(method.playwright_steps) ? method.playwright_steps : [];
    const m = {
      name: method.name ?? "unknown",
      status: "blocked",
      total_steps: steps.length,
      executed_steps: 0,
      failed_step_seq: null,
      failed_tool: "",
      locator_failures: [],
      notes: "",
    };

    summary.total_steps += m.total_steps;

    // Try to reset to a known state per method
    try {
      await page.goto(actualBaseUrl, { waitUntil: "domcontentloaded" });
    } catch (e) {
      m.status = "blocked";
      m.notes = "初期ページ遷移に失敗したためブロック";
      summary.blocked_methods += 1;
      summary.blocked_steps += m.total_steps;
      method_results.push(m);
      continue;
    }

    let failed = false;

    for (const step of steps) {
      if (failed) {
        summary.blocked_steps += 1;
        continue;
      }

      const tool = step.mcp_tool;
      const seq = step.seq ?? null;

      try {
        switch (tool) {
          case "browser_navigate": {
            const url = normalizeNavigateUrl(step.args?.url, actualBaseUrl);
            await page.goto(url, { waitUntil: "domcontentloaded" });
            break;
          }
          case "browser_snapshot": {
            // No-op in Node runner (we use selector_hint as locator)
            break;
          }
          case "browser_fill_form": {
            const fields = step.args_template?.fields ?? step.args?.fields;
            if (!Array.isArray(fields) || fields.length === 0) throw new Error("invalid_fields");
            for (const f of fields) {
              // #role is <select> in demo app
              if (step.selector_hint === "#role") {
                await resolveAndSelect(page, step.selector_hint, f.element, f.value);
              } else {
                await resolveAndFill(page, step.selector_hint, f.element, f.value);
              }
            }
            break;
          }
          case "browser_click": {
            await resolveAndClick(page, step.selector_hint);
            break;
          }
          case "browser_wait_for": {
            const hint = step.selector_hint;
            const t = step.args?.time;
            if (hint && /^([#.\[])/.test(hint)) {
              await page.waitForSelector(hint, { timeout: 3000 });
            } else if (typeof t === "number") {
              // plan uses ms (2000). tolerate both
              const ms = t > 50 ? t : t * 1000;
              await page.waitForTimeout(ms);
            } else {
              await page.waitForTimeout(500);
            }
            break;
          }
          case "browser_verify_text_visible": {
            await verifyTextVisible(page, step.args?.text);
            break;
          }
          case "browser_evaluate": {
            const fn = step.args?.function;
            if (!fn) throw new Error("missing_function");
            await page.evaluate(fn);
            break;
          }
          default:
            throw new Error(`unsupported_tool:${tool}`);
        }

        // success
        m.executed_steps += 1;
        summary.executed_steps += 1;
        summary.passed_steps += 1;
      } catch (e) {
        failed = true;
        m.status = "fail";
        m.failed_step_seq = seq;
        m.failed_tool = tool;
        m.notes = toJapaneseNote(e);

        // Count this step as executed+failed (we attempted it)
        m.executed_steps += 1;
        summary.executed_steps += 1;
        summary.failed_steps += 1;

        const msg = String(e?.message ?? e);
        if (msg.startsWith("locator_not_found:")) {
          const loc = msg.replace("locator_not_found:", "");
          m.locator_failures.push(loc);
        }
      }
    }

    if (!failed) {
      m.status = "pass";
    }

    if (m.status === "pass") summary.pass_methods += 1;
    else if (m.status === "blocked") summary.blocked_methods += 1;
    else summary.fail_methods += 1;

    method_results.push(m);
  }

  let overall_status = "blocked";
  if (summary.fail_methods > 0) overall_status = "fail";
  else if (summary.blocked_methods > 0 && summary.pass_methods > 0) overall_status = "partial";
  else if (summary.blocked_methods === summary.total_methods) overall_status = "blocked";
  else overall_status = "pass";

  return {
    meta: {
      ...meta,
      plan_base,
      actual_base_url: actualBaseUrl,
    },
    overall_status,
    summary,
    method_results,
    common_failures: collectCommonFailures(method_results),
    notes: "",
  };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    actualBaseUrl: process.env.PLAYWRIGHT_ACTUAL_BASE_URL ?? DEFAULT_ACTUAL_BASE_URL,
    headless: process.env.PLAYWRIGHT_HEADLESS ? process.env.PLAYWRIGHT_HEADLESS !== "0" : true,
    limit: process.env.PLAYWRIGHT_PLAN_LIMIT ? Number(process.env.PLAYWRIGHT_PLAN_LIMIT) : Infinity,
  };

  if (args.includes("--headed")) options.headless = false;

  if (!existsFile(PLANS_ROOT)) {
    console.error(`Plans root not found: ${PLANS_ROOT}`);
    process.exit(1);
  }
  ensureDir(RESULTS_ROOT);

  const planPaths = walk(PLANS_ROOT).sort();

  let skipped = 0;
  let processed = 0;
  let pass = 0;
  let fail = 0;
  let blocked = 0;
  let partial = 0;

  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  for (const planPathAbs of planPaths) {
    const resultPathAbs = mirrorResultPath(planPathAbs);
    if (existsFile(resultPathAbs)) {
      skipped += 1;
      continue;
    }

    if (processed >= options.limit) break;

    processed += 1;

    console.log(`[RUN] ${toPosix(path.relative(PROJECT_ROOT, planPathAbs))}`);
    console.log(`[OUT] ${toPosix(path.relative(PROJECT_ROOT, resultPathAbs))}`);

    let result;
    try {
      result = await executePlan(page, planPathAbs, options);
    } catch (e) {
      // Always write a blocked result
      const { model, source_stem, case: caseName, plan_base } = parseMetaFromPlanPath(planPathAbs);
      result = {
        meta: {
          model,
          source_stem,
          case: caseName,
          feature: inferFeature(source_stem, null),
          plan_path: toPosix(path.relative(PROJECT_ROOT, planPathAbs)),
          executed_at: nowIso(),
          base_url: "http://localhost:8080",
          plan_base,
          actual_base_url: options.actualBaseUrl,
        },
        overall_status: "blocked",
        summary: {
          total_methods: 0,
          pass_methods: 0,
          fail_methods: 0,
          blocked_methods: 0,
          total_steps: 0,
          executed_steps: 0,
          passed_steps: 0,
          failed_steps: 0,
          blocked_steps: 0,
        },
        method_results: [],
        common_failures: { failed_tools: [], locator_failures: [] },
        notes: `plan 実行中に例外: ${String(e?.message ?? e)}`,
      };
    }

    ensureDir(path.dirname(resultPathAbs));
    fs.writeFileSync(resultPathAbs, JSON.stringify(result, null, 2), "utf8");

    console.log(`[DONE] ${result.overall_status}`);

    if (result.overall_status === "pass") pass += 1;
    else if (result.overall_status === "partial") partial += 1;
    else if (result.overall_status === "blocked") blocked += 1;
    else fail += 1;
  }

  await context.close();
  await browser.close();

  const total = planPaths.length;
  const remaining = total - skipped - processed;

  const summaryObj = {
    total_plans: total,
    processed,
    skipped,
    pass,
    fail,
    blocked,
    partial,
    remaining,
  };

  console.log(JSON.stringify(summaryObj, null, 2));
}

await main();
