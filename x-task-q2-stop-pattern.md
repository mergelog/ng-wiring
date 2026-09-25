# 表示・操作の追跡停止パターン: 追加調査

作成日: 2026-09-25

## 対象と判定

対象 workspace: `/home/mtrysd/work_2026/000-learn-ClearML-pro`。`ng-wiring` の現行 `dist` を使い、Angular Material ダイアログ内の操作を3ケース解析した。3件とも詳細レポートは `partial`、表示経路は `dynamic-boundary`、route は「なし」で、期待される通信を表示できなかった。これはアプリの通信失敗を意味しない。以下のソース経路とレポートの差が、解析上の問題である。

再現コマンド（対象 workspace で実行）:

```bash
node /home/mtrysd/work_2026/ng-wiring/dist/cli/index.js 'data-id=Create Project' --detail --out-dir /tmp/ngwi-material-audit/project-create
node /home/mtrysd/work_2026/ng-wiring/dist/cli/index.js 'data-id=MoveButton' --candidate 'cand:147f4784f3feb47dfb5f7858b6e40efa53c1ce270db5a8c12154f87fbd5e880b' --detail --out-dir /tmp/ngwi-material-audit/project-move
node /home/mtrysd/work_2026/ng-wiring/dist/cli/index.js 'data-id=EnqueueButton' --detail --out-dir /tmp/ngwi-material-audit/enqueue
```

`MoveButton` は同名属性が2箇所にあり、上記候補は `ProjectDialogComponent` 内の `ProjectMoveToFormComponent`。候補 ID は対象 snapshot が変われば再取得する。

| ケース | ソース上の経路 | 詳細レポートの結果 |
| --- | --- | --- |
| プロジェクト作成 | `CreateNewProjectFormComponent.send()` → `projectCreated` → `ProjectDialogComponent.createProject()` → `createNewProject` → `ProjectDialogEffects.createProject` → `ApiProjectsService.projectsCreate` → `POST /projects.create` | dispatch は出るが、route injector を確定できず Effect で停止。通信は未検出。 |
| プロジェクト移動 | `ProjectMoveToFormComponent.send()` → `moveProject` output → `ProjectDialogComponent.moveProject()` → `moveProject` action → `ProjectDialogEffects.moveProject` → `ApiProjectsService.projectsMove` → `POST /projects.move` | dispatch は出るが、同様に Effect で停止。通信は未検出。 |
| キュー選択後の実行 | `SelectQueueComponent.closeDialog(true)` → `MatDialogRef.close` → 呼び出し元の `afterClosed()` → `enqueueClicked` または `moveExperimentToOtherQueue` → 各 Effect → 通信 | ボタンの click は出るが、`afterClosed()` 以降と通信は未検出。 |

## 根拠と条件

### 1. プロジェクト作成

- 入力と CREATE PROJECT ボタンは `src/app/webapp-common/shared/project-dialog/create-new-project-form/create-new-project-form.component.html:78`。ボタンはフォームが無効なら disabled。クリックで `send()` が output を emit する。
- `src/app/webapp-common/shared/project-dialog/project-dialog.component.html:7` が output を `createProject($event)` に接続し、同 component の `createProject()` が action を dispatch する。
- `ProjectDialogEffects` は `project-dialog.providers.ts` で登録され、`features/dashboard/dashboard.routes.ts` と `features/projects/projects.routes.ts` の両方がこの provider を使用する。ダイアログを開く箇所も `DashboardProjectsComponent:71` と `ProjectsPageComponent:355` の2箇所。
- レポートの `dynamic-call-site` は両方を検出しているが、`dynamic-route-context` が「一意の route injector を確認できない」とし、`createProject` Effect への接続を止める。両 route が同じ Effect を登録する事実を、呼び出し元ごとの条件として表せていない。

### 2. プロジェクト移動

- `src/app/webapp-common/shared/project-dialog/project-move-to-form/project-move-to-form.component.html:55` の MOVE ボタンは disabled 条件を持つ。`send()` の output が `project-dialog.component.html:14` の `moveProject($event)` に届き、`ProjectDialogComponent.moveProject()` が action を dispatch する。
- `ProjectDialogEffects.moveProject` は `ApiProjectsService.projectsMove` を呼ぶ。レポートは dispatch を示すが、Effect と通信は route injector 未確定で停止する。
- さらに候補の表示経路には `DashboardProjectsComponent:71` が含まれるが、その呼び出しは `data.mode: 'create'` 固定。MOVE フォームは `project-dialog.component.html:10` の `mode === 'move'` でのみ表示されるため、この呼び出し元から MOVE ボタンを表示する経路は実行不能。`ProjectsPageComponent:355` は `mode` を引数として渡すため、ここを条件付きの実行可能な呼び出し元として扱う必要がある。

