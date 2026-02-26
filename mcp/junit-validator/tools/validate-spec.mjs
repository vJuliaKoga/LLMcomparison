/**
 * validate-spec.mjs
 *
 * validate-output.mjs（テキスト構造検証）の補完として、
 * 「フィーチャー観点でのカバレッジ」を確認する。
 *
 * validate-output.mjs との役割分担:
 *   validate-output.mjs  → セクション存在・テキスト構造・TC数・カテゴリ数
 *   validate-spec        → フィーチャー固有の必須シナリオが含まれているか
 *
 * Input : { txtContent: string, feature: string }
 * Output: { valid: boolean, coverage: object, issues: string[] }
 */

/**
 * フィーチャーごとの「必須キーワード」定義
 * 仕様書・プロンプトの必須条件から導出。
 */
const FEATURE_REQUIRED = {
  ログイン: {
    keywords: [
      { key: "正常ログイン",   patterns: ["正常", "成功", "ログイン成功"] },
      { key: "MFA",           patterns: ["MFA", "多要素", "二要素", "ワンタイム", "OTP"] },
      { key: "ロックアウト",   patterns: ["ロック", "試行制限", "アカウントロック"] },
      { key: "異常系",        patterns: ["誤ったパスワード", "不正", "無効", "存在しない"] },
      { key: "セキュリティ",  patterns: ["SQLインジェクション", "XSS", "ブルートフォース", "セッション"] },
    ],
  },
  振込: {
    keywords: [
      { key: "正常振込",     patterns: ["正常", "成功", "振込完了"] },
      { key: "残高不足",     patterns: ["残高不足", "残高超過"] },
      { key: "上限",        patterns: ["上限", "限度額", "最大"] },
      { key: "承認フロー",   patterns: ["承認", "二重承認", "承認者"] },
      { key: "二重送信",     patterns: ["二重送信", "二重振込", "冪等"] },
    ],
  },
  監査ログ: {
    keywords: [
      { key: "admin権限",   patterns: ["admin", "管理者"] },
      { key: "auditor権限", patterns: ["auditor", "監査"] },
      { key: "customer権限",patterns: ["customer", "顧客", "一般ユーザ"] },
      { key: "権限拒否",    patterns: ["権限なし", "アクセス拒否", "禁止", "403"] },
    ],
  },
};

/**
 * フィーチャー名からルール定義を検索（部分一致）。
 */
function findFeatureRule(feature) {
  const key = Object.keys(FEATURE_REQUIRED).find((k) =>
    feature.includes(k)
  );
  return key ? FEATURE_REQUIRED[key] : null;
}

/**
 * @param {string} txtContent  .txt ファイルの全文（LLM 出力）
 * @param {string} feature     vars.feature の値
 */
export function validateSpec(txtContent, feature) {
  const issues = [];
  const coverage = {};

  const rule = findFeatureRule(feature);
  if (!rule) {
    return {
      valid: true,
      coverage: { note: `No specific rule defined for feature: "${feature}"` },
      issues: [],
    };
  }

  for (const { key, patterns } of rule.keywords) {
    const found = patterns.some((p) => txtContent.includes(p));
    coverage[key] = found;
    if (!found) {
      issues.push(
        `Missing scenario coverage: "${key}" (expected one of: ${patterns.join(", ")})`
      );
    }
  }

  // (D) 自己検証セクションの存在確認（validate-output.mjs が主担当だが念のため）
  const hasSelfCheck = txtContent.includes("(D) 自己検証");
  coverage["self_validation_section"] = hasSelfCheck;
  if (!hasSelfCheck) {
    issues.push('Missing "(D) 自己検証" section');
  }

  return {
    valid: issues.length === 0,
    coverage,
    issues,
  };
}
