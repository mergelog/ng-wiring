# 未完了のブラウザ通信経路検証

元計画: [_old/x-browser-communication-path-verification-plan.md](_old/x-browser-communication-path-verification-plan.md)。完了済みの A01 と過去の実績は元計画に保存した。以下は未実施の29パターンと未完了の確認事項のみ。共通手順は [x-browser-verification-procedure.md](x-browser-verification-procedure.md) を参照。

- デグレ確認を怠らないこと。

## A. Angular Material と CDK overlay（残り4件）
- [x] **A02 / P1: `mat-select` の overlay option 選択から再取得通信**
  trigger はコンポーネント配下、`mat-option` は `body > .cdk-overlay-container` 配下になる経路を対象にする。`selectionChange` / form value change → handler → store → HTTP が、DOM の親子関係が切れることで失われないかを確認する。
  - 2026-09-26 実施: Workers の期間を `3 Hours` → `6 Hours` に変更。selector一致1件。Networkで `workers.get_all` / `workers.get_activity_report` の再要求を確認（200）。simpleレポートは `setStatsParams` から reducer の `provideState` 登録未検出で停止し、通信未検出と表示。実行時とは不一致。履歴と `ngwi-18-WorkersStatsComponent.name=time-frame-260926.182921.md` を参照。

- [ ] **A03 / P1: `mat-autocomplete` の候補選択から API 呼出し**
  入力による候補取得と、overlay 内 `mat-option` の `optionSelected` による確定後処理を別イベントとして検証する。`displayWith`、async options、FormControl の中間層で通信起点を取り違えないかを見る。
  - 2026-09-26 部分実施: Clone Task の Project autocomplete で入力候補を取得し、既存プロジェクトを選択後 Cancel。候補検索は `projects.get_all_ex` (200) と照合。Clone 確定後の通信は新規タスク作成になるため未実行。simpleレポートは候補取得経路を表示するが exit 5。履歴と `ngwi-20-CloneDialogComponent.formcontrolname=project-260926.183955.md` を参照。

- [x] **A04 / P1: `MatDialog.open()` → dialog action → `afterClosed()` → 通信**
  親画面の open 操作、dialog 内の confirm、`MatDialogRef.close(result)`、呼出し元の `afterClosed()`、dispatch / service を一本にできるか確認する。別 overlay subtree、DI token、Observable callback が主な停止候補。
  - 2026-09-26 実施: Compare Tasks の追加ダイアログで既存タスクを追加して APPLY。`afterClosed()` 後に比較URLが3件へ更新され、`tasks.get_all_ex` が再取得（200）。simpleレポートは `openAddExperimentSearch()` で停止し通信未検出、実行時とは不一致。履歴と `ngwi-21-ExperimentCompareHeaderComponent.data-id=addExperimentButton-260926.184134.md` を参照。

- [x] **A05 / P2: `mat-menu` trigger → menu item → dispatch / route / HTTP**
  `matMenuTriggerFor` と overlay 内 `mat-menu-item` の投影関係を確認する。menu item の click が呼出し元 component の処理へ戻る場合と、route 遷移だけで終わる場合を区別する。
  - 2026-09-26 実施: Task menu の Export を選択。`tasks.get_by_id_ex` (200)、JSONダウンロードと成功通知を確認。overlay item の一意性は1件。DOM selector単独では component host を含まずCLI exit 3、source候補を選んだレポートはHTTPとダウンロードまで表示するがexit 5。履歴と `ngwi-22-ExperimentMenuExtendedComponent.data-id=exportTaskButton-260926.184429.md` を参照。

## B. PrimeNG とテンプレート投影（5件）
- [x] **B01 / P1: `p-table` の `pTemplate="body"` 行クリックから詳細取得**
  PrimeNG Table が消費する `TemplateRef` 内のボタンまたは行を起点に、row context → custom table output → 親 handler → dispatch → effect → HTTP を追う。`pTemplate` の宣言位置と実 DOM の所有 component がずれて経路を失わないかを確認する。
  - 2026-09-26 実施: Training → Tasks の `p-table` で比較タスク行を選択。single click は `rowClicked` → 親の選択更新のみ。double click は `rowDoubleClicked` → `experimentSelectionChanged` → 詳細 route → `tasks.get_by_id_ex` (200)。`tr:nth-child(1)` は1件。simple は終了コード5で target detection incomplete、レポートなし。履歴参照。

