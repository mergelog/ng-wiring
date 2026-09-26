# 未達のリアクティブ契約 28 件を実装する

作成日: 2026-09-26

## 目的と基準

[`test/contracts/reactive-cases.ts`](test/contracts/reactive-cases.ts) の `fixture: null` で残る 12 subcase を実装し、期待する経路と反例を fixture で検証する。ここでの「完了」は `npm run check:contracts` が 110 件すべてを検査して成功すること。単に CI を緑にするために台帳の項目を削除したり、必須 API を `unsupported` に移したり、検査を無効化したりしない（[`x-local/x-structure.md`](x-local/x-structure.md) §10、P16-12）。

作成時の基準値は **110 件中 82 件が fixture 合格、28 件が未達**。R08 の6件、R09 の4件、R10 の3件、R14 の1件、および R15 の4件に期待関係を追加し、現在の台帳は **110 件すべて fixture 設定済み**。`npm run check:contracts` の残件は台帳の `missingFixture` / `demonstratedBy` を正本とする。`scripts/smoke-dist.mjs` の詳細 Markdown 指定は `543b600` で修正済み。

## 進め方と完了判定

1. 各項目の `demonstratedBy` にある workspace と起点で、現在の欠落を再現する。既存の正常ケースと反例も確認する。
2. 解析器に必要な意味モデルを実装する。起点からの因果、購読・生存期間、条件、根拠、未確定境界を保持し、別の API や別インスタンスの経路を混ぜない。
3. 台帳の当該項目に `fixture` と具体的な `expectedEdges` / `expectedNodes` / `expectedConditions` / `expectedDetails` / `forbiddenEdges` / `expectedDiagnostics` を必要に応じて追加し、`missingFixture` を解消する。既存 fixture ではケースを証明できない場合は専用 fixture を追加する。名称や件数だけの一致を合格条件にしない。
4. 項目ごとに `npm run build`、対象テスト、`npm run check:contracts` を実行し、未達件数が減ったことと既存の期待・禁止関係が崩れていないことを確認する。全件完了時に `npm test`、`npm run check:dist`、`npm run check:smoke` と GitHub Actions の Linux/macOS/Windows・Node matrix を確認する。
5. 以下のチェック欄は、実装・fixture・台帳の照合が終わった項目だけ完了にする。`R15/settings-store` は R05/R06 の経路が通ってから確認する。

着手順の目安は、生成 Store の member 解決（R05/R06）→ method 本体と相互運用（R08/R04/R07/R15）→ NgRx の action/selector（R09/R10）→ scope 演算子（R14）。独立した項目は並行して進められる。

## シンプル出力を普段使いする場合の優先度

優先度は**普段のコードリーディングで、選んだ表示値や操作の結果を説明できるか**で並べたもので、実装の依存順ではない。最優先は表示値の計算元と再計算・明示 write の区別（P1）、次に dispatch/HTTP の経路が直接増える項目（P2）とする。現行の [`src/render/simple.ts`](src/render/simple.ts) は表示経路と、選択操作の listener・output・dispatch・Effect・HTTP を主に行として出す。state の read/write や派生はそのままでは行に出ないため、P1 は**解析とシンプル表示の両方**が必要。P2 も該当する辺が選択操作へつながった場合に限り、表示が改善する。

Angular の `computed` と `linkedSignal` は、それぞれ `R02/computed` と `R02/linkedSignal` として既に fixture があるため、下の未達 28 件には含まれない。これらの回帰確認も、P1 の表示値追跡と一緒に行う。

