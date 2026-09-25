# キューダイアログの追跡停止と分岐表示

作成日: 2026-09-25

## 目的

`formcontrolname=name` からキューダイアログを解析したとき、ルートで登録された NgRx Effect と通信の経路を、根拠と実行条件を保って表示する。作成・更新の分岐を両方示し、未確定の表示コンテナや操作を確定扱いしない。

## 再現と現状

- 対象 workspace: `/home/mtrysd/work_2026/000-learn-ClearML-pro`
- 対象資料: `ngwi-CreateNewQueueFormComponent.formcontrolname=name-260925.205626.md`
- 対照資料: `ngwi-InlineEditComponent.data-id=nameField-260925.210008.md`
- 候補: `cand:fc6206bfacbd86ab22e04c854e183677303da35a48cf5b403e9e17599b6b6b81`
- 詳細確認コマンド（対象 workspace で実行）:

```bash
node /home/mtrysd/work_2026/ng-wiring/dist/cli/index.js 'formcontrolname=name' \
  --selector 'sm-queue-create-dialog > sm-dialog-template > sm-create-new-queue-form > form > mat-form-field > div.mat-mdc-form-field-infix' \
  --candidate 'cand:fc6206bfacbd86ab22e04c854e183677303da35a48cf5b403e9e17599b6b6b81' \
  --detail --out-dir /tmp/ngwi-queue-detail
```

詳細レポートには `QueueCreateDialogComponent.createQueue` の両 dispatch が存在する。条件は更新側が `if this.queue.id`、作成側が `else of this.queue.id`。それぞれの後に「この選択経路には route がなく、`provideEffects` の登録を確定できない」という boundary が続く。表示経路は `QueuesComponent` の `MatDialog.open` まで届くが、overlay の表示コンテナ未確定により `dynamic-boundary` で止まる。簡易レポートは更新側の dispatch だけを表示し、通信を「この探索範囲では未検出」とする。

## ソース上の期待経路

共通の入口は `create-new-queue-form.component.html` の入力と CREATE/UPDATE ボタン、`CreateNewQueueFormComponent.send()` による `queueCreated.emit(...)`、`queue-create-dialog.component.html` の `(queueCreated)="createQueue($event)"` である。`send()` はフォームが有効なときだけ emit する。入力値の変更だけでは送信されず、ボタンのクリックが別途必要になる。

| 条件 | dispatch | Effect | 通信 |
| --- | --- | --- | --- |
| `this.queue.id` が真（既存キュー） | `updateQueue` | `QueueCreateDialogEffects.updateQueue` | `ApiQueuesService.queuesUpdate` → `POST /queues.update` |
| `this.queue.id` が偽（新規キュー） | `createNewQueue` | `QueueCreateDialogEffects.createQueue` | `ApiQueuesService.queuesCreate` → `POST /queues.create` |

作成側の `createNewQueue` は `activeLoader` Effect にも届くが、これは通信を開始する Effect ではない。`QueueCreateDialogEffects` は `queue-create-dialog.providers.ts` の `provideEffects([QueueCreateDialogEffects])` で登録され、その provider 配列は `features/workers-and-queues/workers-and-queues.routes.ts` の `queues` ルートで使用される。`QueuesComponent` の `renameQueue()` と `addQueue()` は同じダイアログを開くため、呼び出し箇所も区別する。

## 原因

1. `src/resolve/view` の動的生成経路は `MatDialog.open` の表示コンテナを確定できず、候補に route 参照を付けない。
2. `src/assemble/report.ts` は表示経路上の route 参照だけを `storeInputsForSelection` に渡す。route がないため、`src/resolve/operation/store.ts` は route provider の Effect を登録済みと判定できない。
3. `src/resolve/operation/store-flow.ts` は未登録と見える Effect への接続を boundary に留める。通信経路はその先へ進まない。
4. `src/render/simple.ts` の `dataRows()` は `action-dispatch` を `find()` で一件だけ選ぶ。現状はソース順で先にある `updateQueue` だけが簡易表示に出る。作成側が不存在という意味ではない。

`--route` は既存候補を絞るだけで、route 参照のない候補へ実行文脈を追加しない。

## 対応方針

1. 動的ダイアログの**表示先**と、`MatDialog.open` を実行したコンポーネントの**ルート文脈**を分けて保持する。表示先が不明でも、呼び出し元が一意の route occurrence に結びつく場合、その route の provider を条件付きで解析する。複数 route・複数呼び出し元・不明な injector は混同せず、候補または boundary を残す。
2. route が有効な条件の下で、`updateQueue` と `createNewQueue` の双方から該当 Effect と HTTP まで接続する。`if` / `else`、フォーム有効性、output emit、route activation の条件を各枝に保持する。
3. 簡易表示は一件を黙って選ばず、作成・更新の両枝を条件とともに表示する。通信を確定できない枝では、単なる「未検出」に加えて停止理由を短く示す。詳細表示の境界情報は維持する。
4. 入力要素の値変更と送信ボタンのクリックは別操作として扱う。両者の因果関係を根拠なしに一本化しない。

## 期待する表示の要点

```text
queueCreated → createQueue($event)
├─ this.queue.id が真  → updateQueue    → updateQueue Effect → POST /queues.update
└─ this.queue.id が偽  → createNewQueue → createQueue Effect → POST /queues.create
```

この経路には `queueCreated` の emit、フォームの妥当性、対応する `queues` ルートの有効化が必要。`formcontrolname=name` の入力だけで通信すると表示してはならない。

## 完了条件

- 最小 fixture で、route provider を持つコンポーネントから開くダイアログの両枝が、条件付きで正しい Effect と HTTP に届く。
- 同じダイアログを別 route から開く場合、未登録 Effect、呼び出し元が曖昧な場合に、無関係な通信を確定しない。
- 詳細・簡易レポートで両 dispatch と各停止理由が整合する。`activeLoader` を通信 Effect と誤表示しない。
- 実アプリで資料を再生成し、作成・更新と `MatDialog.open` の両呼び出し箇所を確認する。
- `npm run build`、`npm test`、`npm run check:contracts`、`npm run check:dist` が通る。
