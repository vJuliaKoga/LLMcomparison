/**
 * validate-syntax.mjs
 *
 * Java ソースを静的解析（正規表現ベース）し、
 * JUnit5 + Selenium として最低限の構文要件を満たすか確認する。
 * javac を使わないため、Java インストール不要。
 *
 * 現行プロンプトでは「代表的な 2〜3 シナリオ」を生成する前提のため、
 * @Test 本数の基準は 2 本以上を推奨ラインとする。
 *
 * Input : { code: string }
 * Output: {
 *   valid: boolean,
 *   testCount: number,
 *   errors: string[],
 *   warnings: string[]
 * }
 */

function sanitizeCode(code) {
  let result = "";
  let inString = false;
  let inChar = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        result += "\n";
      } else {
        result += " ";
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        result += "  ";
        i++;
      } else {
        result += ch === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (inString) {
      if (ch === "\\") {
        result += "  ";
        i++;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      result += ch === "\n" ? "\n" : " ";
      continue;
    }

    if (inChar) {
      if (ch === "\\") {
        result += "  ";
        i++;
        continue;
      }
      if (ch === "'") {
        inChar = false;
      }
      result += ch === "\n" ? "\n" : " ";
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      result += "  ";
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      result += "  ";
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += " ";
      continue;
    }

    if (ch === "'") {
      inChar = true;
      result += " ";
      continue;
    }

    result += ch;
  }

  return result;
}

function checkBraceBalance(code) {
  let depth = 0;
  const errors = [];

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth < 0) {
        errors.push(`閉じ波括弧 '}' が余分です（index: ${i}）`);
        depth = 0;
      }
    }
  }

  if (depth !== 0) {
    errors.push(`波括弧の対応が取れていません（ファイル末尾時点の深さ: ${depth}）`);
  }

  return errors;
}

function parseImports(code) {
  const imports = new Set();
  const staticImports = new Set();

  for (const match of code.matchAll(/^\s*import\s+(static\s+)?([^;]+);/gm)) {
    const isStatic = Boolean(match[1]);
    const target = match[2].trim();
    if (isStatic) {
      staticImports.add(target);
    } else {
      imports.add(target);
    }
  }

  return { imports, staticImports };
}

function hasTypeImport(imports, fullyQualifiedName) {
  if (imports.has(fullyQualifiedName)) {
    return true;
  }

  const lastDot = fullyQualifiedName.lastIndexOf(".");
  if (lastDot < 0) {
    return false;
  }

  const pkg = fullyQualifiedName.slice(0, lastDot);
  return imports.has(`${pkg}.*`);
}

function hasStaticAssertionSupport(staticImports, assertionName) {
  return (
    staticImports.has(`org.junit.jupiter.api.Assertions.${assertionName}`) ||
    staticImports.has("org.junit.jupiter.api.Assertions.*")
  );
}

function findAnnotatedMethodNames(code, annotationName) {
  const names = [];
  const pattern = new RegExp(
    `@${annotationName}\\b[\\s\\r\\n]*(?:public\\s+|protected\\s+|private\\s+|static\\s+|final\\s+|synchronized\\s+)*[\\w<>\\[\\], ?]+\\s+(\\w+)\\s*\\(`,
    "g"
  );

  for (const match of code.matchAll(pattern)) {
    names.push(match[1]);
  }

  return names;
}

function findPublicClassNames(code) {
  return [...code.matchAll(/\bpublic\s+class\s+(\w+)\b/g)].map((m) => m[1]);
}

function countMatches(code, pattern) {
  return (code.match(pattern) || []).length;
}

function findSuspiciousStaticImports(staticImports) {
  const suspicious = [];
  for (const value of staticImports) {
    if (/org\.openqa\.selenium\.(WebDriver|WebElement)\.\*/.test(value)) {
      suspicious.push(value);
    }
    if (/org\.openqa\.selenium\.support\.ui\.\*/.test(value)) {
      suspicious.push(value);
    }
  }
  return suspicious;
}

