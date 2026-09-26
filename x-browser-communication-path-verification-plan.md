# ブラウザベース通信経路検証プラン（30パターン）

作成日: 2026-09-26

## 目的

[`x-browser-based-verification-procedure.md`](x-browser-based-verification-procedure.md) に従い、実際の ClearML 画面に存在する UI を起点として、ngwi の simple レポートが正常系の通信経路をどこまで結合できるかを広く確認する。

特に、従来の「通信への接続を確認できない」に相当する停止が起きやすい境界を先回りして選ぶ。停止した場合は、次の3状態を区別して記録する。

- **通信なしを確認**: 操作の正常系がローカル処理だけで終わる。
- **通信有無は未確定**: 動的呼び出し、DI、テンプレート投影、リアクティブ API などの解析境界で追跡が止まる。
- **通信経路の結合失敗**: action、effect、service、HTTP などは個別に存在するが、一本の因果経路として結合できない。

このファイルは検証候補と実施順を定める計画書であり、各項目の対象 UI、セレクター、実行コマンド、結果を確定した実績表ではない。実画面に該当 UI が存在しない項目は、無理に代替せず「対象なし」と根拠を記録する。

## 対象と前提

- ng-wiring: `.`
- 検証対象: `../000-learn-ClearML-pro`
- Angular project: `stackup`
- 出力: `x-local/tmp`
- 出力形式: simple のみ。`--detail`、`--details`、`--json`は使用しない。
- 対象アプリで確認済みの主要依存: Angular Material 22、PrimeNG 22、NgRx Store / Effects / Signals 22、RxJS 7。
- 破壊的操作は対象外とし、検索、絞り込み、表示切替、詳細表示、ダウンロードなどを優先する。保存、削除、停止、キュー投入などは、検証専用データと操作許可が揃った別タスクに分ける。
- ブラウザに接続できない場合は、イントラ側 PC で次の reverse port forward が必要であることをユーザへ伝える。

```bash
ssh -v -p 2221 -NT -o ExitOnForwardFailure=yes -R 9222:127.0.0.1:9222 mtrysd@192.168.0.4
```

## 共通の実施方法

各チェック項目について、次の順序で1件ずつ完結させる。

1. Chrome DevTools MCP でページ、route、コンソールエラーを確認する。
2. `data-id`、`formcontrolname`、ソースに記述された安定属性の順で対象を選ぶ。
3. 対象要素から `body` までの DOM 経路を取得する。overlay は trigger と overlay 内の操作要素を分けて記録する。
4. 対象セレクターの一致件数が1件であることをブラウザ上で確認する。
5. 対象プロジェクトをカレントディレクトリとして ngwi を実行する。

```bash
node ../ng-wiring/dist/cli/index.js \
  'data-id=TARGET' \
  --project stackup \
  --selector 'body > sm-root > ...' \
  --out-dir ../ng-wiring/x-local/tmp
```

6. simple レポートで、UIイベント、handler、状態管理、service、HTTP method / endpoint、正常応答後の主要処理を照合する。
7. 安全に操作できる場合は、実操作前後の Network、DOM、route、console、download / dialog を確認する。
8. 終了コード `0` は `x-his-success.md`、非0は `x-his-fail.md` に、画面説明、完全なコマンド、URL、終了コード、判定、生成ファイルを記録する。
9. 下のチェック欄は、静的レポートと実行時観測の照合、および履歴記録まで終えた場合だけ完了にする。

## 優先順位

- **P1**: 対象アプリに実例があり、複数の解析境界をまたいで HTTP へ到達する可能性が高い。
- **P2**: 実例はあるが、通信しない正常系や画面条件によって候補が見つからない可能性がある。
- **P3**: 実画面での出現確認から必要な探索項目。該当しない場合も非対応範囲の確認材料になる。

## A. Angular Material と CDK overlay（5件）

