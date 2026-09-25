# P18 検索 input 実例の受け入れ

検証日: 2026-09-25。対象は `../000-learn-ClearML-pro` の `stackup` project。実アプリのソースはこのリポジトリに含めない。再現可能な縮小例は `test/fixtures/search-scenario`、検査は `test/p18-search.test.mjs` に置いた。

実アプリでは `data-id=searchInputField` を候補列挙し、`ExperimentInfoHyperParametersFormContainerComponent` を通る `/projects/:projectId/tasks/:experimentId/hyper-params/hyper-param/:hyperParamId` の候補を選択した。`--event input --json` で資料を生成し、次を確認した。

| 項目 | 実測した接続・条件 |
| --- | --- |
| P18-01 | `<input>` の input が `onValueChange` を選び、`value$.next` から生存中の `ngOnInit` subscription、`tap`、`debounce`、2 個の `filter`、`valueChanged.emit` へ続く。空値、親 `value()` との差異、`minimumChars()` の式は条件に残る。 |
| P18-02 | この使用箇所では `enableSearchOnSubmit` は無束縛で既定 `false`、`minimumChars=1`、`debounceTime=0`。`timer(0)` は timer 境界として記録され、同期呼び出しとは表示しない。 |
| P18-03 | `sm-search search-button` は `EditableSectionComponent` の `[search-button]` slot に投影される。`valueChanged` の式と入力束縛の宣言元はフォームコンテナ。 |
| P18-04 | `valueChanged` はフォームコンテナの `searchTable` に接続する。検索語が変わる条件下で `searchedText`、`scrollIndexCounter`、`searchResultsCount` を更新し、`resetIndex` を呼ぶ。同じハンドラの後続で `jumpToNextResult` を呼ぶ。 |
| P18-05 | `searchedText` の書き込みから子表の `[searchedText]` へ値が渡り、後の change detection で入力変更が記録された場合に `ngOnChanges` を実行する。その `searchedText` 分岐から `searchCounterChanged` と `scrollToResultCounterReset` を親のハンドラに届ける。即時ジャンプが新しい一致位置リストを使う保証はない。無関係な `formData` 分岐の `resetSearch` は含めない。 |
| P18-06 | `previousSearchResultButton` のアイコンに click listener はなく、親 button の `(click)="findNext(true)"` に伝播する。この呼び出しが `valueChanged` に渡す式は `null` と評価され、宣言型は `output<string>()`。実アプリの有効な `strictNullChecks` は `false` と記録され、型エラーとは断定しない。 |
| P18-07 | 選択 route の祖先をたどり、`SearchComponent`、投影先の `EditableSectionComponent`、フォームコンテナ、`AppComponent`、`AppRootComponent` を経て `src/main.ts` の bootstrap に達する。route・loader・投影・bootstrap の出典と条件を保持する。 |
| P18-08 | `input` 操作から `http-create` / `http-consume` は 0 件。検索と無関係な保存 API を含めない。Markdown の通信節は「この探索範囲で通信への接続は未検出」と coverage `partial`、停止理由、アプリ全体に通信がないとは言えない旨を併記する。 |

この実アプリの資料 status は `partial`。ngmaze の Program 外 omission を含む未検出範囲が残るため、静的に確認した接続を実行時の必然やアプリ全体の網羅性とは扱わない。縮小 fixture の検査は実アプリの解析結果と同じ種類の辺・条件を継続的に検査する。
