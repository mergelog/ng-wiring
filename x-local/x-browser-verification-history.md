# 今後のブラウザ検証記録

未完了項目を [x-browser-communication-pending.md](x-browser-communication-pending.md) に沿って実施した際、画面・UI、完全なコマンド、URL、終了コード、結果、生成ファイル、Network と主要副作用を記録する。終了コードが0でも、レポートと実行時挙動の照合結果を別に記す。

過去の記録は [_old/x-his-success.md](_old/x-his-success.md) と [_old/x-his-fail.md](_old/x-his-fail.md) に保存した。

## 成功

### 2026-09-26 — A02 / `mat-select` の overlay option → 一覧再取得

- 画面・UI: Workers & Queues → Workers utilization の期間選択。`sm-workers-graph mat-select[name="time-frame"]` は1件。3 Hours から6 Hoursへ変更。
- URL: `http://192.168.0.4:4200/workers-and-queues/workers`
- 実行時結果: 表示値が6 Hoursへ変化。変更後に `POST /service/1/api/v999.0/workers.get_all` と `workers.get_activity_report` が再送され、ともに200。コンソールエラーなし。
- simple結果: 終了コード0。`setStatsParams` dispatch の先で workers reducer の `provideState` 登録が選択 injector にないとして停止し、HTTP未検出。実行時観測との食い違い。
- 完全なコマンド:
  ```bash
  node ../ng-wiring/dist/cli/index.js 'name=time-frame' --project stackup --selector 'body > sm-root > sm-app-shell > div.root-container > div.app-container > sm-orchestration > div.content > sm-workers > sm-workers-graph > div.header > mat-form-field > div > div > div > mat-select' --out-dir ../ng-wiring/x-local/tmp
  ```
- 生成ファイル: `x-local/tmp/ngwi-18-WorkersStatsComponent.name=time-frame-260926.182921.md`（git管理外）

### 2026-09-26 — A04 / `MatDialog.open()` → `afterClosed()` → 再取得

- 画面・UI: Training の既存タスク2件を比較画面へ表示し、「Add/Remove tasks to comparison」から3件目を選択して APPLY。既存データの参照のみ。
- URL: `http://192.168.0.4:4200/projects/37d14cf85a97476489b532343bb9d0e6/compare-tasks;ids=0d9a969515ac4449b611b8034b4fc152,ec229ee4082442a88679b83980876384/details`。確定後に `b4b84597fb7e44588cb725eacf8869a8` が追加。
- 実行時結果: `afterClosed()` の確定結果で比較URLが更新され、`tasks.get_all_ex` が再取得（200）。ダイアログと比較画面に重大な表示エラーなし。
- simple結果: 終了コード5。`openAddExperimentSearch()` のclickで停止し、MatDialog / `afterClosed()` / URL更新 / HTTPを接続できず、実行時観測と不一致。
- 完全なコマンド:
  ```bash
  node ../ng-wiring/dist/cli/index.js 'data-id=addExperimentButton' --project stackup --route '/projects/:projectId/compare-tasks' --selector 'body > sm-root > sm-app-shell > div.root-container > div.app-container > sm-experiments-compare > div.experiment-compare-container.light-theme > sm-experiment-compare-header > div.header-container > div.actions-container > span.d-flex > button.mdc-button.mat-mdc-button-base.mat-mdc-tooltip-trigger.add-experiment.plus.icon-only.mdc-button--unelevated.mat-mdc-unelevated-button.mat-unthemed._mat-animation-noopable.cdk-focused.cdk-mouse-focused > mat-icon.mat-icon.notranslate.al-ico-add.al-icon.mat-icon-no-color' --out-dir ../ng-wiring/x-local/tmp
  ```
- 生成ファイル: `x-local/tmp/ngwi-21-ExperimentCompareHeaderComponent.data-id=addExperimentButton-260926.184134.md`（git管理外）

