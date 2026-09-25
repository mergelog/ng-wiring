# 未達のリアクティブ契約 28 件を実装する

作成日: 2026-09-26

## 目的と基準

[`test/contracts/reactive-cases.ts`](test/contracts/reactive-cases.ts) の `fixture: null` で残る 28 subcase を実装し、期待する経路と反例を fixture で検証する。ここでの「完了」は `npm run check:contracts` が 110 件すべてを検査して成功すること。単に CI を緑にするために台帳の項目を削除したり、必須 API を `unsupported` に移したり、検査を無効化したりしない（[`x-local/x-structure.md`](x-local/x-structure.md) §10、P16-12）。

作成時の基準値は **110 件中 82 件が fixture 合格、28 件が未達**。`npm test` は 236 件合格、`npm run check:contracts` は下記 28 件の `fixture` 欠落で失敗する。`scripts/smoke-dist.mjs` の詳細 Markdown 指定は `543b600` で修正済み。各項目の現在の停止理由と再現先は台帳の `missingFixture` / `demonstratedBy` を正本とする。

## 進め方と完了判定

1. 各項目の `demonstratedBy` にある workspace と起点で、現在の欠落を再現する。既存の正常ケースと反例も確認する。
2. 解析器に必要な意味モデルを実装する。起点からの因果、購読・生存期間、条件、根拠、未確定境界を保持し、別の API や別インスタンスの経路を混ぜない。
3. 台帳の当該項目に `fixture` と具体的な `expectedEdges` / `expectedNodes` / `expectedConditions` / `expectedDetails` / `forbiddenEdges` / `expectedDiagnostics` を必要に応じて追加し、`missingFixture` を解消する。既存 fixture ではケースを証明できない場合は専用 fixture を追加する。名称や件数だけの一致を合格条件にしない。
4. 項目ごとに `npm run build`、対象テスト、`npm run check:contracts` を実行し、未達件数が減ったことと既存の期待・禁止関係が崩れていないことを確認する。全件完了時に `npm test`、`npm run check:dist`、`npm run check:smoke` と GitHub Actions の Linux/macOS/Windows・Node matrix を確認する。
5. 以下のチェック欄は、実装・fixture・台帳の照合が終わった項目だけ完了にする。`R15/settings-store` は R05/R06 の経路が通ってから確認する。

着手順の目安は、生成 Store の member 解決（R05/R06）→ method 本体と相互運用（R08/R04/R07/R15）→ NgRx の action/selector（R09/R10）→ scope 演算子（R14）。独立した項目は並行して進められる。

## 実装チェックリスト（28 件）

`再現:` は `test/fixtures/<名前>` の `target`。各行の期待は台帳から要約したもので、厳密な契約は台帳と設計表を参照する。

### R04: Angular と RxJS の相互運用（2 件）

- [ ] **R04/toSignal** — 再現: `interop-apis`, `data-id=commitButton`。Observable を消費する内部購読の開始・破棄を記録し、操作起点からの依存経路を証明する。
- [ ] **R04/toObservable** — 再現: `interop-apis`, `data-id=commitButton`。`this.value` の write から変換先へ接続し、set 回数と通知回数の一致を仮定しない。

### R05: 生成 Store と feature 合成（3 件）

- [ ] **R05/signalStore.class-extends** — 再現: `signal-store-apis`, `data-id=shoutButton`。`ExtendedCatalogStore` の継承先から生成 Store の method 本体に到達する。
- [ ] **R05/withFeature** — 再現: `signal-store-apis`, `data-id=shoutButton`。`withFeature` が追加する `shouted` を合成順どおり解決し、未解決 feature を無条件に通過させない。
- [ ] **R05/signalStore.provider-instance** — 再現: `signal-store-apis`, `data-id=setTermButton`。同じ宣言と state key でも provider ごとのインスタンスを分け、別インスタンスへの誤接続を禁止する。

### R06: SignalStore の派生状態と hooks（3 件）

- [ ] **R06/withComputed** — 再現: `signal-store-apis`, `data-id=setTermButton`。生成 Store の `label` を派生元から表示まで `reactive-link` で結ぶ。
- [ ] **R06/withLinkedState** — 再現: `signal-store-apis`, `data-id=setTermButton`。`draft` の再計算と明示 write を区別し、表示への経路を検証する。
- [ ] **R06/withHooks** — 再現: `signal-store-apis`, `data-id=setTermButton`。`onInit` の起動条件と `onDestroy` の終了条件を保持し、Store 未生成の反例も壊さない。

### R07: SignalState の監視と深い派生（2 件）

