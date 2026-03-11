# redact_openai_keys.py

Repo 配下のテキストファイルから、`sk-...` で始まる OpenAI API キーっぽい文字列を検出し、指定のプレースホルダ文字列に置換します。

- デフォルト置換：`API-KEY`
- デフォルト対象ルート：`LLM-test-evaluation`（このリポジトリ直下）
- 除外ディレクトリ：`.git`, `node_modules`, `venv`, `.venv`, `__pycache__`, `dist`, `build` など
- バイナリっぽいファイルはスキップします
- 既定で `*.bak` バックアップを作成します（同名バックアップが既にある場合は上書きしません）

## 使い方（PowerShell）

```shell
cd "C:\Users\juria.koga\Documents\Github\LLM-test-evaluation"

# まず確認（変更なし）
python .\tools\redact_openai_keys.py "C:\Users\juria.koga\Documents\Github\LLM-test-evaluation\results" --dry-run

# 問題なければ実行
python .\tools\redact_openai_keys.py "C:\Users\juria.koga\Documents\Github\LLM-test-evaluation\results"
```