### 2026-09-26 — A05 / `mat-menu` item → dispatch → HTTP / download

- 画面・UI: 既存の `random-forest-quality-classifier` task detail の menu を開き、Exportを選択。`[data-id="exportTaskButton"]` のoverlay内一致は1件。
- URL: `http://192.168.0.4:4200/projects/37d14cf85a97476489b532343bb9d0e6/tasks/0d9a969515ac4449b611b8034b4fc152/execution`
- 実行時結果: `tasks.get_by_id_ex` POST 200、JSONダウンロード処理と「Task exported successfully」通知を確認。Chromeはdata URLのdownloadについてHTTPS警告を1件記録（API・画面処理の失敗ではない）。
- simple結果: overlay itemを終端とするselectorはcomponent host tagを持たないため終了コード3（`--selector contains no component host tag found in the candidates`）。route候補1を選ぶとHTTP、ダウンロード、成功通知まで表示したが終了コード5。selectorなしの候補選択による出力。
- 成功経路を出力した完全なコマンド:
  ```bash
  node ../ng-wiring/dist/cli/index.js 'data-id=exportTaskButton' --project stackup --route '/projects/:projectId/tasks/:experimentId' --candidate 1 --out-dir ../ng-wiring/x-local/tmp
  ```
- selector検証で失敗した完全なコマンド:
  ```bash
  node ../ng-wiring/dist/cli/index.js 'data-id=exportTaskButton' --project stackup --route '/projects/:projectId/tasks/:experimentId' --selector 'body > div.cdk-overlay-container > div.cdk-overlay-connected-position-bounding-box > div#cdk-overlay-1.cdk-overlay-pane > div#mat-menu-panel-16.mat-mdc-menu-panel.entity-context-menu.mat-menu-below.mat-menu-panel-animations-disabled.mat-menu-before > div.mat-mdc-menu-content > button[data-id="exportTaskButton"].mat-mdc-menu-item.mat-focus-indicator' --out-dir ../ng-wiring/x-local/tmp
  ```
- 生成ファイル: `x-local/tmp/ngwi-22-ExperimentMenuExtendedComponent.data-id=exportTaskButton-260926.184429.md`（git管理外）

## 失敗・部分資料

### 2026-09-26 — C01〜C05 / Angular template・form・component boundaries

- **C01 child output → parent → communication:** Projects の `Semiconductor Quality Prediction` cardをクリック。`ProjectCardComponent.projectCardClicked` → `ProjectsPage.projectCardClicked` → `setDeep` / `setSelectedProjectId` → effect → `projects.get_all_ex` POST 200。実行時URLは `/projects/` から `/projects/0f2765fc37a24c1e9f3752b1f96330e3/projects`。`sm-project-card:nth-of-type(4) > sm-card` は1件。simpleは `setDeep` の先で無関係な `getUsersEffect` 登録を停止理由にした後、別分岐のAPIを表示し終了コード5。経路結合失敗。
  ```bash
  node ../ng-wiring/dist/cli/index.js 'class=project-card' --project stackup --route '/projects/:projectId/projects' --selector 'body > sm-root > sm-app-shell > div > div > sm-projects-page > sm-projects-list > div > sm-project-card:nth-of-type(4) > sm-card' --out-dir ../ng-wiring/x-local/tmp
  ```
  生成ファイル: `x-local/tmp/ngwi-28-ProjectCardComponent.class=project-card-260926.192601.md`。
