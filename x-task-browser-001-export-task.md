# Browser verification 001: exportTaskButton

## 参照資料

共通の目的、実行方法、出力先、履歴の記録方法は[x-browser-based-verification-procedure.md](x-browser-based-verification-procedure.md)に従う。

このファイルは一回の作業範囲を限定するためのタスク資料である。共通手順書にある別UIの探索や継続的な検証まで実行しない。

## 目的

`data-id="exportTaskButton"`を起点とする正常系が、ngwiのsimple版でaction dispatchからeffect、HTTP、JSONダウンロード、成功通知まで一本の経路として表示されるようにする。

現在はaction dispatchの直後で次のように停止する。

```text
this.store.dispatch(exportTaskInfo({taskId: task.id}))
→ 停止: 通信への接続を確認できない
```

ソース上には通信とその後の正常処理が存在するため、この表示を解消する。

## 対象UI

- 画面: Experiment details
- UI: Export task informationボタン
- ターゲット: `data-id=exportTaskButton`
- Angularプロジェクト: `stackup`
- 検証対象プロジェクト: `../000-learn-ClearML-pro`
- 一時出力先: `x-local/tmp`

ブラウザから取得済みのコンポーネント経路:

```text
body
> sm-root
> sm-app-shell
> sm-common-experiments
> as-split
> as-split-area:nth-child(2)
> sm-experiment-output
> sm-experiment-info-header
> button
```

## 期待する正常系

```text
click
→ ExperimentInfoHeaderComponent.exportTaskInfo()
→ exportTaskInfo action
→ CommonExperimentsInfoEffects.exportTaskInfo$
→ ApiTasksService.tasksGetByIdEx()
→ POST ${basePath}/tasks.get_by_id_ex
→ downloadObjectAsJson()
→ addMessage('success', 'Task exported successfully')
```

HTTP要求は通信上の重要地点として表示する。正常応答後のJSONダウンロードと成功通知も、この操作の意味がある結果として表示する。

## 作業範囲

- simple rendererがaction dispatchと`action-consume`を対応付ける処理
- `exportTaskInfo$`と`tasksGetByIdEx()`の対応付け
- service callと`http-create`の対応付け
- HTTP後の正常系にある`downloadObjectAsJson()`と`addMessage('success', ...)`の表示
- 必要なモデル・assemble処理の修正
- この経路を再現する自動テスト
- 実際のClearML画面とsimpleレポートの再確認

## 対象外

- task不在、例外、HTTP失敗などの分岐をsimple版へ追加すること
- `requestFailed`やerror通知を主経路へ追加すること
- 成功通知から通知UI内部の共通処理をさらに追跡すること
- `exportTaskButton`以外のUIを修正すること
- 新しい検証対象を探索すること
- このタスクに必要のない汎用的な解析機能の拡張

別の不具合や改善候補を発見した場合は、最終報告に記載するだけにとどめ、このタスク内では修正しない。

## 実施手順

1. 現在のsimpleレポートを`x-local/tmp`へ再生成し、再現を確認する。
2. report model内の`action-dispatch`、`action-consume`、`call`、`http-create`とconditionを確認する。
3. simple版がどの対応判定で経路を失っているかを特定する。
4. 正常系を一本だけ結合する最小限の修正を行う。
5. 正常系と通信なしケースを区別できるテストを追加または更新する。
6. 関連テストを実行する。
7. ngwiをsimple版で再実行する。`--detail`、`--details`、`--json`は使用しない。
8. Chrome DevTools MCPでボタン操作時のNetwork requestを確認し、methodとendpointを照合する。
9. 終了コードに従い、コマンドを`x-his-success.md`または`x-his-fail.md`へ記録する。
10. 変更をcommit・pushし、結果を報告して終了する。

## 完了条件

- simpleレポートに`exportTaskInfo$`が表示される。
- simpleレポートに`ApiTasksService.tasksGetByIdEx()`が表示される。
- simpleレポートに`POST ${basePath}/tasks.get_by_id_ex`が表示される。
- simpleレポートに正常応答後の`downloadObjectAsJson()`が表示される。
- simpleレポートに`addMessage('success', ...)`が正常系の終点として表示される。
- dispatch直後の「通信への接続を確認できない」が表示されない。
- task不在、例外、HTTP失敗などの分岐が主経路へ展開されない。
- 既存の通信なしケースが誤ってHTTP経路へ接続されない。
- 関連する自動テストが成功する。
- ブラウザで観測したNetwork requestとsimpleレポートのmethod・endpointが一致する。
- 実行コマンドと結果が成功・失敗履歴へ記録される。

## 停止条件

完了条件を満たしたら、別のUIや次の検証対象を探索せず、このタスクを終了する。

完了条件を満たせない場合も、原因、試した内容、残っている問題を報告し、このタスクの範囲を越えて作業を継続しない。
