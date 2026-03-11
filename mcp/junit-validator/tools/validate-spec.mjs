/**
 * validate-spec.mjs
 *
 * validate-output.mjs（テキスト構造検証）の補完として、
 * 「フィーチャー観点でのカバレッジ」と「仕様に基づいたテスト可能性」を確認する。
 *
 * validate-output.mjs との役割分担:
 *   validate-output.mjs  -> セクション存在・テキスト構造・コードブロック有無などの形式検証
 *   validate-spec        -> フィーチャー固有の代表シナリオが含まれているか + テストケースとして実行可能か
 *
 * Input : { txtContent: string, feature: string }
 * Output: {
 *   valid: boolean,
 *   coverage: object,
 *   testability: object,
 *   issues: string[]
 * }
 */

const FEATURE_RULES = {
  ログイン: {
    groups: [
      {
        key: "正常ログイン",
        required: true,
        patterns: ["正常", "成功", "ログイン成功", "認証成功", "valid credentials"],
        missingMessage: '代表的な正常系シナリオが不足しています: 「正常ログイン」',
      },
      {
        key: "保護・異常系",
        required: true,
        minMatched: 1,
        items: [
          { key: "MFA", patterns: ["MFA", "多要素", "二要素", "ワンタイム", "OTP", "2fa"] },
          { key: "ロックアウト", patterns: ["ロック", "試行制限", "アカウントロック", "lockout"] },
          { key: "異常系", patterns: ["誤ったパスワード", "不正", "無効", "存在しない", "ログイン失敗", "invalid"] },
          { key: "セキュリティ", patterns: ["SQLインジェクション", "XSS", "ブルートフォース", "セッション", "csrf", "security"] },
        ],
        missingMessage: '代表的な保護・異常系シナリオが不足しています（MFA / ロックアウト / 異常系 / セキュリティ のいずれか）',
      },
    ],
    preconditionPatterns: ["admin", "customer", "auditor", "管理者", "顧客", "監査", "mfa", "ロック", "失敗", "成功"],
  },
  振込: {
    groups: [
      {
        key: "正常振込",
        required: true,
        patterns: ["正常", "成功", "振込完了", "送金成功", "transfer success"],
        missingMessage: '代表的な正常系シナリオが不足しています: 「正常振込」',
      },
      {
        key: "制約・保護系",
        required: true,
        minMatched: 1,
        items: [
          { key: "残高不足", patterns: ["残高不足", "残高超過", "insufficient"] },
          { key: "上限", patterns: ["上限", "限度額", "最大", "limit"] },
          { key: "承認フロー", patterns: ["承認", "二重承認", "承認者", "approval"] },
          { key: "二重送信", patterns: ["二重送信", "二重振込", "冪等", "duplicate"] },
        ],
        missingMessage: '代表的な制約・保護系シナリオが不足しています（残高不足 / 上限 / 承認フロー / 二重送信 のいずれか）',
      },
    ],
    preconditionPatterns: ["残高", "承認", "customer", "admin", "顧客", "管理者", "limit", "上限", "二重", "冪等"],
  },
  監査ログ: {
    groups: [
      {
        key: "役割カバレッジ",
        required: true,
        minMatched: 2,
        items: [
          { key: "admin権限", patterns: ["admin", "管理者"] },
          { key: "auditor権限", patterns: ["auditor", "監査"] },
          { key: "customer権限", patterns: ["customer", "顧客", "一般ユーザ", "一般ユーザー"] },
        ],
        missingMessage: '役割ベースの監査ログ観点が不足しています（admin / auditor / customer のうち2役割以上）',
      },
    ],
    preconditionPatterns: ["admin", "auditor", "customer", "管理者", "監査", "顧客", "403", "拒否", "権限"],
  },
};

const LOCATOR_PATTERNS = [
  /By\.(id|name|xpath|cssSelector|className|linkText|partialLinkText|tagName)\(/g,
  /ExpectedConditions\.(visibilityOfElementLocated|presenceOfElementLocated|elementToBeClickable|urlContains|textToBePresentInElementLocated)\(/g,
];

const INPUT_PATTERNS = [
  /sendKeys\(([^)]*)\)/g,
  /driver\.get\(([^)]*)\)/g,
  /selectBy(Value|VisibleText|Index)\(([^)]*)\)/g,
];

