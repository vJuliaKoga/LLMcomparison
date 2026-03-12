reports/playwright-plans 配下にある \*.playwright-plan.json を再帰的にすべて探索し、
未処理の plan を 1 件ずつ順番に Playwright MCP で実行してください。

重要:

- 1件で終わらず、対象がなくなるまでループしてください
- 既に対応する \*.playwright-result.json が存在する plan はスキップしてください
- 失敗しても全体処理は止めず、次の plan に進んでください
- 各 plan ごとに必ず結果 JSON を保存してください
- 全件終わったら、処理件数・成功件数・失敗件数・スキップ件数を最後に報告してください

対象:

- 入力: reports/playwright-plans/\*_/_.playwright-plan.json
- 出力: reports/playwright-results/<model>/<sourceStem>/<case>/<planBase>.playwright-result.json
- ディレクトリ構造は input 側を mirror してください

各 plan でやること:

1. plan JSON を読む
2. test_methods を上から順に実行する
3. browser_snapshot の直後に必要な ref を解決する
4. args_template の "{{ resolve ref from latest snapshot }}" は最新 snapshot から適切な ref に置き換える
5. 各 test_method ごとに pass / fail / blocked を判定する
6. 実行できなかった step は failed_step_seq, failed_tool, locator_failures, notes に記録する
7. plan ごとに結果 JSON を保存する
8. 保存後、次の未処理 plan に進む

結果 JSON 形式:
{
"meta": {
"model": "...",
"source_stem": "...",
"case": "...",
"feature": "...",
"plan_path": "...",
"executed_at": "...",
"base_url": "http://localhost:8080"
},
"overall_status": "pass|fail|blocked|partial",
"summary": {
"total_methods": 0,
"pass_methods": 0,
"fail_methods": 0,
"blocked_methods": 0,
"total_steps": 0,
"executed_steps": 0,
"passed_steps": 0,
"failed_steps": 0,
"blocked_steps": 0
},
"method_results": [
{
"name": "...",
"status": "pass|fail|blocked",
"total_steps": 0,
"executed_steps": 0,
"failed_step_seq": null,
"failed_tool": "",
"locator_failures": [],
"notes": ""
}
],
"common_failures": {
"failed_tools": [],
"locator_failures": []
},
"notes": ""
}

追加ルール:

- 1件成功しただけで終了しない
- result JSON 保存後に必ず次の未処理 plan を探索する
- 既存 result がある plan は「skip」として数える
- 途中で Playwright MCP の操作に失敗しても、その plan の result JSON は必ず残す
- 全件完了後に、最後に処理サマリだけ日本語で出す
