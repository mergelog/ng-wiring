# ブラウザ通信経路検証の残件

元計画: [_old/x-browser-communication-path-verification-plan.md](_old/x-browser-communication-path-verification-plan.md)。完了済みの A01 と過去の実績は元計画に保存した。このファイルは続く29パターンの実施状況、分類レビュー、残件を記録する。共通手順は [x-browser-verification-procedure.md](x-browser-verification-procedure.md) を参照。2026-09-26時点で未完了のパターンはA03。

- デグレ確認を怠らないこと。

## A. Angular Material と CDK overlay（残り4件）
- [x] **A02 / P1: `mat-select` の overlay option 選択から再取得通信**
  trigger はコンポーネント配下、`mat-option` は `body > .cdk-overlay-container` 配下になる経路を対象にする。`selectionChange` / form value change → handler → store → HTTP が、DOM の親子関係が切れることで失われないかを確認する。
  - 2026-09-26 実施: Workers の期間を `3 Hours` → `6 Hours` に変更。selector一致1件。Networkで `workers.get_all` / `workers.get_activity_report` の再要求を確認（200）。simpleレポートは `setStatsParams` から reducer の `provideState` 登録未検出で停止し、通信未検出と表示。実行時とは不一致。履歴と `ngwi-18-WorkersStatsComponent.name=time-frame-260926.182921.md` を参照。

- [ ] **A03 / P1: `mat-autocomplete` の候補選択から API 呼出し**
  入力による候補取得と、overlay 内 `mat-option` の `optionSelected` による確定後処理を別イベントとして検証する。`displayWith`、async options、FormControl の中間層で通信起点を取り違えないかを見る。
  - 2026-09-26 部分実施: Clone Task の Project autocomplete で入力候補を取得し、既存プロジェクトを選択後Cancel。候補検索は `projects.get_all_ex` (200) と照合。Clone確定後は新規タスク作成を伴うため未実施。安全な別autocomplete候補も調査したが、option選択後の通信を起こすものは保存・作成等の変更操作を伴い、読み取り専用の代替は見つからなかった。simpleレポートは候補取得経路を表示するがexit 5。検証用タスクと作成操作の許可を得た後に再開する。履歴と `ngwi-20-CloneDialogComponent.formcontrolname=project-260926.183955.md` を参照。

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
  - 2026-09-26 再確認: 別タブの Compare Tasks で `Hide Identical Fields` を ON/OFF。`mat-slide-toggle` は1件。行表示は切り替わり、ソース上も `setHideIdenticalFields` → reducer → selector購読による表示更新のみで、対応するHTTP effectはない。前後に発生した `tasks.get_all_ex` は約10秒間隔の定期更新で、いずれも `only_fields: ["last_change"]` の同じ要求。toggle起点の追加要求は観測せず、**通信なしを確認**へ分類。simple は reducer registration を未解決としてdispatch後に停止（終了コード5）。比較表示はOFFへ戻した。レポート: `ngwi-31-ExperimentCompareHeaderComponent.mat-slide-toggle-L87-d343e53c5be5-260926.210639.md`。詳細は履歴参照。

## E. Angular Signals / NgRx SignalStore（5件）
- [x] **E01 / P1: `signalStore` の `withMethods` → injected API service → HTTP**
  UI → Store method → `withMethods` 内の service call → HTTP → `patchState` / 表示更新を追う。実例候補は project settings 系 Store。生成 Store member と method 本体の対応失敗を確認する。
  - 2026-09-26 実施: Projects → Semiconductor Quality Prediction → Training → Project Settings を開くと `loadScalars()` が `ApiProjectsService.projectsGetUniqueMetricVariants()` を2系統呼び、`forkJoin` 後に `patchState({scalars})`。Networkで `projects.get_unique_metric_variants` POST 200を2件確認。実DOMのoverlay menu item `data-id=Edit` は1件。ngwiのsimpleはrouteを指定するとProjectCardクリック側の `projects.get_all_ex` へ誤結合（終了コード5）。source起点は画面表示経路だけとなりmethod/API未検出。selector付き実行はoverlayを候補hostへ結び付けられず終了コード3。実行詳細とコマンドは履歴を参照。