- **C02 multi-level projection:** Pipelines を Project view に切替え、`Semiconductor Quality Prediction` cardを選択。親 `NestedPipelinePage` の `cardContent` / `cardFooterContent` TemplateRefを`NestedProjectViewPage`が受け取り、`ngTemplateOutlet`から`NestedCard`経由で`sm-card`内へ投影するソース・DOM経路を照合。routeは `/pipelines/*/projects` → `/pipelines/0f2765fc37a24c1e9f3752b1f96330e3/projects`。`data-id=projectCard` は1件。`projects.get_all_ex` POST 200。simpleは`NestedProjectViewPage.cardClicked.emit`で停止、通信未検出、終了コード5。
  ```bash
  node ../ng-wiring/dist/cli/index.js 'data-id=projectCard' --project stackup --route '/pipelines/:projectId/projects' --selector 'body > sm-root > sm-app-shell > div > div > sm-nested-pipeline-page > sm-nested-project-view-page > div > sm-nested-card > sm-card' --out-dir ../ng-wiring/x-local/tmp
  ```
  生成ファイル: `x-local/tmp/ngwi-27-NestedCardComponent.data-id=projectCard-260926.192216.md`。
- **C03 Reactive Forms submit:** Data Catalog `/data-catalog` の `catalogText` に `semiconductor` を入力して Apply。validな`ngSubmit`→`apply()`→`filterChange`→`applyFilter`→action dispatchを確認し、URLは `/data-catalog?q=semiconductor`、一覧は一致行に絞られた。`catalogApply`は1件。`tasks.get_all_ex` / `models.get_all_ex` POST 200。simpleはaction dispatch以降を接続できず終了コード5、通信経路の結合失敗。
  ```bash
  node ../ng-wiring/dist/cli/index.js 'data-id=catalogApply' --project stackup --route '/data-catalog' --selector 'body > sm-root > sm-app-shell > div > div > sm-data-catalog-page > section > section > sm-catalog-filters > form > div > button' --out-dir ../ng-wiring/x-local/tmp
  ```
  生成ファイル: `x-local/tmp/ngwi-25-CatalogFiltersComponent.data-id=catalogApply-260926.191650.md`。
- **C04 signal `model()` two-way binding:** Tasks の Customize table → ADD METRICを選択。`ExperimentCustomColsMenuComponent.customColumnMode` の変更が `ExperimentHeaderComponent` の `[(customColumnMode)]` に反映され、metric候補画面に遷移。候補ロードの `projects.get_unique_metric_variants` と `projects.get_hyper_parameters` POST 200。`input[placeholder="Search metric"]` は1件。simpleは終了コード5 (`Target detection incomplete`)、レポートなし。
  ```bash
  node ../ng-wiring/dist/cli/index.js 'placeholder=Search metric' --project stackup --route '/projects/:projectId/tasks' --selector 'body > div > div > div > div > div > div > sm-select-metric-for-custom-col > div > sm-search > span > span > input' --out-dir ../ng-wiring/x-local/tmp
  ```
- **C05 directive scroll → load more:** Training の Tasks一覧で`.p-datatable-table-container`を下端へスクロール。`smScrollEnd` IntersectionObserver → `sm-dots-load-more` → `TableComponent.loadMore()` の後、追加 `tasks.get_all_ex` POST 200を確認。`.p-datatable-table-container` は1件、`tr.table-load-more` も1件。simpleは終了コード5 (`Target detection incomplete`)、レポートなし。
  ```bash
  node ../ng-wiring/dist/cli/index.js 'class=table-load-more' --project stackup --route '/projects/:projectId/tasks' --selector 'body > sm-root > sm-app-shell > div > div > sm-common-experiments > div > as-split > as-split-area > sm-experiments-table > div > sm-table > p-table > div > table > tbody > tr.table-load-more > div > div > sm-dots-load-more' --out-dir ../ng-wiring/x-local/tmp
  ```
- 各試行のブラウザURLは `http://192.168.0.4:4200` を基点とした。全5件のCLI終了コードは5。C01〜C03はレポートあり、C04/C05はレポートなし。生成ファイルは `x-local/tmp`（git管理外）。

### 2026-09-26 — A03 / autocomplete候補取得と選択後の確定境界