const ACTION_PATTERNS = [
  /sendKeys\(([^)]*)\)/g,
  /driver\.get\(([^)]*)\)/g,
  /selectBy(Value|VisibleText|Index)\(([^)]*)\)/g,
  /\.click\(/g,
  /\.clear\(/g,
];

const OBSERVABLE_PATTERNS = [
  /getText\(/g,
  /isDisplayed\(/g,
  /isEnabled\(/g,
  /isSelected\(/g,
  /getAttribute\(/g,
  /getCurrentUrl\(/g,
  /getTitle\(/g,
  /getPageSource\(/g,
  /ExpectedConditions\./g,
];

const ASSERTION_PATTERNS = [
  /assertEquals\(/g,
  /assertNotEquals\(/g,
  /assertTrue\(/g,
  /assertFalse\(/g,
  /assertNull\(/g,
  /assertNotNull\(/g,
  /assertThrows\(/g,
  /assertDoesNotThrow\(/g,
  /assertAll\(/g,
  /fail\(/g,
];

const AMBIGUOUS_PATTERNS = [
  /適切/g,
  /正しいこと/g,
  /問題なく/g,
  /期待通り/g,
  /正常に/g,
  /適宜/g,
  /必要に応じて/g,
  /うまく/g,
  /よしなに/g,
  /成功すること/g,
];

const PLACEHOLDER_PATTERNS = [
  /TODO/gi,
  /FIXME/gi,
  /xxx/gi,
  /dummy/gi,
  /placeholder/gi,
  /sample-user/gi,
  /sample-password/gi,
  /your-/gi,
  /<[^>]+>/g,
];

const ASSUMPTION_DISCLOSURE_PATTERNS = [
  /推測/g,
  /仮定/g,
  /仕様.*明記されていない/g,
  /不明/g,
  /未定/g,
  /不足/g,
  /実装依存/g,
  /保証がない/g,
  /可能性/g,
  /対象外/g,
];

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .toLowerCase();
}

function countMatches(text, patterns) {
  let count = 0;
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    count += matches ? matches.length : 0;
  }
  return count;
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => text.includes(String(pattern).toLowerCase()));
}

function findFeatureRule(feature) {
  const featureText = String(feature || "");
  const key = Object.keys(FEATURE_RULES).find((k) => featureText.includes(k));
  return key ? FEATURE_RULES[key] : null;
}

function extractJavaCode(txtContent) {
  const text = String(txtContent || "");
  const javaFence = text.match(/```java\s*([\s\S]*?)\s*```/i);
  const genericFence = text.match(/```\s*([\s\S]*?)\s*```/);
  return (javaFence?.[1] ?? genericFence?.[1] ?? "").trim();
}

function extractSectionB(txtContent) {
  const text = String(txtContent || "");
  const patterns = [
    /^\(B\)[^\n]*\n?([\s\S]*)$/im,
    /^\*{1,2}\s*仕様と実装の不整合・不足情報\s*\*{1,2}\s*\n?([\s\S]*)$/im,
    /^#+\s*仕様と実装の不整合・不足情報\s*\n?([\s\S]*)$/im,
    /^仕様と実装の不整合・不足情報\s*[:：]?\s*\n?([\s\S]*)$/im,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  const fenceMatch = text.match(/```(?:java)?\s*[\s\S]*?```\s*([\s\S]*)$/i);
  return fenceMatch?.[1]?.trim() ?? "";
}

function buildCoverage(feature, normalizedText) {
  const coverage = {};
  const issues = [];

  const rule = findFeatureRule(feature);
  if (!rule) {
    return {
      coverage: { note: `この feature 用の専用ルールは未定義です: "${feature}"` },
      issues: [],
      rule: null,
    };
  }

  for (const group of rule.groups) {
    if (group.items) {
      const matchedItems = group.items
        .filter((item) => includesAny(normalizedText, item.patterns))
        .map((item) => item.key);

      coverage[group.key] = {
        found: matchedItems.length >= (group.minMatched || 1),
        matchedItems,
        required: Boolean(group.required),
        minMatched: group.minMatched || 1,
      };

      if (group.required && matchedItems.length < (group.minMatched || 1)) {
        issues.push(group.missingMessage);
      }
    } else {
      const found = includesAny(normalizedText, group.patterns || []);
      coverage[group.key] = {
        found,
        required: Boolean(group.required),
      };

      if (group.required && !found) {
        issues.push(group.missingMessage);
      }
    }
  }

  return { coverage, issues, rule };
}

function evaluatePreconditions(normalizedText, coverageIssues, rule) {
  const matched = (rule?.preconditionPatterns || []).filter((p) =>
    normalizedText.includes(String(p).toLowerCase())
  );
  const enoughMarkers = matched.length >= 2;
  const specAnchoredByCoverage = coverageIssues.length === 0;
  const ok = enoughMarkers || specAnchoredByCoverage;

  return {
    ok,
    matchedMarkers: [...new Set(matched)],
    detail: ok
      ? "仕様由来の状態・役割・制約に関する手がかりを確認できました"
      : "仕様由来の前提条件（役割・状態・制約）の記述が薄く、前提が曖昧です",
  };
}

function evaluateConcreteInputsAndTargets(javaCode) {
  const locatorCount = countMatches(javaCode, LOCATOR_PATTERNS);
  const inputCount = countMatches(javaCode, INPUT_PATTERNS);
  const actionCount = countMatches(javaCode, ACTION_PATTERNS);
  const placeholderCount = countMatches(javaCode, PLACEHOLDER_PATTERNS);
  const hasConcreteLiteral = /"[^"]{2,}"/.test(javaCode);
  const ok = locatorCount > 0 && actionCount > 0 && hasConcreteLiteral && placeholderCount === 0;

  return {
    ok,
    locatorCount,
    inputCount,
    actionCount,
    placeholderCount,
    detail: ok
      ? "入力値と操作対象が具体的です"
      : "入力値・操作対象が不十分、またはプレースホルダが残っています",
  };
}

function evaluateObservableExpectedResults(javaCode) {
  const assertionCount = countMatches(javaCode, ASSERTION_PATTERNS);
  const observableCount = countMatches(javaCode, OBSERVABLE_PATTERNS);
  const ok = assertionCount > 0 && observableCount > 0;

  return {
    ok,
    assertionCount,
    observableCount,
    detail: ok
      ? "期待結果が UI / 状態変化として観測可能です"
      : "期待結果を観測する assertion または observable な確認処理が不足しています",
  };
}

function evaluateAmbiguity(txtContent, javaCode, observableResult) {
  const textWithoutCode = String(txtContent || "").replace(/```[\s\S]*?```/g, " ");
  const ambiguousCount = countMatches(textWithoutCode, AMBIGUOUS_PATTERNS);
  const placeholderCount = countMatches(javaCode, PLACEHOLDER_PATTERNS);
  const ok = ambiguousCount === 0 && placeholderCount === 0;

  return {
    ok,
    ambiguousCount,
    placeholderCount,
    detail: ok
      ? "曖昧な表現は目立ちません"
      : observableResult.ok
        ? "曖昧な表現が含まれますが、観測可能な assertion はあります"
        : "曖昧な表現が残っており、判定条件も曖昧です",
  };
}

function evaluateAssumptionDisclosure(sectionB, javaCode) {
  const normalizedB = normalizeText(sectionB);
  const hasDisclosure = ASSUMPTION_DISCLOSURE_PATTERNS.some((p) => p.test(sectionB));
  const saysNothing = /特になし|なし|ありません/.test(sectionB);
  const locatorCount = countMatches(javaCode, LOCATOR_PATTERNS);
  const messageLiteralCount = (
    javaCode.match(/assert(?:Equals|True|False)[\s\S]{0,120}?"[^"]+"/g) || []
  ).length;
  const assumptionPressure = locatorCount + messageLiteralCount;

  const ok =
    hasDisclosure ||
    (!saysNothing && normalizedB.length > 0) ||
    assumptionPressure < 4;

  return {
    ok,
    assumptionPressure,
    sectionBLength: sectionB.length,
    detail: ok
      ? "仕様不足や仮定がある程度開示されています"
      : "仕様にない UI 要素や文言を仮定している可能性がある一方で、(B) の開示が不十分です",
  };
}

function evaluateAutomatableAssertions(javaCode) {
  const assertionCount = countMatches(javaCode, ASSERTION_PATTERNS);
  const waitCount = countMatches(javaCode, [/WebDriverWait\(/g, /ExpectedConditions\./g]);
  const uiObservableCount = countMatches(javaCode, [
    /getText\(/g,
    /isDisplayed\(/g,
    /getAttribute\(/g,
    /getCurrentUrl\(/g,
  ]);
  const javaAssertCount = (javaCode.match(/\bassert\s+.+;/g) || []).length;
  const ok =
    assertionCount >= 2 &&
    (waitCount > 0 || uiObservableCount > 0) &&
    javaAssertCount === 0;

  return {
    ok,
    assertionCount,
    waitCount,
    uiObservableCount,
    javaAssertCount,
    detail: ok
      ? "自動実行しやすい assertion に落ちています"
      : "自動化向きの assertion が不足しているか、Java assert 依存が残っています",
  };
}

function buildTestability(txtContent, feature, coverageIssues) {
  const javaCode = extractJavaCode(txtContent);
  const sectionB = extractSectionB(txtContent);
  const normalizedText = normalizeText(txtContent);
  const rule = findFeatureRule(feature);

  const preconditions = evaluatePreconditions(normalizedText, coverageIssues, rule);
  const concreteInputs = evaluateConcreteInputsAndTargets(javaCode);
  const observableResults = evaluateObservableExpectedResults(javaCode);
  const ambiguity = evaluateAmbiguity(txtContent, javaCode, observableResults);
  const assumptions = evaluateAssumptionDisclosure(sectionB, javaCode);
  const automatableAssertions = evaluateAutomatableAssertions(javaCode);

  const testability = {
    spec_grounded_preconditions: preconditions,
    concrete_inputs_and_targets: concreteInputs,
    observable_expected_results: observableResults,
    low_ambiguity: ambiguity,
    assumptions_disclosed: assumptions,
    automatable_assertions: automatableAssertions,
  };

  const issues = [];
  if (!preconditions.ok) {
    issues.push("テスト可能性: 仕様由来の前提条件（役割・状態・制約）が十分に読み取れません");
  }
  if (!concreteInputs.ok) {
    issues.push("テスト可能性: 入力値・操作対象が十分に具体化されていません");
  }
  if (!observableResults.ok) {
    issues.push("テスト可能性: 期待結果が UI / 状態変化として観測可能になっていません");
  }
  if (!ambiguity.ok) {
    issues.push("テスト可能性: 曖昧な表現やプレースホルダが残っています");
  }
  if (!assumptions.ok) {
    issues.push("テスト可能性: 仕様にない仮定の開示が不十分です");
  }
  if (!automatableAssertions.ok) {
    issues.push("テスト可能性: 自動化しやすい assertion に十分落とし込めていません");
  }

  return { testability, issues };
}

/**
 * @param {string} txtContent  .txt ファイルの全文（LLM 出力）
 * @param {string} feature     vars.feature の値
 */
export function validateSpec(txtContent, feature) {
  const normalizedText = normalizeText(txtContent);
  const { coverage, issues: coverageIssues } = buildCoverage(feature, normalizedText);
  const { testability, issues: testabilityIssues } = buildTestability(
    txtContent,
    feature,
    coverageIssues
  );

  const issues = [...coverageIssues, ...testabilityIssues];

  return {
    valid: issues.length === 0,
    coverage,
    testability,
    issues,
  };
}