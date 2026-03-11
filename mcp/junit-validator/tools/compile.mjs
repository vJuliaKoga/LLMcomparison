/**
 * compile.mjs
 *
 * javac を使って .java ファイルをコンパイルする。
 * Java / 依存 JAR がない場合は skipped を返し、後続処理を止めない。
 *
 * Input : { filePath: string, classpath?: string|string[] }
 * Output: { status: "ok"|"error"|"skipped", output: string, errors: string[] }
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

/**
 * javac が使えるか確認する。
 * @returns {Promise<boolean>}
 */
async function isJavacAvailable() {
  try {
    await execFileAsync("javac", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

function extractPublicClassName(code) {
  const match = code.match(/\bpublic\s+class\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
  return match?.[1] ?? null;
}

function normalizeClasspath(classpath) {
  if (Array.isArray(classpath)) {
    return classpath.filter(Boolean).join(path.delimiter);
  }

  const raw = String(classpath ?? "").trim();
  if (!raw) {
    return "";
  }

  let parts;
  if (path.delimiter === ";") {
    parts = raw
      .replace(/\r?\n/g, ";")
      .replace(/,/g, ";")
      .split(";");
  } else {
    parts = raw
      .replace(/\r?\n/g, ";")
      .replace(/,/g, ";")
      .split(/[;:]/);
  }

  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(path.delimiter);
}

function buildMissingDependencyHints(rawOutput) {
  const hints = [];
  const text = String(rawOutput || "");

  if (/package\s+org\.junit\.jupiter\.api\s+does not exist/i.test(text)) {
    hints.push("JUnit 5 の JAR が classpath に含まれていません。");
  }
  if (/package\s+org\.openqa\.selenium\s+does not exist/i.test(text)) {
    hints.push("Selenium の JAR が classpath に含まれていません。");
  }
  if (/cannot find symbol/i.test(text) && /WebDriver|WebDriverWait|ChromeDriver|By/.test(text)) {
    hints.push("Selenium 関連のシンボルを解決できません。依存 JAR を確認してください。");
  }
  if (/cannot find symbol/i.test(text) && /BeforeEach|AfterEach|Test/.test(text)) {
    hints.push("JUnit 関連のシンボルを解決できません。依存 JAR を確認してください。");
  }

  return hints;
}

function stageSourceFile(originalFilePath, tmpRootDir) {
  const originalCode = fs.readFileSync(originalFilePath, "utf8");
  const publicClassName = extractPublicClassName(originalCode);
  const originalBaseName = path.basename(originalFilePath, ".java");
  const stagedBaseName = publicClassName || originalBaseName;
  const stagedFileName = `${stagedBaseName}.java`;
  const stagedFilePath = path.join(tmpRootDir, stagedFileName);

  fs.writeFileSync(stagedFilePath, originalCode, "utf8");

  return {
    code: originalCode,
    publicClassName,
    originalBaseName,
    stagedFilePath,
    stagedFileName,
    fileNameAdjusted: Boolean(publicClassName && publicClassName !== originalBaseName),
  };
}

/**
 * @param {string} filePath  .java ファイルのパス
 * @param {string|string[]} [classpath]  追加クラスパス
 */
export async function compile(filePath, classpath = "") {
  if (!fs.existsSync(filePath)) {
    return {
      status: "error",
      output: "",
      errors: [`ファイルが見つかりません: ${filePath}`],
    };
  }

  if (!(await isJavacAvailable())) {
    return {
      status: "skipped",
      output: "javac が見つかりません。JDK をインストールしてください。",
      errors: [],
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "junit-compile-"));
  const normalizedClasspath = normalizeClasspath(classpath);

  try {
    const staged = stageSourceFile(filePath, tmpDir);
    const args = ["-encoding", "UTF-8", "-d", tmpDir];

    if (normalizedClasspath) {
      args.push("-cp", normalizedClasspath);
    }

    args.push(staged.stagedFilePath);

    const { stdout, stderr } = await execFileAsync("javac", args, {
      timeout: 30_000,
    });

    const notes = [];
    if (staged.fileNameAdjusted) {
      notes.push(
        `public class 名に合わせて一時ファイル名を補正しました: ${staged.stagedFileName}`
      );
    }
    if (normalizedClasspath && normalizedClasspath !== String(classpath ?? "").trim()) {
      notes.push(`classpath を ${process.platform} 向けに正規化しました。`);
    }

    const combined = [stdout, stderr, ...notes].filter(Boolean).join("\n").trim();

    return {
      status: "ok",
      output: combined || "コンパイル成功",
      errors: [],
    };
  } catch (err) {
    const stderr = err?.stderr ?? "";
    const stdout = err?.stdout ?? "";
    const raw = [stdout, stderr].filter(Boolean).join("\n") || err.message || String(err);
    const errors = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (err?.code === "ETIMEDOUT") {
      errors.unshift("javac が 30 秒でタイムアウトしました");
    }

    errors.push(...buildMissingDependencyHints(raw));

    return {
      status: "error",
      output: raw,
      errors: [...new Set(errors)],
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}