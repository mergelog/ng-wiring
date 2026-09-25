# ng-wiring

## まず使う

Angularプロジェクトのルートで、調べたい要素に付けた属性を指定します。

```sh
npx ng-wiring 'data-id="targetInput"' --project app --out-dir reports
```

`targetInput` の処理をたどったMarkdownレポートが `reports/` に出力されます。`--project app` はAngularプロジェクト名、`--out-dir reports` は出力先です。単一プロジェクトの場合、`--project` は省略できます。

対象には `data-id` 以外の属性も指定できます。たとえば、属性値がその文字列と完全に一致する要素を探すには次のようにします。

```sh
npx ng-wiring 'class=cdk-virtual-scroll-content-wrapper'
```

`class` は属性全体の完全一致で検索します。複数のクラスが付いている要素では、指定した値と `class` 属性全体が一致する必要があります。

## 概要

ng-wiringは、Angularの画面要素から、その要素を起点にしたイベント、状態変更、HTTPリクエストなどのつながりをソースコード上で調べ、レポートにまとめるCLIツールです。ブラウザー拡張機能は不要です。

通常は、画面上で調べたい要素に `data-id` を付け、その値をコマンドに渡します。`data-id` を付けられない場合は、他の静的属性やソースファイルの行番号から対象を指定できます。

## インストールとビルド

Node.js `^22.22.3`、`^24.15.0`、または `>=26.0.0` が必要です。Linux/WSL、macOS、Windowsで動作します。

このリポジトリを取得して使う場合は、次のコマンドを実行します。

```sh
npm ci
npm run build
npm test
node dist/cli/index.js --help
```

Angularプロジェクト内にインストール済みの場合は、`npx ng-wiring` で実行できます。

## 対象の指定

### 属性名と値

基本形は `属性名=値` です。値に空白などが含まれる場合や、シェルで解釈される記号がある場合は、全体を引用符で囲みます。

```sh
npx ng-wiring 'data-id="targetInput"'
npx ng-wiring 'class=cdk-virtual-scroll-content-wrapper'
```

対象の属性が複数箇所にある場合、候補一覧が表示されることがあります。候補の絞り方は「画面上の場所で候補を絞り込む」を参照してください。

### ソースファイルと行番号

テンプレート上の属性で対象を特定できない場合は、`--source` にファイルパスと行番号を渡せます。

```sh
npx ng-wiring --source src/app/search.component.ts:12
```

### 画面上の場所で候補を絞り込む

同じ属性を持つ要素が複数の画面にある場合は、Chrome DevToolsで対象要素を右クリックし、**Copy > Copy selector** でセレクターをコピーして `--selector` に渡します。

```sh
npx ng-wiring 'data-id="saveButton"' --project app \
  --selector 'body > app-root > app-shell > app-search > input'
```

`--selector` は画面上の要素に対応する候補を絞るために使います。CSSクラスや `:nth-child()` だけでは、ソースコード内の場所を特定できません。

Angular Material のフォーム入力では、DOM 上の `formcontrolname` をそのまま属性指定できます。`--selector` が Material の生成する `div.mat-mdc-form-field-infix` で終わる場合も、その中の `<input>` または `<textarea>` を候補として照合します。例えば `ng-wiring 'formcontrolname=name' --selector 'sm-create-new-queue-form > form > mat-form-field > div.mat-mdc-form-field-infix'` のように指定します。

## 結果とオプション

既定では、対象から処理までの短いMarkdownレポートを出力します。レポートにはソースコードへのリンクが含まれます。

よく使うオプション:

| オプション | 用途 |
| --- | --- |
| `--project NAME` | Angularプロジェクトを指定する |
| `--tsconfig PATH` | 使用するtsconfigを指定する |
| `--out-dir DIR` | レポートの出力先を指定する。既定は現在のディレクトリ |
| `--selector PATH` | Chrome DevToolsからコピーしたセレクターで候補を絞る |
| `--through CLASS` | 通過するコンポーネントを指定して候補を絞る |
| `--route PATH` | ルートパスを指定して候補を絞る |
| `--candidate NUMBER` | 候補一覧から対象を番号またはIDで選ぶ |
| `--event NAME` | イベント名で絞る |
| `--detail` | 詳細なMarkdownレポートを出力する |
| `--belowData` | 選択したイベント以降を短いレポートに出力する |
| `--json` | 中間データをJSONで出力する |

`--detail` と `--json` は同時に指定できません。すべてのオプションは次のコマンドで確認できます。

```sh
node dist/cli/index.js --help
```

任意の Angular workspace を使った統合確認では、`.env.example` を `.env` にコピーし、
`NGWI_TEST_PROJECT_PATH`、`NGWI_TEST_PROJECT`、`NGWI_TEST_TARGET` を設定します。`.env` は git 管理対象外です。
相対パスはこのリポジトリを基準に解決します。`npm test` に workspace の smoke check が追加され、
`NGWI_TEST_CANDIDATE` も設定するとレポート生成まで確認します。

解析対象のAngularプロジェクトにあるTypeScript、`@angular/compiler`、`@angular/core` を使って解析します。詳細な仕様と出力形式は [_structure/x-structure.md](_structure/x-structure.md) を参照してください。
