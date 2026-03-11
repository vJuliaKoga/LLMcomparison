#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCase, LLMTestCaseParams


SPEC_MAP = {
    "login": "securebank-spec-login.md",
    "rbac": "securebank-spec-rbac.md",
    "transfer": "securebank-spec-transfer.md",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--extracted-root", default="results/extracted")
    parser.add_argument("--report-dir", default="reports")
    parser.add_argument(
        "--prompt-path",
        default="hybrid-test-generation-cohere.txt",
        help="共通プロンプトテンプレート",
    )
    parser.add_argument(
        "--ui-context-path",
        default="specs/financial-demo-app-context.yaml",
        help="UI構造コンテキスト",
    )
    parser.add_argument(
        "--judge-model",
        default=None,
        help="DeepEval judge model。未指定なら deepeval の設定済みモデルを使う",
    )
    parser.add_argument(
        "--skip-common-feature",
        action="store_true",
        help="feature=共通 を除外する",
    )
    parser.add_argument(
        "--max-cases",
        type=int,
        default=0,
        help="先頭から最大 N 件だけ評価する。0 は全件",
    )
    return parser.parse_args()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_json(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def safe_json_load(path: Path) -> Any:
    return json.loads(read_text(path))


def infer_spec_path(project_root: Path, source_stem: str) -> Optional[Path]:
    lower = source_stem.lower()
    for key, filename in SPEC_MAP.items():
        if key in lower:
            return project_root / filename if (project_root / filename).exists() else project_root / "specs" / filename
    return None


def find_java_path(case_dir: Path) -> Optional[Path]:
    java_files = sorted(case_dir.glob("*.java"))
    return java_files[0] if java_files else None


def extract_java_from_output(output_text: str) -> str:
    m = re.search(r"```java\s*([\s\S]*?)\s*```", output_text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    m = re.search(r"```\s*([\s\S]*?)\s*```", output_text)
    return m.group(1).strip() if m else ""


def render_prompt(template: str, spec_text: str, ui_context_text: str, feature: str) -> str:
    rendered = template
    rendered = rendered.replace("{{specification}}", spec_text)
    rendered = rendered.replace("{{ui_context}}", ui_context_text)
    rendered = rendered.replace("{{feature}}", feature)
    return rendered


def count_tests(java_code: str) -> int:
    return len(re.findall(r"@Test\b", java_code))


def count_public_classes(java_code: str) -> int:
    return len(re.findall(r"\bpublic\s+class\s+\w+\b", java_code))


def has_section_b(output_text: str) -> bool:
    return "(B)" in output_text or "仕様と実装の不整合・不足情報" in output_text


def deterministic_checks(feature: str, output_text: str, java_code: str) -> Dict[str, Any]:
    output_lower = output_text.lower()
    java_lower = java_code.lower()

    checks = {
        "has_java_block": bool(java_code.strip()),
        "has_section_b": has_section_b(output_text),
        "has_junit_jupiter": "org.junit.jupiter" in java_code,
        "has_webdriver": "webdriver" in java_lower,
        "has_webdriverwait": "webdriverwait" in java_lower,
        "has_before_each": "@beforeeach" in java_lower,
        "has_after_each": "@aftereach" in java_lower,
        "has_test": "@test" in java_lower,
        "test_count": count_tests(java_code),
        "test_count_2_to_3": 2 <= count_tests(java_code) <= 3,
        "single_public_class": count_public_classes(java_code) == 1,
        "uses_chromedriver": "chromedriver" in java_lower,
        "uses_base_url_env": 'system.getenv("base_url")' in java_lower or "system.getenv('base_url')" in java_lower,
        "uses_localhost_fallback": "http://localhost:8080" in java_code,
        "uses_thread_sleep": "thread.sleep" in java_lower,
        "has_dummy_assert": "asserttrue(true)" in java_lower.replace(" ", ""),
    }

    # promptfoo-rbac.yaml 相当
    if "rbac" in feature.lower() or "監査ログ" in feature:
        checks["mentions_admin"] = "admin" in output_lower
        checks["mentions_auditor"] = "auditor" in output_lower
        checks["mentions_customer"] = "customer" in output_lower
        checks["rbac_role_tokens_ok"] = (
            checks["mentions_admin"]
            and checks["mentions_auditor"]
            and checks["mentions_customer"]
        )
    else:
        checks["mentions_admin"] = False
        checks["mentions_auditor"] = False
        checks["mentions_customer"] = False
        checks["rbac_role_tokens_ok"] = True

    return checks


def deterministic_issues(feature: str, checks: Dict[str, Any]) -> List[str]:
    issues: List[str] = []

    if not checks["has_java_block"]:
        issues.append("Javaコードブロックがありません")
    if not checks["has_section_b"]:
        issues.append("(B) 仕様と実装の不整合・不足情報 がありません")
    if not checks["has_junit_jupiter"]:
        issues.append("org.junit.jupiter の利用が見えません")
    if not checks["has_webdriver"]:
        issues.append("WebDriver の利用が見えません")
    if not checks["has_webdriverwait"]:
        issues.append("WebDriverWait の利用が見えません")
    if not checks["has_before_each"]:
        issues.append("@BeforeEach がありません")
    if not checks["has_after_each"]:
        issues.append("@AfterEach がありません")
    if not checks["has_test"]:
        issues.append("@Test がありません")
    if not checks["test_count_2_to_3"]:
        issues.append(f"@Test 数が 2〜3件ではありません（現在: {checks['test_count']}件）")
    if not checks["single_public_class"]:
        issues.append("1クラス構成になっていません")
    if not checks["uses_chromedriver"]:
        issues.append("ChromeDriver の使用が見えません")
    if not checks["uses_base_url_env"]:
        issues.append('BASE_URL の環境変数利用が確認できません')
    if not checks["uses_localhost_fallback"]:
        issues.append('localhost fallback が確認できません')
    if checks["uses_thread_sleep"]:
        issues.append("Thread.sleep を使用しています")
    if checks["has_dummy_assert"]:
        issues.append("assertTrue(true) のようなダミー assertion があります")

    if ("rbac" in feature.lower() or "監査ログ" in feature) and not checks["rbac_role_tokens_ok"]:
        issues.append("RBAC 用語（admin / auditor / customer）が十分に含まれていません")

    return issues


def make_metric(name: str, criteria: str, judge_model: Optional[str]) -> GEval:
    kwargs: Dict[str, Any] = {
        "name": name,
        "criteria": criteria,
        "evaluation_params": [LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
        "threshold": 0.6,
        "verbose_mode": False,
    }
    if judge_model:
        kwargs["model"] = judge_model
    return GEval(**kwargs)


def evaluate_with_geval(
    input_text: str,
    actual_output: str,
    metric_name: str,
    criteria: str,
    judge_model: Optional[str],
) -> Tuple[float, str]:
    metric = make_metric(metric_name, criteria, judge_model)
    test_case = LLMTestCase(
        input=input_text,
        actual_output=actual_output[:15000],
    )
    metric.measure(test_case)
    score = float(metric.score or 0.0)
    reason = getattr(metric, "reason", "") or ""
    return score, reason


def build_prompt_compliance_input(
    rendered_prompt: str,
    checks: Dict[str, Any],
    issues: List[str],
) -> str:
    return f"""\
以下は実際にモデルへ与えた prompt です。
この prompt に対して、出力がどれだけ忠実かを評価してください。

[Rendered Prompt]
{rendered_prompt}

[Deterministic Checks]
{json.dumps(checks, ensure_ascii=False, indent=2)}

[Rule Issues]
{json.dumps(issues, ensure_ascii=False, indent=2)}

評価時の重要注意:
- 仕様全体の網羅性は要求しない
- prompt 自身が「代表的な2〜3シナリオのみ」を要求している
- したがって「全仕様をカバーしていない」こと自体は減点理由にしない
- 減点すべきなのは、prompt の明示条件違反や、2〜3シナリオとして不適切な選定
"""


def build_representative_testability_input(
    rendered_prompt: str,
    checks: Dict[str, Any],
) -> str:
    return f"""\
以下の prompt に対して、出力されたテストコードが
「代表的な2〜3シナリオとして妥当で、実行可能な E2E テストになっているか」
を評価してください。

[Rendered Prompt]
{rendered_prompt}

[Deterministic Checks]
{json.dumps(checks, ensure_ascii=False, indent=2)}

評価時の重要注意:
- 仕様書全体を網羅している必要はない
- 2〜3本しかない前提で、代表性・実行可能性・観測可能性を評価する
- (B) で不足情報や仮定を適切に開示している場合は加点してよい
- 期待結果が曖昧、観測困難、または自動化しづらい場合は減点する
"""


def deterministic_score(checks: Dict[str, Any], issues: List[str]) -> float:
    total = 12
    passed = 0

    keys = [
        "has_java_block",
        "has_section_b",
        "has_junit_jupiter",
        "has_webdriver",
        "has_webdriverwait",
        "has_before_each",
        "has_after_each",
        "has_test",
        "test_count_2_to_3",
        "single_public_class",
        "uses_chromedriver",
        "rbac_role_tokens_ok",
    ]

    for key in keys:
        if checks.get(key, False):
            passed += 1

    score = passed / total

    # 軽い補正
    if checks.get("uses_base_url_env", False):
        score += 0.03
    if checks.get("uses_localhost_fallback", False):
        score += 0.02
    if checks.get("uses_thread_sleep", False):
        score -= 0.08
    if checks.get("has_dummy_assert", False):
        score -= 0.12
    score -= min(0.20, 0.02 * len(issues))

    return round(max(0.0, min(1.0, score)), 4)


def final_score(
    det_score: float,
    prompt_score: float,
    rep_score: float,
) -> float:
    # 今回は prompt vs output が主軸
    return round(
        max(0.0, min(1.0, 0.40 * det_score + 0.35 * prompt_score + 0.25 * rep_score)),
        4,
    )


def judgement_label(score: float) -> str:
    if score >= 0.80:
        return "pass"
    if score >= 0.60:
        return "review"
    return "fail"


def main() -> int:
    args = parse_args()

    project_root = Path(args.project_root).resolve()
    extracted_root = (project_root / args.extracted_root).resolve()
    report_dir = (project_root / args.report_dir).resolve()
    prompt_path = (project_root / args.prompt_path).resolve()
    ui_context_path = (project_root / args.ui_context_path).resolve()

    report_dir.mkdir(parents=True, exist_ok=True)

    if not extracted_root.exists():
        print(f"[ERROR] extracted root not found: {extracted_root}")
        return 1
    if not prompt_path.exists():
        print(f"[ERROR] prompt file not found: {prompt_path}")
        return 1
    if not ui_context_path.exists():
        print(f"[ERROR] ui context file not found: {ui_context_path}")
        return 1

    prompt_template = read_text(prompt_path)
    ui_context_text = read_text(ui_context_path)

    metadata_files = sorted(extracted_root.rglob("metadata.json"))
    if args.max_cases > 0:
        metadata_files = metadata_files[: args.max_cases]

    rows: List[Dict[str, Any]] = []

    prompt_criteria = (
        "Judge whether the actual output follows the rendered prompt faithfully. "
        "Focus on prompt compliance, not full-spec coverage. "
        "Check whether the output follows the required format, includes a Java JUnit5+Selenium code block, "
        "keeps to 2-3 representative tests, includes section (B), uses WebDriverWait rather than Thread.sleep, "
        "contains BeforeEach/AfterEach, and respects the prompt's explicit implementation constraints."
    )

    representative_testability_criteria = (
        "Judge whether the generated output is a good set of 2-3 representative E2E tests for the requested feature. "
        "Do not penalize lack of full specification coverage. "
        "Instead, assess whether the selected tests are representative, concrete, executable, observable, and suitable "
        "for automated JUnit/Selenium testing, and whether missing or assumed details are properly disclosed in section (B)."
    )

    for meta_path in metadata_files:
        meta = safe_json_load(meta_path)

        feature = str(meta.get("feature") or "")
        if args.skip_common_feature and feature == "共通":
            continue

        txt_path = Path(meta.get("output_txt_path", ""))
        if not txt_path.exists():
            continue

        relative = txt_path.relative_to(extracted_root)
        parts = relative.parts
        model = parts[0] if len(parts) >= 1 else ""
        source_stem = parts[1] if len(parts) >= 2 else ""
        case_name = parts[2] if len(parts) >= 3 else ""
        case_dir = txt_path.parent

        spec_path = infer_spec_path(project_root, source_stem)
        if spec_path is None or not spec_path.exists():
            print(f"[ERROR] {model} / {source_stem} / {case_name} -> spec file not found")
            continue

        try:
            output_text = read_text(txt_path)
            java_path = find_java_path(case_dir)
            java_code = read_text(java_path) if java_path else extract_java_from_output(output_text)
            spec_text = read_text(spec_path)

            rendered_prompt = render_prompt(
                template=prompt_template,
                spec_text=spec_text,
                ui_context_text=ui_context_text,
                feature=feature,
            )

            checks = deterministic_checks(feature, output_text, java_code)
            issues = deterministic_issues(feature, checks)
            det_score = deterministic_score(checks, issues)

            prompt_input = build_prompt_compliance_input(
                rendered_prompt=rendered_prompt,
                checks=checks,
                issues=issues,
            )

            rep_input = build_representative_testability_input(
                rendered_prompt=rendered_prompt,
                checks=checks,
            )

            prompt_score, reason_prompt = evaluate_with_geval(
                input_text=prompt_input,
                actual_output=output_text,
                metric_name="PromptCompliance",
                criteria=prompt_criteria,
                judge_model=args.judge_model,
            )

            rep_score, reason_rep = evaluate_with_geval(
                input_text=rep_input,
                actual_output=output_text,
                metric_name="RepresentativeScenarioAndTestability",
                criteria=representative_testability_criteria,
                judge_model=args.judge_model,
            )

            total = final_score(det_score, prompt_score, rep_score)
            label = judgement_label(total)

            rows.append({
                "model": model,
                "source_stem": source_stem,
                "case": case_name,
                "feature": feature,
                "txt_path": str(txt_path),
                "java_path": "" if not java_path else str(java_path),
                "spec_path": str(spec_path),
                "prompt_path": str(prompt_path),
                "ui_context_path": str(ui_context_path),
                "deterministic_score": det_score,
                "prompt_score": round(prompt_score, 4),
                "representative_testability_score": round(rep_score, 4),
                "final_score": total,
                "judgement": label,
                "rule_issue_count": len(issues),
                "rule_issues": issues,
                "reason_prompt": reason_prompt,
                "reason_representative_testability": reason_rep,
                **checks,
            })

            print(f"[OK] {model} / {source_stem} / {case_name} -> {label} ({total:.3f})")

        except Exception as exc:
            rows.append({
                "model": model,
                "source_stem": source_stem,
                "case": case_name,
                "feature": feature,
                "txt_path": str(txt_path),
                "java_path": "" if not java_path else str(java_path) if 'java_path' in locals() and java_path else "",
                "spec_path": str(spec_path),
                "prompt_path": str(prompt_path),
                "ui_context_path": str(ui_context_path),
                "deterministic_score": 0.0,
                "prompt_score": 0.0,
                "representative_testability_score": 0.0,
                "final_score": 0.0,
                "judgement": "fail",
                "rule_issue_count": 0,
                "rule_issues": [],
                "reason_prompt": "",
                "reason_representative_testability": "",
                "error": str(exc),
            })
            print(f"[ERROR] {model} / {source_stem} / {case_name} -> {exc}")

    summary = {
        "total_cases": len(rows),
        "pass_count": sum(1 for r in rows if r["judgement"] == "pass"),
        "review_count": sum(1 for r in rows if r["judgement"] == "review"),
        "fail_count": sum(1 for r in rows if r["judgement"] == "fail"),
        "avg_final_score": round(
            sum(float(r["final_score"]) for r in rows) / len(rows), 4
        ) if rows else 0.0,
    }

    by_model: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        m = row["model"]
        by_model.setdefault(
            m,
            {
                "model": m,
                "cases": 0,
                "pass_count": 0,
                "review_count": 0,
                "fail_count": 0,
                "avg_final_score": 0.0,
            },
        )
        by_model[m]["cases"] += 1
        by_model[m][f'{row["judgement"]}_count'] += 1
        by_model[m]["avg_final_score"] += float(row["final_score"])

    for item in by_model.values():
        if item["cases"] > 0:
            item["avg_final_score"] = round(item["avg_final_score"] / item["cases"], 4)

    out_json = report_dir / "prompt-output-deepeval-summary.json"
    out_csv = report_dir / "prompt-output-deepeval-summary.csv"

    write_json(
        out_json,
        {
            "summary": summary,
            "by_model": sorted(by_model.values(), key=lambda x: x["model"]),
            "rows": rows,
        },
    )

    columns = [
        "model",
        "source_stem",
        "case",
        "feature",
        "txt_path",
        "java_path",
        "spec_path",
        "prompt_path",
        "ui_context_path",
        "deterministic_score",
        "prompt_score",
        "representative_testability_score",
        "final_score",
        "judgement",
        "rule_issue_count",
        "rule_issues",
        "reason_prompt",
        "reason_representative_testability",
        "has_java_block",
        "has_section_b",
        "has_junit_jupiter",
        "has_webdriver",
        "has_webdriverwait",
        "has_before_each",
        "has_after_each",
        "has_test",
        "test_count",
        "test_count_2_to_3",
        "single_public_class",
        "uses_chromedriver",
        "uses_base_url_env",
        "uses_localhost_fallback",
        "uses_thread_sleep",
        "has_dummy_assert",
        "mentions_admin",
        "mentions_auditor",
        "mentions_customer",
        "rbac_role_tokens_ok",
    ]

    with out_csv.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k) for k in columns})

    print("\n=== Summary ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\nJSON: {out_json}")
    print(f"CSV : {out_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
