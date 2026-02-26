/**
 * playwright-bridge.mjs
 *
 * extract_actions の出力 JSON を読み込み、
 * Playwright MCP (@playwright/mcp) が実行できる
 * "Validation Plan" JSON を生成する。
 *
 * 設計のポイント:
 *   - browser_click / browser_fill_form は browser_snapshot で得た ref が必要
 *   - そのため「navigate → snapshot → element操作」の3段構造を各ページ単位で挿入
 *   - Claude Code がこの plan を読んで Playwright MCP ツールを順番に呼べるよう設計
 *
 * Usage:
 *   node scripts/playwright-bridge.mjs <extract-actions-output.json> [base_url]
 *
 *   extract-actions-output.json: MCP tool "extract_actions" の出力を保存したファイル
 *   base_url: テスト対象の URL (default: http://localhost:8080)
 *
 * Output:
 *   results/{model}/<test>.playwright-plan.json
 */

import fs from "node:fs";
import path from "node:path";

// 引数 ────────────────────────────────────────────────────────────────────
const inputPath = process.argv[2];
const baseUrl   = process.argv[3] ?? "http://localhost:8080";

if (!inputPath) {
  console.error(
    "Usage: node scripts/playwright-bridge.mjs <extract-actions-output.json> [base_url]"
  );
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`❌ File not found: ${inputPath}`);
  process.exit(1);
}

const { testMethods } = JSON.parse(fs.readFileSync(inputPath, "utf8"));

if (!Array.isArray(testMethods) || testMethods.length === 0) {
  console.error("❌ No testMethods found in input JSON.");
  process.exit(1);
}

// セレクタ → 人間可読な説明文（Playwright MCP の element 引数用）──────────
function selectorToDescription(selector) {
  if (selector.startsWith("#")) {
    return `element with id="${selector.slice(1)}"`;
  }
  if (selector.startsWith(".")) {
    return `element with class="${selector.slice(1)}"`;
  }
  if (selector.startsWith("[name=")) {
    const name = selector.match(/\[name="([^"]+)"\]/)?.[1] ?? selector;
    return `input with name="${name}"`;
  }
  if (selector.startsWith("text=")) {
    return `element with text "${selector.slice(5)}"`;
  }
  if (selector.startsWith("xpath=")) {
    return `element at xpath ${selector.slice(6)}`;
  }
  return selector;
}

// 1アクション → Playwright MCP ステップ群 ────────────────────────────────
/**
 * @param {object} action   extractActionsFromBody の出力1件
 * @param {number} seq      連番（変更される）
 * @param {Set}    snapshotted  現在スナップショット済みページの URL 集合
 * @param {string} currentUrl  最後に navigate した URL
 * @returns {{ steps: object[], nextSeq: number, currentUrl: string }}
 */