- [x] **B02 / P1: Table の sort / filter 変更から一覧再取得**
  `SortMeta` / `FilterMetadata` を受ける output、共通 table wrapper、親の NgRx action、effect、一覧 API の経路を対象にする。複数の似た出力と同一 action の条件差を誤結合しないかを見る。
  - 2026-09-26 実施: NAME sort で URL が `order=-name` に変わり `tasks.get_all_ex` (200)。検索語 `comparison` で `q=comparison`、表示3件、同 API (200)。sort selectorは1件。ngwiは両試行とも終了コード5、レポートなし。検索入力はDevTools fillが操作不能だったため input event を dispatch して確認。履歴参照。

- [x] **B03 / P1: virtual scroll / lazy load / paginator から追加取得**
  viewport や page change に伴う遅延イベント → query state 更新 → HTTP の経路を確認する。ユーザ click ではなく library output が起点になるため、イベント未検出と通信なしを混同しないことを重視する。
  - 2026-09-26 実施: `p-table` の `.p-datatable-table-container` を下端までスクロール。`autoLoadMore` が動き `tasks.get_all_ex` の追加POST (200) を複数確認。スクロール container selectorは1件。ngwiは終了コード5、レポートなし。履歴参照。

- [x] **B04 / P1: `p-context-menu` の行コンテキストから操作通信**
  table row の右クリック、選択行の保持、`MenuItem.command` callback、dispatch / dialog / HTTP を追う。設定 object 内 callback とテンプレート上イベントの間が切れやすい経路として扱う。
  - 2026-09-26 実施: 行 context menu → Export。選択行を保持し、`tasks.get_by_id_ex` (200) を確認。単純レポートは `TableComponent.openContext` で止まり、menu command とHTTPを連結せず終了コード5。selectorは行単位で1件。履歴と `ngwi-23-TableComponent.data-id=3DotMenuButton-260926.190203.md` を参照。

- [x] **B05 / P2: PrimeNG dialog / button から確定処理**
  `p-dialog` の可視状態、projected footer、PrimeNG button のイベントから service / store までを確認する。単なる表示閉鎖と保存通信を分け、通信なしの confirm/cancel を誤って HTTP へ結ばない。
  - 2026-09-26 実施: ClearMLソース内に `p-dialog` はなく、Clone は Angular Material dialog。PrimeNG行menuからCloneを開き、`formcontrolname=project` 1件とCancelを確認。project候補の `projects.get_all_ex` (200) のみで、Cancel後にClone作成通信なし。ngwiの同target試行は終了コード5、レポートなし。PrimeNG dialogパターン自体は対象なしとして記録。履歴参照。

## C. Angular テンプレート・フォーム・コンポーネント境界（5件）
- [x] **C01 / P1: child `output()` / `EventEmitter` → parent handler → 通信**
  dumb component の click が output alias を経由し、container component で dispatch または service call される代表経路を選ぶ。output 名と handler 名が異なるケースを優先する。
  - 2026-09-26 実施: Projects の Semiconductor Quality Prediction カードを選択。`projectCardClicked` → `ProjectsPage.projectCardClicked` → `setDeep` / `setSelectedProjectId` → `getSelectedProject` effect → `projects.get_all_ex` (200)。selectorは `nth-of-type(4)` を含め1件。simpleレポートは `setDeep` から無関係な `getUsersEffect` 登録停止を誤結合し終了コード5、後続の正しい `projects.get_all_ex` は表示した。履歴と `ngwi-28-ProjectCardComponent.class=project-card-260926.192601.md` を参照。

