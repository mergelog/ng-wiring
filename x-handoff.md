# x-handoff

作成日時: 2026-09-26 JST

## 依頼

`x-local/x-open-audit.md` を現行実装と先に照合し、差分が出た項目だけ fixture・回帰確認・修正を行う。

## 参照した指示

- このリポジトリの `AGENTS.md` / `AGENTS.local.md` を確認済み。
- 回帰時の実アプリは `/home/mtrysd/work_2026/000-learn-ClearML-pro`、project は `stackup`。
- 実アプリの revision は `0f6f5dd65780cfc074096ec786b8863f4c110305`。
- 実アプリ側には作業開始前から未追跡ファイルがある。編集・add・commit はしていない。
- 本リポジトリは作業単位で commit/push が必要だが、今回の変更は未コミット・未push。

## 照合結果と実装差分

### 1. click の伝播と複数式 handler

実アプリの `data-id=3DotMenuButton` の click は次の式だった。

```html
(click)="$event.stopPropagation(); openContext({originalEvent: $event, data: rowData, single: true})"
```

修正前は、`stopPropagation()` があっても ancestor の `checkClick()` を click 経路に含め、後続の `openContext()` を単一式 handler ではないため辿らなかった。

- `src/index/templates.ts`
  - stop propagation を event 名と無条件/条件付きで記録する形へ変更。
- `src/resolve/operation/events.ts`
  - 同じ event に対して、内側に無条件 stop propagation があれば DOM ancestor listener を除外。
  - 条件付き stop propagation は ancestor listener を残し、条件として記録。
- `src/assemble/report.ts`
  - Angular AST の Chain から、唯一の own public method call を抽出して後続操作を追跡。
- fixture/test
  - `test/fixtures/open-audit-events/`
  - `test/open-audit-events.test.mjs`
  - stop あり、stop なし、条件付き stop の肯定例/反例を追加。

実アプリ再解析（修正後）の結果:

```sh
node /home/mtrysd/work_2026/ng-wiring/dist/cli/index.js \
  'data-id=3DotMenuButton' --project stackup \
  --candidate cand:1d7451318c97c1124e77d3a00afc015acd4781ed9f617ec56e1b98aa26b84f05 \
  --event click --detail --out-dir /tmp/ng-wiring-open-audit-final
```

出力: `/tmp/ng-wiring-open-audit-final/ngwi-02-TableComponent.data-id=3DotMenuButton-260926.232019.md`

- `openContext()`、`rowRightClick`、`ExperimentsTableComponent.openContextMenu()` を辿る。
- `rowClick` / `checkClick` / `handler-expression` は含まれない。

### 2. `provideState` に渡す reducer map

実アプリの route provider は `makeEnvironmentProviders([...])` の内側で `provideState(EXPERIMENTS_STORE_KEY, reducers)` を呼び、`reducers` は nested object map だった。

修正前は map 全体を reducer target として登録したため、leaf の `experimentsViewReducer` が active provider 未登録と誤判定された。

- `src/resolve/operation/store.ts`
  - object property、shorthand property、object spread を再帰展開して leaf reducer ごとに feature registration を作る `featureReducerLeaves()` を追加。
- fixture/test
  - `test/fixtures/open-audit-providers/`
  - `test/open-audit-providers.test.mjs`
  - `makeEnvironmentProviders`、配列 spread、nested reducer map、選択 route と sibling route の非混入を確認する。

同じ click の実アプリ再解析で `experimentsViewReducer has no active provideState registration` は解消済み。選択 route 外の reducer は未登録境界に残る。

### 3. 継承された `this.method()` と abstract

`classMethod()` 自体は継承先 implementation を解決するが、基底クラス本文の `this.method()` は declaration site の symbol をそのまま使うため、選択した派生 component の override を辿れなかった。また abstract/declaration-only method に body が無い場合に明示的な境界が無かった。

- `src/resolve/operation/flow.ts`
  - 呼び出し元の lexical class が選択 component の継承階層にある `this.method()` は、選択 component 上の implementation を解決する。
  - abstract/declaration-only method は「local implementation が無い」boundary を出す。
  - external inheritance（例: `EventTarget`）は local call として仮定せず boundary に留める。
- fixture/test
  - `test/operation-p10-store.test.mjs` に base method、field/getter callback、override、abstract、external `.d.ts` のケースを追加。

field/getter callback の実装は今回も辿らず boundary で止める。外部 `.d.ts` の本体を作らないという audit 要件に沿う。

### 4. Forms の `ngModelChange` 条件

実アプリ `WorkersStatsComponent` の `(ngModelChange)="chartParamChange($event)"` を確認した。`NgModel.update` の output subscription から `setStatsParams` dispatch、registered reducer まで辿れていたが、条件文が「DOM event does not trigger it」になっていた。

`ngModelChange` は ControlValueAccessor の view-to-model update を経て Angular Forms が emit するので、条件文が誤り。

- `src/resolve/operation/events.ts`
  - Angular Forms の `NgModel` / `FormControlName` / `FormControlDirective` の `update` output を識別。
  - `ngModelChange` には view-to-model update、ControlValueAccessor、`updateOn` による遅延の条件を記録する。
- fixture/test
  - `test/fixtures/open-audit-forms/`
  - `test/open-audit-forms.test.mjs`
  - `ngModelChange` と DOM `input`、Forms なし input を分離して確認する。

実アプリ再解析コマンド:

```sh
node /home/mtrysd/work_2026/ng-wiring/dist/cli/index.js \
  --source 'src/app/webapp-common/workers-and-queues/containers/workers-stats/workers-stats.component.html:8' \
  --project stackup --route /workers-and-queues/workers \
  --event ngModelChange --detail --out-dir /tmp/ng-wiring-open-audit-ngmodel-final
```