- [x] **E02 / P1: `signalStoreFeature` 合成越しの method → HTTP**
  `withProjectSettingsStore` や view feature のような feature factory を合成した Store を対象にする。feature 展開、withProps の DI、withMethods の method 解決が途中で未確定にならないかを見る。
  - 2026-09-26 実施: E01と同じ `ProjectSettingsStore = signalStore(withProjectSettingsStore, withMethods(...))` を実行時に確認。合成featureの `withMethods` から注入された `ApiProjectsService` を経て上記2件のHTTPが発生し、成功後 `scalars` を更新。ngwiはこのfeature/method連鎖を出力せず、E01と同じ経路結合失敗。

- [x] **E03 / P1: `rxMethod` → RxJS pipeline → HTTP → `tapResponse` / `patchState`**
  値、Signal、Observable のいずれで起動されたかを記録し、`switchMap` 等の内側の HTTP と success state write まで確認する。method 定義があるだけで起動済みと誤認しない。
  - 2026-09-26 確認: 対象 `stackup/src/app` に `rxMethod` の定義・import・呼出しがなく、実画面候補なし。SignalStoreの別の `withEventHandlers` / RxJS経路はあるが、`rxMethod` 起点と混同しない。対象なし（実行時検証なし）。

- [x] **E04 / P2: SignalStore method → NgRx `Store.dispatch` → effect → HTTP**
  SignalStore と通常の NgRx Store をまたぐ明示的な橋を探す。二つの state system を形だけで同一視せず、実際の dispatch site から action bus の consumer に接続できるか確認する。
  - 2026-09-26 確認: 対象の `withMethods` は project settings の `loadScalars` / `setProject` と dashboard-search store の `checkPermissions` のみ。SignalStore method 内から `Store.dispatch` する実例なし。`withViewBridge` はSignalStore `withEventHandlers` からNgRx dispatchする実例だが、method起点ではないため本項の対象にはしない。対象なし。

- [x] **E05 / P2: `withComputed` / local signal / `patchState` だけで完結する通信なし操作**
  filter toggle や local selection を対象にし、Signal / SignalStore の write と派生表示は示しつつ、無関係な HTTP に接続しないことを確認する。E01〜E04の偽陽性を防ぐ反例とする。
  - 2026-09-26 実施: 同じProject Settingsの Scalar View Defaults で `Find scalars` に `accuracy` を入力。結果一覧が5項目から1項目へ絞られ、`searchTerm` signal → `searchTermChanged()` → 子の `filteredList` computed の経路を確認。操作後にNetworkのXHR/fetch件数は31のままで、新規通信なし。キャンセルで入力を破棄。simpleはselector一致1件だが終了コード5 (`Target detection incomplete`、レポートなし)。通信なしを実行時確認。

## F. HTTP・RxJS・動的呼び出し境界（5件）
- [x] **F01 / P1: generated `Api*Service` wrapper → `HttpClient` method / endpoint**
  component / effect から `ApiTasksService` などの生成 client method を呼ぶ経路を選び、wrapper の method 名だけで止まらず、HTTP method、`${basePath}` を含む endpoint まで表示できるか確認する。
  - 2026-09-26 実施: Training の Project Settings → Scalar View Defaults を表示。`ApiProjectsService.projectsGetUniqueMetricVariants()` の生成 wrapper は `apiRequest.post<...>(\`${this.basePath}/projects.get_unique_metric_variants\`, request, ...)` を呼び、Networkで `POST http://192.168.0.4:4200/service/1/api/v999.0/projects.get_unique_metric_variants` を2件、両方200で確認。sourceにもHTTP methodと`${basePath}`がある。一方、`data-id=Edit` のsimple解析はoverlayのEditではなく親ProjectCardのclickへ誤結合し、別endpoint `projects.get_all_ex` を表示（終了コード5）。実行時API wrapperは確認、ngwiによる当該画面経路の結合は失敗。

- [x] **F02 / P1: `forkJoin` / 複数 HTTP の正常系**
  一つの操作から複数 request を開始し、合流後に state 更新する経路を対象にする。simple 版が代表通信だけを示す場合も、実行時 Network の全 request と、どれを省略したかを記録して誤結合と区別する。
  - 2026-09-26 実施: Quality pipeline (`/quality-pipeline`) を開き、overviewの読み取りだけを確認。`loadOverview` の `forkJoin` に対応する `tasks.get_all_ex` 2件と `models.get_all_ex` 1件をNetworkで確認、すべてPOST 200。別途project id解決の `projects.get_all_ex` 2件も発生したが、forkJoinの3 requestには含めない。画面は最新runなし・production model表示。simple source起点は終了コード5 (`Target detection incomplete`、レポートなし)、Network上の3件をまとめる経路は出力できず。

