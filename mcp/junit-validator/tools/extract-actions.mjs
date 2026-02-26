/**
 * extract-actions.mjs
 *
 * JUnit + Selenium コードから WebDriver API 呼び出しを抽出し、
 * Playwright MCP が直接利用できるセマンティックアクションに変換する。
 *
 * 変換ルール (Selenium → Playwright):
 *   driver.get(url)                         → { type: "navigate",  url }
 *   .findElement(By.id(x)).click()          → { type: "click",     selector: "#x" }
 *   .findElement(By.id(x)).sendKeys(text)   → { type: "fill",      selector: "#x", value: text }
 *   .findElement(By.id(x)).clear()          → { type: "clear",     selector: "#x" }
 *   .findElement(By.id(x)).getText()        → { type: "get_text",  selector: "#x" }
 *   WebDriverWait(...).until(...)           → { type: "wait",      condition }
 *   assertEquals(exp, el.getText())         → { type: "assert_text", selector, expected }
 *   assertTrue(...)                         → { type: "assert_true", expression }
 *   assertFalse(...)                        → { type: "assert_false", expression }
 *   driver.findElements(...).size()         → { type: "count_elements", selector }
 *
 * Output: { testMethods: TestMethod[] }
 *
 * TestMethod: {
 *   name: string,
 *   actions: SemanticAction[]
 * }
 */

// ヘルパー: By 表現 → CSS/XPath セレクタ ─────────────────────────────────
function byToSelector(byExpr) {
  let m;

  // By.id("x") → #x
  m = byExpr.match(/By\.id\s*\(\s*"([^"]+)"\s*\)/);
  if (m) return `#${m[1]}`;

  // By.name("x") → [name="x"]
  m = byExpr.match(/By\.name\s*\(\s*"([^"]+)"\s*\)/);
  if (m) return `[name="${m[1]}"]`;

  // By.cssSelector("x") → x (そのまま)
  m = byExpr.match(/By\.cssSelector\s*\(\s*"([^"]+)"\s*\)/);
  if (m) return m[1];

  // By.xpath("x") → xpath=x
  m = byExpr.match(/By\.xpath\s*\(\s*"([^"]+)"\s*\)/);
  if (m) return `xpath=${m[1]}`;

  // By.className("x") → .x
  m = byExpr.match(/By\.className\s*\(\s*"([^"]+)"\s*\)/);
  if (m) return `.${m[1]}`;

  // By.tagName("x") → x
  m = byExpr.match(/By\.tagName\s*\(\s*"([^"]+)"\s*\)/);
  if (m) return m[1];

  // By.linkText("x") → text="x"
  m = byExpr.match(/By\.linkText\s*\(\s*"([^"]+)"\s*\)/);
  if (m) return `text="${m[1]}"`;

  return byExpr; // fallback: そのまま返す
}

// @Test メソッドをブロック単位で切り出す ──────────────────────────────────
function splitTestMethods(code) {
  const methods = [];
  // @Test の直後にある public void xxx() { ... } を抽出
  const testMethodRe = /@Test[\s\S]*?(?:public\s+)?void\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let match;

  while ((match = testMethodRe.exec(code)) !== null) {
    const name = match[1];
    const startBrace = match.index + match[0].length - 1; // '{' の位置

    // 対応する '}' を探す
    let depth = 1;
    let i = startBrace + 1;
    while (i < code.length && depth > 0) {
      if (code[i] === "{") depth++;
      if (code[i] === "}") depth--;
      i++;
    }
    methods.push({ name, body: code.slice(startBrace, i) });
  }
  return methods;
}

// 1 メソッドのボディからアクションを抽出 ──────────────────────────────────
function extractActionsFromBody(body) {
  const actions = [];

  // driver.get(...)
  for (const m of body.matchAll(/driver\.get\s*\(\s*([^)]+)\s*\)/g)) {
    const urlExpr = m[1].trim();
    // 変数参照か文字列リテラルかを判別
    const urlLiteral = urlExpr.match(/^"([^"]+)"$/);
    actions.push({
      type: "navigate",
      url: urlLiteral ? urlLiteral[1] : `{{ ${urlExpr} }}`,
    });
  }

  // findElement(By.*).sendKeys(...)
  for (const m of body.matchAll(
    /findElement\s*\(\s*(By\.[^)]+\))\s*\)\.sendKeys\s*\(\s*([^)]+)\s*\)/g
  )) {
    const selector = byToSelector(m[1]);
    const valueExpr = m[2].trim();
    const valueLiteral = valueExpr.match(/^"([^"]*)"$/);
    actions.push({
      type: "fill",
      selector,
      value: valueLiteral ? valueLiteral[1] : `{{ ${valueExpr} }}`,
    });
  }

  // findElement(By.*).clear()
  for (const m of body.matchAll(
    /findElement\s*\(\s*(By\.[^)]+\))\s*\)\.clear\s*\(\s*\)/g
  )) {
    actions.push({ type: "clear", selector: byToSelector(m[1]) });
  }

  // findElement(By.*).click()
  for (const m of body.matchAll(
    /findElement\s*\(\s*(By\.[^)]+\))\s*\)\.click\s*\(\s*\)/g
  )) {
    actions.push({ type: "click", selector: byToSelector(m[1]) });
  }

  // findElement(By.*).getText()  — assert の引数として現れることが多い
  for (const m of body.matchAll(
    /findElement\s*\(\s*(By\.[^)]+\))\s*\)\.getText\s*\(\s*\)/g
  )) {
    actions.push({ type: "get_text", selector: byToSelector(m[1]) });
  }

  // assertEquals("expected", element.getText()) パターン
  for (const m of body.matchAll(
    /assertEquals\s*\(\s*"([^"]+)"\s*,\s*.*?findElement\s*\(\s*(By\.[^)]+\))\s*\)\.getText/g
  )) {
    actions.push({
      type: "assert_text",
      selector: byToSelector(m[2]),
      expected: m[1],
    });
  }

  // assertTrue / assertFalse (シンプル表現のみ)
  for (const m of body.matchAll(/assertTrue\s*\(([^;]+)\)/g)) {
    const expr = m[1].trim();
    if (expr !== "true") {
      actions.push({ type: "assert_true", expression: expr });
    }
  }
  for (const m of body.matchAll(/assertFalse\s*\(([^;]+)\)/g)) {
    actions.push({ type: "assert_false", expression: m[1].trim() });
  }

  // WebDriverWait: until(ExpectedConditions.visibilityOfElementLocated(By.*))
  for (const m of body.matchAll(
    /ExpectedConditions\.\w+\s*\(\s*(By\.[^)]+\))\s*\)/g
  )) {
    actions.push({ type: "wait", selector: byToSelector(m[1]) });
  }

  // driver.findElements(...).size() — 要素数確認
  for (const m of body.matchAll(
    /findElements\s*\(\s*(By\.[^)]+\))\s*\)\.size\s*\(\s*\)/g
  )) {
    actions.push({ type: "count_elements", selector: byToSelector(m[1]) });
  }

  return actions;
}

// メイン関数 ──────────────────────────────────────────────────────────────
/**
 * @param {string} javaCode  .java ファイルの全文
 * @returns {{ testMethods: Array<{name: string, actions: object[]}> }}
 */
export function extractActions(javaCode) {
  const methods = splitTestMethods(javaCode);

  const testMethods = methods.map(({ name, body }) => ({
    name,
    actions: extractActionsFromBody(body),
  }));

  return { testMethods };
}
