/**
 * index.mjs — junit-validator MCP Server
 *
 * Tools:
 *   validate_syntax   Java コードの静的構文検証（javac 不要）
 *   compile           javac によるコンパイル（Java インストール必要）
 *   validate_spec     フィーチャー観点のカバレッジ検証
 *   extract_actions   Selenium アクション → Playwright 用セマンティックアクション
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";

import { validateSyntax } from "./tools/validate-syntax.mjs";
import { compile } from "./tools/compile.mjs";
import { validateSpec } from "./tools/validate-spec.mjs";
import { extractActions } from "./tools/extract-actions.mjs";

// ── ツール定義 ─────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "validate_syntax",
    description:
      "JUnit5 + Selenium の Java ソースを静的解析し、構文・アノテーション・必須要素を検証する。javac 不要。",
    inputSchema: {
      type: "object",
      required: ["java_path"],
      properties: {
        java_path: {
          type: "string",
          description:
            "検証対象の .java ファイルパス (例: results/llama-4-scout/ログイン機能E2E.java)",
        },
      },
    },
  },
  {
    name: "compile",
    description:
      "javac を使って .java ファイルをコンパイルする。Java JDK が必要。未インストールの場合は SKIPPED を返す。",
    inputSchema: {
      type: "object",
      required: ["java_path"],
      properties: {
        java_path: {
          type: "string",
          description: "コンパイル対象の .java ファイルパス",
        },
        classpath: {
          type: "string",
          description:
            "追加クラスパス（Selenium/JUnit5 JARs をセミコロン区切りで指定）",
        },
      },
    },
  },
  {
    name: "validate_spec",
    description:
      "LLM 出力テキスト (.txt) を対象フィーチャーの必須シナリオ観点で検証する。validate-output.mjs の補完。",
    inputSchema: {
      type: "object",
      required: ["txt_path", "feature"],
      properties: {
        txt_path: {
          type: "string",
          description:
            "LLM 出力の .txt ファイルパス (例: results/llama-4-scout/ログイン機能E2E.txt)",
        },
        feature: {
          type: "string",
          description:
            "対象フィーチャー名。vars.feature の値と同じ文字列 (例: 'ログイン機能（基本認証、MFA、ログイン試行制限）')",
        },
      },
    },
  },
  {
    name: "extract_actions",
    description:
      "JUnit + Selenium コードから WebDriver API 呼び出しを抽出し、Playwright MCP が利用できるセマンティックアクションに変換する。",
    inputSchema: {
      type: "object",
      required: ["java_path"],
      properties: {
        java_path: {
          type: "string",
          description: "解析対象の .java ファイルパス",
        },
        test_name: {
          type: "string",
          description:
            "特定の @Test メソッド名のみ抽出する場合に指定（省略時は全メソッド）",
        },
      },
    },
  },
];

// ── ツールハンドラ ─────────────────────────────────────────────────────────
async function handleTool(name, args) {
  switch (name) {
    case "validate_syntax": {
      const { java_path } = args;
      if (!fs.existsSync(java_path)) {
        return { error: `File not found: ${java_path}` };
      }
      const code = fs.readFileSync(java_path, "utf8");
      const result = validateSyntax(code);
      return result;
    }

    case "compile": {
      const { java_path, classpath = "" } = args;
      const result = await compile(java_path, classpath);
      return result;
    }

    case "validate_spec": {
      const { txt_path, feature } = args;
      if (!fs.existsSync(txt_path)) {
        return { error: `File not found: ${txt_path}` };
      }
      const txtContent = fs.readFileSync(txt_path, "utf8");
      const result = validateSpec(txtContent, feature);
      return result;
    }

    case "extract_actions": {
      const { java_path, test_name } = args;
      if (!fs.existsSync(java_path)) {
        return { error: `File not found: ${java_path}` };
      }
      const code = fs.readFileSync(java_path, "utf8");
      let result = extractActions(code);

      // 特定テスト名でフィルタ
      if (test_name) {
        result = {
          testMethods: result.testMethods.filter((m) => m.name === test_name),
        };
      }
      return result;
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── MCP サーバー起動 ───────────────────────────────────────────────────────
const server = new Server(
  { name: "junit-validator", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: String(err) }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