- [x] **F03 / P1: `switchMap` / `concatMap` / `exhaustMap` 内の service call**
  高階 Observable の callback 内にある HTTP を対象にし、operator callback を越えて endpoint へ届くか確認する。検索、保存、連打防止など operator の意味が異なる例を一件ずつ候補化し、最初に安全なものを実施する。
  - 2026-09-26 実施: 全体検索を開いて `semiconductor` を入力し、TASKS tabを選択。`DashboardSearchEffects.getResultsCount` の `switchMap(([action,...]) => organizationApi.organizationGetEntitiesCount(...))` をソースで確認。`organization.get_entities_count` と結果取得の `tasks.get_all_ex` がPOST 200。読み取り検索のみでデータ変更なし。simple source起点（`dashboard-search.effects.ts:30`, event `switchMap`）は終了コード5 (`Target detection incomplete`、レポートなし)、operator callbackからgenerated serviceまで未結合。

- [x] **F04 / P2: `firstValueFrom` / `lastValueFrom` / `async` method → HTTP**
  Observable を Promise に変換し、`await` 後に dialog close、download、通知などを行う経路を対象にする。Promise 境界で正常応答後の主要副作用が切れないか確認する。
  - 2026-09-26 実施: Training の Project Settings → Scalar View Defaults を開き、metric一覧5件を表示。`async loadScalars()` が2系統の`projectsGetUniqueMetricVariants()`を`forkJoin`し、`await lastValueFrom(...)`後に`patchState({scalars})`するソース経路を確認。Networkで同endpointのPOST 2件、両方200。キャンセルで閉じ、保存なし。simple source起点（store.ts:30, event `call`）は終了コード5 (`Target detection incomplete`、レポートなし)、Promise以降を未結合。

- [x] **F05 / P3: `fetch` / dynamic service dispatch / SDK 呼び出し**
  `HttpClient` 以外の `fetch`、computed property での service method 選択、AWS SDK などの外部 client が実 UI から呼ばれる経路を探索する。ngwi の既知 HTTP として扱えない場合は、通信なしではなく「通信有無は未確定」とし、Network 観測を根拠に境界を記録する。
  - 2026-09-26 確認: source検索では明示的な`fetch()`は`configuration.service.ts`の`configuration.json` bootstrap読込のみで、対象操作から呼ぶ画面は見つからず。SDKやcomputed propertyでのservice method選択もなし。近い実UI例として全体検索結果の`SearchResultsTableComponent.getAllResults`が``this[`${key}List`]()``で配列memberを動的選択する。`semiconductor`検索からTASKS tabへ切替え、Networkの`tasks.get_all_ex` POST 200と結果状態を確認したが、この動的選択自体は通信service callではなく、結果ロードeffectとは別境界。通信の存在はNetworkで確認した一方、dynamic dispatchからAPIへの因果経路は未確定。simple source起点（search-results-table.component.ts:154, event `call`）は終了コード5 (`Target detection incomplete`、レポートなし)。

## 実施順
- [x] **第1巡: P1 の非破壊操作** — A02/A04、B01-B04、C01-C03、D01-D03、E01-E02、F01-F03で実施。
- [x] **第1巡: P1 の非破壊操作** — A02/A04、B01-B04、C01-C03、D01-D03、E01-E02、F01-F03で実施。
- [ ] **第2巡: P1 の残件** — A03の選択確定後を残す。Cloneの確定はタスク作成を伴うため、専用テストデータと操作許可が揃うまで未実施。
- [x] **第3巡: P2 / P3** — 実例または対象なしの確認を実施。D05/E05は通信なし、A03/F05は未確定、B05/D04/E03/E04は対象なし。
- [x] **分類レビュー** — 30件を下記「分類レビュー」に整理。
- [x] **回帰候補選定** — 同一の解析停止をまとめ、下記「回帰候補」に最小 fixture と ClearML 代表を記録。実装は別タスク。

## 完了条件
- [ ] 30パターンすべてが、完了または根拠付きの「対象なし」になっている。
- [ ] 各実施項目で DOM selector の一意性を確認している。
- [ ] 各実施項目で simple レポートと実行時挙動を独立に判定している。
- [ ] 通信が表示されない項目を「通信なし」「通信有無は未確定」「通信経路の結合失敗」に分類している。
- [ ] 正常系の HTTP 後に意味のある download、route、state update、success notification がある場合は終点まで確認している。
- [ ] success / fail 履歴に完全なコマンド、URL、exit code、結果、生成ファイルを記録している。
- [ ] 同一原因の重複を整理し、改善タスク候補と回帰 fixture 候補を対応付けている。

