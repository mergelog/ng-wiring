# MatDialog の close 結果から HTTP までの処理経路

作成日: 2026-09-26
状態: **対応済み**（2026-09-26）

## 目的

ダイアログ内のユーザー操作から `MatDialogRef.close(result)` を経て、呼び出し元の `afterClosed()` 購読、NgRx dispatch、Effect、HTTP 要求まで、根拠と条件を保って追跡できるようにする。

## 再現と現状

- 対象 workspace: `/home/mtrysd/work_2026/000-learn-ClearML-pro`
- project: `stackup`（application）
- 入力欄のレポート: `ngwi-02-CreateExperimentDialogComponent.data-id=taskNameField-260926.193402.md`
- SAVE AS DRAFT ボタンのレポート: `ngwi-01-CreateExperimentDialogComponent.button-L352-2db261c1588f-260926.194728.md`
- ボタン起点: `--source src/app/webapp-common/experiments/containers/create-experiment-dialog/create-experiment-dialog.component.html:352 --event click --detail`
- ボタン候補は1件。`click` リスナー `close('save')` は検出され、click coverage は `complete-within-scope`。通信は未検出で、confidence は unresolved。
- 詳細レポートは `CreateExperimentDialogComponent.close()` の `this.dialog.close(...)` で外部パッケージ型 `MatDialogRef` の境界に停止する。
- 表示経路は `saveButton` の `TemplateRef` が挿入されたことを確定できず、`fragment-uninstantiated` で終了する。これは表示位置の問題であり、close 結果から呼び出し元へ戻るデータ／処理経路とは分けて扱う。

## ソース上の期待経路

| 段階 | ソース上の処理 |
| --- | --- |
| 起点 | `create-experiment-dialog.component.html:354` `(click)="close('save')"` |
| 結果生成 | `create-experiment-dialog.component.ts:259-274` `close(action)` が `codeFormGroup.value` 等を含む値を `this.dialog.close(...)` に渡す |
| ダイアログ呼び出し元 | `experiments.component.ts:781-787` が `MatDialog.open(CreateExperimentDialogComponent)` の `afterClosed()` を購読し、値が truthy の場合 `createExperiment` を dispatch する |
| HTTP 処理 | `common-experiments-view.effects.ts:868-912` の `createExperiment` Effect が `apiTasks.tasksCreate(...)` を呼ぶ |

したがって、SAVE AS DRAFT のクリックからタスク作成 API まで静的な接続がある。入力欄の編集自体は別操作であり、入力欄を起点にした場合も、入力イベントから保存ボタンのクリックを直接導出しない。

## 原因

操作解析は選択要素のイベントハンドラーから追跡を開始する。ダイアログ内の `close()` までは追跡するが、`MatDialogRef.close(result)` を介した結果の返却と、別コンポーネントにある `afterClosed()` の Observable 購読を対応付けない。そのため、購読コールバック内の dispatch と、それに続く Effect / HTTP が選択操作の scope に入らない。

現状レポートは「アプリに通信がない」とは述べていないが、このコードで確認済みの因果経路を表示できていない。レポートの coverage / confidence に加え、close 結果と afterClosed 購読を調査対象とする必要がある。

## 対応方針

1. **設計の妥当性を再確認して作業すること。** 着手前に現在の操作モデル、Observable / callback の伝播規則、DI と `MatDialogRef` の照合方法、report の scope / 条件表現を読み直し、ダイアログ結果をイベント／値伝播のどの意味として表すのが妥当か決める。既存の境界モデルで表現できるかも先に確認し、以下の実装案を前提として固定しない。
2. `MatDialog.open(Component)` の呼び出し箇所、開いた component 型、対応する `MatDialogRef<Component, Result>` の close 呼び出しを根拠付きで対応付ける。外部ライブラリー内部の実装は解析対象にせず、Angular Material の公開 API 契約を限定的な意味ルールとして扱う。
3. その open 呼び出しから返る `afterClosed()` の Observable と、その subscribe コールバック引数を結果値へ接続する。`pipe` 内の `filter` 等は通過条件として保持し、複数の open 箇所・close 箇所・購読を混同しない。
4. 結果値が callback 内の `createExperiment` dispatch に渡った後は、既存の NgRx / HTTP 解析につなぐ。表示経路の `NgTemplateOutlet` が未確定でも、操作と結果の根拠が揃う場合は処理経路を独立に報告できるようにする。
5. open 元、dialog 型、close 対象、afterClosed 購読の一意な対応を証明できない場合は HTTP を推測で接続せず、該当する境界と理由を残す。
6. 簡易レポートと詳細レポートの双方で、通信検出、条件、停止理由が同じ意味を表すようにする。クリックから後続処理を追えない場合にも、境界位置を「通信未検出」だけに隠さない。

## 検証項目

- 最小 fixture で、ダイアログ内 click → `close(result)` → 呼び出し元 `afterClosed()` → callback → dispatch → Effect → HTTP の経路と各根拠位置を確認する。
- `afterClosed()` が truthy result のみ通す条件や、close が呼ばれない経路を保持する。
- 同じ dialog 型を複数箇所から開く、複数購読がある、別の `MatDialogRef` を close するケースで誤接続しない。
- 無関係なダイアログ、無関係な HTTP、入力欄の編集のみからの HTTP を報告しない。
- `ngTemplateOutlet` の配置不明を理由に、確定済み操作経路まで失わない。表示経路側の未解決理由は引き続き明示する。
- 実アプリで SAVE AS DRAFT 起点のレポートを再生成し、`tasksCreate` までの経路、条件、confidence、coverage をソースと照合する。

## 完了条件

- SAVE AS DRAFT の click 起点で、`close(result)` から `afterClosed()`、`createExperiment` dispatch、Effect、HTTP 要求までの経路が表示される。
- 各辺に追跡可能なソース根拠と、`filter` 等の条件が記録される。
- 一意に結び付けられない場合は誤った HTTP 経路を作らず、理由付き boundary を表示する。
- 入力欄から保存ボタンへの未確認の因果関係を追加しない。
- 最小 fixture と実アプリの照合を行い、関連する build / test / contract / dist checks を実行して結果を記録する。

## 対応結果

- `MatDialog.open(Component)` の型付き呼び出しを探索し、選択された dialog 型と caller を照合する。view 配置が未解決でも、caller と結果購読が確認できる場合は操作経路を独立して追跡する。
- `MatDialogRef.close(result)` から一意な `afterClosed()` 購読へ結果を接続し、RxJS `filter` 条件を callback / dispatch / Effect / HTTP の条件として保持する。購読を一意に特定できない場合は接続を止め、boundary を記録する。
- 簡易レポートと詳細レポートは同一の経路モデルを使用する。SAVE AS DRAFT の `click` から `createExperiment` dispatch、Effect、`POST .../tasks.create` を確認した。`filter(res => !!res)` も条件に記録される。
- 表示経路は引き続き `fragment-uninstantiated`（`saveButton` の `NgTemplateOutlet` 配置未確定）で partial として表示する。click の coverage は `complete-within-scope`。入力欄の編集からボタンクリックへの因果関係は追加していない。
- 実アプリで `--source src/app/webapp-common/experiments/containers/create-experiment-dialog/create-experiment-dialog.component.html:352 --project stackup --event click` を指定して簡易 JSON と詳細 Markdown を再生成し、ソースと照合した。
- 検証: `npm run build` 成功、`npm test` 251 件成功、`npm run typecheck` 成功、`npm run check:contracts` 110 件成功、`npm run check:dist` 成功。
- 実装 commit: `b714d39`（`Trace MatDialog results through afterClosed`）。
