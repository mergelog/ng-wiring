# 引き継ぎ: Q2 追跡停止パターン

2026-09-25。依頼は `x-task-q2-stop-pattern.md` への対応。ユーザーの「再解析入る前に一旦停止」に従って作業を止め、`ho` でこのファイルを作成した後、ユーザーの「作業再開」指示を受けて再開・完了した。**対応は完了済み。以下は完了時点の記録。**

## 現在の状態: 完了

- `structuralInsertion()` の `else` 分岐を、明示的な `<ng-template #ref>` 解決ロジックに接続する残作業を完了。`npm run build` / `npm run typecheck` / `npm test`（236/236）すべて成功し、`dist` は `src` と同期済み。
- 実装・テストを commit し、`origin/main` に push 済み（`aad4c11`: "Wire the else-branch of custom structural directives into view resolution"）。作業ごとに commit / push するローカル指示に従った。
- `x-task-q2-stop-pattern.md` に「対応状況（2026-09-25 追記）」を追記し、6件の実アプリ再解析結果を記録した。詳細はそちらを参照。

## 完了した実装範囲

- 複数のダイアログ呼び出し元 route で同じ provider を使う場合、その共通 provider を追跡。provider が異なる枝は混同しない。`data.mode` 固定値とテンプレートの `mode === ...` が矛盾する呼び出し元を除外。
- `MatDialogRef.close({confirmed: true})` と、同じ `open()` の参照から得た `afterClosed().subscribe()` を対応付け、呼び出し元ごとに NgRx / HTTP を解析。NgRx `createActionGroup` も対応。
- PrimeNG `p-table` の型・selector・query metadata で確認できた `#header` / `#body` を表示経路へ接続。未使用 `ng-template` は未生成のまま。
- アプリ内構造ディレクティブの自身の `TemplateRef` に対する `ViewContainerRef.createEmbeddedView` を確認して表示条件へ反映。CDK Portal は元の親への到達を確定せず、`DomPortalOutlet.attach → #outletId` の表示境界を記録。
- （今回追加）構造ディレクティブの `else` 枝: `*dir="cond; else ref"` の `ref` を参照するホスト要素を検索し、`${selector}Else` の set accessor と `createEmbeddedView` 呼び出しを検証してから表示経路に接続。未接続・未確認の else 入力は従来どおり `fragment-uninstantiated` のまま。
- `test/queue-dialog-route.test.mjs` に共通 / 異なる provider、固定 `mode`、確認 / 取消結果を追加。`test/view.test.mjs` に PrimeNG、構造ディレクティブ（`permitted`/`never`）、else 分岐（`permitWithElse`/`neverElse`）、Portal の最小 fixture を追加。

## 完了確認

- `npm run build` / `npm run typecheck` / `npm test`（236/236）すべて成功。
- 実アプリ（`/home/mtrysd/work_2026/000-learn-ClearML-pro`）で `x-task-q2-stop-pattern.md` 記載の6件を再解析し、すべて期待通りの結果を確認（詳細は同ファイルの「対応状況」節）。
- else 分岐は単体テストの fixture（`permitWithElse` / `neverElse`）でのみ検証。実アプリ内で該当パターン（`*dir="cond; else ref"` 形式のアプリ内カスタム構造ディレクティブ）を探索・再解析することはしていない — ユーザーから「ClearML実装全網羅は無理」「焦点を定めて進める」旨の指示があったため、範囲を単体テストでの検証にとどめた。

## 残作業: なし

現時点で追加の再開作業はない。新しい停止パターンが見つかった場合は、都度このファイルを更新して引き継ぐこと。