### 3. ENQUEUE ボタン

- `src/app/webapp-common/experiments/shared/components/select-queue/select-queue.component.html:75` はキュー選択とフォームの妥当性を満たしたときに押せ、`closeDialog(true)` は `{confirmed, queue}` を返してダイアログを閉じる。
- `ExperimentMenuComponent:205` から開いた場合、`afterClosed()` は `confirmed` を確認して `enqueueClicked` を dispatch する。`CommonExperimentsMenuEffects.enqueueExperiment$` が `ApiTasksService.tasksEnqueueMany` を呼ぶ。
- `QueueInfoComponent:135` から開いた場合、`afterClosed()` は output を emit し、`QueuesComponent.moveExperimentToOtherQueue()` が action を dispatch する。`QueuesEffects.moveExperimentToOtherQueue` は `ApiQueuesService.queuesMoveTaskToQueue` を呼ぶ。2つの通信を無条件に一本化してはならない。
- レポートは両 `MatDialog.open` 呼び出し箇所を `dynamic-call-site` として検出するが、クリックから `afterClosed()` への結果配送を接続できず、通信を「未検出」とする。

## 原因の見立てと対応方針

`src/index/candidates.ts` は同じ候補に属する動的呼び出し元を集約する。`src/assemble/report.ts` の `callerRoute` は、全呼び出し元が同じ一つの route occurrence に結びつく場合だけ採用する。このため、作成・移動のように複数 route が同一 Effect を提供していても、個別の route 条件を保持して先へ進めない。表示先の `dynamic-boundary` は維持しつつ、呼び出し元と route ごとに別枝として provider を解析する必要がある。

`MatDialogRef.close(value)` と、その `MatDialog.open` から得た ref の `afterClosed()` を同一インスタンスで対応付ける。結果の `confirmed` 条件を維持し、ENQUEUE とキュー移動の呼び出し元を混ぜない。プロジェクト移動では `MatDialog.open` の `data.mode` とテンプレートの `@if` 条件を照合し、実行不能な Dashboard 側の枝を候補から除くか、明示的に実行不能とする。

完了確認は、上記3件の実アプリ再解析に加え、複数呼び出し元・同一 provider、異なる provider、`mode` 固定の実行不能枝、`afterClosed()` の戻り値分岐を最小 fixture で検証する。

## 追加確認: PrimeNG `p-table` のテンプレートが表示経路で停止する

Angular Material ダイアログとは別の、実アプリで再現する追跡停止。対象 workspace と `dist` は上記と同じ。次を対象 workspace で実行した。

```bash
node /home/mtrysd/work_2026/ng-wiring/dist/cli/index.js 'data-id=tableHeader' --detail --out-dir /tmp/ngwi-primeng-audit/table-header
node /home/mtrysd/work_2026/ng-wiring/dist/cli/index.js 'data-id=3DotMenuButton' --detail --out-dir /tmp/ngwi-q2-audit/prime-body
```

| ケース | ソース上の表示条件と挿入先 | 詳細レポートの結果 |
| --- | --- | --- |
| テーブル見出し | `shared/ui-components/data/table/table.component.html:55` の `<ng-template #header>` は `<p-table>` に渡される。`!noHeader()` などの条件下で `data-id=tableHeader` を表示する。 | 候補は `uninstantiated-fragment`、表示経路は `fragment-uninstantiated`、route は「なし」。`TemplateRef header has no confirmed insertion` で停止。 |
| 行内のメニューボタン | 同 HTML の `:124` にある `<ng-template #body>` は `<p-table>` に渡される。行データがあり、`rowRightClick.observed && !minimizedView()` 等の条件下で `data-id=3DotMenuButton` を表示する。 | 同様に `TemplateRef body has no confirmed insertion` で停止。 |