- [ ] **R07/watchState** — 再現: `signal-store-apis`, `data-id=pageButton`。`filters` の write と監視を結び、初回通知と更新通知を区別する。
- [ ] **R07/deepComputed** — 再現: `signal-store-apis`, `data-id=pageButton`。深いプロパティの派生を `reactive-link` として残し、単なる深い mutation を通知扱いしない。

### R08: rxMethod / signalMethod の呼出し形態（6 件）

- [ ] **R08/rxMethod.value** — 再現: `signal-store-apis`, `data-id=loadValueButton`。値引数で呼ぶときだけ method 本体に入り、定義だけでは起動しない。
- [ ] **R08/rxMethod.signal** — 再現: `signal-store-apis`, `data-id=loadSignalButton`。Signal 引数による再実行を値引数の単発実行と区別する。
- [ ] **R08/rxMethod.observable** — 再現: `signal-store-apis`, `data-id=loadStreamButton`。Observable 引数の購読・再実行を `rxMethod` 固有の経路として検証する。
- [ ] **R08/signalMethod.value** — 再現: `signal-store-apis`, `data-id=rememberButton`。値引数での起動から method 本体に入る。
- [ ] **R08/signalMethod.signal** — 再現: `signal-store-apis`, `data-id=rememberButton`。Signal 引数の再実行を条件とともに保持する。
- [ ] **R08/signalMethod.no-observable** — 再現: `signal-store-apis`, `data-id=rememberButton`。Observable 引数を `rxMethod` と同じ対応と推定しない反例を検証する。

### R09: NgRx Store の action と読み出し（4 件）

- [ ] **R09/Store.dispatch.action-object** — 再現: `ngrx-apis`, `data-id=objectButton`。creator を介さない action object を当該 Store の dispatch として解決する。
- [ ] **R09/createActionGroup** — 再現: `ngrx-apis`, `data-id=groupButton`。group 内の各 action を個別に識別し、正しい dispatch と受信先を結ぶ。
- [ ] **R09/createFeature** — 再現: `ngrx-apis`, `data-id=featureButton`。object literal 内の reducer と selector を検出し、dispatch → 受信 → state 更新を結ぶ。P10 の契約変更との整合をレビューする。
- [ ] **R09/Store.select** — 再現: `ngrx-apis`, `data-id=effectButton`。`store.select(...).subscribe(...)` を稼働中の Observable consumer として扱い、`selectSignal` と区別する。

### R10: Store の送信形態（3 件）

- [ ] **R10/Store.dispatch.thunk** — 再現: `ngrx-apis`, `data-id=thunkButton`。関数 overload を単発 dispatch と区別し、Signal 依存の再 dispatch として `dispatchMode` を記録する。
- [ ] **R10/Store.dispatch.thunk-injector** — 再現: `ngrx-apis`, `data-id=thunkButton`。明示 injector 指定時の登録先と生存期間を記録する。
- [ ] **R10/Store.next** — 再現: `ngrx-apis`, `data-id=nextButton`。`Store.next` を当該 Store の送信 API として解決し、一般の `Subject.next` と混同しない。

### R14: Events の scope 演算子（1 件）

- [ ] **R14/mapToScope** — 再現: `events-apis`, `data-id=scopedButton`。`toScope` の既存ケースとは別に `mapToScope` を使う handler fixture を作り、演算子による scope 変更と配送先を検証する。

### R15: 実例 Store と RxJS アダプタ（4 件）

- [ ] **R15/settings-store** — 再現: `signal-settings-store`, `data-id=loadScalarsButton`。`signalStoreFeature` 越しの `withMethods` → `lastValueFrom(forkJoin)` → `patchState` を追い、外部 feature の未対応境界は保持する。
- [ ] **R15/rxjs.of** — 再現: `rxjs-consume`, `data-id=ofButton`。`of` による ObservableInput 生成を既知アダプタの関係として記録する。
- [ ] **R15/rxjs.from** — 再現: `rxjs-consume`, `data-id=fromButton`。Promise/配列からの `from` 変換を既知アダプタの関係として記録する。
- [ ] **R15/rxjs.distinctUntilChanged** — 再現: `rxjs-consume`, `data-id=ofButton`。重複値を条件付きで通す演算子として記録し、未知演算子を透過扱いしない。

## 最終確認

- [ ] 28 行すべての `fixture` が設定され、`missingFixture` が残らず、台帳の 110 subcase が維持されている。
- [ ] 期待 relation・条件・根拠と禁止 relation を fixture で照合し、R16 の boundary / partial / 診断も維持されている。
- [ ] `npm run build`、`npm test`、`npm run check:contracts`、`npm run check:dist`、`npm run check:smoke` が成功する。
- [ ] GitHub Actions の全 job が成功する。CI の通知設定変更や検査無効化を完了の代わりにしない。