- 画面・UI: Task menu → Clone。Project autocompleteへ `Semiconductor Quality Prediction` を入力し、既存 `Semiconductor Quality Prediction/Model Comparison` を選択してCancel。Project selectorの一意性は1件。
- URL: `http://192.168.0.4:4200/projects/37d14cf85a97476489b532343bb9d0e6/tasks/0d9a969515ac4449b611b8034b4fc152/execution`
- 実行時結果: 入力に応じて `projects.get_all_ex` が複数回POSTされ200。option選択はFormControl値の確定まで。Clone確定はタスク新規作成を伴うため実行せず、選択後の通信は未検証。
- simple結果: 終了コード5。検索起点から `projects.get_all_ex` への経路は表示。候補取得がeffect内で複数の同種requestに展開された。
- 完全なコマンド:
  ```bash
  node ../ng-wiring/dist/cli/index.js 'formcontrolname=project' --project stackup --selector 'body > div.cdk-overlay-container > div.cdk-global-overlay-wrapper > div.cdk-overlay-pane.dialog-md > mat-dialog-container.mat-mdc-dialog-container.mdc-dialog > div.mat-mdc-dialog-inner-container.mdc-dialog__container > div.mat-mdc-dialog-surface.mdc-dialog__surface > sm-clone-dialog.mat-mdc-dialog-component-host > sm-dialog-template > div.dialog-template-container > div.generic-container > form > div.form-container > sm-paginated-entity-selector' --out-dir ../ng-wiring/x-local/tmp
  ```
- 生成ファイル: `x-local/tmp/ngwi-20-CloneDialogComponent.formcontrolname=project-260926.183955.md`（git管理外）

### 2026-09-26 — A04/A05 の候補・overlay selector 試行

- A04 route未指定での候補列挙は4 route候補を表示して終了コード2。完全なコマンド:
  ```bash
  node ../ng-wiring/dist/cli/index.js 'data-id=addExperimentButton' --project stackup --selector 'body > sm-root > sm-app-shell > div.root-container > div.app-container > sm-experiments-compare > div.experiment-compare-container.light-theme > sm-experiment-compare-header > div.header-container > div.actions-container > span.d-flex > button.mdc-button.mat-mdc-button-base.mat-mdc-tooltip-trigger.add-experiment.plus.icon-only.mdc-button--unelevated.mat-mdc-unelevated-button.mat-unthemed._mat-animation-noopable.cdk-focused.cdk-mouse-focused > mat-icon.mat-icon.notranslate.al-ico-add.al-icon.mat-icon-no-color' --out-dir ../ng-wiring/x-local/tmp
  ```
  対象URLの `/projects/:projectId/compare-tasks` を明示して再実行した。
- A05 overlay内 `exportTaskButton` の一意selectorを指定したCLIは、overlay pathからcomponent host tagを抽出できず終了コード3。候補選択で生成したA05レポートにはselector pathが含まれない。
- A05 route指定のみでの候補列挙も2候補を表示して終了コード2。完全なコマンド:
  ```bash
  node ../ng-wiring/dist/cli/index.js 'data-id=exportTaskButton' --project stackup --route '/projects/:projectId/tasks/:experimentId' --out-dir ../ng-wiring/x-local/tmp
  ```
- A02の `sm-workers-graph mat-select[name="time-frame"]` selectorはDevTools path書式ではないとして終了コード3。component/template経路を保つ簡潔なDevTools pathで再実行した。

### 2026-09-26 — B01〜B05 / PrimeNG table・context menu・dialog

- 対象: ClearML `Training` → `Tasks` (`/projects/37d14cf85a97476489b532343bb9d0e6/tasks`)。`sm-table` 内の PrimeNG `p-table` が `pTemplate="body"` を消費することをソースと実DOMで確認。
- **B01 行→詳細:** `comparison` で絞った先頭行をsingle clickすると選択状態だけが変化。double clickでは `/tasks/4037754160124faf9db09ff81cfaea2e/execution` へ遷移し、`tasks.get_by_id_ex` POST 200。`tbody tr:nth-child(1)` は1件。simple解析は終了コード5 (`Target detection incomplete`)、出力なし。
  ```bash
  node ../ng-wiring/dist/cli/index.js 'class=experiment-name' --project stackup --route '/projects/:projectId/tasks/:experimentId' --selector 'body > sm-root > sm-app-shell > div > div > sm-common-experiments > div > as-split > as-split-area > sm-experiments-table > div > sm-table > p-table > div > table > tbody > tr > td:nth-child(3) > div > div.experiment-name' --out-dir ../ng-wiring/x-local/tmp
  ```
