# リアクティブ解析の残作業

元の28件の契約タスクは [_old/x-task-reactive-contract-gaps.md](_old/x-task-reactive-contract-gaps.md) に保存した。`npm run check:contracts` は110/110件合格済み。以下はそのタスクの優先度表と追加確認から残る、台帳の合格範囲外の作業だけを記す。

## シンプル出力で表示値を追う

- [ ] 選択した操作による state write から、`computed` / `linkedSignal` / `withComputed` / `withLinkedState` / `deepComputed` の派生を経て、表示要素の state read までを短い行で示す。再計算と明示 write の条件を区別する。
- [ ] `signal-store-apis` の `data-id=setTermButton` と `data-id=pageButton`、既存の Angular `computed` / `linkedSignal` fixture で、モデルの該当辺と simple 出力を照合する。直接の deep mutation を通知として表示しない。

確認時点では `setTermButton` のモデルに state/reactive 辺が7本あるが、simple 出力には0本だった。実装箇所は [`src/render/simple.ts`](src/render/simple.ts)。

## rxMethod から HTTP への経路を確認する

- [ ] `signal-store-apis` の `loadValueButton`、`loadSignalButton`、`loadStreamButton` で、`rxMethod` の `switchMap` 内にある `CatalogApi.search()` と `GET /api/catalog` への到達条件を解析する。
- [ ] HTTP を開始する条件と、未呼出し `rxMethod` の反例を fixture で検証する。静的に接続できない場合は、停止位置・理由を具体的に残す。
- [ ] 通信辺が確認できた場合は simple 出力の通信行も確認する。

現状は3形態とも state 更新まで検査されるが、service call は未解決境界となり report は `partial`。既存テスト [`test/reactive-fixture-p16.test.mjs`](test/reactive-fixture-p16.test.mjs) はこの境界を明示的に期待している。