| 優先 | 契約 | シンプル出力への効果 | 補足情報としての価値 |
| --- | --- | --- | --- |
| P1 | R06/withComputed | 選んだ表示値の計算元を短い行で示す（表示側の追加が必要） | 派生元の state と計算条件を確認できる |
| P1 | R06/withLinkedState | 再計算と明示 write のどちらが表示値を変えたか示す（表示側の追加が必要） | 値の由来と上書きの区別に効く |
| P1 | R07/deepComputed | 深い依存から表示値まで示す（表示側の追加が必要） | 深い mutation だけでは通知されない境界を確認できる |
| P2 | R09/Store.dispatch.action-object | action object の dispatch 行を出せる | どの action が送られたかを特定できる |
| P2 | R09/createActionGroup | group の action の dispatch 行を出せる | 同じ group の別 action と受信先を区別できる |
| P2 | R10/Store.next | Store の送信行を出せる | 通常の `Subject.next` と区別できる |
| P2 | R08/rxMethod.value | method 内の HTTP まで届けば通信行を出せる | 値を渡した呼出しが起点と分かる |
| P2 | R08/rxMethod.signal | method 内の HTTP まで届けば通信行を出せる | Signal 変化で再実行する条件が分かる |
| P2 | R08/rxMethod.observable | method 内の HTTP まで届けば通信行を出せる | 購読による再実行の条件が分かる |
| P3 | R15/settings-store | API に届けば通信行の候補になるが、現行表示は主経路の要求を一つ選ぶ | `forkJoin` の複数要求と state 更新の関係を説明できる |
| P3 | R09/Store.select | 現行表示に read 行はない | 生きた購読から後続の write/dispatch への関係を説明できる |
| P3 | R09/createFeature | dispatch は表示されても、reducer の state 更新は行に出ない | 選択中の表示がどの更新で変わるか説明できる |
| P3 | R05/signalStore.class-extends | Store method が state につながっても行には出ない | 継承先の method で追跡が止まる理由を減らせる |
| P3 | R05/withFeature | feature の派生 state は行に出ない | `shouted` がどの state に依存するか説明できる |
| P3 | R08/signalMethod.value | state 更新だけでは新しい行は出ない | 値引数で実行した method と更新を結べる |
| P3 | R08/signalMethod.signal | state 更新だけでは新しい行は出ない | Signal 変化と再実行の関係を説明できる |
| P3 | R04/toSignal | 購読・表示値の変化は行に出ない | Observable から表示値への橋渡しを説明できる |
| P3 | R04/toObservable | 変換・通知は行に出ない | state write 後の通知条件を説明できる |
| P3 | R07/watchState | state の監視は行に出ない | 初回通知と更新通知を区別できる |
| P3 | R15/rxjs.of | Observable の生成は行に出ない | 定数値から state への経路を説明できる |
| P3 | R15/rxjs.from | Observable への変換は行に出ない | Promise/配列から state への経路を説明できる |
| P3 | R15/rxjs.distinctUntilChanged | 演算子の通過条件は行に出ない | 同値通知が抑制される条件を説明できる |
| P3 | R14/mapToScope | Events の scope 変更は行に出ない | どの handler が受信し得るかを区別できる |
| P3 | R05/signalStore.provider-instance | インスタンス識別は行に出ない | 別 provider の state を誤接続しない根拠になる |
| P4 | R10/Store.dispatch.thunk | dispatch 行は現状でも出るが、登録形態は表示されない | 再 dispatch の条件は詳細出力向け |
| P4 | R10/Store.dispatch.thunk-injector | 明示 injector は行に出ない | 登録先と生存期間は詳細出力向け |
| P4 | R06/withHooks | 起動・破棄条件は行に出ない | Store の生存期間は詳細出力向け |
| P4 | R08/signalMethod.no-observable | 新しい経路を追加しない反例 | 誤った Observable 対応を防ぐ検証向け |

P1 は解析結果だけでなく、選択した表示値について**値の計算元 → 派生 → 表示**をシンプル出力で短く確認できることを合格条件にする。`computed` / `linkedSignal` の既存ケースも同じ観点で回帰確認する。P3 の情報をシンプル出力に追加する場合は、選択操作から表示または通信への因果関係を説明する行だけを対象にする。action 定義や feature 名を一律に付け足すことは完了条件にしない。P2 は再現先でシンプル出力の行も確認し、P3/P4 はまず詳細・JSON の意味モデルと反例を検証する。

## 実装チェックリスト（28 件）

`再現:` は `test/fixtures/<名前>` の `target`。各行の期待は台帳から要約したもので、厳密な契約は台帳と設計表を参照する。

### R04: Angular と RxJS の相互運用（2 件）

- [x] **R04/toSignal** — 再現: `interop-apis`, `data-id=commitButton`。Observable を消費する内部購読の開始・破棄を記録し、操作起点からの依存経路を証明する。
- [x] **R04/toObservable** — 再現: `interop-apis`, `data-id=commitButton`。`this.value` の write から Observable 変換先へ接続し、通知は change-detection boundary に従う条件を記録。

### R05: 生成 Store と feature 合成（3 件）

- [x] **R05/signalStore.class-extends** — 再現: `signal-store-apis`, `data-id=shoutButton`。`ExtendedCatalogStore` の継承先から生成 Store の method 本体に到達する。
- [x] **R05/withFeature** — 再現: `signal-store-apis`, `data-id=shoutButton`。`withFeature` が追加する `shouted` を合成順どおり解決し、未解決 feature は境界として残す。
- [x] **R05/signalStore.provider-instance** — 再現: `signal-store-apis`, `data-id=setTermButton`。同じ宣言と state key でも provider ごとのインスタンスを分け、別インスタンスへの誤接続を禁止する。

### R06: SignalStore の派生状態と hooks（3 件）

- [x] **R06/withComputed** — 再現: `signal-store-apis`, `data-id=setTermButton`。生成 Store の `label` を派生元から表示まで `reactive-link` で結ぶ。
- [x] **R06/withLinkedState** — 再現: `signal-store-apis`, `data-id=setTermButton`。`draft` の再計算と明示 write を区別し、表示への経路を検証する。
- [x] **R06/withHooks** — 再現: `signal-store-apis`, `data-id=setTermButton`。`onInit` の起動条件と `onDestroy` の終了条件を保持し、Store 未生成の反例も壊さない。

### R07: SignalState の監視と深い派生（2 件）