- **B02 sort/filter:** NAME sort後にURLの `order=-name` が変化し、`tasks.get_all_ex` が200。`comparison` 検索後は `q=comparison`、表示3行、同APIが200。sort selectorは1件。Chrome DevToolsのfill/clickでは検索欄が操作不能だったため、同じinputへinput eventをdispatchして実行した。2回のsimple解析はいずれも終了コード5、出力なし。
  ```bash
  node ../ng-wiring/dist/cli/index.js 'data-id=sortTableColumn' --project stackup --route '/projects/:projectId/tasks' --selector 'body > sm-root > sm-app-shell > div > div > sm-common-experiments > div > as-split > as-split-area > sm-experiments-table > div > sm-table > p-table > div > table > thead > tr > th[data-col-id="name"] > sm-table-filter-sort > div > button[data-id="sortTableColumn"]' --out-dir ../ng-wiring/x-local/tmp
  ```
  ```bash
  node ../ng-wiring/dist/cli/index.js 'data-id=sortTableColumn' --project stackup --route '/projects/:projectId/tasks' --out-dir ../ng-wiring/x-local/tmp
  ```
- **B03 lazy load:** 詳細表示中のPrimeNG table scroll containerを下端までスクロールし、遅延ロード後の `tasks.get_all_ex` POST (200) を複数確認。scroll container selectorは1件。解析は終了コード5 (`Target detection incomplete`)、出力なし。
  ```bash
  node ../ng-wiring/dist/cli/index.js 'class=table-load-more' --project stackup --route '/projects/:projectId/tasks' --selector 'body > sm-root > sm-app-shell > div > div > sm-common-experiments > div > as-split > as-split-area > sm-experiments-table > div > sm-table > p-table > div > table > tbody > tr.table-load-more > div > div > sm-dots-load-more' --out-dir ../ng-wiring/x-local/tmp
  ```
- **B04 context menu:** 行をcontext menuで開き、Exportを選択。`tasks.get_by_id_ex` POST 200を確認。ngwiは `TableComponent.openContext` までは表示するがPrimeNG `MenuItem.command` callbackから通信を結合できず終了コード5。生成レポート: [`ngwi-23-TableComponent.data-id=3DotMenuButton-260926.190203.md`](tmp/ngwi-23-TableComponent.data-id=3DotMenuButton-260926.190203.md)。該当行メニューボタンselectorは1件。
  ```bash
  node ../ng-wiring/dist/cli/index.js 'data-id=3DotMenuButton' --project stackup --route '/projects/:projectId/tasks' --selector 'body > sm-root > sm-app-shell > div > div > sm-common-experiments > div > as-split > as-split-area > sm-experiments-table > div > sm-table > p-table > div > table > tbody > tr > div > button[data-id="3DotMenuButton"]' --out-dir ../ng-wiring/x-local/tmp
  ```
- **B05 dialog/button:** Cloneを開くとProject候補の `projects.get_all_ex` が200。`formcontrolname=project` は1件。Cancelで閉じ、Clone作成APIは発生しなかった。ソース・DOMにPrimeNG `p-dialog` はなく、Clone modalはAngular Material dialogだったためPrimeNG dialog本体は対象なし。解析試行は終了コード5、出力なし。
  ```bash
  node ../ng-wiring/dist/cli/index.js 'formcontrolname=project' --project stackup --route '/projects/:projectId/tasks/:experimentId' --out-dir ../ng-wiring/x-local/tmp
  ```