出力: `/tmp/ng-wiring-open-audit-ngmodel-final/ngwi-02-WorkersStatsComponent.mat-select-L8-bfa159734311-260926.233038.md`

`Angular Forms emits ngModelChange after a view-to-model update` と `ControlValueAccessor` 条件になり、誤条件はない。

## 差分なしとして照合した実例

- DOM `input`: `data-id=tagSearchInputField` は `(input)="setSearchTerm($event)"` で `searchTerm = $event.target.value` へ進み、NgModel の value accessor は背景入力として分離。
  - 出力: `/tmp/ng-wiring-open-audit-forms/ngwi-02-MainPagesHeaderFilterComponent.data-id=tagSearchInputField-260926.231531.md`
- `keydown.enter`: InlineEdit の `form.checkValidity() && inlineSaved()` は guard、`textChanged` の emit 条件、変更なし時の cancel を分離。
  - 出力: `/tmp/ng-wiring-open-audit-inline-enter/ngwi-02-InlineEditComponent.input-L27-ca138732c03a-260926.232616.md`
- `keydown.escape`: InlineEdit の `inlineCanceled()` は `cancelEdit` と `inlineActiveStateChanged` を出し、`textChanged` を出さない。
  - 出力: `/tmp/ng-wiring-open-audit-inline-escape/ngwi-02-InlineEditComponent.input-L27-ca138732c03a-260926.232712.md`
- `blur`: PeriodSelector の `applyChanges()` は DOM `blur` として扱い、外部 ControlValueAccessor callback の本体は boundary に留める。
  - 出力: `/tmp/ng-wiring-open-audit-blur/ngwi-02-PeriodSelectorComponent.input-L22-e98677007175-260926.232759.md`
- SignalStore events: `filterByRegexField` の keyup は local named dispatcher、event reducer、`logFilter` state write を辿る。
  - 出力: `/tmp/ng-wiring-open-audit-signalstore/ngwi-02-ExperimentOutputLogComponent.data-id=filterByRegexField-260926.233146.md`
- RxJS / HTTP / DI: `downloadFullLogButton` の click は named dispatcher、handler subscription、`fromFetch` と `switchMap`、HTTP start condition まで辿る。
  - 出力: `/tmp/ng-wiring-open-audit-rxjs/ngwi-02-ExperimentOutputLogComponent.data-id=downloadFullLogButton-260926.233222.md`
- custom component の `(change)` は Material output subscription と同じ綴りの DOM event を別候補として扱う。実アプリの `mat-slide-toggle` で両方の経路を表示した。
  - 出力: `/tmp/ng-wiring-open-audit-change/ngwi-02-ProfilePreferencesComponent.mat-slide-toggle-L5-6e0a31e18a73-260926.233507.md`

## テスト状況

完了済み:

- `npm run build` は複数回成功。
- `node --test test/operation-p10-store.test.mjs` は、継承修正直後に 25/25 成功。
- `node --test test/open-audit-forms.test.mjs` は 2/2 成功。
- `node --test test/open-audit-events.test.mjs test/open-audit-providers.test.mjs` は、各 fixture 作成時に成功。

ただし最後に次を変更したため、再度の build と全確認が必要。

- Forms output の識別 regex を `FormControlDirective` に修正。
- 継承 fixture に field/getter callback と external `EventTarget` boundary を追加。

必ず実行する残作業:

```sh
npm run build
npm test
npm run check:contracts
npm run check:dist
```

成功後、最新 `dist` で少なくとも click、provider、Forms の3件を再解析し、`x-local/x-open-audit.md` に revision / project / query / candidate / event / command / expected-vs-actual / fixture / result を追記する。

追記後は current repo の変更だけを commit/push する。実アプリ repo は read-only のままにする。

## 現在の変更ファイル

- `src/assemble/report.ts`
- `src/index/templates.ts`
- `src/resolve/operation/events.ts`
- `src/resolve/operation/flow.ts`
- `src/resolve/operation/store.ts`
- 対応する `dist/` 生成物
- `test/operation-p10-store.test.mjs`
- `test/fixtures/open-audit-events/`
- `test/fixtures/open-audit-forms/`
- `test/fixtures/open-audit-providers/`
- `test/open-audit-events.test.mjs`
- `test/open-audit-forms.test.mjs`
- `test/open-audit-providers.test.mjs`
- この `x-handoff.md`

`x-local/x-open-audit.md` は未更新。

## 継続結果（2026-09-26）

上記の「未コミット」「未push」「再実行が必要」「未更新」は引き継ぎ時点の状態。継続作業では以下を完了した。

- `npm run build` 成功、`npm test` 259/259 成功、`npm run check:contracts` 110/110 成功。
- 旧 `test/operation.test.mjs` の stop propagation 期待値を新しい伝播処理に合わせ、`preventDefault` では祖先に伝わる反例を追加。
- `provideState` の reducer map fixture を有効な NgRx の map にし、object spread と shorthand を通して leaf reducer を解決するよう確認。
- 最新 `dist` で click、provider、Forms を実アプリ再解析。継承した `cardClicked()` から派生側 `openContextMenu()` もソースとレポートで照合。
- `x-local/x-open-audit.md` に revision、project、query、candidate、event、完全なコマンド、期待値と実際、fixture、残る境界を記録。`x-local/` は gitignore 対象のローカル記録。
- 実アプリ repo は read-only を維持。再解析出力は `/tmp/ng-wiring-open-audit-verify-*`。

実アプリ再解析レポートは全体として `partial` で、無関係な view relocation や外部実装などの境界が残る。今回の4件の修正対象経路は検査済み。`check:dist` は更新済み `dist` の commit 後に実施する。
