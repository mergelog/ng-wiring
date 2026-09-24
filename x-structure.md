# ng-wiring 設計・実現可能性調査

作成日・改訂日: 2026-09-24

対象: Angular 22 のソースコード。初期検証対象は `../000-learn-ClearML-pro`。

範囲: CLI の実装に向けた設計。CLI 全体の実装・配布・受け入れ試験は次段階。

## 1. 目的と保証範囲

画面の要素を属性またはソース位置で指定し、その使用箇所からアプリケーションの起動コンポーネントまでの経路と、操作から到達する処理を根拠付きで資料化する。親コンポーネント列を主線にし、入出力・状態・サービス・API・Model を関連する枝として示す。

**ソース上の接続が確認できることと、実行時に必ず表示・実行されることを区別する。** 静的解析で任意の Angular アプリの全実行経路を証明することはできない。条件・未解決・探索打ち切りを出力し、名前の類似、同じ型、同じファイルにあるという理由では接続しない。実際の DOM インスタンス、ユーザーデータ、ネットワークの成否は特定しない。

要素抽出と基礎グラフ取得は現物で確認済み。投影・起動点・操作・状態/API を統合した ng-wiring 全体は未実装であり、この設計の完了を CLI の実証完了とは扱わない。

この実例では、選択するルートに応じて `SearchComponent → EditableSectionComponent → ExperimentInfoHyperParametersFormContainerComponent → … → AppComponent → AppRootComponent` と表示する。終端は一般には**選択経路に属する bootstrap コンポーネント**であり、`sm-root` に固定しない。表示上の親と、式を評価する宣言元は別の関係として保持する。

## 2. 現物の再検証

以下は 2026-09-24 のローカルソースと ngmaze v0.1.0、リビジョン `6da35347018531df30659d34e66a11d1bfcc3f22` に対する確認結果。件数はこのソース状態での観測値であり、他のアプリに一般化しない。