- 実行時URL: `http://192.168.0.4:4200/projects/37d14cf85a97476489b532343bb9d0e6/tasks?columns=selected&columns=type&columns=name&columns=tags&columns=status&columns=project.name&columns=users&columns=started&columns=last_update&columns=last_iteration&columns=parent.name&order=-name&q=comparison`。B01のdouble click後は同URLの `/tasks/4037754160124faf9db09ff81cfaea2e/execution`。
- `npm test`: 終了コード0、251 passed / 0 failed。`.env` の統合テスト対象を `data-id=3DotMenuButton` とcandidate `cand:1d7451318c97c1124e77d3a00afc015acd4781ed9f617ec56e1b98aa26b84f05` にし、外部 `stackup` workspaceを確認。

### 2026-09-26 — D01〜D05 / NgRx Store・Effects

- **D01 class effect → generated API:** Workers & Queues → Workers utilization で期間を `3 Hours` から `1 Day` に変更。selector `name=time-frame` は画面上1件。`workers.get_all` と `workers.get_activity_report` の再要求を確認（200）。simple は `setStatsParams` dispatch後に `workersReducer` の選択 injectorでの登録未検出として停止し、APIを表示しなかった（終了コード5）。レポート: [`ngwi-30-WorkersStatsComponent.name=time-frame-260926.210441.md`](tmp/ngwi-30-WorkersStatsComponent.name=time-frame-260926.210441.md)。
  ```bash
  node ../ng-wiring/dist/cli/index.js 'name=time-frame' --project stackup --route '/workers-and-queues/workers' --selector 'body > sm-root > sm-app-shell > div.root-container > div.app-container > sm-orchestration > div.content > sm-workers > sm-workers-graph > div.header > mat-form-field > div > div > div > mat-select' --out-dir ../ng-wiring/x-local/tmp
  ```
- **D02 `createActionGroup` → effect → HTTP:** Data CatalogでName containsに`semiconductor`を入力してApply。URLが`/data-catalog?q=semiconductor`へ変わり、絞り込まれた一覧を表示。`tasks.get_all_ex` / `models.get_all_ex` POST 200。simpleは`dataCatalogActions.filterChanged` dispatch後で停止（終了コード5）、URL/effect/HTTPを表示しなかった。レポート: [`ngwi-29-CatalogFiltersComponent.data-id=catalogApply-260926.210113.md`](tmp/ngwi-29-CatalogFiltersComponent.data-id=catalogApply-260926.210113.md)。
  ```bash
  node ../ng-wiring/dist/cli/index.js 'data-id=catalogApply' --project stackup --route '/data-catalog' --selector 'body > sm-root > sm-app-shell > div > div > sm-data-catalog-page > section > section > sm-catalog-filters > form > div > button' --out-dir ../ng-wiring/x-local/tmp
  ```
- **D03 effect follow-up action chain:** 同じData Catalogで`semiconductor-quality-training #12`を開いた。画面に詳細と`Where it came from`を表示し、Networkで`tasks.get_by_id_ex`と関連するtasks/models読み取り200を確認。ソースは`openDetail` → `loadDetail` → `detailLoaded` → `loadLineage`と続く。source起点解析は終了コード5（`Target detection incomplete`、レポートなし）。
  ```bash
  node ../ng-wiring/dist/cli/index.js --source src/app/features/data-catalog/components/catalog-assets-table/catalog-assets-table.component.html:23 --event click --project stackup --route '/data-catalog/run/:id' --out-dir ../ng-wiring/x-local/tmp
  ```
