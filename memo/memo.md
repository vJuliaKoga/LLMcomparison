
使い方
ステップ1: プロンプトファイルを作成

prompts/hybrid-test-generation.txt

``
金融システムのE2Eテストケースを生成してください。

【業務仕様】
{{specification}}

【実装コード】
{{sourcecode}}

【対象機能】
{{feature}}

【指示】
仕様書からビジネス要件を理解
実装コードから実際のバリデーションルール・エラーメッセージを抽出
両者の整合性を確認
網羅的なテストケースを生成

【出力形式】
テストケースID: TC-XXX
カテゴリ: [正常系/異常系/境界値/セキュリティ]
優先度: [高/中/低]
前提条件: 
テスト手順:
期待結果: 
実装根拠: (コードの該当行を引用)
`

ステップ2: promptfoo.yaml で変数を定義

promptfoo.yaml

`yaml
prompts:
  - file://prompts/hybrid-test-generation.txt

providers:
  - openai:gpt-4o
  - anthropic:claude-3-5-sonnet-20241022

tests:
  - vars:
      specification: file://specs/securebank-spec.md
      sourcecode: file://financial-demo-app.html
      feature: "ログイン機能（基本認証、MFA、ログイン試行制限）"
`

変数の指定方法

Promptfoo では 3種類の方法 で変数を指定できます：

方法1: ファイル参照（推奨）

`yaml
vars:
  specification: file://specs/securebank-spec.md
  sourcecode: file://financial-demo-app.html
  feature: "振込機能"
`

メリット:
• ファイルが自動的に読み込まれる
• 再利用しやすい
• 大きなファイルでも問題なし

方法2: 直接記述（短い場合）

`yaml
vars:
  feature: "ログイン機能（基本認証、MFA含む）"
  requirements: "正常系3ケース、異常系5ケース"
`

メリット:
• シンプル
• 短いテキストに最適

方法3: インライン複数行

`yaml
vars:
  specification: |
    ## ログイン仕様
    - ユーザーID、パスワード、役割で認証
    - 3回失敗で30秒ロック
    - MFA必須（6桁コード）
  feature: "ログイン機能"
`

実際のファイル構成例

`
project/
├── financial-demo-app.html              # デモアプリ
├── specs/
│   └── securebank-spec.md               # 仕様書（前回提供したもの）
├── prompts/
│   └── hybrid-test-generation.txt       # プロンプトテンプレート
├── promptfoo.yaml                       # 評価設定（下記参照）
└── results/
`

promptfoo.yaml 完全版（すぐ使える）

`yaml
プロンプトファイルを指定
prompts:
  - file://prompts/hybrid-test-generation.txt

評価するLLMモデル
providers:
  - id: openai:gpt-4o
    config:
      temperature: 0.2
      maxtokens: 4000
  
  - id: anthropic:claude-3-5-sonnet-20241022
    config:
      temperature: 0.2
      maxtokens: 4000

テストケース
tests:
  # テスト1: ログイン機能
  - description: "ログイン機能の網羅的テスト"
    vars:
      specification: file://specs/securebank-spec.md
      sourcecode: file://financial-demo-app.html
      feature: "ログイン機能（基本認証、MFA、ログイン試行制限）"
    assert:
      - type: javascript
        value: output.match(/TC-\d+/g) && output.match(/TC-\d+/g).length >= 10
      - type: contains-all
        value:
          - "テストケースID"
          - "期待結果"
      - type: llm-rubric
        value: "ログイン試行制限（3回失敗→30秒ロック）を正確にテストしているか"

  # テスト2: 振込機能
  - description: "振込機能の境界値・異常系"
    vars:
      specification: file://specs/securebank-spec.md
      sourcecode: file://financial-demo-app.html
      feature: "振込機能（全バリデーション、承認フロー含む）"
    assert:
      - type: javascript
        value: output.match(/TC-\d+/g) && output.match(/TC-\d+/g).length >= 12
      - type: contains-all
        value:
          - "残高不足"
          - "上限超過"
          - "1,000,000"

  # テスト3: 権限制御
  - description: "役割ベースアクセス制御"
    vars:
      specification: file://specs/securebank-spec.md
      sourcecode: file://financial-demo-app.html
      feature: "監査ログ機能（役割別アクセス制御）"
    assert:
      - type: contains-all
        value:
          - "admin"
          - "auditor"
          - "customer"

デフォルト設定
defaultTest:
  options:
    provider:
      id: openai:gpt-4o

結果出力先
outputPath: ./results/evaluation-results.json
`

実行手順
ファイル準備

`powershell
プロジェクトフォルダ作成
mkdir financial-test-evaluation
cd financial-test-evaluation

必要なフォルダ作成
mkdir specs, prompts, results

ファイルを配置
• financial-demo-app.html (ルートに配置)
• specs/securebank-spec.md (前回提供した仕様書)
• prompts/hybrid-test-generation.txt (上記のプロンプト)
• promptfoo.yaml (上記の設定ファイル)
`

Promptfoo インストール

`powershell
npm install -g promptfoo
`

評価実行

`powershell
評価実行
promptfoo eval

結果をブラウザで表示
promptfoo view
`

簡易版（ファイル参照なし）

もし すぐに試したい 場合は、以下のように全部 yaml に書くこともできます：

`yaml
prompts:
  - |
    以下の仕様に基づきテストケースを生成してください。
    
    【仕様】
    - ログイン: ユーザーID、パスワード、役割で認証
    - 3回失敗で30秒ロック
    - MFA: 6桁コード（テスト用: 123456）
    
    【対象機能】
    {{feature}}
    
    【出力形式】
    テストケースID: TC-XXX
    カテゴリ: [正常系/異常系/境界値]
    テスト手順: ...
    期待結果: ...

providers:
  - openai:gpt-4o

tests:
  - vars:
      feature: "ログイン機能"
    assert:
      - type: contains
        value: "TC-"
`
