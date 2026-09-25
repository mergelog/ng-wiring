
欲しいのは以下のようなシンプルな追跡Mapです。
途中の divは不要
- --detailを追加。通常は simple版を出力するが、このオプションで現状のどでかい出力とする
- --belowData を追加。`:D` データ受け渡し以降のみ出力する

人間が読みコード追跡しやすいものを目指しているので
そこを踏まえて記載してください。

これ以外の情報は基本追加したくないですが提案あれば出してください（無理やり提案しなくていいです）

# nameField 追跡Map（サンプル）

出典: `ngwi-InlineEditComponent.data-id=nameField-260925.133738.md`

````md
# data-id=nameField 解析結果

- 解析信頼度: 98%

## nameField の 遷移

- 23. [▶️:B:V](src/main.ts#44) bootstrapApplication(AppRootComponent):44
- 22. [▶️:R:V](src/app/app.routes.ts#30) route / → AppComponent:30
- 21. [▶️:O:V](src/app/app.component.html#18) &lt;router-outlet class="main-router"&gt;:18
- 20. [▶️:R:V](src/app/webapp-common/experiments/experiment-routes.ts#45) route /projects/:projectId/tasks → ExperimentsComponent:45
- 19. [▶️:L:V](src/app/webapp-common/experiments/experiments.component.html#52) &lt;as-split&gt;（テーブル／情報パネルの2分割）:52
- 18. [▶️:L:C](src/app/webapp-common/experiments/experiments.component.html#120) &lt;as-split-area [visible]="minimizedView()"&gt;（右ペイン）:120
- 17. [▶️:O:V](src/app/webapp-common/experiments/experiments.component.html#126) &lt;router-outlet&gt;（右ペイン内）:126
- 16. [▶️:R:V](src/app/webapp-common/experiments/experiment-routes.ts#75) route /projects/:projectId/tasks/:experimentId → ExperimentOutputComponent:75
- 15. [▶️:h:V](src/app/features/experiments/containers/experiment-ouptut/experiment-output.component.html#6) &lt;sm-experiment-info-header&gt;:6
- 14. [▶️:h:V](src/app/webapp-common/experiments/dumb/experiment-info-header/experiment-info-header.component.html#8) &lt;sm-inline-edit [editable]="editable()"&gt;:8
- 13. [▶️:@:C](src/app/webapp-common/shared/ui-components/inputs/inline-edit/inline-edit.component.html#18) @if (editable()):18
- 12. [▶️:h:V](src/app/webapp-common/shared/ui-components/inputs/inline-edit/inline-edit.component.html#20) &lt;form #form&gt;（checkValidity() の判定元）:20
- 11. [▶️:@:C](src/app/webapp-common/shared/ui-components/inputs/inline-edit/inline-edit.component.html#21) @if (!multiline()):21
- 10. [▶️:h:V](src/app/webapp-common/shared/ui-components/inputs/inline-edit/inline-edit.component.html#22) &lt;input data-id="nameField" [(ngModel)]="inlineValue"&gt;:22
- 09. [▶️:h:D](src/app/webapp-common/shared/ui-components/inputs/inline-edit/inline-edit.component.html#34) (keydown.tab)/(keydown.enter) form.checkValidity() && InlineEditComponent.inlineSaved():34,36
- 08. [▶️:C:D](src/app/webapp-common/shared/ui-components/inputs/inline-edit/inline-edit.component.ts#94) this.textChanged.emit(this.inlineValue()):94
- 07. [▶️:h:D](src/app/webapp-common/experiments/dumb/experiment-info-header/experiment-info-header.component.html#14) ExperimentInfoHeaderComponent.onNameChanged($event):14
- 06. [▶️:C:D](src/app/webapp-common/experiments/dumb/experiment-info-header/experiment-info-header.component.ts#121) this.experimentNameChanged.emit(name):121
- 05. [▶️:h:D](src/app/features/experiments/containers/experiment-ouptut/experiment-output.component.html#13) ExperimentOutputComponent.updateExperimentName($event):13
- 04. [▶️:D:D](src/app/webapp-common/experiments/containers/experiment-ouptut/base-experiment-output.component.ts#179) this.store.dispatch(experimentDetailsUpdated({id: this.selectedExperiment().id, changes: {name}})):179
- 03. [▶️:E:D](src/app/webapp-common/experiments/effects/common-experiments-info.effects.ts#450) CommonExperimentsInfoEffects.updateExperimentDetails$（ofType(experimentDetailsUpdated)）:450
- 02. [▶️:E:D](src/app/webapp-common/experiments/effects/common-experiments-info.effects.ts#459) ApiTasksService.tasksUpdate({task: action.id, ...action.changes}):459
- 01. [▶️:S:A](src/app/business-logic/api-services/tasks.service.ts#2186) POST ${basePath}/tasks.update:2186

## 凡例

1個目（種別）

- `:h` html
- `:C` コンポーネントクラスts
- `:D` ディスパッチ（コンポーネントより強い）
- `:E` エフェクト
- `:S` サービス
- `:R` ルート定義
- `:O` router-outlet（配置先）
- `:@` 制御フロー（@if / @switch / @for）
- `:L` 外部ライブラリ部品（angular-split 等）
- `:B` bootstrap
- `:?` 上記以外

2個目（関係）

- `:D` データ受け渡し
- `:A` API通信
- `:V` 表示配置（描画ツリーの組み立て。データは流れない）
- `:C` 条件分岐（表示の可否を決める）
- `:-` 何もなし

## selector path

- body
- sm-root
- sm-app-shell
- div
- div
- sm-common-experiments
- div
- as-split
- as-split-area:nth-child(2)
- sm-experiment-output
- div
- sm-experiment-info-header
- div.d-flex.align-items-center
- div.d-flex.align-items-center.experiment-name-cont
- sm-inline-edit
- div
- div.input
- form
- input

## exec command

npx github:mergelog/ng-wiring 'data-id=nameField' --project stackup   --selector 'body > s
m-root > sm-app-shell > div > div > sm-common-experiments > div > as-split > as-split-area:nth-child(2) > sm-experiment-output > div > sm-e
xperiment-info-header > div.d-flex.align-items-center > div.d-flex.align-items-center.experiment-name-cont > sm-inline-edit > div > div.inp
ut > form > input'

````