- [x] **C02 / P1: `ng-content` / `ng-template` / `TemplateRef` 多段投影から通信**
  table 以外の dialog、card、menu template で、宣言元 → 投影先 → 実 DOM → 親処理を照合する。content query やテンプレート変数を名前だけで推測せず、実際の投影先を確認する。
  - 2026-09-26 実施: Pipelines の nested project view で、親 `NestedPipelinePage` が宣言した `cardContent` / `cardFooterContent` を `TemplateRef` として渡し、`NestedProjectViewPage` が `ngTemplateOutlet` で `NestedCard` 内へ描画する経路をソースとDOMで確認。Semiconductor Quality Prediction カードを選択すると project route が変わり、`projects.get_all_ex` (200)。`data-id=projectCard` selectorは1件。simpleレポートは NestedProjectViewPage の output emit で停止し通信未検出（終了コード5）。履歴と `ngwi-27-NestedCardComponent.data-id=projectCard-260926.192216.md` を参照。

- [x] **C03 / P1: Reactive Forms の `ngSubmit` → validation → API**
  submit button / form を起点に、valid の正常分岐だけを通って、form value → component method → action / service → HTTP → dialog close / success notification までを確認する。invalid 分岐は主経路へ展開しない。
  - 2026-09-26 実施: Data Catalog の Name contains に `semiconductor` を入力して Apply。validな `ngSubmit` → `apply()` → `filterChange` → 親 `applyFilter` → `filterChanged` dispatch 後、一覧が絞られ、`tasks.get_all_ex` / `models.get_all_ex` が200。button selectorは1件。simpleレポートはdispatch後のeffect/APIを結合できず終了コード5。履歴と `ngwi-25-CatalogFiltersComponent.data-id=catalogApply-260926.191650.md` を参照。

- [x] **C04 / P2: signal `input()` / `model()` の変更 → 親子双方向処理 → 通信**
  signal input、model output、computed を挟む UI を探し、値の変化が親 component の通信起点へ届くか確認する。通常の `@Input` / `@Output` と同じ形だと推測して誤接続しないことも判定する。
  - 2026-09-26 実施: Tasks の Customize table → ADD METRIC を選択。`ExperimentCustomColsMenuComponent.customColumnMode = model(...)` は親 `ExperimentHeaderComponent` の `[(customColumnMode)]` へ反映され、候補画面を表示。候補を表示するため `projects.get_unique_metric_variants` と `projects.get_hyper_parameters` が200。simple解析は候補検索の `placeholder=Search metric` で終了コード5 / Target detection incomplete、レポートなし。通信は候補表示の起点で確認。履歴参照。

- [x] **C05 / P2: directive / host listener が代理するイベントから通信**
  infinite scroll、resize、keyboard、options scroll など、template 上に直接 handler がない操作を選ぶ。directive output / `HostListener` → component → state → HTTP を追い、DOM event だけで停止しないかを見る。
  - 2026-09-26 実施: Training の Tasks 一覧で `.p-datatable-table-container` を末尾までスクロール。`smScrollEnd` IntersectionObserver → `sm-dots-load-more` の `loadMore` → `TableComponent.loadMore()` → tasks state → `tasks.get_all_ex` (200) を確認。load-more row selectorは1件。simple解析は終了コード5 / Target detection incomplete、レポートなし。履歴参照。

## D. NgRx Store / Effects（5件）
- [x] **D01 / P1: action creator dispatch → class-based effect → generated API service**
  `store.dispatch(actionCreator(...))` → `createEffect` → `ofType` → flattening operator → `Api*Service` → `HttpClient` の標準経路を検証する。`exportTaskButton` とは別 action を選び、既知修正の過適合を避ける。
  - 2026-09-26 実施: Workers の期間を `3 Hours` → `1 Day` に変更。期間変更後に `workers.get_all` / `workers.get_activity_report` の再要求（200）を確認。ソース上は `setStatsParams` dispatch と `WorkersEffects` の class effect があるが、simple は `workersReducer` の選択 injector での `provideState` 登録未検出を理由にdispatch直後で停止し、API未表示（終了コード5）。検出失敗。`ngwi-30-WorkersStatsComponent.name=time-frame-260926.210441.md`。