export function validateSyntax(code) {
  const errors = [];
  const warnings = [];
  const sanitized = sanitizeCode(code);
  const { imports, staticImports } = parseImports(sanitized);

  // 1. 対括弧バランス
  errors.push(...checkBraceBalance(sanitized));

  // 2. クラス宣言
  const publicClassNames = findPublicClassNames(sanitized);
  if (publicClassNames.length === 0) {
    errors.push("public class 宣言が見つかりません");
  } else if (publicClassNames.length > 1) {
    errors.push(`public class が複数あります: ${publicClassNames.join(", ")}`);
  }

  // 3. 使用要素と import の整合
  const requiredImports = [
    {
      label: "@Test",
      usage: /@Test\b/,
      importName: "org.junit.jupiter.api.Test",
    },
    {
      label: "@BeforeEach",
      usage: /@BeforeEach\b/,
      importName: "org.junit.jupiter.api.BeforeEach",
    },
    {
      label: "@AfterEach",
      usage: /@AfterEach\b/,
      importName: "org.junit.jupiter.api.AfterEach",
    },
    {
      label: "WebDriver",
      usage: /\bWebDriver\b/,
      importName: "org.openqa.selenium.WebDriver",
    },
    {
      label: "By",
      usage: /\bBy\b/,
      importName: "org.openqa.selenium.By",
    },
    {
      label: "WebDriverWait",
      usage: /\bWebDriverWait\b/,
      importName: "org.openqa.selenium.support.ui.WebDriverWait",
    },
    {
      label: "ChromeDriver",
      usage: /\bChromeDriver\b/,
      importName: "org.openqa.selenium.chrome.ChromeDriver",
    },
    {
      label: "FirefoxDriver",
      usage: /\bFirefoxDriver\b/,
      importName: "org.openqa.selenium.firefox.FirefoxDriver",
    },
    {
      label: "Duration",
      usage: /\bDuration\b/,
      importName: "java.time.Duration",
    },
  ];

  for (const rule of requiredImports) {
    if (rule.usage.test(sanitized) && !hasTypeImport(imports, rule.importName)) {
      errors.push(`${rule.label} に必要な import が不足しています: ${rule.importName}`);
    }
  }

  // 4. JUnit 5 の基本要件
  if (!/@Test\b/.test(sanitized)) {
    errors.push("@Test メソッドが見つかりません");
  }

  const testCount = countMatches(sanitized, /@Test\b/g);
  if (testCount > 0 && testCount < 2) {
    warnings.push(`@Test の本数が少ないです: ${testCount}件（現行プロンプト想定では 2件以上推奨）`);
  }

  if (!/@BeforeEach\b/.test(sanitized)) {
    errors.push("@BeforeEach がありません（WebDriver 初期化不足の可能性）");
  }
  if (!/@AfterEach\b/.test(sanitized)) {
    errors.push("@AfterEach がありません（WebDriver 終了処理不足の可能性）");
  }

  const beforeEachMethods = findAnnotatedMethodNames(sanitized, "BeforeEach");
  const afterEachMethods = findAnnotatedMethodNames(sanitized, "AfterEach");
  const testMethods = findAnnotatedMethodNames(sanitized, "Test");

  if (beforeEachMethods.length === 0 && /@BeforeEach\b/.test(sanitized)) {
    warnings.push("@BeforeEach はありますが、対応するメソッド定義を検出できませんでした");
  }
  if (afterEachMethods.length === 0 && /@AfterEach\b/.test(sanitized)) {
    warnings.push("@AfterEach はありますが、対応するメソッド定義を検出できませんでした");
  }
  if (testMethods.length === 0 && /@Test\b/.test(sanitized)) {
    warnings.push("@Test はありますが、対応するメソッド定義を検出できませんでした");
  }

  const duplicateTestNames = testMethods.filter((name, index) => testMethods.indexOf(name) !== index);
  if (duplicateTestNames.length > 0) {
    warnings.push(`同名の @Test メソッドがあります: ${[...new Set(duplicateTestNames)].join(", ")}`);
  }

  // 5. Selenium 利用の基本要件
  if (!/\bWebDriver\b/.test(sanitized)) {
    errors.push("WebDriver が見つかりません（Selenium を使用していない可能性があります）");
  }
  if (!/\bWebDriverWait\b/.test(sanitized)) {
    warnings.push("WebDriverWait が見つかりません（固定待機依存の可能性があります）");
  }
  if (/\bThread\.sleep\s*\(/.test(sanitized)) {
    warnings.push("Thread.sleep が使われています。WebDriverWait の利用を推奨します");
  }
  if (/\bdriver\s*=\s*new\s+\w+Driver\s*\(/.test(sanitized) && !/\bdriver\.quit\s*\(/.test(sanitized)) {
    warnings.push("WebDriver は生成されていますが、driver.quit() が見つかりません");
  }

  const suspiciousStaticImports = findSuspiciousStaticImports(staticImports);
  if (suspiciousStaticImports.length > 0) {
    warnings.push(
      `不自然な static import があります: ${suspiciousStaticImports.join(", ")}（コンパイル失敗の原因になりやすいです）`
    );
  }

  // 6. JUnit assertion の使い方
  const assertionNames = [
    "assertEquals",
    "assertNotEquals",
    "assertTrue",
    "assertFalse",
    "assertNull",
    "assertNotNull",
    "assertThrows",
    "assertDoesNotThrow",
    "assertAll",
    "fail",
  ];

  for (const assertionName of assertionNames) {
    const bareAssertionPattern = new RegExp(`(^|[^.\\w])${assertionName}\\s*\\(`);
    if (!bareAssertionPattern.test(sanitized)) {
      continue;
    }

    if (!hasStaticAssertionSupport(staticImports, assertionName)) {
      warnings.push(
        `${assertionName}(...) が使われていますが、org.junit.jupiter.api.Assertions の static import がありません`
      );
    }
  }

  if (/\bassert\s+.+;/.test(sanitized)) {
    warnings.push("Java の assert 文が使われています。JUnit assertion の利用を推奨します");
  }

  // 7. ダミーテスト / 空メソッド検知
  if (/\bassertTrue\s*\(\s*true\s*\)/.test(sanitized)) {
    warnings.push("assertTrue(true) が見つかりました。ダミーテストの可能性があります");
  }

  const emptyTestMethods =
    sanitized.match(/@Test\b[\s\r\n]*(?:public\s+|protected\s+|private\s+)?(?:static\s+)?void\s+\w+\([^)]*\)\s*\{\s*\}/g) || [];
  if (emptyTestMethods.length > 0) {
    warnings.push(`空の @Test メソッドがあります: ${emptyTestMethods.length}件`);
  }

  return {
    valid: errors.length === 0,
    testCount,
    errors,
    warnings,
  };
}