function actionToSteps(action, seq, snapshotted, currentUrl) {
  const steps = [];

  switch (action.type) {

    // navigate ──────────────────────────────────────────────────────────
    case "navigate": {
      const url = action.url.startsWith("{{")
        ? baseUrl  // 変数参照はデフォルト URL に置換
        : action.url;

      steps.push({
        seq: seq++,
        mcp_tool: "browser_navigate",
        args: { url },
        note: `Navigate to ${url}`,
      });
      // navigate 後は必ずスナップショットを取る
      steps.push({
        seq: seq++,
        mcp_tool: "browser_snapshot",
        args: {},
        note: "Capture accessibility snapshot to resolve element refs",
        _snapshot_marker: true,
      });
      snapshotted.add(url);
      currentUrl = url;
      break;
    }

    // fill ──────────────────────────────────────────────────────────────
    case "fill": {
      // スナップショットがまだなら挿入
      if (!snapshotted.has(currentUrl)) {
        steps.push({
          seq: seq++,
          mcp_tool: "browser_snapshot",
          args: {},
          note: "Snapshot before fill (auto-inserted)",
          _snapshot_marker: true,
        });
        snapshotted.add(currentUrl);
      }
      steps.push({
        seq: seq++,
        mcp_tool: "browser_fill_form",
        args_template: {
          fields: [
            {
              element: selectorToDescription(action.selector),
              ref: "{{ resolve ref from latest snapshot }}",
              value: action.value,
            },
          ],
        },
        selector_hint: action.selector,
        original_action: action,
        note: `Fill "${action.selector}" with "${action.value}"`,
        locator_status: "pending",
      });
      break;
    }

    // click ──────────────────────────────────────────────────────────────
    case "click": {
      if (!snapshotted.has(currentUrl)) {
        steps.push({
          seq: seq++,
          mcp_tool: "browser_snapshot",
          args: {},
          note: "Snapshot before click (auto-inserted)",
          _snapshot_marker: true,
        });
        snapshotted.add(currentUrl);
      }
      steps.push({
        seq: seq++,
        mcp_tool: "browser_click",
        args_template: {
          element: selectorToDescription(action.selector),
          ref: "{{ resolve ref from latest snapshot }}",
        },
        selector_hint: action.selector,
        original_action: action,
        note: `Click "${action.selector}"`,
        locator_status: "pending",
      });
      // クリック後はページ状態が変わる可能性があるのでスナップショットを無効化
      snapshotted.delete(currentUrl);
      break;
    }

    // clear ──────────────────────────────────────────────────────────────
    case "clear": {
      if (!snapshotted.has(currentUrl)) {
        steps.push({
          seq: seq++,
          mcp_tool: "browser_snapshot",
          args: {},
          note: "Snapshot before clear (auto-inserted)",
          _snapshot_marker: true,
        });
        snapshotted.add(currentUrl);
      }
      steps.push({
        seq: seq++,
        mcp_tool: "browser_fill_form",
        args_template: {
          fields: [
            {
              element: selectorToDescription(action.selector),
              ref: "{{ resolve ref from latest snapshot }}",
              value: "",
            },
          ],
        },
        selector_hint: action.selector,
        original_action: action,
        note: `Clear "${action.selector}"`,
        locator_status: "pending",
      });
      break;
    }

    // wait (WebDriverWait) ───────────────────────────────────────────────
    case "wait": {
      // セレクタが解決できる要素の出現待ち → browser_wait_for { text } or snapshot
      steps.push({
        seq: seq++,
        mcp_tool: "browser_wait_for",
        args: {
          // text が得られない場合は短い固定待ち
          time: 2000,
        },
        note: `Wait for "${action.selector}" to appear`,
        selector_hint: action.selector,
        original_action: action,
      });
      // 待機後は再スナップショット
      snapshotted.delete(currentUrl);
      break;
    }

    // assert_text ───────────────────────────────────────────────────────
    case "assert_text": {
      steps.push({
        seq: seq++,
        mcp_tool: "browser_verify_text_visible",
        args: { text: action.expected },
        note: `Assert text visible: "${action.expected}"`,
        original_action: action,
        locator_status: "pending",
      });
      break;
    }

    // get_text ──────────────────────────────────────────────────────────
    case "get_text": {
      // snapshot を取り、テキストが含まれているか目視確認
      if (!snapshotted.has(currentUrl)) {
        steps.push({
          seq: seq++,
          mcp_tool: "browser_snapshot",
          args: {},
          note: "Snapshot to read text content (auto-inserted)",
          _snapshot_marker: true,
        });
        snapshotted.add(currentUrl);
      }
      steps.push({
        seq: seq++,
        mcp_tool: "browser_snapshot",
        args: {},
        note: `Read text from "${action.selector}" — verify in snapshot output`,
        selector_hint: action.selector,
        original_action: action,
      });
      break;
    }

    // assert_true / assert_false ─────────────────────────────────────────
    case "assert_true":
    case "assert_false": {
      steps.push({
        seq: seq++,
        mcp_tool: "browser_evaluate",
        args: {
          function: `() => !!(${action.expression})`,
        },
        note: `${action.type}: ${action.expression}`,
        original_action: action,
      });
      break;
    }

    // count_elements ─────────────────────────────────────────────────────
    case "count_elements": {
      steps.push({
        seq: seq++,
        mcp_tool: "browser_evaluate",
        args: {
          function: `() => document.querySelectorAll('${action.selector}').length`,
        },
        note: `Count elements matching "${action.selector}"`,
        selector_hint: action.selector,
        original_action: action,
      });
      break;
    }

    default:
      // 未知のアクションはスキップし記録のみ
      steps.push({
        seq: seq++,
        mcp_tool: "/* unknown */",
        note: `Unhandled action type: ${action.type}`,
        original_action: action,
        skipped: true,
      });
  }

  return { steps, nextSeq: seq, currentUrl };
}

