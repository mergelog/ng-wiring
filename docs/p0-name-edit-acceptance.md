# 名前編集から通信までの実例の受け入れ

検証日: 2026-09-25。対象は `../000-learn-ClearML-pro` の `stackup` project、revision `8e26c9f99709f33824da74d6f060f9b8c4f84661`。実アプリのソースはこのリポジトリに含めず、解析中にも変更していない。縮小した再現例は `test/operation-p10-store.test.mjs` と `test/operation-p12-flow.test.mjs` に置いた。

対象の tsconfig は `tsconfig.app.json`、TypeScript 6.0.3、@angular/compiler 22.1.5、ngmaze `6da35347018531df30659d34e66a11d1bfcc3f22`、`strictNullChecks` は `false`。以下の実行はいずれも `--json` で資料を出力し、終了コードは coverage `partial` を表す 5 である。

## 調べた操作と結果

`x-issue.md` の P0 は、名前編集の資料が `updateExperimentDetails$` までで止まり、その先の `tasks.update` に届かない差分を最初の課題とした。以下はその再確認と、通信を持たない操作・別の通信経路との対照である。

| 操作 | クエリと候補 | 期待 | 実測 |
| --- | --- | --- | --- |
| 名前編集 | `data-id=nameField`、`cand:68e75ac70326ebe0157756ffdc6b7bfafa21a35d1b097f508dbe71dfa1ff9c9e` | `keydown.enter` から `tasks.update` まで条件付きで届く | `textChanged` → `ExperimentInfoHeaderComponent.onNameChanged` → `experimentNameChanged` → `ExperimentOutputComponent.updateExperimentName` → `experimentDetailsUpdated` → `updateExperimentDetails$` → `POST ${this.basePath}/tasks.update` の `http-create` / `http-consume` が出る。成功時の `experimentUpdatedSuccessfully`、失敗時の `requestFailed` と `setServerError` も分岐として残る |
| 編集の取り消し | 同じ候補の `keydown.escape` | 通信を持たない | 辺 13 本、`http-create` 0 件。`deactivateEdit` の dispatch だけが残る |
| 入力そのもの | 同じ候補の `ngModelChange` | 通信を持たない | 辺 2 本、`http-create` 0 件 |
| tab による保存 | 同じ候補の `keydown.tab` | enter と同じ保存経路 | テンプレートの handler が `form.checkValidity() && inlineSaved()` で共通のため、enter と同じ 5 個の URL に届く |
| 検索 input | `data-id=searchInputField`、`cand:60dd95fb9bfcf140df5499a0af72e3bf01a644ebe36c5d70d7f51a2ac437eb39`、`--event input` | 無関係な保存 API を含めない | 辺 104 本、`http-create` 0 件 |
| SignalStore のログ取得 | `data-id=downloadFullLogButton`、`cand:67a4340b5034a0a994a471f0a11d405b514a7082f747bc833fe6f624e62c786b`、`--event click` | `fromFetch` の通信に届く | `POST ${HTTP.API_BASE_URL}/events.download_task_log` の条件付き `http-create` / `http-consume` |
| 正規表現フィルタ | `data-id=filterByRegexField`、`cand:ae13a74f21a9a5ce624ead17d32490f674331e6503134ccec29f483926c5ef87`、`--event keyup` | 同じ画面だが通信を持たない | 辺 5 本、`http-create` 0 件 |
| 設定の保存 | `data-id=Save`、`cand:d6f7051a0e95a7c4153a8a164f4dbc911816e4acec394c5c377fb48359a65da5` | 2 本の保存 API のうち追えるものと止まるものを区別する | `users.set_preferences` には届く。`updateProject` は停止位置と理由を記録する（後述） |

`tasks.update` の `http-create` に残る条件は、テンプレート側の `editable()`、`!multiline()`、`enter` の修飾子、handler の `form.checkValidity()`、component の `this.inlineValue() !== this.originalText()`、`name.trim().length > 2`、lazy route injector、Effect の `ofType`・購読・`filter requires ([, , , valid]) => valid`、interceptor の存在、動的なベースパスである。URL がベースパスを含む式のままなのは、`basePath` が実行時に決まるためで、静的には `${this.basePath}/tasks.update` 以上には確定しない。