## 分類レビュー

30件（完了済みA01を含む）の現時点の分類:

| 分類 | 件数 | ID |
| --- | ---: | --- |
| 成功 | 2 | A01, A05 |
| 通信なしを確認 | 2 | D05, E05 |
| 通信有無は未確定 | 2 | A03, F05 |
| 通信経路の結合失敗 | 20 | A02, A04, B01-B04, C01-C05, D01-D03, E01-E02, F01-F04 |
| 対象なし | 4 | B05, D04, E03-E04 |

- A01/A05は実行時のHTTPと主要終点がsimple経路に対応した。A05は目的の経路を出力したが、CLI終了コードは5。
- D05/E05は表示変更を実行し、操作起点のHTTPがないことをソースとNetworkの両方で確認した。D05には独立した定期更新が並行する。
- A03は候補検索とFormControl値確定まで。Clone確定は新規タスクを作るため未実施で、選択確定後の通信は未観測。
- F05はHTTP通信自体はあったが、動的な配列member選択と別起点の結果ロードAPIとの因果を結べなかったため未確定。
- 残る20件は実行時通信または副作用を確認した一方、simple経路に誤接続・早期停止・必要な終点の欠落がある。個別根拠は各項目と履歴を参照。

## 回帰候補

| 改善候補 | 対象ID | 最小fixture候補 | ClearML代表 |
| --- | --- | --- | --- |
| `provideState` / route injectorを越えたreducer・effect登録解決 | A02, D01, D05 | route provider登録のStoreでdispatchし、class effectから生成APIへ進む例。reducer-only actionにはHTTP edgeを作らない負例も含める | Workersの期間変更（A02/D01）、Compare TasksのHide Identical Fields（D05） |
| `createActionGroup` eventとfollow-up actionの対応付け | D02, D03 | 同一groupの複数eventを持つeffectと、成功actionから次effectへ進む二段チェーン | Data Catalogのfilter適用（D02）と詳細・lineage読込（D03） |
| overlay callback / `afterClosed()` と親処理の接続 | A03, A04 | Material dialog/autocompleteのoverlay option、FormControl、`afterClosed()`を含む読み取り専用fixture | Compare Tasksの追加ダイアログ（A04）。A03はClone確定操作の許可後に追加 |
| PrimeNG template/output/callbackの所有元追跡 | B01-B04, C02 | `pTemplate`、projected `TemplateRef`、`MenuItem.command`をそれぞれ独立に小さく再現 | Tasks一覧の行double-click（B01）、context menu Export（B04）、nested project card（C02） |
| directive / library eventから親handlerへの接続 | B02-B03, C05 | `p-table` sort/filter outputとIntersectionObserver経由のdirective outputを分けて用意 | Tasks一覧のsort/filter（B02）とlazy load（B03/C05） |
| signal model/output・Reactive Formsからstore更新への接続 | C01, C03-C04 | output alias、valid `ngSubmit`、signal `model()`の3ケースを個別fixture化 | Projects card選択（C01）、Catalog Apply（C03）、ADD METRIC（C04） |
| SignalStore feature合成・DI・Promise境界 | E01-E02, F04 | `signalStoreFeature`、injected API、`forkJoin`、`lastValueFrom`、`patchState`を一経路にしたfixture | Project Settingsの`loadScalars()`。E01/E02/F04は同じ画面・APIを再利用 |
| 高階Observable内HTTPと複数要求の追跡 | F02-F03 | `forkJoin`の複数HTTPと`switchMap` callback内service callを別fixture化 | Quality pipeline overview（F02）、Dashboard Search（F03） |
| API wrapper endpointおよび正常応答後の副作用 | F01, A05 | `${basePath}`を使う生成wrapperとdownload/success通知までの正常系 | `projects.get_unique_metric_variants`（F01）、Task Export（A05） |
| HTTPを作らないローカルstate更新の負例 | D05, E05 | reducer-only actionとcomputed/local signal更新。無関係なtimer通信を区別できるNetwork assertionを分離 | Compare Tasks toggle（D05）、Scalar検索（E05） |

実装対象はこのレビューでは変更しない。A03はClone作成を許可された検証データで実行できるまで完了扱いにしない。
