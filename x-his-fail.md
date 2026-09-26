# 失敗コマンド一覧

## Experiment details — Export task information

```bash
node ../ng-wiring/dist/cli/index.js 'data-id=exportTaskButton' --project stackup --selector 'body > sm-root > sm-app-shell > div.root-container > div.app-container > sm-common-experiments > div.experiment-body > as-split.as-horizontal.as-percent > as-split-area.as-split-area:nth-child(2) > sm-experiment-output > div.experiment-output-container.light-theme > sm-experiment-info-header > div.d-flex.align-items-center:nth-child(1) > div.d-flex.align-items-center:nth-child(2) > button.line-item._mat-animation-noopable:nth-child(4)' --out-dir ../ng-wiring/x-local/tmp
```

- URL: http://192.168.0.4:4200/projects/6c5385bf7f9644a8bb766c6800889811/tasks/57407833e0904c5c8af31f18d3a79152/output/execution
- Exit code: `5`
- Result: simpleレポートは生成されたが、解析結果が `partial` のため失敗扱い
- Output: `x-local/tmp/ngwi-04-ExperimentInfoHeaderComponent.data-id=exportTaskButton-260926.125102.md`

## Experiment details — Export task information（修正前再現）

```bash
node ../ng-wiring/dist/cli/index.js 'data-id=exportTaskButton' --project stackup --selector 'body > sm-root > sm-app-shell > div.root-container > div.app-container > sm-common-experiments > div.experiment-body > as-split.as-horizontal.as-percent > as-split-area.as-split-area:nth-child(2) > sm-experiment-output > div.experiment-output-container.light-theme > sm-experiment-info-header > div.d-flex.align-items-center:nth-child(1) > div.d-flex.align-items-center:nth-child(2) > button.line-item._mat-animation-noopable:nth-child(4)' --out-dir ../ng-wiring/x-local/tmp
```

- URL: http://192.168.0.4:4200/projects/6c5385bf7f9644a8bb766c6800889811/tasks/57407833e0904c5c8af31f18d3a79152/output/execution
- Exit code: `5`
- Result: dispatch直後で「通信への接続を確認できない」と停止する現象を再現
- Output: `x-local/tmp/ngwi-05-ExperimentInfoHeaderComponent.data-id=exportTaskButton-260926.134043.md`

## Experiment details — Export task information（修正後確認）

```bash
node ../ng-wiring/dist/cli/index.js 'data-id=exportTaskButton' --project stackup --selector 'body > sm-root > sm-app-shell > div.root-container > div.app-container > sm-common-experiments > div.experiment-body > as-split.as-horizontal.as-percent > as-split-area.as-split-area:nth-child(2) > sm-experiment-output > div.experiment-output-container.light-theme > sm-experiment-info-header > div.d-flex.align-items-center:nth-child(1) > div.d-flex.align-items-center:nth-child(2) > button.line-item._mat-animation-noopable:nth-child(4)' --out-dir ../ng-wiring/x-local/tmp
```

- URL: http://192.168.0.4:4200/projects/6c5385bf7f9644a8bb766c6800889811/tasks/57407833e0904c5c8af31f18d3a79152/output/execution
- Exit code: `5`
- Result: simple経路は effect、service、HTTP、JSONダウンロード、成功通知まで完成。レポート全体は検証対象外の関連gapを含むため `partial`
- Browser: `POST /service/1/api/v999.0/tasks.get_by_id_ex` → `200`、`Task exported successfully` を確認
- Output: `x-local/tmp/ngwi-07-ExperimentInfoHeaderComponent.data-id=exportTaskButton-260926.135102.md`

## A01 — Clone task dialog の Project 検索

### selector区切り不足

```bash
node ../ng-wiring/dist/cli/index.js \
  'formcontrolname=project' \
  --project stackup \
  --selector 'body > div.cdk-overlay-container mat-dialog-container sm-clone-dialog sm-paginated-entity-selector[formcontrolname="project"] mat-form-field input' \
  --out-dir ../ng-wiring/x-local/tmp
```

- URL: http://192.168.0.4:4200/projects/6c5385bf7f9644a8bb766c6800889811/tasks/57407833e0904c5c8af31f18d3a79152/output/execution
- Exit code: `3`
- Result: `--selector` は全階層を `>` で区切る必要があり、引数検証で終了
- Output: なし

### authored inputまで指定したselector

