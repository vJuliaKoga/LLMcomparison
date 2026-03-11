/**
 * extract-actions.mjs
 *
 * JUnit + Selenium コードから WebDriver API 呼び出しを抽出し、
 * Playwright などの実行系へ渡しやすいセマンティックアクション列に変換する。
 *
 * 目的:
 * - 「このテストコードが実行可能な操作列へ落とせるか」を見る
 * - 操作順を保ったまま抽出する
 * - locator 変数 / WebElement 変数 / 一部 assertion / wait を扱う
 *
 * Output:
 * {
 *   testMethods: [
 *     {
 *       name: string,
 *       actions: SemanticAction[],
 *       warnings: string[]
 *     }
 *   ],
 *   summary: {
 *     testMethodCount: number,
 *     actionCount: number,
 *     methodsWithNoActions: number,
 *     warningCount: number
 *   }
 * }
 */

function sanitizeForStructure(code) {
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

function splitTestMethods(code) {
  const methods = [];
  const sanitized = sanitizeForStructure(code);
  const testMethodRe =
    /@Test[\s\S]*?(?:public\s+|protected\s+|private\s+)?(?:static\s+)?(?:final\s+)?[\w<>\[\], ?]+\s+(\w+)\s*\([^)]*\)\s*\{/g;

  let match;
  while ((match = testMethodRe.exec(code)) !== null) {
    const name = match[1];
    const startBrace = match.index + match[0].lastIndexOf("{");

    let depth = 1;
    let i = startBrace + 1;
    while (i < sanitized.length && depth > 0) {
      if (sanitized[i] === "{") depth++;
      if (sanitized[i] === "}") depth--;
      i++;
    }

    methods.push({
      name,
      body: code.slice(startBrace + 1, i - 1),
    });
  }

  return methods;
}

function splitStatements(body) {
  const statements = [];
  let current = "";
  let startIndex = 0;

  let inString = false;
  let inChar = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const next = body[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (inString) {
      current += ch;
      if (ch === "\\") {
        if (i + 1 < body.length) {
          current += body[i + 1];
          i++;
        }
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (inChar) {
      current += ch;
      if (ch === "\\") {
        if (i + 1 < body.length) {
          current += body[i + 1];
          i++;
        }
        continue;
      }
      if (ch === "'") {
        inChar = false;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      current += ch + next;
      i++;
      inLineComment = true;
      continue;
    }

    if (ch === "/" && next === "*") {
      current += ch + next;
      i++;
      inBlockComment = true;
      continue;
    }

    if (ch === '"') {
      current += ch;
      inString = true;
      continue;
    }

    if (ch === "'") {
      current += ch;
      inChar = true;
      continue;
    }

    current += ch;

    if (ch === ";") {
      const statement = current.trim();
      if (statement) {
        statements.push({ index: startIndex, text: statement });
      }
      current = "";
      startIndex = i + 1;
    }
  }

  const tail = current.trim();
  if (tail) {
    statements.push({ index: startIndex, text: tail });
  }

  return statements;
}

function stripQuotes(expr) {
  const trimmed = String(expr || "").trim();
  const m = trimmed.match(/^["']([\s\S]*)["']$/);
  return m ? m[1] : null;
}

function exprToValue(expr) {
  const literal = stripQuotes(expr);
  return literal !== null ? literal : `{{ ${String(expr || "").trim()} }}`;
}

function normalizeLocatorExpr(locatorExpr) {
  return String(locatorExpr || "").trim().replace(/\s+/g, " ");
}

function resolveLocatorExpr(locatorExpr, ctx, depth = 0) {
  const normalized = normalizeLocatorExpr(locatorExpr);
  if (depth > 5) return normalized;

  if (ctx.locatorVars[normalized]) {
    return resolveLocatorExpr(ctx.locatorVars[normalized], ctx, depth + 1);
  }

  return normalized;
}

function byToSelector(locatorExpr) {
  let m;
  const expr = String(locatorExpr || "").trim();

  m = expr.match(/By\.id\s*\(\s*["']([^"']+)["']\s*\)/);
  if (m) return `#${m[1]}`;

  m = expr.match(/By\.name\s*\(\s*["']([^"']+)["']\s*\)/);
  if (m) return `[name="${m[1]}"]`;

  m = expr.match(/By\.cssSelector\s*\(\s*["']([\s\S]+?)["']\s*\)/);
  if (m) return m[1];

  m = expr.match(/By\.xpath\s*\(\s*["']([\s\S]+?)["']\s*\)/);
  if (m) return `xpath=${m[1]}`;

  m = expr.match(/By\.className\s*\(\s*["']([^"']+)["']\s*\)/);
  if (m) return `.${m[1]}`;

  m = expr.match(/By\.tagName\s*\(\s*["']([^"']+)["']\s*\)/);
  if (m) return m[1];

  m = expr.match(/By\.linkText\s*\(\s*["']([\s\S]+?)["']\s*\)/);
  if (m) return `text="${m[1]}"`;

  m = expr.match(/By\.partialLinkText\s*\(\s*["']([\s\S]+?)["']\s*\)/);
  if (m) return `text=${m[1]}`;

  return expr;
}

function resolveSelector(locatorExpr, ctx) {
  const resolvedExpr = resolveLocatorExpr(locatorExpr, ctx);
  const selector = byToSelector(resolvedExpr);
  const resolved =
    selector !== locatorExpr ||
    /^#|^\[name=|^xpath=|^\.|^text=|^text="/.test(selector);

  return {
    locatorExpr: resolvedExpr,
    selector,
    resolved,
  };
}

function resolveElementSelector(elementExpr, ctx) {
  const name = String(elementExpr || "").trim();
  if (ctx.elementVars[name]) {
    return resolveSelector(ctx.elementVars[name], ctx);
  }
  return {
    locatorExpr: name,
    selector: name,
    resolved: false,
  };
}

function addWarning(methodWarnings, message) {
  if (!methodWarnings.includes(message)) {
    methodWarnings.push(message);
  }
}

function parseWaitAction(statement, ctx) {
  let m;

  m = statement.match(
    /until\s*\(\s*ExpectedConditions\.(visibilityOfElementLocated|presenceOfElementLocated|elementToBeClickable)\s*\(\s*([\s\S]+?)\s*\)\s*\)/
  );
  if (m) {
    const conditionType = m[1];
    const resolved = resolveSelector(m[2], ctx);
    return {
      type: "wait",
      condition: conditionType,
      selector: resolved.selector,
    };
  }

  m = statement.match(
    /until\s*\(\s*ExpectedConditions\.textToBePresentInElementLocated\s*\(\s*([\s\S]+?)\s*,\s*([^)]+)\s*\)\s*\)/
  );
  if (m) {
    const resolved = resolveSelector(m[1], ctx);
    return {
      type: "wait",
      condition: "textToBePresentInElementLocated",
      selector: resolved.selector,
      expected: exprToValue(m[2]),
    };
  }

  m = statement.match(
    /until\s*\(\s*ExpectedConditions\.urlContains\s*\(\s*([^)]+)\s*\)\s*\)/
  );
  if (m) {
    return {
      type: "wait",
      condition: "urlContains",
      expected: exprToValue(m[1]),
    };
  }

  return null;
}

function parseAssertionAction(statement, ctx) {
  let m;

  m = statement.match(
    /assertEquals\s*\(\s*([^)]+?)\s*,\s*driver\.findElement\s*\(\s*([\s\S]+?)\s*\)\.getText\s*\(\s*\)\s*\)/
  );
  if (m) {
    const resolved = resolveSelector(m[2], ctx);
    return {
      type: "assert_text",
      selector: resolved.selector,
      expected: exprToValue(m[1]),
    };
  }

  m = statement.match(
    /assertEquals\s*\(\s*([^)]+?)\s*,\s*(\w+)\.getText\s*\(\s*\)\s*\)/
  );
  if (m) {
    const resolved = resolveElementSelector(m[2], ctx);
    return {
      type: "assert_text",
      selector: resolved.selector,
      expected: exprToValue(m[1]),
    };
  }

  m = statement.match(
    /assertEquals\s*\(\s*([^)]+?)\s*,\s*driver\.getCurrentUrl\s*\(\s*\)\s*\)/
  );
  if (m) {
    return {
      type: "assert_url",
      expected: exprToValue(m[1]),
    };
  }

  m = statement.match(
    /assertTrue\s*\(\s*(\w+)\.isDisplayed\s*\(\s*\)\s*\)/
  );
  if (m) {
    const resolved = resolveElementSelector(m[1], ctx);
    return {
      type: "assert_visible",
      selector: resolved.selector,
    };
  }

  m = statement.match(
    /assertFalse\s*\(\s*(\w+)\.isDisplayed\s*\(\s*\)\s*\)/
  );
  if (m) {
    const resolved = resolveElementSelector(m[1], ctx);
    return {
      type: "assert_hidden",
      selector: resolved.selector,
    };
  }

  m = statement.match(
    /assertTrue\s*\(\s*driver\.getCurrentUrl\s*\(\s*\)\.contains\s*\(\s*([^)]+)\s*\)\s*\)/
  );
  if (m) {
    return {
      type: "assert_url_contains",
      expected: exprToValue(m[1]),
    };
  }

  m = statement.match(/assertTrue\s*\(\s*([^)]+)\s*\)/);
  if (m && m[1].trim() !== "true") {
    return {
      type: "assert_true",
      expression: m[1].trim(),
    };
  }

  m = statement.match(/assertFalse\s*\(\s*([^)]+)\s*\)/);
  if (m) {
    return {
      type: "assert_false",
      expression: m[1].trim(),
    };
  }

  return null;
}

function extractActionsFromBody(body) {
  const actions = [];
  const warnings = [];
  const statements = splitStatements(body);

  const ctx = {
    locatorVars: {},
    elementVars: {},
    selectVars: {},
  };

  for (const { text } of statements) {
    const statement = text.trim();

    // locator 変数
    let m = statement.match(
      /(?:By|var)\s+(\w+)\s*=\s*(By\.(?:id|name|cssSelector|xpath|className|tagName|linkText|partialLinkText)\s*\([\s\S]+?\))\s*;?$/
    );
    if (m) {
      ctx.locatorVars[m[1]] = m[2].trim();
      continue;
    }

    // WebElement 変数
    m = statement.match(
      /(?:WebElement|var)\s+(\w+)\s*=\s*driver\.findElement\s*\(\s*([\s\S]+?)\s*\)\s*;?$/
    );
    if (m) {
      ctx.elementVars[m[1]] = m[2].trim();
      continue;
    }

    // Select 変数
    m = statement.match(
      /(?:Select|var)\s+(\w+)\s*=\s*new\s+Select\s*\(\s*driver\.findElement\s*\(\s*([\s\S]+?)\s*\)\s*\)\s*;?$/
    );
    if (m) {
      ctx.selectVars[m[1]] = m[2].trim();
      continue;
    }

    // navigate
    m = statement.match(/driver\.get\s*\(\s*([^)]+)\s*\)/);
    if (m) {
      actions.push({
        type: "navigate",
        url: exprToValue(m[1]),
      });
      continue;
    }

    // direct sendKeys
    m = statement.match(
      /driver\.findElement\s*\(\s*([\s\S]+?)\s*\)\.sendKeys\s*\(\s*([\s\S]+?)\s*\)\s*;?$/
    );
    if (m) {
      const resolved = resolveSelector(m[1], ctx);
      if (!resolved.resolved) {
        addWarning(warnings, `sendKeys の locator を解決できませんでした: ${m[1].trim()}`);
      }
      actions.push({
        type: "fill",
        selector: resolved.selector,
        value: exprToValue(m[2]),
      });
      continue;
    }

    // variable sendKeys
    m = statement.match(/(\w+)\.sendKeys\s*\(\s*([\s\S]+?)\s*\)\s*;?$/);
    if (m) {
      const resolved = resolveElementSelector(m[1], ctx);
      if (!resolved.resolved) {
        addWarning(warnings, `sendKeys の要素変数を解決できませんでした: ${m[1]}`);
      }
      actions.push({
        type: "fill",
        selector: resolved.selector,
        value: exprToValue(m[2]),
      });
      continue;
    }

    // clear
    m = statement.match(/driver\.findElement\s*\(\s*([\s\S]+?)\s*\)\.clear\s*\(\s*\)\s*;?$/);
    if (m) {
      const resolved = resolveSelector(m[1], ctx);
      actions.push({ type: "clear", selector: resolved.selector });
      continue;
    }

    m = statement.match(/(\w+)\.clear\s*\(\s*\)\s*;?$/);
    if (m) {
      const resolved = resolveElementSelector(m[1], ctx);
      actions.push({ type: "clear", selector: resolved.selector });
      continue;
    }

    // click
    m = statement.match(/driver\.findElement\s*\(\s*([\s\S]+?)\s*\)\.click\s*\(\s*\)\s*;?$/);
    if (m) {
      const resolved = resolveSelector(m[1], ctx);
      actions.push({ type: "click", selector: resolved.selector });
      continue;
    }

    m = statement.match(/(\w+)\.click\s*\(\s*\)\s*;?$/);
    if (m) {
      const resolved = resolveElementSelector(m[1], ctx);
      actions.push({ type: "click", selector: resolved.selector });
      continue;
    }

    // select
    m = statement.match(/(\w+)\.selectByVisibleText\s*\(\s*([^)]+)\s*\)\s*;?$/);
    if (m) {
      const resolved = resolveSelector(ctx.selectVars[m[1]] || m[1], ctx);
      actions.push({
        type: "select_option",
        selector: resolved.selector,
        by: "visible_text",
        value: exprToValue(m[2]),
      });
      continue;
    }

    m = statement.match(/(\w+)\.selectByValue\s*\(\s*([^)]+)\s*\)\s*;?$/);
    if (m) {
      const resolved = resolveSelector(ctx.selectVars[m[1]] || m[1], ctx);
      actions.push({
        type: "select_option",
        selector: resolved.selector,
        by: "value",
        value: exprToValue(m[2]),
      });
      continue;
    }

    m = statement.match(/(\w+)\.selectByIndex\s*\(\s*([^)]+)\s*\)\s*;?$/);
    if (m) {
      const resolved = resolveSelector(ctx.selectVars[m[1]] || m[1], ctx);
      actions.push({
        type: "select_option",
        selector: resolved.selector,
        by: "index",
        value: exprToValue(m[2]),
      });
      continue;
    }

    // wait
    const waitAction = parseWaitAction(statement, ctx);
    if (waitAction) {
      actions.push(waitAction);
      continue;
    }

    // count elements
    m = statement.match(/driver\.findElements\s*\(\s*([\s\S]+?)\s*\)\.size\s*\(\s*\)\s*;?$/);
    if (m) {
      const resolved = resolveSelector(m[1], ctx);
      actions.push({
        type: "count_elements",
        selector: resolved.selector,
      });
      continue;
    }

    // standalone getText
    m = statement.match(/driver\.findElement\s*\(\s*([\s\S]+?)\s*\)\.getText\s*\(\s*\)\s*;?$/);
    if (m) {
      const resolved = resolveSelector(m[1], ctx);
      actions.push({
        type: "get_text",
        selector: resolved.selector,
      });
      continue;
    }

    m = statement.match(/(\w+)\.getText\s*\(\s*\)\s*;?$/);
    if (m) {
      const resolved = resolveElementSelector(m[1], ctx);
      actions.push({
        type: "get_text",
        selector: resolved.selector,
      });
      continue;
    }

    // assertions
    const assertionAction = parseAssertionAction(statement, ctx);
    if (assertionAction) {
      if (
        "selector" in assertionAction &&
        assertionAction.selector &&
        assertionAction.selector === assertionAction.expression
      ) {
        addWarning(warnings, `assertion の selector 解決が不十分です: ${statement}`);
      }
      actions.push(assertionAction);
      continue;
    }
  }

  if (actions.length === 0) {
    addWarning(warnings, "アクションを抽出できませんでした");
  }

  return { actions, warnings };
}

/**
 * @param {string} javaCode
 * @returns {{
 *   testMethods: Array<{name: string, actions: object[], warnings: string[]}>,
 *   summary: { testMethodCount: number, actionCount: number, methodsWithNoActions: number, warningCount: number }
 * }}
 */
export function extractActions(javaCode) {
  const methods = splitTestMethods(javaCode);

  const testMethods = methods.map(({ name, body }) => {
    const extracted = extractActionsFromBody(body);
    return {
      name,
      actions: extracted.actions,
      warnings: extracted.warnings,
    };
  });

  const summary = {
    testMethodCount: testMethods.length,
    actionCount: testMethods.reduce((sum, m) => sum + m.actions.length, 0),
    methodsWithNoActions: testMethods.filter((m) => m.actions.length === 0).length,
    warningCount: testMethods.reduce((sum, m) => sum + m.warnings.length, 0),
  };

  return { testMethods, summary };
}