- **D04 functional effect:** `src/app`の`createEffect` / `provideEffects` を調べた。effectはinjectable classのmemberとして定義され、providersも`provideEffects([Class])`形式。class外に定義されたfunctional effectは見つからず、実画面対象はなし。実行時確認とCLI実行はなし。
- **D05 reducer-only / 通信なし候補:** Compare Tasksの`Hide Identical Fields`をON/OFF。selectorは1件。`setHideIdenticalFields` → reducer state → 表示切替のソースを確認し、対応するHTTP effectはない。切替後に`tasks.get_all_ex`が1件記録されたが、定期更新との時間的重複を排除できず、このtoggleの因果とは判定しない。simpleは`compareHeader`の登録未検出後に停止（終了コード5）。レポート: [`ngwi-31-ExperimentCompareHeaderComponent.mat-slide-toggle-L87-d343e53c5be5-260926.210639.md`](tmp/ngwi-31-ExperimentCompareHeaderComponent.mat-slide-toggle-L87-d343e53c5be5-260926.210639.md)。比較表示は元のOFFへ戻した。
  ```bash
  node ../ng-wiring/dist/cli/index.js --source src/app/webapp-common/experiments-compare/dumbs/experiment-compare-header/experiment-compare-header.component.html:87 --event change --project stackup --route '/projects/:projectId/compare-tasks' --out-dir ../ng-wiring/x-local/tmp
  ```

### 2026-09-26 — E01〜E05 / Angular Signals・NgRx SignalStore

- **E01 `withMethods` → API service → HTTP:** `/projects/0f2765fc37a24c1e9f3752b1f96330e3/projects` の Training card menuからProject Settingsを開いた。overlay内の `sm-menu-item[data-id="Edit"]` は1件。constructorが `setProject()` と `loadScalars()` を呼ぶ。`loadScalars()` は injected `ApiProjectsService` で experiment/model metricの2要求を作り、`forkJoin` 後に `patchState({scalars})`。`projects.get_unique_metric_variants` POSTを2件確認し、ともに200。
- **E02 `signalStoreFeature` 合成:** 同じ実行で `ProjectSettingsStore = signalStore(withProjectSettingsStore, withMethods(...))` → feature内 `withMethods` → injected serviceまで確認。実行時HTTPは上記2件。ngwiのroute付きsimpleレポートはmenu itemをProjectCard自体のclickと誤結合し、`projects.get_all_ex` を表示（終了コード5）。selector経由ではoverlay DOMと候補component hostを対応できず終了コード3。feature method/API連鎖はレポートに出ず、経路結合失敗。
  - route付きsimpleコマンド:
    ```bash
    node ../ng-wiring/dist/cli/index.js 'data-id=Edit' --project stackup --route '/projects/:projectId/projects' --out-dir ../ng-wiring/x-local/tmp
    ```
  - 出力: `x-local/tmp/ngwi-33-ProjectCardMenuExtendedComponent.data-id=Edit-260926.214845.md`（git管理外）。
  - overlay selectorコマンド（終了コード3、no component host tag）:
    ```bash
    node ../ng-wiring/dist/cli/index.js 'data-id=Edit' --project stackup --selector 'body > div.cdk-overlay-container > div.cdk-overlay-connected-position-bounding-box > div.cdk-overlay-pane > div#mat-menu-panel-17 > div.mat-mdc-menu-content > div.results > sm-menu-item[data-id="Edit"]' --out-dir ../ng-wiring/x-local/tmp
    ```
  - overlay境界の診断試行: 同selectorを内側 `div[role="menuitem"]` まで延長した場合も終了コード3 (`no component host tag`)。DevTools pathでない単独selectorは終了コード3 (`expects a DevTools Copy selector path`)。routeなしでは候補列挙後の選択待ちとなり終了コード2。候補番号を3に固定したroute実行は終了コード3 (`Candidate 3 is outside the discovered candidates`)。
    ```bash
    node ../ng-wiring/dist/cli/index.js 'data-id=Edit' --project stackup --selector 'body > div.cdk-overlay-container > div.cdk-overlay-connected-position-bounding-box > div.cdk-overlay-pane > div#mat-menu-panel-17 > div.mat-mdc-menu-content > div.results > sm-menu-item[data-id="Edit"] > div[role="menuitem"]' --out-dir ../ng-wiring/x-local/tmp
    node ../ng-wiring/dist/cli/index.js 'data-id=Edit' --project stackup --selector 'sm-menu-item[data-id="Edit"]' --out-dir ../ng-wiring/x-local/tmp
    node ../ng-wiring/dist/cli/index.js 'data-id=Edit' --project stackup --out-dir ../ng-wiring/x-local/tmp
    node ../ng-wiring/dist/cli/index.js 'data-id=Edit' --project stackup --route '/projects/:projectId/projects' --candidate 3 --out-dir ../ng-wiring/x-local/tmp
    ```
  - source起点の候補確認では表示経路のみのレポートとなり、終了コード5。生成物: `x-local/tmp/ngwi-32-ProjectCardMenuExtendedComponent.sm-menu-item-L2-81e8711e863d-260926.214758.md`。
    ```bash
    node ../ng-wiring/dist/cli/index.js --source src/app/webapp-common/shared/ui-components/panel/project-card-menu/project-card-menu.component.html:2 --event itemClicked --project stackup --route '/projects/:projectId/projects' --out-dir ../ng-wiring/x-local/tmp
    ```
  - Store method行へのsource起点は終了コード5 (`Target detection incomplete`)、レポートなし。
    ```bash
    node ../ng-wiring/dist/cli/index.js --source src/app/webapp-common/shared/project-dialog/project-settings/project-settings-dialog.component.ts:160 --project stackup --route '/projects/:projectId/projects' --out-dir ../ng-wiring/x-local/tmp
    ```
