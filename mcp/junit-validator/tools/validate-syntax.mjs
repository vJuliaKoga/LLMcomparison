/**
 * validate-syntax.mjs
 *
 * Java ソースを静的解析（正規表現ベース）し、
 * JUnit5 + Selenium として最低限の構文要件を満たすか確認する。
 * javac を使わないため、Java インストール不要。
 *
 * Input : { code: string }
 * Output: { valid: boolean, errors: string[], warnings: string[] }
 */

export function validateSyntax(code) {
  const errors = [];
  const warnings = [];

  // 1. 対括弧バランス ────────────────────────────────────────────────
  let depth = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      if (ch === "\\" ) { i++; continue; } // エスケープ
      if (ch === '"')  { inString = false; }
      continue;
    }

    if (ch === "/" && next === "/")  { inLineComment = true; continue; }
    if (ch === "/" && next === "*")  { inBlockComment = true; continue; }
    if (ch === '"')                   { inString = true; continue; }
    if (ch === "{")                   { depth++; }
    if (ch === "}")                   { depth--; }
  }
  if (depth !== 0) {
    errors.push(`Unbalanced braces: depth=${depth} at end of file`);
  }

  // 2. クラス宣言 ───────────────────────────────────────────────────
  if (!/\bpublic\s+class\s+\w+/.test(code)) {
    errors.push("Missing: public class declaration");
  }

  // 3. JUnit 5 import ───────────────────────────────────────────────
  if (!code.includes("org.junit.jupiter.api.Test")) {
    errors.push("Missing import: org.junit.jupiter.api.Test");
  }

  // 4. @Test アノテーション ─────────────────────────────────────────
  const testCount = (code.match(/@Test\b/g) || []).length;
  if (testCount === 0) {
    errors.push("No @Test methods found");
  } else if (testCount < 3) {
    warnings.push(`@Test count is ${testCount} (expected >= 3)`);
  }

  // 5. @BeforeEach / @AfterEach ─────────────────────────────────────
  if (!code.includes("@BeforeEach")) {
    errors.push("Missing @BeforeEach (WebDriver initialization)");
  }
  if (!code.includes("@AfterEach")) {
    errors.push("Missing @AfterEach (WebDriver teardown)");
  }

  // 6. Selenium WebDriver ────────────────────────────────────────────
  if (!code.includes("WebDriver")) {
    errors.push("Missing: WebDriver (Selenium not used)");
  }
  if (!code.includes("WebDriverWait")) {
    warnings.push("WebDriverWait not found — fixed sleep dependency suspected");
  }
  if (code.includes("Thread.sleep")) {
    warnings.push("Thread.sleep detected — use WebDriverWait instead");
  }

  // 7. ダミーテスト検知 ────────────────────────────────────────────
  if (code.includes("assertTrue(true)")) {
    warnings.push("assertTrue(true) found — possible dummy test");
  }

  // 8. 空メソッド検知（{}のみ）──────────────────────────────────────
  const emptyMethods = (code.match(/@Test\s+\n?\s*(public\s+)?void\s+\w+\([^)]*\)\s*\{\s*\}/g) || []);
  if (emptyMethods.length > 0) {
    warnings.push(`${emptyMethods.length} empty @Test method(s) found`);
  }

  return {
    valid: errors.length === 0,
    testCount,
    errors,
    warnings,
  };
}