- [x] **A01 / P1: `mat-form-field` 内の Reactive Forms 入力から検索通信**
  `formcontrolname` を起点に、Material が生成する `div.mat-mdc-form-field-infix` から authored `input` / `textarea` を復元し、`input` / `change` → FormControl → debounce → dispatch / service → HTTP を追う。生成 DOM をテンプレート要素と誤対応して停止しないかを確認する。

  - 状態: 通信経路の結合成功（レポート全体は関連gapによりpartial）
  - 画面・UI: 完了タスク詳細の Clone task dialog — Project 検索
  - URL / route: `http://192.168.0.4:4200/projects/6c5385bf7f9644a8bb766c6800889811/tasks/57407833e0904c5c8af31f18d3a79152/output/execution`
  - target: `formcontrolname=project`（`sm-paginated-entity-selector` host。内側の authored `input[matInput][formControl]` を操作）
  - selector: `body > div.cdk-overlay-container:nth-of-type(2) > div.cdk-global-overlay-wrapper:nth-of-type(2) > div.cdk-overlay-pane.dialog-md > mat-dialog-container.mat-mdc-dialog-container.mdc-dialog > div.mat-mdc-dialog-inner-container.mdc-dialog__container > div.mat-mdc-dialog-surface.mdc-dialog__surface > sm-clone-dialog.mat-mdc-dialog-component-host > sm-dialog-template > div.dialog-template-container > div.generic-container:nth-of-type(2) > form > div.form-container > sm-paginated-entity-selector`
  - selector一致件数: host `1`件、内側の `sm-paginated-entity-selector[formcontrolname="project"] input` も `1`件
  - UIイベント: authored input の `input` → `getEntities.emit(value)` → parent `(getEntities)` → `searchChanged({value: $event})`
  - 期待経路: `searchChanged()` → `getTablesFilterProjectsOptions` dispatch → `getTablesFilterProjectsOptions$` → `debounceTime(300)` → `switchMap` / `forkJoin` → `ApiProjectsService.projectsGetAllEx()` → `POST ${basePath}/projects.get_all_ex` → project候補更新
  - ngwiの到達点: `getEntities → searchChanged() → getTablesFilterProjectsOptions dispatch → getTablesFilterProjectsOptions$ → getPaginatedAndSearchedAndSelectedProjects() → ApiProjectsService.projectsGetAllEx() → POST ${basePath}/projects.get_all_ex`。helper内`forkJoin`の3つの条件付きrequest siteを表示
  - 実行時Network: 修正後にも `Semi` 入力で `POST /service/1/api/v999.0/projects.get_all_ex` が2件発生し、ともに `200`。部分検索 `pattern: "Semi"` と完全一致確認 `pattern: "^Semi$"`
  - 主要副作用: autocomplete候補に `Semiconductor Quality Prediction` 以下のprojectが表示。Cloneは実行せずCancelで閉じた
  - console error: なし。今回の操作と無関係な `NG02956` preconnect warningが1件
  - exit code: `5`
  - report: `x-local/tmp/ngwi-17-CloneDialogComponent.formcontrolname=project-260926.143552.md`
  - 履歴: `x-his-fail.md`
  - 修正内容: 末尾セミコロン付きoutput handlerを親handlerとして解決し、同名DOMイベントとの二重解釈を除去。ファイル直下のarrow helperと、引数で渡されたDI serviceを越えてhelper内`forkJoin`のHTTPを結合

- [ ] **A02 / P1: `mat-select` の overlay option 選択から再取得通信**  
  trigger はコンポーネント配下、`mat-option` は `body > .cdk-overlay-container` 配下になる経路を対象にする。`selectionChange` / form value change → handler → store → HTTP が、DOM の親子関係が切れることで失われないかを確認する。

- [ ] **A03 / P1: `mat-autocomplete` の候補選択から API 呼出し**  
  入力による候補取得と、overlay 内 `mat-option` の `optionSelected` による確定後処理を別イベントとして検証する。`displayWith`、async options、FormControl の中間層で通信起点を取り違えないかを見る。

- [ ] **A04 / P1: `MatDialog.open()` → dialog action → `afterClosed()` → 通信**  
  親画面の open 操作、dialog 内の confirm、`MatDialogRef.close(result)`、呼出し元の `afterClosed()`、dispatch / service を一本にできるか確認する。別 overlay subtree、DI token、Observable callback が主な停止候補。

- [ ] **A05 / P2: `mat-menu` trigger → menu item → dispatch / route / HTTP**  
  `matMenuTriggerFor` と overlay 内 `mat-menu-item` の投影関係を確認する。menu item の click が呼出し元 component の処理へ戻る場合と、route 遷移だけで終わる場合を区別する。

## B. PrimeNG とテンプレート投影（5件）

- [ ] **B01 / P1: `p-table` の `pTemplate="body"` 行クリックから詳細取得**  
  PrimeNG Table が消費する `TemplateRef` 内のボタンまたは行を起点に、row context → custom table output → 親 handler → dispatch → effect → HTTP を追う。`pTemplate` の宣言位置と実 DOM の所有 component がずれて経路を失わないかを確認する。

- [ ] **B02 / P1: Table の sort / filter 変更から一覧再取得**  
  `SortMeta` / `FilterMetadata` を受ける output、共通 table wrapper、親の NgRx action、effect、一覧 API の経路を対象にする。複数の似た出力と同一 action の条件差を誤結合しないかを見る。

