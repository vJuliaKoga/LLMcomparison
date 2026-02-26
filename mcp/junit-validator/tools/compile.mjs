/**
 * compile.mjs
 *
 * javac を使って .java ファイルをコンパイルする。
 * Java / 依存 JAR がない場合は SKIPPED を返し、後続処理を止めない。
 *
 * Input : { filePath: string, classpath?: string }
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

/**
 * @param {string} filePath  .java ファイルの絶対パス
 * @param {string} [classpath]  追加クラスパス（セミコロン区切り, Windows）
 */
export async function compile(filePath, classpath = "") {
  if (!fs.existsSync(filePath)) {
    return {
      status: "error",
      output: "",
      errors: [`File not found: ${filePath}`],
    };
  }

  // javac 存在確認
  if (!(await isJavacAvailable())) {
    return {
      status: "skipped",
      output: "javac not found. Install JDK to enable compilation.",
      errors: [],
    };
  }

  // 一時ディレクトリに出力（元ディレクトリを汚さない）
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "junit-compile-"));

  try {
    const args = ["-d", tmpDir];
    if (classpath) {
      args.push("-cp", classpath);
    }
    args.push(filePath);

    const { stdout, stderr } = await execFileAsync("javac", args, {
      timeout: 30_000,
    });

    const combined = [stdout, stderr].filter(Boolean).join("\n");
    return {
      status: "ok",
      output: combined || "Compilation successful.",
      errors: [],
    };
  } catch (err) {
    // javac はエラーを stderr に出力し exit code != 0
    const raw = err.stderr ?? err.message ?? String(err);
    const errors = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    return {
      status: "error",
      output: raw,
      errors,
    };
  } finally {
    // 一時ディレクトリを削除
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