これは「テンプレートが実際に表示されない」というアプリ側の判定ではない。対象アプリの PrimeNG 22.1.x の実装は `p-table` の `header` と `body` を `contentChild` で受け取り、`headerTemplate()` を `NgTemplateOutlet` に、`bodyTemplate()` をテーブル本体へ渡す。一方、`src/resolve/view/index.ts` の挿入先探索は、同一 owner の `ngTemplateOutlet`、アプリ内 child の input を介した `ngTemplateOutlet`、`ViewContainerRef.createEmbeddedView` を確認するが、外部コンポーネントが名前付き `TemplateRef` を取得する経路は接続しない。そのため表示可能な PrimeNG の内容を未生成と判定している。

対応時は、外部コンポーネントのテンプレート受け口を型・パッケージ・対象 slot に基づいて確認し、宣言元と表示先、`let-` 変数の context、表示条件を保持する。名前が似た `ng-template` を無条件に表示済みとして扱わない。完了確認には `#header` と `#body` の最小 fixture と上記2件の再解析を追加し、未使用の `ng-template` は従来どおり `fragment-uninstantiated` になることも検証する。

## 追加確認: アプリ内の構造ディレクティブで停止枝と条件欠落枝が並立する

`src/app/webapp-common/layout/header-navbar-tabs/header-navbar-tabs.component.html:8` の `<mat-tab *smCheckPermission="route.permissionCheck">` を調べた。`src/app/shared/directives/check-permission.directive.ts:37-45` の `CheckPermissionDirective` は権限条件が成立すると `ViewContainerRef.createEmbeddedView(this.templateRef)` でそのビューを作る。したがって `smCheckPermission` の条件は表示経路に必要である。

```bash
node /home/mtrysd/work_2026/ng-wiring/dist/cli/index.js --source 'src/app/webapp-common/layout/header-navbar-tabs/header-navbar-tabs.component.html:8' --out-dir /tmp/ngwi-q2-audit/custom-structural-mat-tab
```

現行レポートは同じ `<mat-tab>` に候補を2件作る。一方は `Custom structural directive insertion is unresolved` で `fragment-uninstantiated` に停止する。他方は `bootstrap` まで到達し、表示経路を `complete-within-scope` とするが、`smCheckPermission` の許可条件も `createEmbeddedView` も経路に示さない。未解決として止める枝と、条件を飛ばして完結扱いにする枝が同居する点が不具合である。`src/resolve/view/index.ts` は既知の構造ディレクティブを固定の名前リストで判定しており、アプリ内のディレクティブ実装を確認しない。

対応時は、構造ディレクティブの `TemplateRef` と `ViewContainerRef.createEmbeddedView` の対応、および許可・else 条件を確認できる範囲で枝に結びつける。確認できない場合は全枝を未解決として扱い、別の候補が構造ディレクティブを迂回して完結扱いにならないようにする。最小 fixture では許可、拒否、else、挿入しないディレクティブを区別して検証する。

## 追加確認: CDK Portal の DOM 移動先を表示上の親に反映しない

`src/app/webapp-common/experiments-compare/containers/experiment-compare-details/experiment-compare-details.component.html:115-133` の `data-id=previousDiffButton` は `<sm-portal outletId="nextDiff">` 内に宣言される。`src/app/webapp-common/shared/portal/portal.component.ts:31-37` は `CdkPortal` を `DomPortalOutlet` に attach し、移動先は `experiment-compare-header.component.html:84` の `<div id="nextDiff">` である。

```bash
node /home/mtrysd/work_2026/ng-wiring/dist/cli/index.js 'data-id=previousDiffButton' --candidate 'cand:6fb7ee09bdb3a8f6971e94b9aa4bc5b8fe1cfd1c230538f8d3ce92e2d700e009' --detail --out-dir /tmp/ngwi-q2-audit/cdk-portal-selected
```

候補 ID は対象 snapshot が変われば再取得する。現行レポートは表示経路を `bootstrap` まで `complete-within-scope` とし、ボタンの表示上の親を `PortalComponent`、さらにその親を元の比較画面側として確定する。実際の DOM 配置先である `#nextDiff` と `DomPortalOutlet.attach()` は経路に出ない。宣言元・DI の文脈と DOM の表示先を混同しない形で、Portal の挿入先を追跡するか、未解決の表示境界として示す必要がある。完了確認には、宣言元と DOM 移動先が異なる最小 fixture とこの実アプリの再解析を加える。