// メイン変換ロジック ───────────────────────────────────────────────────────
const plan = {
  _meta: {
    generated_at: new Date().toISOString(),
    source_file: path.resolve(inputPath),
    base_url: baseUrl,
    playwright_mcp: "@playwright/mcp",
  },

  /**
   * Claude Code 向け実行ガイド
   * （このフィールドを読んで各ステップを Playwright MCP で実行してください）
   */
  execution_guide: [
    "1. 各 test_method を順番に実行してください",
    "2. mcp_tool が 'browser_snapshot' のステップでは snapshot を取得し、",
    "   次のステップの ref 解決に使用してください",
    "3. args_template 内の '{{ resolve ref from latest snapshot }}' は",
    "   直前の snapshot から selector_hint に一致する要素の ref に置き換えてください",
    "4. locator_status フィールドは実行後に 'resolved' / 'not_found' で更新してください",
    "5. 全テストメソッドの実行後に summary を報告してください",
  ],

  test_methods: testMethods.map((method) => {
    const snapshotted = new Set();
    let seq = 1;
    let currentUrl = "";
    const playwrightSteps = [];

    for (const action of method.actions) {
      const { steps, nextSeq, currentUrl: nextUrl } = actionToSteps(
        action,
        seq,
        snapshotted,
        currentUrl
      );
      playwrightSteps.push(...steps);
      seq = nextSeq;
      currentUrl = nextUrl;
    }

    // アクションが0件 or navigate が1つもない場合は最初に navigate を挿入
    const hasNavigate = method.actions.some((a) => a.type === "navigate");
    if (!hasNavigate && method.actions.length > 0) {
      playwrightSteps.unshift(
        {
          seq: 0.1,
          mcp_tool: "browser_navigate",
          args: { url: baseUrl },
          note: `Auto-inserted: Navigate to base URL (no explicit navigate in Selenium code)`,
        },
        {
          seq: 0.2,
          mcp_tool: "browser_snapshot",
          args: {},
          note: "Auto-inserted: Initial snapshot",
          _snapshot_marker: true,
        }
      );
      // seq を振り直し
      playwrightSteps.forEach((s, i) => (s.seq = i + 1));
    }

    return {
      name: method.name,
      total_steps: playwrightSteps.length,
      playwright_steps: playwrightSteps,
      result: {
        status: "pending",  // "pass" | "fail" | "partial" — Claude が更新
        locator_failures: [],
        notes: "",
      },
    };
  }),

  summary: {
    total_methods: testMethods.length,
    status: "pending",
    locator_resolution_rate: null, // Claude が実行後に記入
  },
};

// 出力 ────────────────────────────────────────────────────────────────────
// 入力ファイルと同じディレクトリに保存
const outDir  = path.dirname(path.resolve(inputPath));
const outBase = path.basename(inputPath).replace(/\.json$/, "");
const outPath = path.join(outDir, `${outBase}.playwright-plan.json`);

fs.writeFileSync(outPath, JSON.stringify(plan, null, 2), "utf8");

console.log(`✅ Playwright validation plan generated:`);
console.log(`   ${outPath}`);
console.log(`   Methods: ${plan.test_methods.length}`);
console.log(`   Total steps: ${plan.test_methods.reduce((s, m) => s + m.total_steps, 0)}`);
console.log(`\nNext: Claude Code で以下を実行してください`);
console.log(`  "playwright-plan.json を読んで Playwright MCP で検証して"`);