- [ ] **B03 / P1: virtual scroll / lazy load / paginator から追加取得**  
  viewport や page change に伴う遅延イベント → query state 更新 → HTTP の経路を確認する。ユーザ click ではなく library output が起点になるため、イベント未検出と通信なしを混同しないことを重視する。

- [ ] **B04 / P1: `p-context-menu` の行コンテキストから操作通信**  
  table row の右クリック、選択行の保持、`MenuItem.command` callback、dispatch / dialog / HTTP を追う。設定 object 内 callback とテンプレート上イベントの間が切れやすい経路として扱う。

- [ ] **B05 / P2: PrimeNG dialog / button から確定処理**  
  `p-dialog` の可視状態、projected footer、PrimeNG button のイベントから service / store までを確認する。単なる表示閉鎖と保存通信を分け、通信なしの confirm/cancel を誤って HTTP へ結ばない。

## C. Angular テンプレート・フォーム・コンポーネント境界（5件）

- [ ] **C01 / P1: child `output()` / `EventEmitter` → parent handler → 通信**  
  dumb component の click が output alias を経由し、container component で dispatch または service call される代表経路を選ぶ。output 名と handler 名が異なるケースを優先する。

- [ ] **C02 / P1: `ng-content` / `ng-template` / `TemplateRef` 多段投影から通信**  
  table 以外の dialog、card、menu template で、宣言元 → 投影先 → 実 DOM → 親処理を照合する。content query やテンプレート変数を名前だけで推測せず、実際の投影先を確認する。

- [ ] **C03 / P1: Reactive Forms の `ngSubmit` → validation → API**  
  submit button / form を起点に、valid の正常分岐だけを通って、form value → component method → action / service → HTTP → dialog close / success notification までを確認する。invalid 分岐は主経路へ展開しない。

- [ ] **C04 / P2: signal `input()` / `model()` の変更 → 親子双方向処理 → 通信**  
  signal input、model output、computed を挟む UI を探し、値の変化が親 component の通信起点へ届くか確認する。通常の `@Input` / `@Output` と同じ形だと推測して誤接続しないことも判定する。

- [ ] **C05 / P2: directive / host listener が代理するイベントから通信**  
  infinite scroll、resize、keyboard、options scroll など、template 上に直接 handler がない操作を選ぶ。directive output / `HostListener` → component → state → HTTP を追い、DOM event だけで停止しないかを見る。

## D. NgRx Store / Effects（5件）

- [ ] **D01 / P1: action creator dispatch → class-based effect → generated API service**  
  `store.dispatch(actionCreator(...))` → `createEffect` → `ofType` → flattening operator → `Api*Service` → `HttpClient` の標準経路を検証する。`exportTaskButton` とは別 action を選び、既知修正の過適合を避ける。

- [ ] **D02 / P1: `createActionGroup` の event dispatch → effect → HTTP**  
  同じ group の複数 event が存在する経路を選び、正しい creator、consumer、effect だけが結合されるか確認する。表示名の正規化や property access による action 同定失敗を狙う。

- [ ] **D03 / P1: effect が別 action を返す多段チェーン**  
  UI action → effect A → success / follow-up action → effect B → HTTP または主要副作用を追う。simple 版では正常系一本だけを表示し、failure action や error notification を混ぜない。

- [ ] **D04 / P1: functional effect / `provideEffects` 登録を経由する通信**  
  class member ではない functional effect、inject による service / Actions 解決、application / route providers での登録を含む経路を対象にする。effect member 名を前提にした探索で停止しないか確認する。

- [ ] **D05 / P2: dispatch → reducer / selector / signal 表示更新のみで通信なし**  
  HTTP を行わない表示切替や selection 操作を意図的に選ぶ。action と reducer が存在するだけで無関係な effect / HTTP を結ばず、「通信なしを確認」と正しく判定できる反例にする。

## E. Angular Signals / NgRx SignalStore（5件）

- [ ] **E01 / P1: `signalStore` の `withMethods` → injected API service → HTTP**  
  UI → Store method → `withMethods` 内の service call → HTTP → `patchState` / 表示更新を追う。実例候補は project settings 系 Store。生成 Store member と method 本体の対応失敗を確認する。

- [ ] **E02 / P1: `signalStoreFeature` 合成越しの method → HTTP**  
  `withProjectSettingsStore` や view feature のような feature factory を合成した Store を対象にする。feature 展開、withProps の DI、withMethods の method 解決が途中で未確定にならないかを見る。

