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