- [x] **R07/watchState** — 再現: `signal-store-apis`, `data-id=pageButton`。`filters` の write と監視を結び、初回通知と更新通知を区別する。
- [x] **R07/deepComputed** — 再現: `signal-store-apis`, `data-id=pageButton`。深いプロパティの派生を `reactive-link` として残し、単なる深い mutation を通知扱いしない。

### R08: rxMethod / signalMethod の呼出し形態（6 件）

- [x] **R08/rxMethod.value** — 再現: `signal-store-apis`, `data-id=loadValueButton`。値引数で呼ぶときだけ method 本体に入り、定義だけでは起動しない。
- [x] **R08/rxMethod.signal** — 再現: `signal-store-apis`, `data-id=loadSignalButton`。Signal 引数による再実行を値引数の単発実行と区別する。
- [x] **R08/rxMethod.observable** — 再現: `signal-store-apis`, `data-id=loadStreamButton`。Observable 引数の購読・再実行を `rxMethod` 固有の経路として検証する。
- [x] **R08/signalMethod.value** — 再現: `signal-store-apis`, `data-id=rememberButton`。値引数での起動から method 本体に入る。
- [x] **R08/signalMethod.signal** — 再現: `signal-store-apis`, `data-id=rememberButton`。Signal 引数の再実行を条件とともに保持する。
- [x] **R08/signalMethod.no-observable** — 再現: `signal-store-apis`, `data-id=rememberButton`。Observable 引数を `rxMethod` と同じ対応と推定しない反例を検証する。

### R09: NgRx Store の action と読み出し（4 件）

- [x] **R09/Store.dispatch.action-object** — 再現: `ngrx-apis`, `data-id=objectButton`。creator を介さない action object を静的 `type` で対応する action と照合し、当該 Store の dispatch → reducer → state write を確認。
- [x] **R09/createActionGroup** — 再現: `ngrx-apis`, `data-id=groupButton`。group 内 action を NgRx のシンボルと event member で個別に識別し、正しい reducer の受信と state write を確認。
- [x] **R09/createFeature** — 再現: `ngrx-apis`, `data-id=featureButton`。object literal 内 reducer を登録済み feature に結び、dispatch → 受信 → state 更新 → 生成 selector の state read を確認。P10-04/05/08 の dispatch・action type・reducer/selector 契約に整合。
- [x] **R09/Store.select** — 再現: `ngrx-apis`, `data-id=effectButton`。`.select(...).subscribe(...)` の呼び出し祖先に実 subscription があることを確認し、稼働中 Observable consumer として `selectSignal` から区別。

### R10: Store の送信形態（3 件）

- [x] **R10/Store.dispatch.thunk** — 再現: `ngrx-apis`, `data-id=thunkButton`。関数 overload を単発 dispatch と区別し、Signal 依存の再 dispatch として `dispatchMode` を記録する。
- [x] **R10/Store.dispatch.thunk-injector** — 再現: `ngrx-apis`, `data-id=thunkButton`。明示 injector 指定時の登録先と生存期間を記録する。
- [x] **R10/Store.next** — 再現: `ngrx-apis`, `data-id=nextButton`。`Store.next` を当該 Store の送信 API として解決し、一般の `Subject.next` と混同しない。

### R14: Events の scope 演算子（1 件）

- [x] **R14/mapToScope** — 再現: `events-map-to-scope`, `data-id=pageButton`。`toScope` の既存ケースとは別に `mapToScope` を使う handler fixture を作り、演算子による scope 変更と配送先を検証する。

### R15: 実例 Store と RxJS アダプタ（4 件）

- [x] **R15/settings-store** — 再現: `signal-settings-store`, `data-id=loadScalarsButton`。`signalStoreFeature` 越しの `withMethods` → `lastValueFrom(forkJoin)` → `patchState` を追い、外部 feature の未対応境界は保持する。
- [x] **R15/rxjs.of** — 再現: `rxjs-consume`, `data-id=ofButton`。`of` による ObservableInput 生成を既知アダプタの関係として記録する。
- [x] **R15/rxjs.from** — 再現: `rxjs-consume`, `data-id=fromButton`。Promise/配列からの `from` 変換を既知アダプタの関係として記録する。
- [x] **R15/rxjs.distinctUntilChanged** — 再現: `rxjs-consume`, `data-id=ofButton`。重複値を条件付きで通す演算子として記録し、未知演算子を透過扱いしない。

## 最終確認

- [ ] 28 行すべての `fixture` が設定され、`missingFixture` が残らず、台帳の 110 subcase が維持されている。
- [ ] 期待 relation・条件・根拠と禁止 relation を fixture で照合し、R16 の boundary / partial / 診断も維持されている。
- [ ] `npm run build`、`npm test`、`npm run check:contracts`、`npm run check:dist`、`npm run check:smoke` が成功する。
- [ ] GitHub Actions の全 job が成功する。CI の通知設定変更や検査無効化を完了の代わりにしない。