- [ ] **E03 / P1: `rxMethod` → RxJS pipeline → HTTP → `tapResponse` / `patchState`**  
  値、Signal、Observable のいずれで起動されたかを記録し、`switchMap` 等の内側の HTTP と success state write まで確認する。method 定義があるだけで起動済みと誤認しない。

- [ ] **E04 / P2: SignalStore method → NgRx `Store.dispatch` → effect → HTTP**  
  SignalStore と通常の NgRx Store をまたぐ明示的な橋を探す。二つの state system を形だけで同一視せず、実際の dispatch site から action bus の consumer に接続できるか確認する。

- [ ] **E05 / P2: `withComputed` / local signal / `patchState` だけで完結する通信なし操作**  
  filter toggle や local selection を対象にし、Signal / SignalStore の write と派生表示は示しつつ、無関係な HTTP に接続しないことを確認する。E01〜E04の偽陽性を防ぐ反例とする。

## F. HTTP・RxJS・動的呼び出し境界（5件）

- [ ] **F01 / P1: generated `Api*Service` wrapper → `HttpClient` method / endpoint**  
  component / effect から `ApiTasksService` などの生成 client method を呼ぶ経路を選び、wrapper の method 名だけで止まらず、HTTP method、`${basePath}` を含む endpoint まで表示できるか確認する。

- [ ] **F02 / P1: `forkJoin` / 複数 HTTP の正常系**  
  一つの操作から複数 request を開始し、合流後に state 更新する経路を対象にする。simple 版が代表通信だけを示す場合も、実行時 Network の全 request と、どれを省略したかを記録して誤結合と区別する。

- [ ] **F03 / P1: `switchMap` / `concatMap` / `exhaustMap` 内の service call**  
  高階 Observable の callback 内にある HTTP を対象にし、operator callback を越えて endpoint へ届くか確認する。検索、保存、連打防止など operator の意味が異なる例を一件ずつ候補化し、最初に安全なものを実施する。

- [ ] **F04 / P2: `firstValueFrom` / `lastValueFrom` / `async` method → HTTP**  
  Observable を Promise に変換し、`await` 後に dialog close、download、通知などを行う経路を対象にする。Promise 境界で正常応答後の主要副作用が切れないか確認する。

- [ ] **F05 / P3: `fetch` / dynamic service dispatch / SDK 呼び出し**  
  `HttpClient` 以外の `fetch`、computed property での service method 選択、AWS SDK などの外部 client が実 UI から呼ばれる経路を探索する。ngwi の既知 HTTP として扱えない場合は、通信なしではなく「通信有無は未確定」とし、Network 観測を根拠に境界を記録する。

## 実施順

- [ ] **第1巡: P1 の非破壊操作** — 一覧、検索、filter、sort、詳細表示、export を中心に、各カテゴリから最低1件ずつ実施する。
- [ ] **第2巡: P1 の残件** — 第1巡で得た停止位置を重複させすぎないよう、別の解析境界を持つ UI を優先する。
- [ ] **第3巡: P2 / P3** — 通信なしの反例、overlay / directive / dynamic call など不確定境界を確認する。
- [ ] **分類レビュー** — 全30件を成功、通信なし、未確定、経路結合失敗、対象なしに分類し、停止位置別に改善候補をまとめる。
- [ ] **回帰候補選定** — 同じ原因の失敗を束ね、各原因につき最小の fixture と ClearML 実画面の代表1件を選ぶ。ここでは実装せず、別タスクへ切り出す。

## 各項目の記録テンプレート

```markdown
### ID / 画面・UI

- 状態: 成功 / 通信なし / 通信有無は未確定 / 通信経路の結合失敗 / 対象なし
- URL / route:
- target:
- selector:
- UIイベント:
- 期待経路:
- ngwiの到達点:
- 実行時Network: method / URL / status
- 主要副作用: DOM / route / download / notification / state
- console error:
- 完全なコマンド:
- exit code:
- report:
- 履歴:
- 改善候補または対象なしの根拠:
```

## 完了条件

- [ ] 30パターンすべてが、完了または根拠付きの「対象なし」になっている。
- [ ] 各実施項目で DOM selector の一意性を確認している。
- [ ] 各実施項目で simple レポートと実行時挙動を独立に判定している。
- [ ] 通信が表示されない項目を「通信なし」「通信有無は未確定」「通信経路の結合失敗」に分類している。
- [ ] 正常系の HTTP 後に意味のある download、route、state update、success notification がある場合は終点まで確認している。
- [ ] success / fail 履歴に完全なコマンド、URL、exit code、結果、生成ファイルを記録している。
- [ ] 同一原因の重複を整理し、改善タスク候補と回帰 fixture 候補を対応付けている。