- **E03 `rxMethod`:** `stackup/src/app` 全体に定義・import・呼出しが見つからず、対象なし。実行時検証・CLI実行なし。
- **E04 SignalStore method → NgRx dispatch:** `withMethods` を持つ対象Storeを検索し、method内の `Store.dispatch` はなし。`withViewBridge` には `withEventHandlers` → NgRx dispatchの別構造があるため対象外。対象なし、実行時検証・CLI実行なし。
- **E05 local signal → computed / 通信なし:** Project Settings → Scalar View Defaultsで `Find scalars` (`input[placeholder="Find scalars"]`) に `accuracy` を入力。selector一致1件。表示が5指標からaccuracyのみへ変化し、`searchTerm` signal / `filteredList` computedを確認。操作前後のXHR/fetchはどちらも31件で、新規通信なし。入力を空に戻してCancelし、保存操作なし。simpleは終了コード5 (`Target detection incomplete`)、レポートなし。
  ```bash
  node ../ng-wiring/dist/cli/index.js 'placeholder=Find scalars' --project stackup --route '/projects/:projectId/projects' --selector 'body > div.cdk-overlay-container > div.cdk-global-overlay-wrapper > div#cdk-overlay-2 > mat-dialog-container#mat-mdc-dialog-1 > div.mat-mdc-dialog-inner-container > div.mat-mdc-dialog-surface > sm-project-settings > sm-dialog-template > div.dialog-template-container > div.generic-container > mat-tab-group > div.mat-mdc-tab-body-wrapper > mat-tab-body#mat-tab-group-1-content-1 > div.mat-mdc-tab-body-content > div.list > sm-selectable-grouped-filter-list > sm-search > span.search-input-container > span.search-input > input[placeholder="Find scalars"]' --out-dir ../ng-wiring/x-local/tmp
  ```
- ソース確認: `project-settings-dashboard-search-permissions.store.ts`, `project-settings-dialog.store.ts`, `project-settings-dialog.component.ts`, `selectable-grouped-filter-list.component.ts`, `core/state/view.store.ts`。E01/E02のservice/patchStateとE05のlocal filterに対応する実行時表示は確認できたが、ngwiのsimpleはE01/E02で別のHTTPに誤結合し、E05はtarget detectionで停止した。