| 観点 | 確認結果・根拠 | 設計への反映 |
| --- | --- | --- |
| ツールチェーン | インストール済み Angular/compiler 22.1.5、TypeScript 6.0.3、Node.js 24.15.0 | 初期契約試験の基準版とする |
| 要素 | [search.component.html](../000-learn-ClearML-pro/src/app/webapp-common/shared/ui-components/inputs/search/search.component.html#L16) の `data-id="searchInputField"` は 1 箇所。Angular `parseTemplate` で属性・イベント・位置を取得可能 | HTML の正規表現を主解析にしない |
| 再利用数 | タグ境界付き `<sm-search(?=[\s/>])` は **13 HTML ファイル・13 箇所**。ngmaze の同コンポーネントへの `template` 辺も 13 件 | 旧記載の 15 ファイル・24 箇所は他のタグ名を前方一致で数えた誤り。件数差をスコープ解決の根拠にしない |
| スコープ | [BaseImageViewerComponent](../000-learn-ClearML-pro/src/app/webapp-common/shared/debug-sample/image-viewer/base-image-viewer.component.ts#L37) と [ImageViewerComponent](../000-learn-ClearML-pro/src/app/webapp-common/shared/debug-sample/image-viewer/image-viewer.component.ts#L21) は同じ selector | 使用元の import / NgModule スコープで特定する |
| 複数アプリ | [angular.json](../000-learn-ClearML-pro/angular.json) に `stackup` と `report-widgets`。`AppComponent` というクラス名も 2 箇所にある | 解析コンテキスト、ComponentId、起動点を区別する |
| 起動点 | [main.ts](../000-learn-ClearML-pro/src/main.ts#L44) は `AppRootComponent`、[widgets/main.ts](../000-learn-ClearML-pro/src/app/webapp-common/clearml-applications/report-widgets/src/main.ts#L18) は widgets 側 `AppComponent` を bootstrap | 共有部品から複数アプリへの経路を混ぜない |
| 最上位 route | [app.ts](../000-learn-ClearML-pro/src/app/app.ts#L7) に outlet、[app.routes.ts](../000-learn-ClearML-pro/src/app/app.routes.ts#L31) に `component: AppComponent` | `AppRootComponent → AppComponent` は router による配置。bootstrap が両方を生成するわけではない |
| 実験 route | [experiment-routes.ts](../000-learn-ClearML-pro/src/app/webapp-common/experiments/experiment-routes.ts#L139) と [同ファイルの別定義](../000-learn-ClearML-pro/src/app/webapp-common/experiments/experiment-routes.ts#L211) から同じフォームコンテナに至る。上位は [loadChildren](../000-learn-ClearML-pro/src/app/app.routes.ts#L88) | 定義位置と loader 使用箇所を含めて経路を区別する |
| 投影 | [フォームコンテナ](../000-learn-ClearML-pro/src/app/webapp-common/experiments/containers/experiment-info-hyper-parameters-form-container/experiment-info-hyper-parameters-form-container.component.html#L13) の `sm-search` が [検索スロット](../000-learn-ClearML-pro/src/app/webapp-common/shared/ui-components/panel/editable-section/editable-section.component.html#L19) に入る | 表示上は `EditableSectionComponent` を経由し、式の所有者はフォームコンテナのまま |
| 入出力 | [SearchComponent](../000-learn-ClearML-pro/src/app/webapp-common/shared/ui-components/inputs/search/search.component.ts#L51) の `enableSearchOnSubmit` は既定 `false`。この使用箇所に束縛はなく、`minimumChars=1`、`debounceTime=0` を渡す | この使用コンテキストで分岐・条件を評価する。timer(0) も非同期境界として残す |
| 検索処理 | [searchTable](../000-learn-ClearML-pro/src/app/webapp-common/experiments/containers/experiment-info-hyper-parameters-form-container/experiment-info-hyper-parameters-form-container.component.ts#L105) は検索語更新後、[jumpToNextResult](../000-learn-ClearML-pro/src/app/webapp-common/experiments/dumb/experiment-execution-parameters/experiment-execution-parameters.component.ts#L184) を即時呼び出す。再計算は後続の [ngOnChanges の searchedText 分岐](../000-learn-ClearML-pro/src/app/webapp-common/experiments/dumb/experiment-execution-parameters/experiment-execution-parameters.component.ts#L199) | 新しい一致位置リストへの移動を保証しない。関連しない保存 API を検索操作に載せない |
| 前へ操作 | [アイコン](../000-learn-ClearML-pro/src/app/webapp-common/shared/ui-components/inputs/search/search.component.html#L54) 自体に click はなく、親 button にある。[findNext(true)](../000-learn-ClearML-pro/src/app/webapp-common/shared/ui-components/inputs/search/search.component.ts#L138) は `output<string>()` に `null` を渡す | リスナー位置と対象を分離し、宣言型・実際の emit 値・逆方向検索の判定を併記する。strictNullChecks の設定も記録し、必ず型エラーだとは断定しない |
| 共有テンプレート | [ServingComponent](../000-learn-ClearML-pro/src/app/webapp-common/serving/serving.component.ts#L32) と [ServingLoadingComponent](../000-learn-ClearML-pro/src/app/webapp-common/serving/serving-loading.component.ts#L28) が同じ HTML を使用 | `--source` でも所有コンポーネント別の候補が必要 |
| TemplateRef | [widgets テンプレート](../000-learn-ClearML-pro/src/app/webapp-common/clearml-applications/report-widgets/src/app/app.component.html#L61) が `csvButtonTemplate` を入力で渡し、[子の outlet](../000-learn-ClearML-pro/src/app/webapp-common/shared/single-value-summary-table/single-value-summary-table.component.html#L17) が描画 | 宣言元と挿入先を分ける。この実例の両コンポーネント自体は親子であり、「親子関係にない」という指摘の表現は不正確 |
| 制御フロー | `@defer` は 5 HTML ファイル・10 箇所、`@switch` は 24 ファイル・27 箇所 | 分岐、遅延表示、補助ブロックも解析・fixture の対象 |
| API | [保存 effect](../000-learn-ClearML-pro/src/app/webapp-common/experiments/effects/common-experiments-info.effects.ts#L537) → [生成クライアント](../000-learn-ClearML-pro/src/app/business-logic/api-services/tasks.service.ts#L974) → `SmApiRequestsService.post` | ラッパーと request/response 型、購読、effect 登録まで確認する |
| SignalStore | [ログの Store](../000-learn-ClearML-pro/src/app/webapp-common/experiments/containers/experiment-output-log/experiment-output-log.store.ts#L56) は `signalStore/withState/withComputed/withReducer/withEventHandlers`、[再利用 feature](../000-learn-ClearML-pro/src/app/webapp-common/shared/project-dialog/project-settings/project-settings-dialog.store.ts#L22) は `signalStoreFeature/withMethods/patchState` を使用 | 通常のクラスや NgRx effect の探索だけでは不足。生成 Store・feature 合成・状態直接更新を専用アダプタで解析する |
| dispatch の複数形 | [ログのコンポーネント](../000-learn-ClearML-pro/src/app/webapp-common/experiments/containers/experiment-output-log/experiment-output-log.component.ts#L60) は `injectDispatch`、[比較選択画面](../000-learn-ClearML-pro/src/app/webapp-common/experiments-compare/containers/select-experiments-for-compare/select-experiments-for-compare.component.ts#L57) は `Dispatcher`、[view bridge](../000-learn-ClearML-pro/src/app/webapp-common/core/state/view.store.ts#L12) は SignalStore event から `Store.dispatch` を呼ぶ | `.dispatch` という名前だけでなく受信オブジェクトと送信先を解決する。effect を経由しない dispatch/reducer も独立して対象にする |
| ngmaze 全体解析 | 352 components、704 template edges、66 dynamic edges、157 route entries、153 route edges、1490 source files。gaps は 50 件（view-relocation 46、unresolved-dynamic-target 4）、owner=null は 4 件。named outlet は 0 件 | JSON を再利用するが、無い辺を「関係なし」の証拠にしない。named outlet は別 fixture で検証する |
| ngmaze の限定解析 | `--angular-project report-widgets` では 1 component・0 edges・10 source files。一方、同アプリの tsconfig から通常の TS Program を作ると内部ソースは 436 件で共有部品への import も解決できる | 原因は [analysisFiles を rootNames 内に限定する実装](../ng-maze/src/project/program.ts)。tsconfig が共有部品を含められないという説明は採用しない |
| 性能 | 同環境で ngmaze 単体を 1 回ずつ実行し、全体約 2.31 秒、stackup 約 2.20 秒、widgets 約 1.00 秒。全体 JSON は約 1.05 MB | 単発の参考値。ng-wiring 全体、ピーク RSS、cold/warm 差、大規模 fixture の測定は必要 |

ng-maze の既存 196 テスト成功は先行調査・提示されたレビューでの報告として保持する。今回の変更は設計書のみで、そのテストは再実行していない。

## 3. CLI 契約

### 3.1 対象指定

予定コマンド（実装・公開前のため現時点では利用不可）:

```bash
npx github:mergelog/ng-wiring 'data-id="searchInputField"'
npx github:mergelog/ng-wiring 'data-id="searchInputField"' --project stackup --through ExperimentInfoHyperParametersFormContainerComponent
npx github:mergelog/ng-wiring --source 'src/app/webapp-common/experiments/dumb/experiment-execution-parameters/experiment-execution-parameters.component.html:51'
```

`github:mergelog/ng-wiring` または `mergelog/ng-wiring` が npm の GitHub 指定形式。`github/mergelog/ng-wiring` は使わない。

| 引数 | 契約 |
| --- | --- |
| 位置引数 `属性名=値` | 1 個のみ。最初の `=` で分け、空の属性名はエラー。値全体を囲む一致した `"` または `'` を 1 組だけ除去する。残りの `=` は値。エスケープ構文は追加しない |
| `--source <path>:<line>` | 属性指定と排他。末尾の `:<正整数>` を分離するので Windows のドライブ表記と衝突しない。ワークスペース相対パスまたは絶対パス。行は 1 始まりで開始タグ内を指す |
| `--project <name>` | Angular project を選ぶ。`--tsconfig` と排他。同時指定は ngmaze 起動前にエラー |
| `--tsconfig <path>` | 明示した TS 設定を 1 つの独立した解析コンテキストとして扱う。`angular.json` は必須でない。solution-style の複数 references は勝手に 1 つを選ばず、具体的な設定を要求する |
| `--through <ClassNameまたはpath#ClassName>` | 親経路に指定コンポーネントを含む候補だけ残す。クラス名が複数 ComponentId に解決する場合は識別子一覧を返し、完全な ID で再指定を求める |
| `--route <path>` | 再構築したルートパターンを完全一致で絞る。例 `/projects/:projectId/tasks/:experimentId/hyper-params/hyper-param/:hyperParamId`。実 URL、query、fragment、glob として解釈しない |
| `--candidate <番号またはcand:ID>` | 下記の安定順序による 1 始まりの番号、または SHA-256 の全桁 ID。全フィルター適用後の候補から選ぶ。範囲外・存在しない ID はエラー |
| `--event <name>` | 正規化したイベント名で絞る。`keydown` は `keydown.enter` 等も含み、修飾子付き指定は完全一致。該当リスナーなしならその理由を持つ経路資料を出す |
| `--out-dir <dir>` | 既定は実行ディレクトリ。存在しなければ作成。ソースへのリンクはこの出力先を基準にする |
| `--json` | Markdown の代わりに JSON ファイルを **1 個**作る。stdout に JSON 本文は流さない |

解析は Angular ワークスペースのルートで実行する。明示 tsconfig で angular.json がない場合はその設定のディレクトリを workspace root とする。tsconfig/out-dir の相対引数は実行ディレクトリ、source/ComponentId は workspace root を基準とする。指定がなければ全 application project を**それぞれの設定で直列解析**し、候補の一覧だけ統合する。application がなければ具体的な project/tsconfig を要求して code 3 とする。library は参照された範囲を含め、library 単独指定時は bootstrap 未到達の資料を許す。project が異なるグラフ同士は接続しない。

属性は Angular AST の静的属性名とデコード済み値の完全一致で比較する。大小文字・空白・Unicode の正規化で勝手に対象を増減させない。`data-id="a"` と `data-id=a` は入力文法上同一のクエリであり、異なる対象ではない。raw 引数も保存する。`[attr.data-id]`、補間、host 属性、実行時に付く属性は静的属性一致に含めず、検出できた範囲を診断する。空値は許可し、存在属性は `search-button=` と指定できる。

`--source` は外部 HTML またはインラインテンプレートを含む TS を受ける。同一行に複数タグがある場合、および同じ HTML に複数所有者がいる場合は全組合せを候補にする。指定行で `[startOffset, endOffset)` の開始タグ span と重なる要素だけを選び、本文・閉じタグ・コメントだけの行は一致なし。インライン文字列の cooked/raw offset を変換できないときは推測で行を決めず診断する。`@for` 内の位置はソース要素を表し、個々の行データを表さない。CSS selector、`:nth-child()`、ビルド由来の `_ngcontent-*` は初期版の識別構文にしない。

### 3.2 候補と対話

候補は「解析コンテキスト + 所有コンポーネント + 対象要素の span + 使用箇所列 + route の定義/loader 使用箇所列 + bootstrap + 投影/挿入先」で区別する。各パスは `/` 区切りのワークスペース相対表現、比較順は Unicode code point と数値位置で固定し、環境の locale に依存させない。上記 tuple の canonical JSON を SHA-256 にして candidate ID とする。canonical JSON はオブジェクトのキーを code point 順、配列は規定の経路/ソース順、UTF-8、余分な空白なし、未設定値は null とする。識別 tuple に日時・OS 固有の絶対ルートは入れない。ファイル内容・設定のハッシュは別途 snapshotId に持つ。ソース編集で番号・ID は変わり得るので、再実行時に選択結果の所有者・経路・snapshot を必ず資料に記載する。

`--through` / `--route` は候補を絞るだけである。一意なら選択し、複数なら stdin と stderr がともに TTY のときだけ stderr に一覧・プロンプトを出し、stdin から入力を読む。stdout がパイプでも対話可能。非対話時は stderr に ID 付き一覧を出して終了し、資料を作らない。候補ゼロを一意と扱わない。

bootstrap 到達済み、宣言/使用のみ確認、未生成 TemplateRef、動的配置未解決を分けて候補表示する。不完全な候補も明示選択できるが、未解決位置を架空の親で埋めない。ルート列挙が上限に達した場合は「1 件しか見つからなかった」を一意性の証明にせず、自動選択を禁止する。上限はフィルター後の列挙に適用する。省略された候補 ID を指定しても発見済み扱いにせず、through/route/project で探索を狭めるよう案内する。

### 3.3 終了コード・出力

| コード | 意味 | 資料 |
| --- | --- | --- |
| 0 | 解析が規定範囲内で完了。条件付き辺は許す | 1 ファイル |
| 1 | 有効な解析範囲で対象の一致なし | なし |
| 2 | 候補・所有者等の選択が必要 | なし |
| 3 | 引数、設定、対応バージョン、解析依存、ngmaze 契約のエラー | なし |
| 4 | 出力 I/O、内部整合性違反等の実行失敗 | なし |
| 5 | 選択対象に未解決・非対応・打ち切りがある、または解析欠落で対象有無を判定できない | 対象を選べた場合だけ部分資料 |
| 130 | Ctrl-C / SIGINT | 正常資料のパスを出さない |

stdout は書き込みが完了したファイルの絶対パス 1 行のみ。診断・候補・進捗は stderr。部分資料も `status: partial` を本文冒頭/JSON に示す。対象外の局所的な gap だけでは選択結果を partial にしない。起動点・スコープ全体を壊す gap は関連するとして扱う。

判定順は引数/依存・設定エラー → 解析不能な致命的失敗 → 対象なし（欠落が原因なら 5、そうでなければ 1）→ 選択要求 2 → 出力成功時の 0/5。選択段階の TTY 入力が EOF なら 2 で終了する。`--help` / `--version` は通常の案内を stdout に出して 0 とし、対象引数は不要。未知・重複した単値オプション、対象指定なし/両方指定は 3 とする。

### 3.4 ファイル名

合意済みの基本形 **`ngwi-{処理名}-{YYMMDD.HHMMSS}.md`** を維持する。例:

```text
ngwi-SearchComponent.data-id=searchInputField-260924.130024.md
```

処理順を次に固定する。

1. 属性クエリを解析し、外側の構文用引用符を除く。見出しは `SearchComponent.data-id="searchInputField"` のように表示するが、ファイル名の元文字列は `SearchComponent.data-id=searchInputField` とする。**値の内部にある引用符は除かない。** `--source` は `ComponentClass.要素名-L行番号-パスハッシュ` とし、パスハッシュは所有コンポーネント ID とソースパスの SHA-256 先頭 12 桁とする。
2. ファイル名用文字列だけ NFC 化し、ASCII 英数字・`_`・`-`・`.`・`=` 以外を UTF-8 の `%HH`（大文字 16 進）にする。`%` 自身もエンコードする。照合用属性値・識別子は正規化しない。
3. エンコード結果が 160 ASCII 文字を超えたら、`%HH` を分断しない先頭 140 文字以内と `-h<元文字列のSHA-256先頭12桁>` に短縮する。元文字列は無損失で資料に残す。
4. 解析開始時のローカル日時を付ける。本文には ISO 8601 の日時と UTC offset も残す。`--json` は拡張子のみ `.json` にする。
5. 同名・大小文字だけ違う既存名を検査し、衝突時は**処理名側**に `-c1`、`-c2`…を付ける。ASCII エンコード後のファイル名全体を小文字化して比較する。出力ディレクトリに `.ng-wiring-output.lock` を `wx` で作り、比較と作成を直列化する。最終ファイルも `wx` で新規作成する。既存ファイルは上書きしない。ロック競合は code 4 で再実行を案内し、他プロセスのロックを削除しない。自分のロックは正常/例外/SIGINT の finally で解放する。

固定長の日時を末尾から `-(\d{6}\.\d{6})\.(md|json)$` で識別できるため、処理名に `-` や `.` を許しても分解は可能。ファイル名は表示ラベルであり、対象の再識別には本文/JSON の ID を使う。完全な出力内容を先にメモリ上で検証してから書き、失敗時は自分が作成した不完全ファイルを削除する。ファイルシステム限界や強制終了での完全な原子性は保証せず、成功するまで stdout にパスを出さない。

## 4. 解析コンテキストと ngmaze 接続

### 4.1 プロジェクト別の Program

`AnalysisContext` は workspace root、project 名（明示 tsconfig なら null）、tsconfig と extends のハッシュ、compilerOptions、ツールチェーン、エントリーポイントを持つ。同じソースでもコンテキストが違えば別ノードである。`angularProject` フィールドのディレクトリ帰属と、そのアプリで使用されることは同義でない。

project 指定時は `architect.build` または `targets.build` の **options** の tsConfig と browser/main を使う。tsConfig がなければ project root の tsconfig.app.json、tsconfig.json の順で選び、どれも無ければ code 3。application の entry が不明なら bootstrap の推測はせず partial にする。初期版はソース配置の解析であり、configuration による fileReplacements・独自 builder・SSR/hydration の実行環境の再現は対象外。該当設定があれば解析メタデータに未適用と記載し、構成差で関係が変わる箇所を確定しない。暗黙に production/defaultConfiguration を適用しない。

ng-wiring は TS の設定読み込み API で extends / paths / baseUrl / moduleResolution / references を解決し、noEmit で Program と TypeChecker を作る。選択 project のソース走査と設定の fileNames に加え、Program が import で読み込んだワークスペース内部の非宣言ソースを解析対象に含める。未使用ファイルの発見と bootstrap からの到達可能性は分ける。spec、生成物、node_modules、`_old` は走査から除外し、依存として必要になった除外ソースは gap とする。外部パッケージの `.d.ts` は型・公開 Angular メタデータに用いるが、通常のアプリ処理の再帰探索対象外とする。

明示 tsconfig の場合はその fileNames と import closure を対象にし、別 project の sourceRoot を無条件に加えない。ngmaze が余分なソースを返した場合は、この対象集合に含まれる宣言・使用箇所だけ受け入れる。ワークスペース外の linked source、宣言ファイルに置き換わった project reference、解決できない拡張子は外部境界とする。bootstrap の起点は project の browser/main、明示設定なら fileNames 内で確認できる entry とし、複数あれば別候補にする。

解析中に対象のアプリコードや任意の設定関数を実行しない。import、定数、オブジェクト/配列、単純な関数の戻り値は限定した AST 評価器で扱い、副作用、循環、評価不能な式では停止する。getter、provider factory、ルート loader を実行して値を得ない。静的評価も式ごとに最大 10,000 AST 展開・深さ 64 に制限し、超過は unknown と診断する。

### 4.2 ツールチェーン

対象 workspace の node_modules から TypeScript と `@angular/compiler` を優先解決する。初期版の意味解析は **対象にインストール済みの依存があることを必須**とし、見つからない/ロードに失敗した場合に同梱版で黙って継続しない。ngmaze が bundled にフォールバックした場合も結合を拒否する。AST は各プロセスで生成し、別バージョンの AST オブジェクトを混ぜない。

契約対象は Angular 22.x と TypeScript 6.0.x、最初の固定試験版は compiler/core 22.1.5 と TS 6.0.3。リアクティブ解析の固定試験版は対象にインストールされた `@ngrx/store/effects/signals` 22.0.0、RxJS 7.8.2 とする。対象の core/compiler の版整合性も検査し、非対応 Angular/TS 版は code 3 とする。NgRx/RxJS の未対応版や未知 API は該当アダプタの unsupported として部分解析にし、使用していないパッケージを必須依存にはしない。同じ major でも未知の AST/API が出た箇所は unsupported とする。初期版の Node `engines` は `^22.22.3 || ^24.15.0 || >=26.0.0`。対応 OS は Linux/WSL・macOS・Windows とし、各 OS の配布スモークテストを要求する。

### 4.3 ngmaze アダプタ

[ngmaze の正式スキーマ](../ng-maze/docs/ngmaze.schema.json) と [JSON 契約](../ng-maze/docs/JSON_SCHEMA.md) を境界とする。初期版は上記固定リビジョンを依存に固定し、v0.1.0 とスキーマハッシュを検査する。[package.json](../ng-maze/package.json) の exports が指す `dist/index.js` は現行ビルドで生成されないので、内部モジュールは import しない。

ng-wiring パッケージを基準に解決した ngmaze の package.json から `bin.ngmaze` を読み、実在する CLI ファイルを `spawn(process.execPath, [binPath, ...args], {shell: false, cwd: workspaceRoot})` で実行する。PATH 上の別 ngmaze や Windows `.cmd` shim に依存しない。package root は `createRequire(import.meta.url).resolve.paths('ngmaze')` の検索ディレクトリ順に `ngmaze/package.json` をファイルとして探し、realpath と name/version を照合する。exports 越しの `require.resolve('ngmaze/package.json')` や未生成の main を経由しない。bin がその package root 内の実在ファイルか検査し、npm/pnpm の配置をクリーンインストール試験で保証する。

| ng-wiring の入力 | ngmaze の引数 |
| --- | --- |
| project コンテキスト | `--project <workspace絶対パス> --angular-project <name> --json` |
| 明示 tsconfig コンテキスト | `--project <workspace絶対パス> --tsconfig <設定絶対パス> --json` |

component クエリ、`--all`、`--with-routes` は渡さない。概要 JSON の `result.components`（templateFile / templateKind を含む）、`edges`、`routes`、`routeEdges`、`externalUsages`、`ambiguousUsages` と `global.diagnostics` / `global.detectionGaps` を使う。`routeEdges` は `--with-routes` なしでも含まれる。

照合対象は workspaceRoot/analysisRoot の realpath、primary tsconfig と付加設定、project 集合、TS/compiler の版と source、ComponentId のパス。現行 meta はモジュール実体の絶対パスや全ソース集合を公開しないため、meta だけで完全一致を証明したとはしない。固定リビジョンの resolver 規則・同じ解析ルートで依存の realpath を事前確認し、ソース/設定の snapshot とローカルのシンボル解決でも辺を検証する。バージョン/スキーマ/コンテキストの不一致なら結合せず code 3。ソース集合の欠落は次の補完処理に回す。

project 集合は ngmaze の探索契約との比較に使う。project 指定では選択 project 1 件、明示 tsconfig では ngmaze が workspace から発見した project 集合が期待値となる。後者を ng-wiring の使用アプリ集合と読み替えず、解析対象集合と entry で再限定する。明示 tsconfig の compilerOptions に別 project の alias をマージしない。

**ngmaze は基礎グラフであり、完全なカタログではない。** report-widgets のように import で到達した共有部品が省かれる場合、ng-wiring の Program のカタログで補完する。独立した scope resolver を持ち、standalone の imports、NgModule の declarations/imports/exports、継承した入出力、公開 `.d.ts` のメタデータをシンボルで解決する。Angular compiler の selector matcher を使用元の有効スコープにだけ適用する。component は唯一の対象と確認できたときに辺を作り、directive は同じ要素に複数適用されるため一致した全宣言を保持する。ngmaze の既存辺も自前の AST/span と照合する。欠落補完は `origin: ng-wiring`、受領辺は `origin: ngmaze` とする。

静的な hostDirectives と公開 input/output alias も適用 directive に含める。未知の metadata、動的 hostDirectives、スコープ循環等で一意性を確認できない場合は未解決にする。別アプリの全体解析で見つかった辺をコピーして埋めない。scope resolver の実装は追加コストとして初期実装範囲に含め、ngmaze 自体の修正を前提条件にしない。

子プロセスは 120 秒で終了させ、stdout は 64 MiB を上限にストリーム収集する。超過、異常終了、不正 JSON、stderr、`error` を診断する。非ゼロ終了を成功 JSON として消費しない。複数コンテキストは直列実行して Program を解放する。総時間とピーク RSS は両プロセスを含めて測定する。

## 5. 中間モデルと確定度

Markdown と JSON は同じ正規化済みモデルから生成する。JSON 初版は `schemaVersion: "1.0.0"`。正式 JSON Schema は実装時に `docs/ng-wiring.schema.json` として同梱し、以下の必須フィールド・列挙・不変条件を表現する。任意に意味を変える変更は major を上げる。

| フィールド | 内容 |
| --- | --- |
| `schemaVersion`, `toolVersion`, `status` | 契約版、CLI 版、`complete-within-scope` / `partial` |
| `generatedAt`, `snapshotId`, `context` | offset 付き ISO 時刻、解析入力内容のハッシュ、設定/entry/toolchain/除外/未適用設定 |
| `query`, `selection` | raw/解析済み引数、candidateId、所有者、対象要素、route/bootstrap、候補列挙が完了したか |
| `nodes`, `edges`, `evidence`, `conditions` | 型付きグラフ、出典、条件式 |
| `paths`, `operations` | 表示経路・宣言元の参照、イベント別の因果グラフ、各スコープの確定度/網羅性 |
| `diagnostics`, `coverage`, `limits` | 関連診断、全体の gap 集計と未解決一覧、適用した上限・実際の打ち切り位置 |

- `ComponentId = workspace相対TSパス#ClassName`。内部キーは `(contextId, ComponentId)`。selector/className だけをキーにしない。
- 定義ノードと使用箇所ノードを分ける。`OccurrenceId` は context、所有者、使用 span、挿入/投影/route 文脈を含む。再帰や `@for` で作られる具体的インスタンス数は表さない。
- ノード種別は `application | component | directive | pipe | element | template | route | listener | symbol | operation | state | action | event | event-bus | effect | service | http | type | boundary`。参照先のない辺を許さない。
- 根拠は `{id, file, startOffset, endOffset, startLine, startColumn, endLine, endColumn, precision, symbolId, contentHash}`。offset は UTF-16、範囲は半開区間、行・列は 1 始まり。外部 HTML はそのファイル、インラインは TS 内への対応表を使う。近似位置は `precision: approximate` とし、正確なタグ位置として利用しない。
- 辺は `{id, from, to, kind, evidenceIds, conditionId, confidence, origin, contextId, details}`。`evidenceIds` は空にしない。kind ごとの details と定型文は第8節の表で規定する。方向は「親→子」「原因/提供元→受け手」で保存し、子→root の表示時のみ親辺を逆にたどる。
- 条件は `true | false | predicate | all | any | not | phase` の木。predicate は元の式・位置・スコープを持ち、phase は lifecycle / defer / subscription / route activation 等を表す。評価不能を false にしない。

単一出力には選択 context のみを格納する。別 context の調査結果は候補一覧と集計に留める。paths は順序付き occurrence/edge ID、宣言元 ID、終端理由、confidence、coverage を持つ。operations は起点 event/listener ID と到達 node/edge ID を持つ。各 node は id/kind/contextId/evidenceIds/details、診断は id/code/severity（info/warning/error）/message/evidenceIds/relatedIds/stopReason を持つ。設定エラー等でソース根拠がない診断は evidenceIds を空配列にできる。

探索辺は解決不能なら `boundary` kind にし、具体的な接続が判明しているが URL 等の付随情報だけ未知なら元の kind に field ごとの unresolved reason を付ける。conditionId が null なら条件なし。全 ID 参照の存在、context の一致、edge kind と両端 node kind の整合、partial の理由、行/span 範囲を schema とモデル検証で確認する。

`confidence` は接続の根拠に関する 3 値:

| 値 | 判定 |
| --- | --- |
| `confirmed` | 対象・関係を一意に解決でき、未評価の実行条件がない。実行済みという意味ではない |
| `conditional` | 接続先を特定できるが、分岐、route activation、view 存在、購読、スケジューラ等に依存する |
| `unresolved` | 対象や関係を一意に解決できず、その位置で探索を止める。unknown boundary への辺とし、推測した具体先へ確定辺を張らない |

単一路の confidence は `unresolved > conditional > confirmed` の最弱値。条件は各辺の `all`、別経路は別 path とする。複数の分岐を合成する見出しでは最弱値を出し、各枝の値も残す。false と証明できた枝は有効経路から除き、除外理由を診断に残す。

**confidence と coverage は独立**。既知の辺がすべて confirmed でも別の辺が欠け得るなら coverage は `partial`。coverage は `complete-within-scope | partial` とし、関連 gap、未到達 root、循環/上限で partial にする。親経路、各イベント、全体で別々に集約し、無関係なイベントの未知の枝が親の確定度を書き換えない。

## 6. 要素から起動点まで

### 6.1 表示経路と宣言元

ngmaze の `template` 辺は宣言元→子の使用関係である。それをそのまま全て「表示上の親」と扱わない。AST の包含、投影スロット、TemplateRef の生成先から表示経路を構築し、宣言元を別参照として残す。単一の表示経路は子から root に `01, 02, …` と採番する。別の挿入箇所は別 candidate、多段投影の宣言元は各節から参照する枝とし、両方を無理に一本道にしない。

`ng-content` は使用元の投影対象に対し select、静的 ngProjectAs、既定スロット、fallback content を対象 Angular の規則で照合する。複数の select に一致しても直ちに曖昧とせず、宣言順で最初の一致を使う。既定スロットの重複等も対象 compiler/runtime の規則を照合し、判断できないときだけ未解決とする。該当スロットが無ければ「投影されない」と診断し、表示経路を作らない。投影先にあっても式の所有者や DI コンテキストを勝手に変更しない。ng-content は DOM 要素ではなく、条件付きスロットの表示と投影コンポーネントの生成時期は一致するとは限らない。表示条件と生成条件を別に保持する。[Angular の投影規則](https://angular.dev/guide/templates/ng-content)を基準とする。

TemplateRef は `#ref`、view/content query、入力/プロパティの代入を通して、`NgTemplateOutlet`、`ViewContainerRef.createEmbeddedView`、既知の構造ディレクティブまで追う。`*` マイクロシンタックスは Angular AST の展開結果を用い、`ng-container` / `ng-template` 自体を実 DOM の祖先に数えない。宣言だけの fragment は未生成とする。任意の独自ディレクティブの挿入先を推測しない。

fragment 内のクラスメンバーは宣言元で評価し、`let-` / `$implicit` は挿入時 context で解決する。`ngTemplateOutletInjector` 等による DI 文脈の変更は別途扱う。TemplateRef の描画先が変わっても式の所有者は変わらない。[Angular の fragment と context](https://angular.dev/guide/templates/ng-template)を根拠とする。

dialog、`createComponent`、`NgComponentOutlet` は呼出元/生成元の関係を持つが、overlay の DOM 親が呼出元とは限らない。描画コンテナまで確定できなければ dynamic creation の枝として示し、表示上の親へ昇格しない。外部ライブラリによるラッパーは外部境界として明記する。

### 6.2 ルートと bootstrap

`RouteEntry.path` は best effort のパターン、`host` は最寄り祖先 route component、`outlet` は名前（null は primary）。JSON に無いのは**テンプレート上の outlet の要素位置**であり、outlet 名そのものではない。

ng-wiring は root の `provideRouter` / `RouterModule.forRoot` と routes の参照、`children`、`loadChildren`、`RouterModule.forChild`、`loadComponent` をソースから再構築する。`RouteOccurrenceId` に定義位置だけでなく使用/loader の列を入れ、同じ route 配列を別の path から取り込む場合も区別する。componentless route は URL/条件の列に残すが、コンポーネント節にはしない。

`host === null` は bootstrap 直下という意味ではない。取り込み元を調べ、root router 設定まで接続できた route だけを対応する bootstrap の outlet に結ぶ。ロード元不明の route 配列もあるため、null を「root 直下か loadChildren の二択」と断定しない。static redirect は遷移参照であって親子辺ではない。guard、matcher、route の記述順、先行候補、pathMatch を条件として保持し、URL が一致するだけで activation を確定しない。動的 resetConfig 等は到達範囲の gap とする。

primary/named outlet は最寄り表示ホストのテンプレートとその子 view 内を探索し、名前・router context・生成条件を照合する。root から任意の outlet を探して接続することはしない。outlet が無い、複数あって絞れない、投影/TemplateRef で router context が不明な場合は未解決。named outlet の path だけで区別できなければ candidate で選ぶ。

bootstrap は選択 entry から到達する `bootstrapApplication`、または `bootstrapModule` と NgModule の bootstrap 配列を静的に解決する。application ノード→bootstrap component と、bootstrap component→最初の route component は別の辺。未使用の別 entry に書かれた bootstrap を同じアプリに結合しない。

### 6.3 制御フローと有限化

`@if/@else if/@else` は先行条件の否定を含め、`@for/@empty` は要素存在・反復数不明・空集合を保持する。`@switch/@case/@default` は switch 式と case の対応を保つ。`@let` は値/スコープの定義であり表示分岐ではない。

`@defer` は main/placeholder/loading/error を別 phase とする。on/when のトリガー、prefetch、after/minimum を別々に残す。複数の実行トリガーは OR、外側ブロックとの包含は AND。when が後で false になっても未ロード状態へ戻るとは解釈せず、時点の真偽だけでなく「起動済み」の状態として表す。prefetch は描画完了を意味しない。SSR/hydrate の経路をブラウザー操作へ混ぜない。[Angular の defer 規則](https://angular.dev/guide/templates/defer)を基準とする。

未知のテンプレート AST ノードは黙って読み飛ばさず、その領域を unsupported として coverage に反映する。親探索の循環キーは `(contextId, 定義ID, 使用位置, 関係種別, 直近のroute/fragment挿入位置)` とし、伸び続ける祖先配列を含めない。現在の枝で同じキーを再訪したら循環とし、異なる使用箇所の同じクラスは残す。再帰は有限回の具体インスタンスを列挙せず cycle boundary と他の非循環の root 経路を併記する。初期上限は親経路深さ 200、候補 1,000、展開状態 100,000。上限に達した枝と未列挙範囲を残す。

## 7. 操作・データ・API の解析

### 7.1 リスナーと DOM 伝播

対象自身、静的に復元できる DOM 祖先、および関連 host/directive のリスナーを対象とする。選択要素、リスナー要素、event source、修飾子、購読先を別フィールドに保持する。

1. Angular スコープで component/directive の output（alias と継承を含む）を解決する。output の emit は購読関係であり DOM をバブルしない。祖先の `(smHesitate)` や `(valueChanged)` を input 内の UI イベントの伝播先として結ばない。[Angular outputs](https://angular.dev/guide/components/outputs)を根拠とする。
2. DOM event の経路は独立に評価する。同じ名前の output と DOM event がある場合、双方が登録され得るため「output が見つかったら DOM 経路を全削除」としない。イベントの生成元と実際の Angular 22 の登録規則で区別する。
3. 標準 UI event はバージョン管理した表で bubbles/composed を判定する。初期必須は click/dblclick/input/change/keydown/keyup/mouseover/mouseout/focusin/focusout と、非バブルの focus/blur/mouseenter/mouseleave。後者は対象自身のリスナーを追うが、通常の bubble による祖先辺は作らない。capture 登録が明示解決できれば別経路とする。未知の CustomEvent は dispatch 元の bubbles/composed が不明なら unresolved にする。
4. stopPropagation/stopImmediatePropagation、キー修飾子、disabled、shadow DOM の retargeting、DOM 配置の未知を条件にする。preventDefault やハンドラの return false を伝播停止と同一視しない。CSS や外部ライブラリでの抑止を網羅したと主張せず、ソース上の伝播候補として表示する。

`window:` / `document:` は global listener として明示し、祖先要素を捏造しない。イベント間の自動派生（click したから必ず submit、focus() したから必ず focusin 等）はブラウザーの前提を解決できない限り conditional/境界に留める。既定出力はイベント別節、`--event` は選択後の節を絞る。

### 7.2 テンプレート式と呼出先

Angular AST は TypeScript TypeChecker に直接渡さない。Angular の lexical scope を作り、`@let`、ループ/fragment 変数、`#ref`、`$event`、pipe、コンポーネントメンバーを解決してから対応する TS シンボルへ結ぶ。`#ref="exportAs"` は directive、component host 上の裸の ref は component、通常要素上なら DOM 要素として識別する。

ローカル変数は暗黙のクラスメンバーを隠す。明示的な `this.name` はクラス側を参照する。[Angular の式のスコープ](https://angular.dev/guide/templates/expression-syntax)に従う。`public` / `protected`、継承、アクセス可能性を検査し、private の参照を正常な辺として扱わない。ただし「private だから同名の ref に決める」のではなく、名前解決後に可視性を検査する。型診断があっても構文上確認できる関係を診断付きで残し、ソースが実行可能と保証しない。

実例のテンプレート `executionParamsForm.matchIndex` は `#executionParamsForm` の子インスタンス、TS の `this.executionParamsForm()` は private query signal。query の型は候補を示すだけで、対象インスタンスの証明ではない。viewChild/contentChild、read、子 view/投影範囲、条件、複数一致、任意性を検査する。非 required query は undefined の可能性を残し、`.required` も表示失敗の可能性を無視しない。[Angular queries](https://angular.dev/guide/components/queries)を根拠とする。

呼出しは callee と receiver のシンボル・値の由来、呼出箇所ごとに解決する。継承/override、関数値、union、computed property、any で一意にならなければ境界にする。メソッド名・返却型だけで別インスタンスへ接続しない。AST 評価器は対象コードを実行しない。

### 7.3 入出力・状態・非同期

`input/input.required/@Input/model` と親の property binding、`output/@Output` と event binding を alias 込みで対応付ける。入力の既定値はその使用箇所でのみ適用し、transform、setInput、imperative assignment、別の provider/生成経路があれば条件を残す。静的属性が directive input に渡る場合も Angular の意味を考慮する。

`model` の暗黙の `nameChange`、two-way binding の入力/出力、フォーム directive と ControlValueAccessor は既知アダプタで関係を分離する。未知の accessor/pipe/transform を透過的な代入として扱わない。Angular/RxJS/NgRx の API は import 元のシンボルで認識し、同名のユーザー関数を誤認しない。

呼出箇所と状態更新を区別し、property assignment、signal set/update、computed/effect、Subject next/subscribe、input 変更と ngOnChanges の関連を追う。constructor/ngOnInit で登録した購読は登録文脈として調べ、そこで行われる無関係な初期化を今回の操作の因果経路に追加しない。生存期間、条件付き購読、unsubscribe/takeUntilDestroyed を条件として残す。

Signal・SignalStore・dispatch の必須 API と fixture は第7.6節の R01〜R16 を正本とする。「signal 対応」「NgRx 対応」という総称だけで実装済み・試験済みと判定しない。

同期呼出し、output、RxJS 演算子、timer、Promise、変更検知の境界は時系列を区別する。`EventEmitter(true)` の非同期設定も読む。初期 RxJS アダプタは `Subject`、subscribe、map/tap/filter、debounce/debounceTime、switchMap/mergeMap/concatMap/exhaustMap、withLatestFrom/concatLatestFrom、take、catchError、forkJoin、timer、async pipe を対象にし、取消し/並行/直列/間引き条件を記録する。未知の演算子は効果を推定せず、既知の前後を未解決境界で区切る。

根拠の重複除去と操作回数は別物。同じ emit 箇所へ別の call site や非同期枝から到達し得る場合は両方残す。`clear()` の直接 emit と `value$.next('')` 経由の emit は別経路。回数を証明できなければ「最大1回」「必ず2回」とは書かない。

### 7.4 DI と NgRx

DI は型注釈だけで具象サービスを確定しない。選択 bootstrap/route/component の injector、providers/viewProviders、providedIn、useClass/useExisting/useValue/useFactory、multi、optional/self/skipSelf/host を根拠に解決する。投影/TemplateRef と injector の文脈も区別する。factory の戻り値、上書き、複数実装を一意に解決できない場合は token で止める。[Angular の階層 DI](https://angular.dev/guide/di/hierarchical-dependency-injection)を基準とする。

`@ngrx/store` の `dispatch → action → reducer / ofType → effect` は、選択アプリの Store/feature/effect 登録を確認する。`provideStore/provideState/provideEffects`、`StoreModule.forRoot/forFeature`、`EffectsModule.forRoot/forFeature` を静的に解決する。**dispatch の検知に effect の存在を要求しない。** UI/コンポーネント/サービス/facade/SignalStore method からの dispatch、effect のない `dispatch → reducer → select/selectSignal → 表示` も必須経路である。ファイルに effect 宣言があるだけでは有効とはみなさない。lazy route の登録、生存期間、`dispatch:false`、functional effect を条件に反映する。SignalStore の `withReducer/withEventHandlers` は別の登録・配送機構として第7.6節で扱う。

action は creator のシンボルと type 値を記録する。実行時の ofType は type で一致するため、別 creator が同じ静的 type を持つ場合も衝突を診断して対応候補を残す。動的 type を名前の類似で解決しない。成功/失敗 action は emit/return が確認できた分だけ次段へ追い、effect の返却値が自動 dispatch される設定かも確認する。

因果探索の境界を次に固定する。

- 選択イベントから生じた同期/非同期の呼出し、値の書き込み、output、dispatch、確認済みの購読先を前向きに追う。成功/失敗 action の後続 effect も同じ規則で追う。
- reducer の書き込みから該当 state の selector/computed 依存へ進み、既存の購読/テンプレート消費を結果の利用先として示す。ただし「state が変化したから必ず selector が emit する」とせず、投影値・比較・購読状態を条件にする。購読 callback 内の副作用はその発火条件付きで続ける。
- 操作で変化した証拠のない read は参考入力。withLatestFrom/concatLatestFrom の既存値を読むだけなら、値を過去に作った API を今回の原因へ逆接続しない。
- 背景データ源は、上記 read の直接の selector/input/signal 定義までの別欄。初期版は背景を全アプリの過去の API まで逆探索しない。

flow はイベントごとに最大 10,000 展開状態、call stack 深さ 64。状態キーは symbol/call site、receiver、使用コンテキスト、起点イベント、抽象引数を含む。現在の枝での同一キー再訪は循環境界とし、その枝だけ止める。他の枝からの再到達は循環とせず、memoized な解析結果を別の到達辺として再利用する。未解決関数、外部実装、未知演算子、上限で停止理由を残し、未知の処理の先を架空の因果でつながない。

### 7.5 API と型

サービス→生成クライアント→共通ラッパー→HTTP を段階的に解決し、HTTP method、URL の静的部分/式、request 引数、response の型を出す。URL が動的でも既知の method/型は失わず、URL だけ未解決にする。`Observable<any>` の返却でも内部 `post<Response>` の型は区別して示す。interface、type alias、生成 DTO、ジェネリックは実際に値/引数/返却で使われた型のみ載せ、import 全件を Model として列挙しない。

`HttpClient` 呼出しによる Observable の作成と、購読に結び付く通信開始を区別する。subscribe、登録済み effect の flattening、async pipe、firstValueFrom 等まで追えたものを「通信開始に至るソース経路」とする。Observable を作るだけなら通信候補で止める。fetch 等の Promise API は呼出し時の開始と結果の await/then を分ける。[Angular HTTP](https://angular.dev/guide/http/making-requests)を根拠とする。

消費側には `lastValueFrom`、`toSignal` の内部購読、`rxMethod` の生存中の pipeline、生成された SignalStore の `withEventHandlers` による購読も含める。いずれも登録・インスタンス生成・入力/トリガーからの到達を確認する。単に API 名や factory 宣言を見つけただけで通信開始とはしない。

HTTP interceptor、キャッシュ、retry、share/replay、取消し等で実際のネットワーク回数・到達先は変わり得る。登録/処理が追えれば枝として示し、未知なら HTTP 境界の診断を残す。購読の発見だけで「必ずサーバーへ1回通信」とは記載しない。

### 7.6 Signal・SignalStore・dispatch の必須検知契約

以下は**実装と fixture を必須にする設計契約**であり、ng-wiring が現在すでに検知できるという実証ではない。Angular Signal、NgRx Store、NgRx SignalStore を区別し、それぞれの初期化・読み取り・更新・配送・消費先を追う。SignalStore に dispatch/effect が無い実装も正常な解析対象である。

#### Signal の読み取りと依存

`signal()` の呼出し・型・返却値の代入を追い、`count()` は read、`count.set/update` は write、`asReadonly()` は同じ状態の読み取り用参照として結ぶ。computed/linkedSignal/effect/テンプレートの tracked read と、イベントハンドラ等の単発 read、`untracked` 内の read を区別する。untracked の中でも明示的な write/call/dispatch は消さず、再実行の依存辺だけを作らない。動的分岐、equal、遅延評価、await 後の非追跡領域を反映し、deep mutation を Signal の通知と同一視しない。[Angular Signals](https://angular.dev/guide/signals)の意味に従う。

`toSignal` は Observable の消費側、`toObservable` は Signal から Observable への接続として扱う。生成・購読・破棄の時点を分け、Signal の各 set が同数の Observable 通知になるとは仮定しない。`Store.selectSignal` も selector→Signal→表示/他の consumer まで追う。[Angular の RxJS interop](https://angular.dev/ecosystem/rxjs-interop)を基準とする。

#### SignalStore の構築と更新

`const XxxStore = signalStore(...)` のような**変数へ返される生成クラス**をカタログ化する。Store の ID は宣言ファイル・変数/シンボル位置・context、インスタンスは DI provider/生成箇所で識別する。通常の `class` 宣言や `@Injectable` の走査だけで終えない。`class X extends signalStore(...)`、別名 import/re-export、再利用 feature の直接参照と factory 呼出しも追う。

feature は引数の順に合成し、withState、withComputed/withLinkedState、withProps、withMethods、withHooks、signalStoreFeature/withFeature の提供する state/member/hook を対応付ける。destructuring した state signal や method 内で捕捉した store 参照も元のインスタンスに戻す。後続 feature による同名 member の上書きは宣言順・実際の型/値解決で判定し、未知 feature を透明として通過させない。

`patchState` は部分オブジェクト・updater 関数・複数 updater を順に評価し、書かれた state key と依存する read を残す。`withReducer(on(...))` の返却 updater も同じ状態更新に接続する。SignalState は DI クラスとは限らない別の state source。Store の提供だけでは生成済みとせず、inject/new と withHooks の生存期間を確認する。onInit の処理は起動条件、onDestroy は終了条件として扱い、全てを毎回の UI 操作の結果にしない。

#### dispatch の種類と配送先

`Store.dispatch(action)`、`Store.dispatch(() => action)`、`Dispatcher.dispatch(event)`、`injectDispatch(group).eventName(payload)` を別の入口として検知する。2 番目は Signal read に依存して再 dispatch し得る登録であり、単発 dispatch と同一視しない。facade/wrapper 内部の dispatch も receiver/呼出先が解決できれば対象にする。action/event creator の呼出しだけでは dispatch とせず、実際の送信・自動送信条件が必要である。

SignalStore Events は `event/eventGroup`、`Events.on`、`ReducerEvents`、`withReducer/on`、`withEventHandlers`、`provideDispatcher` と `self/parent/global` scope を対応付ける。`injectDispatch(group)({scope: 'parent'}).eventName(...)`、`toScope/mapToScope` も含める。選択した injector の配送先と親側から受け取る経路を解決し、同じ event type でも無関係な sibling/local scope に配らない。通常の NgRx Store と SignalStore Events は別の配送先であり、同じ `{type, payload}` を渡しても自動的に双方へ届くとはしない。[NgRx 22 の Dispatcher 実装](https://raw.githubusercontent.com/ngrx/platform/22.0.0/modules/signals/events/src/dispatcher.ts)に合わせる。

`withEventHandlers` は生成 Store の初期化時に購読を登録し、その出力が新しい event の場合に再配送する。void の副作用、受信 event をそのまま流す場合、`[event, scope設定]` を区別する。`withReducer` の更新と、その後の Events handler への通知の順序もモデルに残す。[NgRx 22 の withEventHandlers 実装](https://raw.githubusercontent.com/ngrx/platform/22.0.0/modules/signals/events/src/with-event-handlers.ts)で確認した規則を固定契約にする。ドキュメント内の古い名称を見て `withEffects` をこの版の公開 API として追加せず、実際の exports を基準にする。

実例の `withViewBridge` のように SignalStore event を受けて `globalStore.dispatch` するコードは、明示的な bridge として通常の呼出し/配送辺をつなぐ。逆に `globalStore.dispatch(viewEvents.activateLoader(...))` は receiver が NgRx Store なので、それだけで `Events.on(viewEvents.activateLoader)` へ結ばない。橋渡しが見つからなければ送信済み・対応受信未検出として記録し、意図を推測して補正しない。

#### API と fixture の対応表

R01〜R15 は初期版の必須対応、R16 は未対応範囲を検知して止める必須診断。表中に複数 API/形態がある行は **API・形態ごとに fixture の subcase を持つ**。1 例だけ通して行全体を対応済みにしない。

| ID | 検知する API・形態 | 必須 fixture の期待値・禁止事項 |
| --- | --- | --- |
| R01 | `signal`、read、`set/update/asReadonly`、別名・service/facade 経由 | UI→state write→テンプレートを effect/dispatch なしで完結。read-only 参照は同一状態、同名の一般関数は Signal と誤認しない |
| R02 | `computed/linkedSignal`、equal、条件付き read、`untracked` | 依存の追加/除去を条件付きで表示。untracked の read を起動原因にせず、中の write/dispatch は残す。linkedSignal の再計算と明示 write を両方検知 |
| R03 | Angular `effect/afterRenderEffect`、cleanup/destroy | 初回実行・依存変化・描画後・破棄を区別。await 後の read を自動依存にしない。生成だけで全 callback を操作の結果にしない |
| R04 | `input/model`、`toSignal/toObservable`、`Store.selectSignal` | 親入力/暗黙出力、Observable↔Signal、selector→表示を追う。toSignal の内部購読と破棄、toObservable の通知集約を保持 |
| R05 | `signalStore/signalStoreFeature/withFeature`、生成変数・extends・再利用 feature | クラス宣言がなくても Store を発見。複数 feature の順序・上書き・provider 別インスタンスを分離 |
| R06 | `withState/withComputed/withLinkedState/withProps/withMethods/withHooks` | DI/default 引数/destructuring/捕捉変数を解決。未生成 Store の hook/handler を稼働中としない |
| R07 | `signalState/patchState/getState/watchState/deepComputed`、state の深いプロパティ | object/updater/複数 updater→変更 key→consumer を追う。getState の read と watchState の初回/更新通知を区別し、deep mutation で通知を捏造しない |
| R08 | `rxMethod`、`signalMethod` | 定義と起動を分離。値・Signal・計算関数、rxMethod の Observable 引数を別ケース化。API→patchState、取消し、destroy、未呼出しを検査 |
| R09 | `Store.dispatch(action)`、facade 経由、action object、`createAction/createActionGroup` | effect のない dispatch→`createReducer/on`→`createSelector/createFeature`→select/selectSignal→表示を必須ケースとする。単なる creator 呼出しには dispatch 辺を作らない |
| R10 | `Store.dispatch(() => action)` と明示 injector、`Store.next(action)` | 関数 overload の Signal 依存/再配送/破棄を追う。next は当該 Store の送信 API として識別し、一般の Subject.next と区別 |
| R11 | NgRx `createEffect/ofType`、返却 action、手動 dispatch、`dispatch:false` | 通常の自動 dispatch と callback 内の手動 dispatch を別々に検知。dispatch:false でも手動 dispatch は残す。未登録 effect は稼働中にしない |
| R12 | SignalStore `event/eventGroup`、`injectDispatch`、`Dispatcher.dispatch` | 名前付き送信と直接送信を同じ event に対応付け、生成だけの event と区別。alias/re-export、payload の経路を検査 |
| R13 | `withReducer/on`、`Events.on/ReducerEvents`、`withEventHandlers` | handler/API のない event→reducer→state→表示も検知。handler の内部購読、後続 event の自動配送、void/受信 event の素通し、破棄を検査 |
| R14 | `provideDispatcher`、self/parent/global、`toScope/mapToScope`、複数 Store | ローカル/親/グローバルの配送・受信経路を検査。異なる bus の同名 type を結ばず、明示 bridge がある場合だけ両系統を接続 |
| R15 | 実アプリ由来の複合ケース | ログ画面の injectDispatch→event→withReducer/withEventHandlers、設定 Store の withMethods→lastValueFrom(forkJoin)→patchState を検証。effect を探索起点に限定しない |
| R16 | 未対応版・未知 custom feature・`@ngrx/signals/entities` / resource 等の未対応拡張 | API の import/使用箇所を検出して unsupported と根拠を出す。既知 state/member を上書きし得る未知 feature は関連範囲を partial とし、透明な feature や「関係なし」と扱わない |

R08/R15 の RxJS 経路に必要な `of/from`、配列/Promise の ObservableInput、`firstValueFrom/lastValueFrom`、`distinctUntilChanged`、`@ngrx/operators` の `tapResponse/mapResponse` も既知アダプタに含める。signalMethod は rxMethod と同じ Observable 引数対応だと推定しない。Angular resource/rxResource/httpResource、NgRx ComponentStore、外部 toolkit 等は初期版で意味モデルが無ければ R16 の診断対象とし、通常の SignalStore と誤認しない。

中間モデルの state details に framework（angular-signal/signal-state/signal-store/ngrx-store）、宣言/インスタンス/状態 key を持たせる。`state-read` に tracking（tracked/snapshot/untracked）を持ち、effect の framework/実行 phase も保存する。配送は `action-dispatch/action-consume` と `event-dispatch/event-consume` を分け、それぞれ busId、送信形式、scope、登録/生存条件を保持する。Store method は `call`、patchState は `state-write`、computed 等は `reactive-link` で表し、全てを effect ノードに変換しない。

## 8. 出力形式と検査

資料の先頭は対象/所有者、project・snapshot・適用設定、候補 ID、選択した表示経路と root、イベント、confidence/coverage、重要な未解決理由。続いて `01` から子→root のコンポーネント節、宣言元/挿入先への参照、イベント別の処理、背景入力、診断・制限を置く。同名クラスはパスを併記し、同一クラスの別出現も別番号とする。循環末尾は参照先と打ち切りを表示し、存在しない root を番号付きで追加しない。

関係の文章は次の閉じた kind と定型文から生成する。`in/process/out/state/service/relation` は表示グループに限り、解析 kind と混同しない。全ての文末に根拠リンクと、必要な条件/未解決理由を付ける。未知 kind は自由作文に回さず schema/render エラーとする。

| kind | 必須 details | 定型文（`{…}` はモデル由来） |
| --- | --- | --- |
| `template-use` | owner, child, occurrence, location | `{owner} が {location} で {child} を宣言する` |
| `display-parent` | parent, child | `{child} の表示上の親は {parent}` |
| `projection` | child, host, slot | `{child} を {host} の {slot} に投影する` |
| `view-insertion` | fragment, declarer, insertion | `{declarer} の {fragment} を {insertion} に挿入する` |
| `route-load` | sourceRoute, targetRoute, loader | `{sourceRoute} が {loader} から {targetRoute} を取り込む` |
| `route-outlet` | route, component, outlet | `{route} の {component} を {outlet} に配置する` |
| `route-redirect` | route, destination | `{route} は {destination} へのリダイレクトを定義する` |
| `bootstrap` | application, component | `{application} が {component} を起動する` |
| `dynamic-create` | caller, component, container | `{caller} が {container} で {component} を生成する` |
| `dom-listener` | event, selected, listener, handler | `{selected} の {event} に対し {listener} の {handler} が登録されている` |
| `event-propagation` | event, fromElement, toElement, phase | `{event} は {phase} で {fromElement} から {toElement} に伝播し得る` |
| `input-binding` | expression, owner, input | `{owner} の {expression} を {input} に渡す` |
| `output-subscription` | output, subscriber | `{subscriber} が {output} を購読する` |
| `output-emit` | output, valueExpression, declaredType | `{output} に {valueExpression} を emit する（宣言型 {declaredType}）` |
| `call` | caller, callee, arguments | `{caller} が {callee}({arguments}) を呼ぶ` |
| `value-flow` | valueExpression, destination | `{valueExpression} が {destination} の入力となる` |
| `state-write` | writer, state, valueExpression | `{writer} が {state} を {valueExpression} で更新する` |
| `state-read` | reader, state, tracking | `{reader} が {state} を読む（{tracking}）` |
| `reactive-link` | source, operator, consumer, scheduling | `{source} は {operator} を介して {consumer} に接続する（{scheduling}）` |
| `query-target` | query, target, scope | `{query} が {scope} から {target} を参照する` |
| `di-resolve` | token, implementation, provider | `{token} は {provider} により {implementation} に解決される` |
| `action-dispatch` | caller, action, busId, dispatchMode | `{caller} が {busId} に {action} を dispatch する（{dispatchMode}）` |
| `action-consume` | action, consumer, busId, registration | `{registration} の {consumer} が {busId} から {action} を受け取る` |
| `event-dispatch` | caller, event, busId, scope, dispatchMode | `{caller} が {busId} の {scope} に {event} を送信する（{dispatchMode}）` |
| `event-consume` | event, consumer, busId, registration | `{registration} の {consumer} が {busId} から {event} を受け取る` |
| `http-create` | method, urlExpression, requestType, responseType | `{method} {urlExpression} の要求を作る（要求型 {requestType}、応答型 {responseType}）` |
| `http-consume` | request, consumer | `{request} は {consumer} の購読/開始に接続する` |
| `type-use` | value, type, role | `{value} は {role} として {type} を使用する` |
| `boundary` | reason, lastConfirmed | `{lastConfirmed} で追跡停止: {reason}` |

kind ごとに未知の details は null と理由を許し、その文を unresolved 表記にする。state-read の tracking は Signal 等の追跡対象でない通常の読み取りなら snapshot とする。dispatchMode は `explicit | reactive-factory | named-dispatcher | automatic-output` とし、送信形式を Markdown と JSON の双方に残す。確定できない表示親や通信先を placeholder 名で確定表現しない。conditions は条件式から機械的に表示し、自然言語で新しい因果を補わない。

検索 input の期待する資料内容は次のとおり（出力済みの実測ではなく受け入れ時の期待値）:

- SearchComponent: input → onValueChange → value$.next → debounce(timer(0)) → filter → emit。空値または親 value と異なる値、minimumChars の条件を保持する。
- EditableSectionComponent: search-button スロットへの投影。フォームコンテナを式の宣言元として参照する。
- フォームコンテナ: valueChanged → searchTable。検索語が変わる場合の state 更新・resetIndex と、同ハンドラ内の jumpToNextResult を示す。
- 子表の枝: searchedText の input 変更 → ngOnChanges の再計算 → searchCounterChanged/scrollToResultCounterReset の出力。即時ジャンプより後に再計算され得ることを区別する。
- 選択 route の祖先と bootstrap: 条件と出典を残して root まで続ける。
- 通信: 今回の起点から検出した要求だけ。未検出なら「この探索範囲で通信への接続は未検出」と coverage/停止理由を併記し、「アプリに API がない」とは書かない。

Markdown のソースリンクは**出力ファイルからの相対パス**に `#L<行>` を付け、空白・`#`・`%` 等を URL エンコードする。テキスト/属性/コード抜粋は Markdown/HTML としてエスケープし、ソース中の文字列をリンク構文として実行させない。異なるドライブ等で相対リンクを作れない場合は絶対パスのテキストと診断を出し、存在しない相対リンクを作らない。

ngmaze 起動前に解析対象のソース/テンプレート、設定/extends、依存 package metadata と lockfile の集合・内容ハッシュを記録する。後で発見した依存も読み込み時に追加し、ngmaze とローカル解析の後、出力前にファイル集合と内容を再確認する。根拠リンクに載ったファイルだけの検査では、別ファイルの変更による経路増減を見落とすため不十分とする。変更を検出したら成果物を破棄し code 4 で再実行を案内する。同一バイトへ戻る編集や検査直後の編集まで防ぐファイルシステム snapshot は保証しない。

さらに全 evidence の存在・行範囲・span と対象シンボルを検査する。根拠 ID の共有は許すが、異なる call site/使用箇所の辺を誤って統合しない。JSON と Markdown の一致は、**同じ中間モデルを両 renderer に渡す試験**で検証し、日時の異なる CLI 2 回実行のバイト比較は要求しない。

### 診断の関連付け

ngmaze の owner が選択経路/イベントの探索対象、候補 targets が対象、または location が関連 route・directive・service のいずれかに一致する gap は局所診断として付ける。owner=null でも後二者で関連付ける。owner だけでフィルターしない。

関連不明の owner=null は末尾の「解析全体の未検出範囲」、無関係の owner 付き gap はコード別件数とする。JSON の coverage には全 gap と `related | global-unknown | unrelated` を保持する。未検出カタログやスコープ全体の問題で候補漏れを否定できなければ関連に昇格する。ng-wiring が補完した gap は原記録を消さず、`resolvedBy` と補完根拠を添えて active な欠落から除く。

## 9. 依存関係・配置・配布

独立した Node.js CLI とし、グローバルインストールやブラウザー拡張は要求しない。ngmaze、TS/compiler の配布時バージョンは lockfile で固定し、解析には第4節の対象ツールチェーンを使う。JSON Schema の runtime validator も固定する。`ts-morph` / `ast-grep` は初期必須依存にしない。

```text
ng-wiring/
  package.json
  README.md
  dist/                     bin 用の配布 JavaScript
  docs/
    ng-wiring.schema.json   自前の JSON 契約
  src/
    cli/                    引数・対話・終了コード
    workspace/              context・設定・Program・snapshot
    index/                  component/directive/式/型の索引
    resolve/
      scope/                ngmaze の欠落も補完する Angular スコープ
      view/                 投影・TemplateRef・outlet・bootstrap
      operation/            イベント・呼出し・DI・状態/API
    model/                  根拠・条件・確定度・coverage
    render/                 定型文・Markdown・JSON・ファイル名
    adapters/ng-maze/        プロセス・契約検証・受領グラフ
    adapters/reactive/       Angular Signal・SignalStore・NgRx Store/Effects・RxJS の意味モデル
      capabilities.ts       R01〜R16 と API 別 matcher・意味モデル・対応版の対応
  test/
    fixtures/               最小 Angular 22 アプリ、偽陽性/欠落ケース
    contracts/
      reactive-cases.ts     R01〜R16 の API/subcase・期待辺・禁止辺・診断の一覧
```

bin は `ng-wiring` の 1 個。ビルド済み dist を GitHub 配布に含め、CI でソースからの再ビルドと一致を確認する。ngmaze の固定 GitHub 依存には prepare があるため、空の npm cache・空の作業ディレクトリからインストール/実行する配布試験を行う。アダプタ起動用依存と対象ソースの型解決を分離する。ng-maze は [MIT License](../ng-maze/LICENSE) に従って扱う。

初期版は永続キャッシュを持たない。1 実行内で同じ snapshot/context の AST・索引のみ再利用する。将来キャッシュを加える場合は設定、依存版、ファイル内容までキーに含める。

## 10. 実装順と受け入れ条件

実装順は context/契約 → 要素/スコープ → 表示/route → 操作/データ → DI/状態/API → renderer/配布。途中で出せる部分資料は明示し、下記の未達条件を無言で成功扱いしない。

| ID | 条件 | 合格基準 |
| --- | --- | --- |
| A01 | CLI 文法 | 属性の空値/内部引用符/`=`/Unicode、source の Windows path、project/tsconfig 排他、不正 candidate を仕様どおり判定 |
| A02 | 複数 context | 両アプリを個別設定で処理。共有部品は import closure を含める。別 tsconfig の同名 alias が違う実装に解決しても混線しない |
| A03 | ngmaze 契約 | 正常 JSON、meta/schema/version 不一致、非ゼロ、timeout、サイズ超過、stderr、欠落補完、source snapshot 変化を検証 |
| A04 | 候補 | 13 使用箇所、2 本のフォーム route、同一行複数タグ、共有 HTML、同名クラス、安定ソート/ID、非TTY・stdout pipe を検証 |
| A05 | スコープ | standalone/NgModule、同一 selector、複数 directive と hostDirectives、alias/継承/公開 metadata、未解決 import に偽の辺を作らない |
| A06 | 投影/fragment | search-button、既定/fallback/ngProjectAs、複数 select の優先順、多段投影、TemplateRef 入力/context、旧マイクロ構文、未生成 fragment、複数挿入先を分離 |
| A07 | route/root | componentless/loadChildren、同配列の複数使用、host=null、named outlet、複数 bootstrap、guard/redirect/未知 matcher を検証 |
| A08 | 制御フロー | if/else、for/empty、let、switch/default、defer の全 phase・OR trigger・prefetch・一度発火後の when=false、未知 AST の診断を検証 |
| A09 | DOM/output | アイコン→親 button、focus/blur 非バブル、focusin/out、smHesitate 非伝播、DOM/output 同名、stopPropagation と preventDefault、shadow/global listener の境界を検証 |
| A10 | 式/query/DI | executionParamsForm の隠蔽と this/private/protected、query の undefined/複数候補、provider override/multi/factory、viewProviders と投影を検証 |
| A11 | 検索操作 | input/keydown/click を分離。既定 false・minimumChars=1・debounceTime=0・filter・null による逆方向・即時ジャンプと後続再計算・clear の複数到達を保持 |
| A12 | データ伝播 | alias/model/two-way/form accessor、signal、RxJS の条件/取消し/購読寿命、未知演算子を透過扱いしない |
| A13 | NgRx | 登録済み/未登録/lazy effect、dispatch:false、同一 action type 衝突、success/error chain、selector 値の不変、背景の read と因果の分離 |
| A14 | HTTP/Model | 生成クライアント→ラッパー→要求/応答型、未購読 Observable、Promise、動的 URL、interceptor/cache/retry の境界。検索 input に無関係な保存 API を出さない |
| A15 | 有限化 | 同一クラス別出現は残す。合流を循環と誤認しない。循環、候補/深さ/状態数の上限で停止位置と partial を表示し、一意性を捏造しない |
| A16 | renderer | 全 kind の定型文、同一 IR の Markdown/JSON 一致、schema、confidence と coverage の独立、局所/全体 gap、リンク/span/特殊文字を検証 |
| A17 | ファイル | 合意形式、引用符/NFC 衝突/長名/同秒/大小文字/並行実行、排他作成、失敗時削除、stdout/stderr/終了コードを検証 |
| A18 | 配布/性能 | 固定 ngmaze の bin を各 OS で起動。Node 対応版、クリーン npx、dist 一致。実アプリと大規模 fixture で cold/warm 時間・両プロセスのピーク RSS を記録 |
| A19 | Angular Signal | R01〜R04 の各 API/subcase。effect のない state 更新、untracked、linkedSignal、interop/購読を含めて検証 |
| A20 | SignalStore/SignalState | R05〜R08。生成 Store、feature 合成、patchState、hooks、rxMethod/signalMethod と未生成/未起動の反例を検証 |
| A21 | 通常の dispatch | R09〜R11。effect なしの reducer 経路、facade、関数 overload、next、dispatch:false 内の明示 dispatch を検証 |
| A22 | SignalStore Events | R12〜R14。injectDispatch/Dispatcher、reducer のみ、handler の内部購読/自動配送、scope と別 bus の非接続を検証 |
| A23 | 現物と非対応境界 | R15/R16。ログ/設定 Store の実例と外部 feature の欠落診断を固定 fixture にし、未対応 API を無言で落とさない |
| A24 | 実装・試験の対応漏れ | 下記の API 台帳照合で未登録 matcher/意味モデル、欠落・skip/todo の fixture、根拠や禁止辺の不足を CI で失敗にする |

fixture では期待する辺の存在だけでなく、**存在してはいけない親子/因果の辺が無いこと**を検査する。対象アプリ全体のビルド成功は解析ツールの合格条件にしないが、検出した構文/型/設定エラーと関連する解析欠落は必ず出す。設計段階では上記を未実施として扱う。

### 実装・テスト時の漏れを防ぐ完了条件

R01〜R16 を `test/contracts/reactive-cases.ts` の独立した期待台帳へ転記し、API/subcase ごとに package/export/member、対象版、fixture ID、期待 node/edge、禁止 edge、期待 diagnostic を固定する。実装側 `capabilities.ts` には matcher ID、意味モデル ID、対応する契約 ID を登録する。**テスト対象を実装レジストリだけから生成しない。** 実装から丸ごと漏れた API がテストからも消えるためである。

台帳は表の検知 API だけでなく、期待値欄の reducer/selector API と本文で追加した RxJS 消費 API も対象にする。設計表の R ID と各 API/subcase の台帳への転記を実装レビューで照合し、CI では全 R ID の存在と台帳上の各 subcase の実行結果を検査する。API/subcase の削除・unsupported への変更は設計契約の変更としてレビューし、テストを通すために期待台帳だけを減らしてはならない。

CI は期待台帳→実装登録→実行された fixture 結果を突き合わせる。R01〜R15 の必須 API が unsupported のまま、fixture が未登録/skip/todo、期待辺の一部が欠ける、禁止辺が出る、起点やソース根拠を誤る場合は失敗とする。R16 は所定の境界・partial・診断が出ることを合格条件とする。単語検出や件数一致、スナップショット更新だけでは合格にしない。

特に `UI → signal.set/update → 表示`、`UI → SignalStore method → patchState → 表示`、`UI → Store.dispatch → reducer → selectSignal → 表示`、`UI → injectDispatch → withReducer → 表示` の **effect/API が存在しない4ケース**を独立した必須 fixture にする。別 fixture で effect/handler→API→state 更新を追加し、両方の経路が残ることを確認する。

実アプリのログ Store には外部 toolkit の feature もあるため、最小 fixture の成功で外部 feature 対応まで主張しない。実ソース由来の fixture では未対応境界も期待結果に含める。リリース前に全 R ID・API/subcase と A19〜A24 の対応を確認し、設計上の対象・実装済み・試験合格を別状態で報告する。

## 11. 提示された指摘の採否

原文は [x-claude指摘.md](x-claude指摘.md) に保持する。重要度の呼称ではなく、現物と仕様の問題を基準に判断した。

| 指摘 | 判断・反映 |
| --- | --- |
| 1-1 | 採用。タグ数を 13/13 に訂正。スコープが必要な根拠を重複 selector に差し替え |
| 1-2 | 採用。project/tsconfig を自前検証で排他にする |
| 1-3 | **現象は採用、原因説明と全体解析への置換案は不採用**。TS Program は共有部品を解決する。ngmaze の rootNames フィルターを確認し、個別 context の scope/catalog 補完を必須化 |
| 1-4 / 1-5 | 採用。ComponentId、複数 bootstrap、コンテキスト別の終端を規定 |
| 1-6 | 採用。ただし host=null を二択に限定せず、未接続の route 配列も未解決として扱う |
| 1-7 / 1-8 | 採用。outlet 名と位置を区別し、named outlet fixture と ngOnChanges 分岐のリンクラベルを修正 |
| 1-9 | 主要数値とソースを再確認。196 テストは先行報告であり今回の実行とは区別 |
| 2-1 | 採用。templateFile 逆引きと所有者別候補 |
| 2-2 | 版/出所の明文化は採用。**無条件 fallback は不採用**。対象依存を必須とし、現行 meta だけでは実体の同一性を検証できない点も明記 |
| 2-3 | 処理順の明確化は採用。**日時先頭への変更は不採用**。引用符付き/無しの入力は同義で、末尾固定日時から分解可能。合意済み形式を維持 |
| 2-4 | 採用・補強。output 非伝播と非バブル event を区別。同名 DOM/output の両登録を落とさない |
| 2-5 | 採用。最弱集約と coverage の独立を規定 |
| 2-6 / 2-7 | 採用。表示経路と宣言元を分離し、使用箇所 ID・循環・番号付け・上限を規定 |
| 2-8 / 2-9 | 採用。stdin+stderr の TTY、JSON 単独出力、同一 IR での renderer 比較 |
| 3-1 | 採用・補強。defer を単なる AND 条件とせず状態/OR trigger/prefetch として扱う |
| 3-2 | 採用。ただし実例の両コンポーネントは親子。問題は fragment 宣言と表示位置の違い |
| 3-3 | 名前の隠蔽と可視性の確認は採用。private を名前解決の代用にせず、明示 this と型検査設定も区別 |
| 3-4 / 3-5 | 採用。前向き因果・背景 read・停止規則と kind/定型文を明文化 |
| 3-6 | 採用・補強。owner=null も location/candidates で関連判定し、補完済み gap を識別 |
| 3-7 | 採用。Node engines、bin の package 基準解決、shell:false、配布試験を規定 |
| 3-8 | 測定値の記録は採用。**残る測定が Program 生成だけという判断は不採用**。経路展開・フロー・メモリ・両プロセス・規模依存を測る |

## 12. 独自の敵対的レビューと適用記録

### 1回目: 偽の接続を作らないか

提示指摘の反映と合わせ、コンテキスト間の型/alias 混線、ngmaze にない共有部品、同名 DOM/output、query の型とインスタンスの混同、DI override、未登録 effect、購読前の HTTP を再点検した。第4・6・7節に局所スコープ補完、receiver/生成文脈、登録・購読・停止条件を適用した。ファイル名の変更提案は既存合意と文法を再検討し、第3節の処理順で解消した。

### 2回目: 観点を切り替え、部分的な成功が完全な成功に見えないか

1回目の修正後、列挙の完全性、部分成功、モデル/出力の一意性、解析中の変更を観点として再レビューし、次を本文と受け入れ条件に適用した。

1. **合流を循環と誤認する危険**: flow の全体 visited では別経路からの同じ emit 到達が消える。現在の枝での再訪と memoization を分離し、親探索の循環キーから増え続ける祖先列を除いた。
2. **複数一致の誤処理**: component の一意性を directive に適用すると同一要素の複数 directive を落とす。また複数投影 select は常に曖昧ではない。directive 全件保持と投影の優先順を追加した。
3. **依存起動の未具体化**: ngmaze の package.json は exports で直接解決できない。Node の検索ディレクトリから package を見つける手順と bin 検査を規定した。
4. **設定と余分なソースの混入**: 明示 tsconfig では import closure を基準にし、ngmaze が走査した他 project のソースを自動採用しないようにした。entry と workspace root も明記した。
5. **出典ファイルだけを検査する不足**: リンクに載らないファイルや設定の変更でも経路は変わる。snapshot の検査を解析入力集合・追加依存まで広げた。
6. **出力契約の抜け**: EOF/help/version、終了コードの優先順、source の span 判定、ID の canonical 化、ロック名/解放、モデルの参照整合を規定した。

前回の設計改訂時にはローカルリンク 31 件の存在・行範囲、Markdown 表 9 個、コードフェンス、受け入れ条件 A01〜A18 の連番、`git diff --check` を確認した。参照行の内容照合で widgets の bootstrap を L18、上位 loadChildren を L88 に修正した。対象の Angular parser でも input 要素・属性 L16・4 イベント（focusin/focusout/input/keydown）を再取得した。実装時の受け入れ試験は第10節に残し、文書検査の成功で代用しない。

### 追加レビュー: Signal・SignalStore・dispatch の具体化

基本的な Signal 更新と Store.dispatch は記載済みだったが、SignalStore の生成クラス/feature と Events API、dispatch の関数 overload、effect を通らない経路の個別試験が不足していた。対象コードおよびインストール済み NgRx 22.0.0 の exports・型・実装を確認し、第7.6節の R01〜R16、第10節の A19〜A24、独立した期待台帳による CI 条件に反映した。特に通常の Store と SignalStore Events の配送先を分離し、名前付き injectDispatch、内部購読、明示 bridge、dispatch:false の中の手動 dispatch を落とさない契約とした。

追加後にローカルリンク 36 件、Markdown 表 10 個、コードフェンス、A01〜A24 と R01〜R16 の連番、差分の空白を検査した。ここで確認したのは設計・現物 API・文書整合であり、未実装の matcher や fixture を試験合格にはしていない。

## 13. 参照資料

現物の挙動は上記ローカルソースと固定バージョンを優先する。以下は仕様を照合した公式資料であり、最新版サイトの記述を対象版と無条件に同一視しない。

- [Angular の式と lexical context](https://angular.dev/guide/templates/expression-syntax)
- [Angular outputs](https://angular.dev/guide/components/outputs)
- [Angular テンプレート fragment](https://angular.dev/guide/templates/ng-template)
- [Angular コンテンツ投影](https://angular.dev/guide/templates/ng-content)
- [Angular defer](https://angular.dev/guide/templates/defer)
- [Angular queries](https://angular.dev/guide/components/queries)
- [Angular 階層 DI](https://angular.dev/guide/di/hierarchical-dependency-injection)
- [Angular HTTP](https://angular.dev/guide/http/making-requests)
- [Angular バージョン互換表](https://angular.dev/reference/versions)
- [NgRx Effects](https://ngrx.io/guide/effects)
- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [npm exec](https://docs.npmjs.com/cli/v11/commands/npm-exec/)
- [DOM Standard のイベント配送](https://dom.spec.whatwg.org/#dispatching-events)
- [UI Events のイベント定義](https://w3c.github.io/uievents/)
- [TypeScript の include と import](https://www.typescriptlang.org/tsconfig/#include)
- [Node.js child_process.spawn](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)
- [Angular Signals](https://angular.dev/guide/signals)
- [Angular linkedSignal](https://angular.dev/guide/signals/linked-signal)
- [Angular Signal と RxJS の相互変換](https://angular.dev/ecosystem/rxjs-interop)
- [NgRx 22 Dispatcher のソース](https://raw.githubusercontent.com/ngrx/platform/22.0.0/modules/signals/events/src/dispatcher.ts)
- [NgRx 22 withEventHandlers のソース](https://raw.githubusercontent.com/ngrx/platform/22.0.0/modules/signals/events/src/with-event-handlers.ts)
