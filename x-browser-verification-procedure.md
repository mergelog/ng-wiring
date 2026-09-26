# ブラウザ検証: 継続手順

## 目的

実際に動作しているAngularアプリをChrome DevTools MCPで巡回し、画面上に存在するUIを起点としてng-wiring（ngwi）の解析機能を自律的に確認する。

CSSセレクターの取得自体を目的とはしない。ブラウザ上の実在要素、実行中のroute、DOM上のコンポーネント階層を、ngwiが解析したソース位置、表示経路、イベント、状態管理、通信経路と照合するために使用する。

## 対象環境

- ng-wiring: `.`
- 検証対象Angularプロジェクト: `../000-learn-ClearML-pro`
- Angularプロジェクト名: `stackup`
- ブラウザ操作: Chrome DevTools MCP
- 一時出力先: `x-local/tmp`

## 出力と履歴のルール

- ngwiの出力は標準のsimple版を使用する。
- `--detail`、`--details`、`--json`は指定しない。
- レポートは`x-local/tmp`へ出力する。このディレクトリはgit管理外とする。
- 終了コード`0`のコマンドは`x-browser-verification-history.md`の成功欄へ記録する。
- 終了コードが`0`以外のコマンドは`x-browser-verification-history.md`の失敗欄へ記録する。
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
node ../ng-wiring/dist/cli/index.js \
  'data-id=TARGET' \
  --project stackup \
  --selector 'body > sm-root > ... > button' \
  --out-dir ../ng-wiring/x-local/tmp
```

`--detail`、`--details`、`--json`は追加しない。

### 5. 結果を判定する

終了コードとレポート生成の両方を確認する。

- 終了コード`0`: 成功として`x-browser-verification-history.md`の成功欄へ記録する。
- 終了コード`5`: partialレポートが生成される場合があるが、コマンド履歴上は失敗として`x-browser-verification-history.md`の失敗欄へ記録する。
- そのほかの非0終了: 引数、候補選択、解析エラーなどを確認し、`x-browser-verification-history.md`の失敗欄へ記録する。

simpleレポートでは、少なくとも次を確認する。

- 対象属性とソース上の要素が一致している。
- 実DOMのカスタム要素列と表示経路が対応している。
- 現在のURLと解析されたAngular routeが対応している。
- 実際の操作イベントとレポートの起点イベントが一致している。
- イベントからhandler、dispatch、状態処理、HTTP処理まで期待する範囲を追跡できている。
- 停止した場合は、停止位置と理由が妥当である。

## simple版の経路表示方針

simple版では、検出したすべての成功・失敗分岐を主経路へ並べない。通常の操作が成功したときの正常系を一本だけ表示し、読みやすさを優先する。

通信を伴う操作では、HTTP要求を重要な中間地点として必ず表示する。HTTP応答後に、ダウンロード、画面遷移、状態更新、成功通知など、その操作の目的を表す主要な副作用がある場合は、正常系をそこまで続ける。

```text
UIイベント
→ handler
→ action dispatch
→ effect
→ API service
→ HTTP method / endpoint
→ 正常応答後の主要処理
→ ユーザーに見える成功結果
```

正常系上のダウンロードや成功通知は、それ自体に意味がある場合は主経路へ含める。一方、エラー通知、`requestFailed`、例外処理などの失敗分岐は展開しない。成功通知から通知UI内部の処理をさらに追うなど、操作の目的を越えた共通処理も展開しない。すべての分岐を確認する用途はsimple版とは分ける。

正常系の終点はHTTPに固定せず、次のような主要な副作用またはユーザーに見える結果とする。

- ファイルの生成・ダウンロード
- 画面遷移
- 対象データの状態更新
- 操作完了を表す成功通知

通信が表示されない場合は、次の状態を区別する。

- 通信なしを確認: 解析対象の正常系がローカル処理だけで終了すると確認できた。
- 通信有無は未確定: 動的呼び出し、DI、effect登録などの解析境界で追跡が止まった。
- 通信経路の結合失敗: action、effect、HTTPは個別に検出したが、一本の経路として結合できなかった。

「通信への接続を確認できない」だけでは、通信が存在しない場合と解析できない場合を区別できないため、simple版の最終表示としては使用しない。

### 6. 必要に応じて実行時挙動と照合する

安全に実行できるUIでは、Chrome DevTools MCPで実際に操作し、操作前後を比較する。

- Network requestのmethod、URL、status
- DOMの表示変化
- routeの変化
- コンソールエラー
- ダウンロードやダイアログなどの副作用

ngwiが示したイベント・通信経路と実行時挙動が一致するかを確認する。レポートが生成されたことだけでは解析内容の正しさは証明できないため、実行時観測または期待値との照合を独立した判定材料にする。

## 継続中の検証

- 未実施パターンと完了条件: [x-browser-communication-pending.md](x-browser-communication-pending.md)
- 過去の試行: [_old/x-his-success.md](_old/x-his-success.md)、[_old/x-his-fail.md](_old/x-his-fail.md)