```bash
node ../ng-wiring/dist/cli/index.js \
  'formcontrolname=project' \
  --project stackup \
  --selector 'body > div.cdk-overlay-container:nth-of-type(2) > div.cdk-global-overlay-wrapper:nth-of-type(2) > div.cdk-overlay-pane.dialog-md > mat-dialog-container.mat-mdc-dialog-container.mdc-dialog > div.mat-mdc-dialog-inner-container.mdc-dialog__container > div.mat-mdc-dialog-surface.mdc-dialog__surface > sm-clone-dialog.mat-mdc-dialog-component-host > sm-dialog-template > div.dialog-template-container > div.generic-container:nth-of-type(2) > form > div.form-container > sm-paginated-entity-selector > mat-form-field.mat-mdc-form-field.mat-mdc-form-field-type-mat-input > div.mat-mdc-text-field-wrapper.mdc-text-field:nth-of-type(1) > div.mat-mdc-form-field-flex > div.mat-mdc-form-field-infix:nth-of-type(2) > input.mat-mdc-input-element.mat-mdc-autocomplete-trigger' \
  --out-dir ../ng-wiring/x-local/tmp
```

- URL: http://192.168.0.4:4200/projects/6c5385bf7f9644a8bb766c6800889811/tasks/57407833e0904c5c8af31f18d3a79152/output/execution
- Exit code: `5`
- Result: target属性はcustom component host側にあり、selector終端を内側inputにすると `Target detection incomplete`
- Output: なし

### selectorなしの候補確認

```bash
node ../ng-wiring/dist/cli/index.js \
  'formcontrolname=project' \
  --project stackup \
  --out-dir ../ng-wiring/x-local/tmp
```

- URL: http://192.168.0.4:4200/projects/6c5385bf7f9644a8bb766c6800889811/tasks/57407833e0904c5c8af31f18d3a79152/output/execution
- Exit code: `2`
- Result: 7候補を列挙。CloneDialogComponentは候補2の `unresolved-dynamic`
- Output: なし

### 最終検証

```bash
node ../ng-wiring/dist/cli/index.js \
  'formcontrolname=project' \
  --project stackup \
  --selector 'body > div.cdk-overlay-container:nth-of-type(2) > div.cdk-global-overlay-wrapper:nth-of-type(2) > div.cdk-overlay-pane.dialog-md > mat-dialog-container.mat-mdc-dialog-container.mdc-dialog > div.mat-mdc-dialog-inner-container.mdc-dialog__container > div.mat-mdc-dialog-surface.mdc-dialog__surface > sm-clone-dialog.mat-mdc-dialog-component-host > sm-dialog-template > div.dialog-template-container > div.generic-container:nth-of-type(2) > form > div.form-container > sm-paginated-entity-selector' \
  --out-dir ../ng-wiring/x-local/tmp
```

- URL: http://192.168.0.4:4200/projects/6c5385bf7f9644a8bb766c6800889811/tasks/57407833e0904c5c8af31f18d3a79152/output/execution
- Exit code: `5`
- Result: dialog表示と `getEntities → searchChanged()` までは検出したが、dispatch以降を通信経路へ結合できず「通信: この探索範囲では未検出」。分類は「通信経路の結合失敗」
- Browser: `Semi` 入力で `POST /service/1/api/v999.0/projects.get_all_ex` が2件発生し、ともに `200`。候補一覧更新を確認し、Cloneは実行せずCancel
- Console: error / warningなし
- Output: `x-local/tmp/ngwi-08-CloneDialogComponent.formcontrolname=project-260926.141717.md`

### 修正後確認

```bash
node ../ng-wiring/dist/cli/index.js \
  'formcontrolname=project' \
  --project stackup \
  --selector 'body > div.cdk-overlay-container:nth-of-type(2) > div.cdk-global-overlay-wrapper:nth-of-type(2) > div.cdk-overlay-pane.dialog-md > mat-dialog-container.mat-mdc-dialog-container.mdc-dialog > div.mat-mdc-dialog-inner-container.mdc-dialog__container > div.mat-mdc-dialog-surface.mdc-dialog__surface > sm-clone-dialog.mat-mdc-dialog-component-host > sm-dialog-template > div.dialog-template-container > div.generic-container:nth-of-type(2) > form > div.form-container > sm-paginated-entity-selector' \
  --out-dir ../ng-wiring/x-local/tmp
```

- URL: http://192.168.0.4:4200/projects/6c5385bf7f9644a8bb766c6800889811/tasks/57407833e0904c5c8af31f18d3a79152/output/execution
- Exit code: `5`
- Result: `getEntities → searchChanged() → getTablesFilterProjectsOptions dispatch → getTablesFilterProjectsOptions$ → getPaginatedAndSearchedAndSelectedProjects() → ApiProjectsService.projectsGetAllEx() → POST ${basePath}/projects.get_all_ex` を結合。simpleレポートはhelper内の3つの条件付きrequest siteを表示し、通信経路の結合失敗は解消した。レポート全体は検証対象外の関連gapを含むため `partial`
- Browser: `Semi` 入力で `POST /service/1/api/v999.0/projects.get_all_ex` が2件発生し、ともに `200`。request patternは `"Semi"` と `"^Semi$"`。Cloneは実行せずCancel
- Console: errorなし。今回の操作と無関係な `NG02956` preconnect warningが1件
- Output: `x-local/tmp/ngwi-17-CloneDialogComponent.formcontrolname=project-260926.143552.md`
