# ブラウザベース機能確認手順

## 目的

実際に動作しているAngularアプリをChrome DevTools MCPで巡回し、画面上に存在するUIを起点としてng-wiring（ngwi）の解析機能を自律的に確認する。

CSSセレクターの取得自体を目的とはしない。ブラウザ上の実在要素、実行中のroute、DOM上のコンポーネント階層を、ngwiが解析したソース位置、表示経路、イベント、状態管理、通信経路と照合するために使用する。

## 対象環境

- ng-wiring: `/home/mtrysd/work_2026/ng-wiring`
- 検証対象Angularプロジェクト: `/home/mtrysd/work_2026/000-learn-ClearML-pro`
- Angularプロジェクト名: `stackup`
- ブラウザ操作: Chrome DevTools MCP
- 一時出力先: `/home/mtrysd/work_2026/ng-wiring/x-local/tmp`

## 出力と履歴のルール

- ngwiの出力は標準のsimple版を使用する。
- `--detail`、`--details`、`--json`は指定しない。
- レポートは`x-local/tmp`へ出力する。このディレクトリはgit管理外とする。
- 終了コード`0`のコマンドは`x-his-success.md`へ記録する。
- 終了コードが`0`以外のコマンドは`x-his-fail.md`へ記録する。
- 履歴には、画面・UIの説明、実行した完全なコマンド、対象URL、終了コード、結果、生成ファイルを記載する。

## 確認手順

### 1. ブラウザで対象画面を確認する

Chrome DevTools MCPで現在のページ一覧を取得し、対象ページを選択する。アクセシビリティスナップショットとスクリーンショットを使い、画面、route、主要なUI要素、コンソールエラーの有無を確認する。

必要なら画面内のリンクやタブを操作して、一覧から詳細画面、タスク画面など、解析対象のUIが存在する階層まで移動する。

### 2. 解析対象のUIを選ぶ

DOMから操作可能な要素を調べ、次の属性を優先してngwiのターゲットにする。

- `data-id`
- `formcontrolname`
- ソーステンプレートに記述された安定した属性

動的な`id`、Materialが生成したクラス、UUIDを含む`name`は、ほかに選択肢がない場合を除いてターゲットにしない。

自動操作による実行時確認まで行う場合は、検索、画面遷移、情報表示、エクスポートなど、状態を破壊しない操作を優先する。保存、削除、実データ更新は検証対象と操作内容が明示されている場合に限る。

### 3. DOM経路を取得する

対象要素から`body`まで親要素をたどり、CSSセレクターを生成する。ngwiが表示経路を選択できるように、Angularのカスタム要素を含む外側の経路を残す。

例:

```text
body
> sm-root
> sm-app-shell
> sm-common-experiments
> as-split
> as-split-area:nth-child(2)
> sm-experiment-output
> sm-experiment-info-header
> button
```

`div`、クラス、`:nth-child()`もセレクターの一意性には利用できる。ただしngwiによるソース経路の判定では、主にコンポーネントのhost tagと終端要素が使われる。

生成したセレクターについて、ブラウザ上の一致件数が1件であることを確認する。

### 4. ngwiを実行する

検証対象プロジェクトをカレントディレクトリにして、ターゲット属性とブラウザから取得したセレクターを渡す。

```bash
node /home/mtrysd/work_2026/ng-wiring/dist/cli/index.js \
  'data-id=TARGET' \
  --project stackup \
  --selector 'body > sm-root > ... > button' \
  --out-dir /home/mtrysd/work_2026/ng-wiring/x-local/tmp
```

`--detail`、`--details`、`--json`は追加しない。

### 5. 結果を判定する

終了コードとレポート生成の両方を確認する。

- 終了コード`0`: 成功として`x-his-success.md`へ記録する。
- 終了コード`5`: partialレポートが生成される場合があるが、コマンド履歴上は失敗として`x-his-fail.md`へ記録する。
- そのほかの非0終了: 引数、候補選択、解析エラーなどを確認し、`x-his-fail.md`へ記録する。

simpleレポートでは、少なくとも次を確認する。

- 対象属性とソース上の要素が一致している。
- 実DOMのカスタム要素列と表示経路が対応している。
- 現在のURLと解析されたAngular routeが対応している。
- 実際の操作イベントとレポートの起点イベントが一致している。
- イベントからhandler、dispatch、状態処理、HTTP処理まで期待する範囲を追跡できている。
- 停止した場合は、停止位置と理由が妥当である。

### 6. 必要に応じて実行時挙動と照合する

安全に実行できるUIでは、Chrome DevTools MCPで実際に操作し、操作前後を比較する。

- Network requestのmethod、URL、status
- DOMの表示変化
- routeの変化
- コンソールエラー
- ダウンロードやダイアログなどの副作用

ngwiが示したイベント・通信経路と実行時挙動が一致するかを確認する。レポートが生成されたことだけでは解析内容の正しさは証明できないため、実行時観測または期待値との照合を独立した判定材料にする。

## 初回試行の結果

`data-id="exportTaskButton"`を対象に、実DOMから次のコンポーネント経路を取得してngwiを実行した。

```text
sm-root
> sm-app-shell
> sm-common-experiments
> as-split
> as-split-area
> sm-experiment-output
> sm-experiment-info-header
> button
```

ngwiは対象を`ExperimentInfoHeaderComponent`のボタンとして特定し、表示経路、`click → exportTaskInfo()`、NgRx actionのdispatchまでをsimpleレポートへ出力した。その後は「通信への接続を確認できない」で停止し、終了コードは`5`だった。

- レポート: `x-local/tmp/ngwi-04-ExperimentInfoHeaderComponent.data-id=exportTaskButton-260926.125102.md`
- 履歴: `x-his-fail.md`

この試行により、ブラウザ上のUI選択、DOM経路取得、候補の一意化、simpleレポート生成、結果記録までは自律的に実行できることを確認した。

## 今後の自律確認ループ

1. Chrome DevTools MCPで画面を巡回する。
2. 安定した属性を持つUIを収集する。
3. 一意なDOM経路を取得する。
4. ngwiをsimple出力で実行する。
5. 終了コードとレポート内容を判定する。
6. 安全な操作は実行時挙動とも照合する。
7. 成功・失敗履歴へコマンドと結果を記録する。
8. 異常や不足をngwiの改善候補として切り分ける。