## 通信に届かなかった原因

基準レポートで `tasks.update` が欠けていた原因は一つではなく、次の三つが重なっていた。

HTTP の追跡が画面のメソッドからしか始まらず、Action を受け取った Effect の本体に入らなかった。Effect が constructor で注入したサービスを追えなかった。同じ HTTP ラッパーを呼ぶ別の場所を購読元として選んでしまい、選択した呼び出しの詳細と取り違えた。あわせて、子から親へ再送出される Angular Output が 1 段しか辿られず、`textChanged` から `experimentNameChanged` への連鎖が切れていた。それぞれ `src/resolve/operation/http-flow.ts`、`src/resolve/operation/store-flow.ts`、`src/assemble/report.ts` で修正し、肯定・否定の検査を対にして追加した。

テンプレートの `form.checkValidity() && inlineSaved()` のようなガード付き handler も、以前は呼び出すメソッドを読み取れずに操作ごと落ちていた。現在はメソッドを読み、ガードの式を `handler requires form.checkValidity()` として後続の辺の条件に伝播する。

## 残る停止位置

静的に確定できない箇所は、通信未検出とだけ書かず、どこで何が決まらないかを資料に残す。

`ProjectSettingsDialogComponent` の `updateProject` は、`ProjectDialogEffects` が `projectDialogProviders` 経由で `projects.routes.ts` と `dashboard.routes.ts` の route provider に登録されている。この component は dialog として実行時に生成され、選択した候補から route に到達しないため、どちらの route injector が有効かが決まらない。登録が無いのではなく決まらないので、`project-dialog.effects.ts` の `updateProject` を名指しして「この選択は route に到達しないため、その injector が確定しない」という boundary を置く。route 上の選択ではこの boundary は出ず、登録の判定は従来どおり行う。

生成された API クライアントの `this.configuration` は `@Optional()` 注入であり、`optional injection may return null` を根拠として停止する。実行時に null になりうる以上、この停止は正しい。

`NotifierService` は `importProvidersFrom(NotifierModule.withConfig({...}))` から提供される。DI の層は NgModule の provider を展開しないため、provider が見つからないまま停止する。これは未対応の構文であり、`layout.effects.ts` の周辺で 1 件の boundary として現れる。停止の根拠には provider 不在に加えて、展開していない `importProvidersFrom` の位置（`app.config.ts:46:7`）を記録する。検査は `test/operation-p10-di.test.mjs` に置いた。

外部パッケージが宣言と provider の両方を持つ受け手、たとえば ngrx の `Store` や `HttpClient` での停止は、§4.2 が外部パッケージのソースを探索対象外としているための設計上の停止である。以前はこれを「DI で一意に解決できない」と表示していた。名前編集の `keydown.enter` に出る 41 件の停止のうち 21 件がこれに当たり、現在は外部パッケージであることを理由として区別する。残る 20 件は上記の optional 注入と provider 不在である。

## 実行時間とメモリ

| 対象 | 変更前 | 変更後 |
| --- | --- | --- |
| 名前編集（`data-id=nameField`） | 13.21 秒 / 1,137,324 KB | 18.1 秒 / 1,095,328 KB |
| 検索 input | 12.42 秒 / 1,088,668 KB | 12.52 秒 / 1,091,980 KB |
| ログ取得 | 10.72 秒 / 1,143,432 KB | 10.51 秒 / 1,059,232 KB |
| 設定の保存 | 10.63 秒 / 1,063,172 KB | 10.69 秒 / 1,074,748 KB |

名前編集だけが 5 秒ほど増えた。この候補では `keydown.enter`、`keydown.tab`、`textChanged`、`experimentNameChanged` の 4 操作が新たに Effect と通信まで辿るようになり、操作あたりの辺が数本から 126〜158 本に増えたためである。Output の連鎖を辿らない対照は変わっていない。ピーク RSS は増えていない。

この資料の status はいずれも `partial` である。ngmaze の Program 外 omission と上記の停止が残るため、静的に確認した接続を実行時の必然やアプリ全体の網羅性とは扱わない。
