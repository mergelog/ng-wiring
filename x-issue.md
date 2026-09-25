# ng-wiring の見落とし・誤解析を調べる計画

作成日: 2026-09-25

## 目的と判定基準

Angular の要素から表示経路、イベント、状態更新、Effect、通信までを追う際、**実在する接続の見落とし**と**実在しない接続の表示**を両方調べる。`partial` や診断が出ているだけで問題を解決済みと扱わない。逆に、静的に確定できない実行条件を推測で確定扱いしない。

各調査ケースで、ソースを手で読んで作った期待経路を基準にし、レポートの辺・根拠位置・条件・停止理由と照合する。差分は次の形で記録する。

| 記録項目 | 内容 |
| --- | --- |
| 再現条件 | 対象ソースの revision、project、クエリ、候補 ID、イベント、実行コマンド |
| 期待と実際 | 期待する接続または停止位置、レポートの該当箇所、ソース上の根拠 |
| 分類 | 見落とし、誤接続、誤った確定度、診断不足、根拠リンク不良、性能問題 |
| 修正判定 | 最小 fixture の再現結果、実アプリでの再確認、残る境界 |

## 1. 基準ケースを固定する

1. `../000-learn-ClearML-pro` の `stackup` と `report-widgets` について、対象 revision と tsconfig、ツールチェーンを記録する。実アプリのファイルは調査中に変更しない。
2. 名前編集の基準資料は `../000-learn-ClearML-pro/ngwi-InlineEditComponent.data-id=nameField-260925.120933.md`。`InlineEditComponent.textChanged → ExperimentInfoHeaderComponent.onNameChanged → experimentNameChanged → BaseExperimentOutputComponent.updateExperimentName → experimentDetailsUpdated → updateExperimentDetails$` を照合する。ソース上ではさらに `tasksUpdate → POST /tasks.update` に至るが、現レポートは通信未検出とする。この差分を最初の再現課題にする。
3. API が不要な対照例として既存の検索 input ケース（`docs/p18-search-acceptance.md`）も用いる。名前編集で通信が出ない見落としと、検索で無関係な通信が出る誤接続を同時に検査する。
4. レポートは一時ディレクトリに出力し、候補一覧・Markdown・必要なら JSON を保存して比較する。調査後に生成した一時ファイルを片付ける。

## 2. 優先して調べる経路

### P0: 名前変更の未完了部分

- `updateExperimentDetails$` の `ofType`、`filter(valid)`、`mergeMap`、`apiTasks.tasksUpdate`、購読、生成クライアントの `post` を順に確認する。HTTP request が Effect の処理から接続できない理由を、登録不足・コールバック到達判定・DI 解決・Observable 消費判定に切り分ける。
- 成功時の複数 Action、失敗時の `catchError`、フォーム無効時、名前が 3 文字未満の場合を別経路として確認する。通信が起こらない枝に `http-consume` を付けない。
- `effect output action is not statically confirmed` が、実際の返却 Action を見落としているのか、返却値が条件付きで確定できないのかをソースで判定する。原因が異なる場合は診断を分ける。

### P1: 今回の修正と同型の見落とし

- 継承: テンプレートハンドラーだけでなく、基底クラス内の `this.method()`、継承 field、override、abstract method、getter、同名メソッドを検査する。実装が外部 `.d.ts` のみなら本体を作り出さず停止する。
- Provider: `getAppConfig()`、`makeEnvironmentProviders`、配列と spread、`provideEffects` / `provideState`、route 親子、複数 bootstrap を検査する。未選択 route の Effect や別アプリの provider が混入しないことも確認する。
- Output: `output()` / `EventEmitter` は明示的な `emit` から親の購読へ接続する。現資料にある `textChanged` / `experimentNameChanged` の「bubble で input から伝播」という表現が、Angular Output を DOM イベントと取り違えていないか調べる。単に input をクリックしただけで Output が発火した経路を作らない。
- Forms: `ngModelChange` と DOM `input` / `change`、保存操作の `keydown.enter` / `keydown.escape` / `blur` を分けて検査する。値の反映と `textChanged.emit` の条件を混同しない。

### P2: 周辺の誤判定とスコープ

- DI: `inject()`、constructor 注入、`useClass` / `useExisting` / `useFactory`、route provider、継承 field を確認する。受信先が一意でない場合は候補や境界を残す。
- NgRx / SignalStore / RxJS: Action type の定数連結、Effect の `dispatch:false`、配列で返す Action、SignalStore の合成 feature、`rxMethod`、`subscribe` / `toSignal` / async pipe を確認する。既知の未達 28 subcase は `test/contracts/reactive-cases.ts` の台帳と照合して重複を避ける。
- 表示経路と診断: 再利用コンポーネント、同名 selector、投影、TemplateRef、動的生成、別アプリ・別 route で、選択した occurrence だけが結果に入るか調べる。無関係な gap が `partial` の主因に昇格していないか、関連する gap が消されていないか確認する。
- 根拠: 辺の source span、行番号、リンク先、宣言元と使用位置が一致するか確認する。実体が基底クラスにある場合はそのファイルを根拠にする。

## 3. 調査と修正の進め方

1. **実アプリで差分を発見**: 上記の基準ケースに加え、保存 API を持つ別画面、SignalStore の画面、API のない操作を少なくとも各 1 件選ぶ。イベント単位で手製の期待経路を作り、レポートと辺ごとに比較する。
2. **最小再現を作る**: 差分ごとに `test/fixtures` と対応する `test/*.test.mjs` へ、必要な Angular / NgRx 構文だけを含む fixture を作る。肯定ケースと、同名だが無関係なクラス・未登録 provider・実行されない分岐などの否定ケースを対にする。
3. **原因を層で特定**: `src/index`、`src/resolve/view`、`src/resolve/operation`、`src/adapters/reactive`、`src/assemble`、`src/render` のどこで情報が欠けるかを確認する。表示上だけの修正で解析の欠落を隠さない。
4. **一件ずつ修正**: 期待経路と境界条件をテストで固定し、実アプリ資料を再生成する。接続が増えたときは誤接続が増えていないか否定ケースも再実行する。
5. **回帰と配布を確認**: `npm run build`、`npm test`、`npm run check:contracts` を実行する。追跡ファイルである `dist` を更新して commit した後、`npm run check:dist` と CLI の実アプリ再実行を確認する。実アプリ 1 件の実行時間とメモリも基準値と比較し、著しい増加は別問題として記録する。

## 完了条件

- 名前変更の資料で、条件付きの `tasksUpdate` と `POST /tasks.update` まで根拠付きで辿れる。静的に辿れない箇所が残る場合は、その**具体的な停止位置と理由**を資料に示し、「通信未検出」だけで終わらせない。
- 選んだ対照例で、期待する経路の欠落、無関係な経路の混入、誤った確定度をゼロにする。残る未対応構文は、再現 fixture と診断コードを台帳に登録する。
- 修正ごとに肯定・否定の回帰テストが通り、実アプリ再確認の結果と性能差を記録する。
