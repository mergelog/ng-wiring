# 引き継ぎ: Q2 追跡停止パターン

2026-09-25。依頼は `x-task-q2-stop-pattern.md` への対応。ユーザーの「再解析入る前に一旦停止」に従って作業を止め、その後 `ho` によりこのファイルを作成した。**ここから実アプリの再解析を再開する前にユーザーの指示を確認すること。**

## 現在の状態

- `main` 上に実装とテストの未コミット変更がある。`src/` 5 ファイル、`test/` 2 ファイル、生成済み `dist/` 6 ファイル。ユーザーの停止指示後は再解析・ビルド・テストを実行していない。
- 最後に `src/resolve/view/index.ts` の `structuralInsertion()` に `else` 枝の調査を追加したが、呼び出し元との接続・fixture・ビルド検証が未完了。`dist/resolve/view/index.js` はこの最後の変更を含まず、ソースと不一致。
- この実装全体はまだコミット・プッシュしていない。ローカル指示は作業ごとに commit / push を要求する。

## 実装済みの範囲

- 複数のダイアログ呼び出し元 route で同じ provider を使う場合、その共通 provider を追跡。provider が異なる枝は混同しない。`data.mode` 固定値とテンプレートの `mode === ...` が矛盾する呼び出し元を除外。
- `MatDialogRef.close({confirmed: true})` と、同じ `open()` の参照から得た `afterClosed().subscribe()` を対応付け、呼び出し元ごとに NgRx / HTTP を解析。NgRx `createActionGroup` も対応。
- PrimeNG `p-table` の型・selector・query metadata で確認できた `#header` / `#body` を表示経路へ接続。未使用 `ng-template` は未生成のまま。
- アプリ内構造ディレクティブの自身の `TemplateRef` に対する `ViewContainerRef.createEmbeddedView` を確認して表示条件へ反映。CDK Portal は元の親への到達を確定せず、`DomPortalOutlet.attach → #outletId` の表示境界を記録。
- `test/queue-dialog-route.test.mjs` に共通 / 異なる provider、固定 `mode`、確認 / 取消結果を追加。`test/view.test.mjs` に PrimeNG、構造ディレクティブ、Portal の最小 fixture を追加。

## 停止前の検証

- `npm run build` と `npm run typecheck` は、最後の `else` 変更より前に成功。
- 停止前の `npm test` は 236 件中 235 件成功。`matchingElements()` の変更で `@for` 既存テストが 1 件失敗したが、その後修正し、`node --test test/control-flow.test.mjs test/view.test.mjs test/queue-dialog-route.test.mjs` は 10 件全て成功。**全体の `npm test` は修正後に再実行していない。**
- 停止前の実アプリ解析では、作成 `projects.create`、移動 `projects.move`、ENQUEUE の `tasks.enqueue_many` と `queues.move_task_to_queue` を条件付き通信として検出。移動の Dashboard 側 `mode: 'create'` 枝は除外された。
- PrimeNG `tableHeader` と `3DotMenuButton` は `bootstrap` まで表示経路が進んだ。Portal の `previousDiffButton` は `#nextDiff` の未確定表示境界で止まった。構造ディレクティブでは `smCheckPermission: allowed` と挿入呼び出しを経路で確認した。
- 実アプリ解析の一時結果は `/tmp/ngwi-q2-new-create2`、`/tmp/ngwi-q2-new-move`、`/tmp/ngwi-q2-new-enqueue4`、`/tmp/ngwi-q2-new-header2`、`/tmp/ngwi-q2-new-body2`、`/tmp/ngwi-q2-new-portal2` にある。

## 再開時の作業

1. `structuralInsertion()` の最後の `else` 変更を完成または整理する。別の `ng-template #else` と構造ディレクティブの `*...="...; else ..."`、許可・拒否・挿入なしの fixture を追加し、誤って表示済みにしないことを確認する。
2. `npm run build`、`npm run typecheck`、`npm test` を実行し、`dist` を同期する。最後の `else` 変更にはビルド未確認の箇所がある。
3. 実アプリの**再解析**はユーザーの再開指示を受けてから行う。対象と再現手順は `x-task-q2-stop-pattern.md` に記載。
4. 差分・結果を確認後、実装を commit / push する。