- [x] **D02 / P1: `createActionGroup` の event dispatch → effect → HTTP**
  同じ group の複数 event が存在する経路を選び、正しい creator、consumer、effect だけが結合されるか確認する。表示名の正規化や property access による action 同定失敗を狙う。
  - 2026-09-26 実施: Data Catalog で Name contains に `semiconductor` を入力してApply。`filterChanged` → URL更新 → URLから `openList` → 一覧APIの実行後、対象一覧へ絞り込まれた。`dataCatalogActions` は複数eventを持つ `createActionGroup`。simple は `filterChanged` dispatchで停止し、後続のURL/effect/HTTPを接続せず（終了コード5）。Networkでは `tasks.get_all_ex` / `models.get_all_ex` のPOST 200を確認。`ngwi-29-CatalogFiltersComponent.data-id=catalogApply-260926.210113.md`。

- [x] **D03 / P1: effect が別 action を返す多段チェーン**
  UI action → effect A → success / follow-up action → effect B → HTTP または主要副作用を追う。simple 版では正常系一本だけを表示し、failure action や error notification を混ぜない。
  - 2026-09-26 部分実施: Data Catalog の `semiconductor-quality-training #12` を開いた。ソースでは route detail の `openDetail` → `loadDetail` effect → `detailLoaded` → `loadLineage` effect → lineage要求の順。画面に詳細と `Where it came from` が表示され、Networkで `tasks.get_by_id_ex` と関連する tasks/models 読み取りの200を確認。source起点のsimple実行は終了コード5（`Target detection incomplete`、レポートなし）、因果経路の結合は未達。実行コマンドは履歴参照。

- [x] **D04 / P1: functional effect / `provideEffects` 登録を経由する通信**
  class member ではない functional effect、inject による service / Actions 解決、application / route providers での登録を含む経路を対象にする。effect member 名を前提にした探索で停止しないか確認する。
  - 2026-09-26 確認: 対象 `stackup` アプリの `src/app` で `createEffect` と `provideEffects` を照合。登録は `provideEffects([Class])` 形式で、class member外に定義された functional effect は見つからず、実画面の起点候補なし。対象なしとして記録。functional effectの実行時検証は未実施。

- [x] **D05 / P2: dispatch → reducer / selector / signal 表示更新のみで通信なし**
  HTTP を行わない表示切替や selection 操作を意図的に選ぶ。action と reducer が存在するだけで無関係な effect / HTTP を結ばず、「通信なしを確認」と正しく判定できる反例にする。
  - 2026-09-26 部分実施: Compare Tasks の `Hide Identical Fields` を切替。`setHideIdenticalFields` は reducerで表示データを選択し、対応するHTTP effectはない。Networkには切替後に `tasks.get_all_ex` が1件現れたが、定期更新との時間的重複がありこのtoggleの因果とは確認できず、通信なしの実行時証明は未確定。simple は reducer registrationを未解決としてdispatch後で停止（終了コード5）。`ngwi-31-ExperimentCompareHeaderComponent.mat-slide-toggle-L87-d343e53c5be5-260926.210639.md`。

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

## 完了条件
- [ ] 30パターンすべてが、完了または根拠付きの「対象なし」になっている。
- [ ] 各実施項目で DOM selector の一意性を確認している。
- [ ] 各実施項目で simple レポートと実行時挙動を独立に判定している。
- [ ] 通信が表示されない項目を「通信なし」「通信有無は未確定」「通信経路の結合失敗」に分類している。
- [ ] 正常系の HTTP 後に意味のある download、route、state update、success notification がある場合は終点まで確認している。
- [ ] success / fail 履歴に完全なコマンド、URL、exit code、結果、生成ファイルを記録している。
- [ ] 同一原因の重複を整理し、改善タスク候補と回帰 fixture 候補を対応付けている。
