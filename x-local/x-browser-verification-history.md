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
