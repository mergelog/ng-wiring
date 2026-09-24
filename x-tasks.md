# ng-wiring 実装進捗リスト

作成日: 2026-09-24

対象設計: [x-structure.md](x-structure.md)（2026-09-24 改訂）

現状: **実装中**。P0〜P16 を実施済みで、`ng-wiring` は候補選択から資料出力まで通る。残りは P17（配布・性能）、P18（実例シナリオ）と、P16 の台帳が示す R 契約 28 subcase の未達（P10〜P12 の解析側）である（§1, §2）。

## 進捗サマリ

| フェーズ | 主な対象 | 項目数 | 完了 | 前提 |
| --- | --- | --- | --- | --- |
| P0 プロジェクト基盤 | package/dist/依存固定 | 7 | 7 | — |
| P1 CLI 契約 | `src/cli` | 20 | 20 | P0 |
| P2 解析コンテキストと workspace | `src/workspace` | 19 | 19 | P0 |
| P3 ngmaze アダプタ | `src/adapters/ng-maze` | 12 | 12 | P2 |
| P4 索引と Angular スコープ解決 | `src/index`, `src/resolve/scope` | 13 | 13 | P2, P3 |
| P5 表示経路・投影・TemplateRef | `src/resolve/view` | 10 | 10 | P4 |
| P6 route と bootstrap | `src/resolve/view` | 10 | 10 | P4 |
| P7 制御フローと有限化 | `src/resolve/view` | 10 | 10 | P5, P6 |
| P8 リスナー・DOM 伝播・式 | `src/resolve/operation` | 14 | 14 | P4 |
| P9 入出力・状態・非同期 | `src/resolve/operation` | 11 | 11 | P8 |
| P10 DI と NgRx Store | `src/resolve/operation` | 12 | 12 | P9 |
| P11 Signal・SignalStore・dispatch | `src/adapters/reactive` | 15 | 15 | P9, P10 |
| P12 API・HTTP・型 | `src/resolve/operation` | 7 | 7 | P9 |
| P13 中間モデルと schema | `src/model`, `docs` | 15 | 15 | P5〜P12 |
| P14 renderer とファイル名 | `src/render` | 22 | 22 | P13 |
| P15 診断の関連付けと coverage | `src/model`, `src/render` | 6 | 6 | P13 |
| P16 fixture・期待台帳・CI | `test/` | 15 | 15 | 各フェーズ並行 |
| P17 配布・性能 | 配布・計測 | 7 | 0 | P14, P16 |
| P18 実例シナリオの受け入れ | 検索 input 一式 | 8 | 0 | P14 |
| 完了時の報告規約 | リリース判定 | 4 | 0 | P16, P17 |
| **合計** | | **237** | **218** | |

別表: 受け入れ条件 A01〜A24（24 行 × 実装/fixture/CI）、必須検知契約 R01〜R16（16 行 × matcher/意味モデル/台帳/fixture）。フェーズ側を埋めても、この 2 表が埋まるまで完了ではない。

## 使い方

- 各項目は [x-structure.md](x-structure.md) の節番号（§）を根拠に持つ。着手前に該当節を読む。
- `- [x]` は「実装済み **かつ** 対応 fixture が green」の意味。実装だけ済んだ段階は `- [~]` とし、`[x]` に繰り上げない（§10 の「設計上の対象・実装済み・試験合格を別状態で報告する」規定）。
- 受け入れ条件 A01〜A24 と必須検知契約 R01〜R16 は末尾の対応表で個別に管理する。フェーズ側の項目を埋めても、対応表が埋まるまで完了ではない。
- フェーズ順は §10 の実装順（context/契約 → 要素/スコープ → 表示/route → 操作/データ → DI/状態/API → renderer/配布）に従う。P8 以降は P2〜P4 が無いと着手できない。

## P0 プロジェクト基盤（§9）

- [x] P0-01 `package.json` 作成。bin は `ng-wiring` の 1 個、`engines` は `^22.22.3 || ^24.15.0 || >=26.0.0`（§4.2, §9）
- [x] P0-02 §9 のディレクトリ雛形を作る（`src/cli`, `src/workspace`, `src/index`, `src/resolve/{scope,view,operation}`, `src/model`, `src/render`, `src/adapters/ng-maze`, `src/adapters/reactive`, `docs`, `test/fixtures`, `test/contracts`）
- [x] P0-03 lockfile で ngmaze の固定リビジョン `6da3534…`・TS/@angular/compiler の配布版・JSON Schema runtime validator を固定（§9）
- [x] P0-04 `ts-morph` / `ast-grep` を初期必須依存に入れないことを確認（§9）
- [x] P0-05 `dist/` ビルド設定と、CI でのソース再ビルド一致検査（§9, A18）
- [x] P0-06 永続キャッシュを持たない実装方針（1 実行内で同じ snapshot/context の AST・索引のみ再利用）（§9）
- [x] P0-07 ng-maze の MIT License 表記の取り込み（§9）

## P1 CLI 契約（`src/cli`, §3）

- [x] P1-01 位置引数 `属性名=値` のパーサ。最初の `=` で分割、空の属性名はエラー、値全体を囲む一致した引用符 1 組のみ除去、内部の引用符は残す、raw 引数も保存（§3.1, §3.4-1）
- [x] P1-02 `--source <path>:<line>`。末尾 `:<正整数>` を分離して Windows ドライブ表記と衝突させない。属性指定と排他（§3.1）
- [x] P1-03 `--project` / `--tsconfig` の排他を ngmaze 起動前に自前検証（§3.1, 指摘 1-2）
- [x] P1-04 `--through <ClassName|path#ClassName>`。複数 ComponentId に解決したら識別子一覧を返して再指定を要求（§3.1）
- [x] P1-05 `--route <path>` の完全一致絞り込み（実 URL・query・fragment・glob として解釈しない）（§3.1）
- [x] P1-06 `--candidate <番号|cand:ID>`。1 始まり番号または SHA-256 全桁、範囲外・不存在はエラー（§3.1）
- [x] P1-07 `--event <name>` の正規化（`keydown` は `keydown.enter` 等を含む、修飾子付きは完全一致、該当なしでも理由付き資料を出す）（§3.1）
- [x] P1-08 `--out-dir <dir>`（未存在なら作成、ソースリンクの基準にする）（§3.1）
- [x] P1-09 `--json`（ファイルを 1 個だけ作り、stdout に JSON 本文を流さない）（§3.1）
- [x] P1-10 `--help` / `--version` は stdout に案内を出して code 0、対象引数不要（§3.3）
- [x] P1-11 未知/重複した単値オプション、対象指定なし/両方指定を code 3（§3.3）
- [x] P1-12 終了コード 0/1/2/3/4/5/130 と判定順（引数・設定 → 致命的失敗 → 対象なし（欠落なら 5、他は 1）→ 選択要求 2 → 出力成功時 0/5）（§3.3）
- [x] P1-13 stdout は完成ファイルの絶対パス 1 行のみ、診断・候補・進捗は stderr（§3.3）
- [x] P1-14 相対パスの基準分離（tsconfig/out-dir は実行ディレクトリ、source/ComponentId は workspace root）（§3.1）
- [x] P1-15 candidate の識別 tuple（context + 所有者 + span + 使用箇所列 + route 定義/loader 列 + bootstrap + 投影先）と canonical JSON → SHA-256。日時・OS 固有絶対ルートを含めない（§3.2）
- [x] P1-16 `snapshotId` を candidate ID とは別に保持（§3.2）
- [x] P1-17 候補の安定順序（`/` 区切りワークスペース相対、Unicode code point と数値位置、locale 非依存）（§3.2）
- [x] P1-18 対話選択（stdin と stderr がともに TTY のときだけ stderr に一覧とプロンプト、stdout がパイプでも可、EOF は code 2、非対話は ID 付き一覧を出して資料を作らない）（§3.2, §3.3）
- [x] P1-19 候補の分類表示（bootstrap 到達済み / 宣言・使用のみ / 未生成 TemplateRef / 動的配置未解決）と、不完全候補の明示選択（§3.2）
- [x] P1-20 列挙上限に達した場合は自動選択を禁止し、候補ゼロを一意と扱わない。省略された ID の指定は through/route/project による絞り込みを案内（§3.2）

## P2 解析コンテキストと workspace（`src/workspace`, §4.1, §4.2）

- [x] P2-01 `AnalysisContext`（workspace root, project 名, tsconfig+extends のハッシュ, compilerOptions, toolchain, entry）。同ソースでも context が違えば別ノード（§4.1）
- [x] P2-02 `angular.json` の `architect.build` / `targets.build` の **options** から tsConfig と browser/main を取得。無ければ `tsconfig.app.json` → `tsconfig.json` の順、どれも無ければ code 3（§4.1）
- [x] P2-03 project 指定なしなら全 application project をそれぞれの設定で直列解析し、候補一覧だけ統合。application 無しは code 3（§3.1）
- [x] P2-04 library の扱い（参照された範囲を含め、単独指定時は bootstrap 未到達の資料を許す）。異なる project のグラフを接続しない（§3.1）
- [x] P2-05 明示 tsconfig の workspace root 決定と、solution-style の複数 references を勝手に選ばない（§3.1, §4.1）
- [x] P2-06 TS 設定読み込み API で extends / paths / baseUrl / moduleResolution / references を解決し、noEmit で Program + TypeChecker を作る（§4.1）
- [x] P2-07 解析対象集合 = 設定の fileNames + Program が import で読んだワークスペース内部の非宣言ソース。spec・生成物・node_modules・`_old` を走査から除外し、依存に必要な除外ソースは gap（§4.1）
- [x] P2-08 外部パッケージの `.d.ts` は型・公開 Angular メタデータのみに使い、再帰探索の対象外にする（§4.1）
- [x] P2-09 明示 tsconfig では fileNames と import closure に限定し、別 project の sourceRoot や alias をマージしない（§4.1）
- [x] P2-10 未使用ファイルの発見と bootstrap からの到達可能性を別に扱う（§4.1）
- [x] P2-11 外部境界の判定（ワークスペース外の linked source、宣言ファイルに置き換わった project reference、解決できない拡張子）（§4.1）
- [x] P2-12 entry の決定（project の browser/main、明示設定なら fileNames 内の entry、複数なら別候補）。不明なら bootstrap を推測せず partial（§4.1）
- [x] P2-13 fileReplacements・独自 builder・SSR/hydration を未適用として解析メタデータに記載。production/defaultConfiguration を暗黙適用しない（§4.1）
- [x] P2-14 限定 AST 評価器（import・定数・オブジェクト/配列・単純な戻り値のみ。式ごと最大 10,000 展開・深さ 64、副作用/循環/評価不能は停止。getter・provider factory・route loader を実行しない）（§4.1）
- [x] P2-15 snapshot 記録（ソース/テンプレート、設定/extends、依存 package metadata、lockfile の集合と内容ハッシュ。後から読んだ依存も追加）（§8）
- [x] P2-16 出力前の snapshot 再確認。変更を検出したら成果物を破棄して code 4 で再実行案内（根拠リンク掲載ファイルだけの検査では不足）（§8）
- [x] P2-17 ツールチェーン解決（対象 node_modules の TS と `@angular/compiler` を優先、未検出・ロード失敗で同梱版へ黙って継続しない、AST を版混在させない）（§4.2）
- [x] P2-18 対応版検査（Angular 22.x / TS 6.0.x、固定試験版 compiler・core 22.1.5 と TS 6.0.3、core/compiler の整合、非対応は code 3）（§4.2）
- [x] P2-19 リアクティブ依存の版検査（`@ngrx/store|effects|signals` 22.0.0、RxJS 7.8.2 を固定試験版に。未対応版・未知 API は該当アダプタの unsupported で部分解析、未使用パッケージを必須依存にしない）（§4.2）

## P3 ngmaze アダプタ（`src/adapters/ng-maze`, §4.3）

- [x] P3-01 package root 解決（`createRequire(import.meta.url).resolve.paths('ngmaze')` の検索ディレクトリ順に `ngmaze/package.json` をファイルとして探し、realpath と name/version を照合。exports 越しの解決と未生成 main を経由しない）（§4.3）
- [x] P3-02 `bin.ngmaze` が package root 内の実在ファイルか検査（§4.3）
- [x] P3-03 `spawn(process.execPath, [binPath, ...args], {shell:false, cwd: workspaceRoot})` で起動。PATH 上の別 ngmaze や Windows `.cmd` shim に依存しない（§4.3）
- [x] P3-04 引数生成の 2 形態（`--project <絶対> --angular-project <name> --json` / `--project <絶対> --tsconfig <絶対> --json`）。component クエリ・`--all`・`--with-routes` は渡さない（§4.3）
- [x] P3-05 契約検証（v0.1.0、固定リビジョン、スキーマハッシュ、`docs/ngmaze.schema.json` と JSON 契約を境界にする。内部モジュールを import しない）（§4.3）
- [x] P3-06 照合項目（workspaceRoot/analysisRoot の realpath、primary + 付加 tsconfig、project 集合、TS/compiler の版と source、ComponentId のパス）。meta だけで完全一致の証明としない（§4.3）
- [x] P3-07 不一致時は結合せず code 3。bundled へ fallback した ngmaze の結果も拒否（§4.2, §4.3）
- [x] P3-08 受領データの利用（`result.components`（templateFile/templateKind 含む）、`edges`、`routes`、`routeEdges`、`externalUsages`、`ambiguousUsages`、`global.diagnostics`、`global.detectionGaps`）（§4.3）
- [x] P3-09 project 集合の期待値比較（project 指定は 1 件、明示 tsconfig は ngmaze の発見集合。後者を使用アプリ集合と読み替えない）（§4.3）
- [x] P3-10 プロセス制御（120 秒で終了、stdout は 64 MiB 上限のストリーム収集、超過・異常終了・不正 JSON・stderr・`error` を診断、非ゼロ終了を成功 JSON として消費しない、複数 context は直列実行して Program を解放）（§4.3）
- [x] P3-11 受領辺の自前 AST/span 照合と `origin: ngmaze` / `origin: ng-wiring` の付与（§4.3）
- [x] P3-12 欠落補完（report-widgets のように import で到達した共有部品が省かれる場合を自前カタログで補う。別アプリの全体解析の辺をコピーしない）（§4.3, 指摘 1-3）

## P4 索引と Angular スコープ解決（`src/index`, `src/resolve/scope`, §4.3, §3.1）

- [x] P4-01 component/directive/pipe カタログ（`ComponentId = workspace相対TSパス#ClassName`、内部キー `(contextId, ComponentId)`。selector/className をキーにしない）（§5）
- [x] P4-02 独立 scope resolver（standalone の imports、NgModule の declarations/imports/exports、継承した入出力、公開 `.d.ts` メタデータをシンボルで解決）（§4.3）
- [x] P4-03 Angular compiler の selector matcher を使用元の有効スコープにだけ適用（§4.3）
- [x] P4-04 component は唯一の対象と確認できたときだけ辺を作り、directive は一致した全宣言を保持（§4.3, 2回目レビュー 2）
- [x] P4-05 静的 hostDirectives と公開 input/output alias を適用 directive に含める。未知 metadata・動的 hostDirectives・スコープ循環は未解決（§4.3）
- [x] P4-06 要素抽出（`parseTemplate` で属性・イベント・位置を取得。HTML の正規表現を主解析にしない）（§2, §3.1）
- [x] P4-07 属性一致（静的属性名とデコード済み値の完全一致。大小文字・空白・Unicode 正規化で対象を増減させない。`data-id="a"` と `data-id=a` は同一クエリ。空値許可、存在属性は `search-button=`）（§3.1）
- [x] P4-08 `[attr.data-id]`・補間・host 属性・実行時属性は静的一致に含めず、検出範囲を診断（§3.1）
- [x] P4-09 `--source` の span 判定（`[startOffset, endOffset)` の開始タグ span と重なる要素だけ。本文・閉じタグ・コメントだけの行は一致なし）（§3.1）
- [x] P4-10 同一行に複数タグ、同一 HTML に複数所有者（ServingComponent / ServingLoadingComponent）の全組合せを候補化（§2, §3.1）
- [x] P4-11 インラインテンプレートの cooked/raw offset 変換。変換できないときは行を推測せず診断（§3.1）
- [x] P4-12 `@for` 内の位置はソース要素を表し、個々の行データを表さないことをモデルに反映（§3.1）
- [x] P4-13 CSS selector・`:nth-child()`・`_ngcontent-*` を識別構文にしない（§3.1）

## P5 表示経路・投影・TemplateRef（`src/resolve/view`, §6.1）

- [x] P5-01 表示経路の構築（AST の包含、投影スロット、TemplateRef の生成先から作る。ngmaze の `template` 辺をそのまま表示親にしない）（§6.1）
- [x] P5-02 宣言元を別参照として保持し、多段投影の宣言元は各節から参照する枝にする（§6.1）
- [x] P5-03 子から root への `01, 02, …` 採番。別の挿入箇所は別 candidate（§6.1, §8）
- [x] P5-04 `ng-content` の照合（select、静的 ngProjectAs、既定スロット、fallback content。複数一致は宣言順で最初、判断不能時のみ未解決、該当スロット無しは「投影されない」診断で表示経路を作らない）（§6.1）
- [x] P5-05 投影先でも式の所有者と DI コンテキストを変更しない。`ng-content` を DOM 要素として数えない。表示条件と生成条件を別保持（§6.1）
- [x] P5-06 TemplateRef 追跡（`#ref`、view/content query、入力/プロパティ代入 → `NgTemplateOutlet`、`ViewContainerRef.createEmbeddedView`、既知の構造ディレクティブ）（§6.1）
- [x] P5-07 `*` マイクロシンタックスは Angular AST の展開結果を用い、`ng-container` / `ng-template` を実 DOM の祖先に数えない。宣言だけの fragment は未生成（§6.1）
- [x] P5-08 任意の独自ディレクティブの挿入先を推測しない（§6.1）
- [x] P5-09 fragment 内のスコープ（クラスメンバーは宣言元で評価、`let-` / `$implicit` は挿入時 context、`ngTemplateOutletInjector` の DI 変更は別扱い）（§6.1）
- [x] P5-10 dynamic creation（dialog、`createComponent`、`NgComponentOutlet`）は呼出元/生成元の枝として示し、描画コンテナ未確定なら表示上の親へ昇格しない。外部ライブラリのラッパーは外部境界（§6.1）

## P6 route と bootstrap（`src/resolve/view`, §6.2）

- [x] P6-01 root の `provideRouter` / `RouterModule.forRoot` と routes 参照、`children`、`loadChildren`、`RouterModule.forChild`、`loadComponent` をソースから再構築（§6.2）
- [x] P6-02 `RouteOccurrenceId` に定義位置 + 使用/loader の列を入れ、同じ routes 配列を別 path から取り込む場合も区別（§6.2）
- [x] P6-03 componentless route は URL/条件の列に残し、コンポーネント節にしない。static redirect は遷移参照で親子辺にしない（§6.2）
- [x] P6-04 guard・matcher・記述順・先行候補・pathMatch を条件として保持し、URL 一致だけで activation を確定しない（§6.2）
- [x] P6-05 `host === null` を bootstrap 直下と解釈しない。取り込み元を調べ、root router 設定まで接続できた route だけを bootstrap の outlet に結ぶ。ロード元不明の route 配列も未解決として残す（§6.2, 指摘 1-6）
- [x] P6-06 outlet 探索（primary/named を最寄り表示ホストのテンプレートとその子 view 内で探し、名前・router context・生成条件を照合。root から任意の outlet を探さない）（§6.2）
- [x] P6-07 outlet が無い/複数で絞れない/投影・TemplateRef で router context 不明は未解決。path だけで区別できない named outlet は candidate 化（§6.2）
- [x] P6-08 bootstrap 解決（選択 entry から到達する `bootstrapApplication`、または `bootstrapModule` と NgModule の bootstrap 配列。未使用の別 entry の bootstrap を結合しない）（§6.2）
- [x] P6-09 application ノード→bootstrap component と bootstrap component→最初の route component を別の辺にする（`AppRootComponent → AppComponent` は router 配置）（§2, §6.2）
- [x] P6-10 動的 `resetConfig` 等は到達範囲の gap として記録（§6.2）

## P7 制御フローと有限化（§6.3）

- [x] P7-01 `@if/@else if/@else`（先行条件の否定を含める）（§6.3）
- [x] P7-02 `@for/@empty`（要素存在・反復数不明・空集合を保持）（§6.3）
- [x] P7-03 `@switch/@case/@default`（switch 式と case の対応を保つ）（§6.3）
- [x] P7-04 `@let` は値/スコープの定義として扱い、表示分岐にしない（§6.3）
- [x] P7-05 `@defer` の phase 分離（main/placeholder/loading/error）と on/when・prefetch・after/minimum の個別保持（§6.3）
- [x] P7-06 `@defer` の合成規則（複数トリガーは OR、外側ブロックとの包含は AND、when が false に戻っても未ロードへ戻さず「起動済み」状態として表す、prefetch は描画完了でない、SSR/hydrate をブラウザー操作に混ぜない）（§6.3, 指摘 3-1）
- [x] P7-07 未知のテンプレート AST を読み飛ばさず unsupported として coverage に反映（§6.3）
- [x] P7-08 親探索の循環キー `(contextId, 定義ID, 使用位置, 関係種別, 直近の route/fragment 挿入位置)`。伸び続ける祖先配列を含めない。異なる使用箇所の同じクラスは残す（§6.3, 2回目レビュー 1）
- [x] P7-09 再帰は具体インスタンスを列挙せず cycle boundary と他の非循環 root 経路を併記（§6.3）
- [x] P7-10 初期上限（親経路深さ 200、候補 1,000、展開状態 100,000）と、上限に達した枝・未列挙範囲の記録（§6.3）

## P8 リスナー・DOM 伝播・テンプレート式（`src/resolve/operation`, §7.1, §7.2）

- [x] P8-01 Angular スコープで component/directive の output（alias と継承）を解決。emit は購読関係で DOM をバブルさせない（祖先の `(smHesitate)` / `(valueChanged)` を UI イベントの伝播先にしない）（§7.1）
- [x] P8-02 DOM event の経路を独立評価。同名の output があっても DOM 経路を全削除しない（§7.1, 指摘 2-4）
- [x] P8-03 バージョン管理した標準 UI event 表（bubbles/composed）。初期必須は click/dblclick/input/change/keydown/keyup/mouseover/mouseout/focusin/focusout + 非バブルの focus/blur/mouseenter/mouseleave（§7.1）
- [x] P8-04 非バブル event は対象自身のリスナーのみ追う。capture 登録が明示解決できれば別経路。未知 CustomEvent は bubbles/composed 不明なら unresolved（§7.1）
- [x] P8-05 伝播抑止の条件化（stopPropagation/stopImmediatePropagation、キー修飾子、disabled、shadow DOM の retargeting、DOM 配置の未知）。preventDefault や `return false` を伝播停止と同一視しない（§7.1）
- [x] P8-06 `window:` / `document:` を global listener として明示し、祖先要素を捏造しない（§7.1）
- [x] P8-07 イベント間の自動派生（click→submit、focus()→focusin 等）は conditional/境界に留める（§7.1）
- [x] P8-08 選択要素・リスナー要素・event source・修飾子・購読先を別フィールドに保持（§7.1）
- [x] P8-09 Angular lexical scope の構築（`@let`、ループ/fragment 変数、`#ref`、`$event`、pipe、メンバーを解決してから TS シンボルへ結ぶ。Angular AST を TypeChecker に直接渡さない）（§7.2）
- [x] P8-10 `#ref` の種別判定（`exportAs` は directive、component host 上の裸 ref は component、通常要素は DOM 要素）（§7.2）
- [x] P8-11 ローカル変数の隠蔽と明示 `this`、`public`/`protected`/継承/アクセス可能性の検査。private を名前解決の代用にしない（§7.2, 指摘 3-3）
- [x] P8-12 query 解決（viewChild/contentChild、read、子 view/投影範囲、条件、複数一致、任意性。非 required の undefined、`.required` でも表示失敗の可能性を残す）（§7.2）
- [x] P8-13 呼出し解決（callee と receiver のシンボル・値の由来を呼出箇所ごとに。継承/override・関数値・union・computed property・any は境界。メソッド名や返却型だけで別インスタンスへ接続しない）（§7.2）
- [x] P8-14 型診断があっても構文上確認できる関係は診断付きで残し、実行可能とは保証しない（§7.2）

## P9 入出力・状態・非同期（§7.3）

- [x] P9-01 `input`/`input.required`/`@Input`/`model` と property binding、`output`/`@Output` と event binding を alias 込みで対応付け（§7.3）
- [x] P9-02 入力既定値はその使用箇所のみ適用。transform・setInput・imperative assignment・別 provider/生成経路があれば条件を残す。静的属性が directive input に渡る場合も扱う（§7.3）
- [x] P9-03 `model` の暗黙 `nameChange`、two-way binding、フォーム directive と ControlValueAccessor を既知アダプタで分離。未知 accessor/pipe/transform を透過的代入にしない（§7.3）
- [x] P9-04 Angular/RxJS/NgRx の API は import 元のシンボルで認識し、同名のユーザー関数を誤認しない（§7.3）
- [x] P9-05 呼出箇所と状態更新の区別（property assignment、signal set/update、computed/effect、Subject next/subscribe、input 変更と ngOnChanges の関連）（§7.3）
- [x] P9-06 購読の登録文脈（constructor/ngOnInit）を調べ、そこでの無関係な初期化を今回の因果に足さない。生存期間・条件付き購読・unsubscribe/takeUntilDestroyed を条件化（§7.3）
- [x] P9-07 RxJS アダプタ初期セット（`Subject`、subscribe、map/tap/filter、debounce/debounceTime、switchMap/mergeMap/concatMap/exhaustMap、withLatestFrom/concatLatestFrom、take、catchError、forkJoin、timer、async pipe）と取消し/並行/直列/間引き条件の記録（§7.3）
- [x] P9-08 追加の既知 API（`of`/`from`、配列/Promise の ObservableInput、`firstValueFrom`/`lastValueFrom`、`distinctUntilChanged`、`@ngrx/operators` の `tapResponse`/`mapResponse`）（§7.6）
- [x] P9-09 未知演算子は効果を推定せず、既知の前後を未解決境界で区切る（§7.3）
- [x] P9-10 時系列の区別（同期呼出し、output、RxJS 演算子、timer、Promise、変更検知の境界、`EventEmitter(true)` の非同期設定）（§7.3）
- [x] P9-11 根拠の重複除去と操作回数を分離（`clear()` の直接 emit と `value$.next('')` 経由は別経路。回数を証明できなければ「最大1回」「必ず2回」と書かない）（§7.3）

## P10 DI と NgRx Store（§7.4）

- [x] P10-01 injector 階層の解決（選択 bootstrap/route/component の injector、providers/viewProviders、providedIn、useClass/useExisting/useValue/useFactory、multi、optional/self/skipSelf/host）。型注釈だけで具象を確定しない（§7.4）
- [x] P10-02 投影/TemplateRef と injector の文脈の区別。factory 戻り値・上書き・複数実装が一意にならなければ token で停止（§7.4）
- [x] P10-03 Store/feature/effect の登録解決（`provideStore/provideState/provideEffects`、`StoreModule.forRoot/forFeature`、`EffectsModule.forRoot/forFeature`、lazy route 登録、生存期間）。ファイルに effect 宣言があるだけでは有効としない（§7.4）
- [x] P10-04 **dispatch の検知に effect の存在を要求しない**。UI/コンポーネント/サービス/facade/SignalStore method からの dispatch と、`dispatch → reducer → select/selectSignal → 表示` を必須経路として実装（§7.4）
- [x] P10-05 action は creator のシンボルと type 値を記録。別 creator が同じ静的 type を持つ場合は衝突を診断して候補を残す。動的 type を名前の類似で解決しない（§7.4）
- [x] P10-06 成功/失敗 action は emit/return が確認できた分だけ次段へ追い、返却値の自動 dispatch 設定と `dispatch:false`、functional effect を条件に反映（§7.4）
- [x] P10-07 因果境界の実装（前向き追跡：同期/非同期呼出し・値の書き込み・output・dispatch・確認済み購読先）（§7.4）
- [x] P10-08 reducer の書き込み → selector/computed 依存 → 既存の購読/テンプレート消費。「state が変化したから必ず emit」とせず投影値・比較・購読状態を条件化（§7.4）
- [x] P10-09 変化の証拠がない read は参考入力とし、withLatestFrom/concatLatestFrom の既存値を過去の API へ逆接続しない。背景データ源は直接の selector/input/signal 定義までの別欄（§7.4）
- [x] P10-10 flow の有限化（イベントごと最大 10,000 展開状態、call stack 深さ 64、状態キーに symbol/call site・receiver・使用コンテキスト・起点イベント・抽象引数）（§7.4）
- [x] P10-11 現在の枝での同一キー再訪のみ循環境界とし、他の枝からの再到達は memoized 結果の別到達辺として再利用（§7.4, 2回目レビュー 1）
- [x] P10-12 停止理由の記録（未解決関数、外部実装、未知演算子、上限）。未知の先を架空の因果でつながない（§7.4）

## P11 Signal・SignalStore・dispatch の共通実装（`src/adapters/reactive`, §7.6）

- [x] P11-01 `capabilities.ts` に matcher ID・意味モデル ID・対応契約 ID（R01〜R16）を登録（§9, §10）
- [x] P11-02 Angular Signal・NgRx Store・NgRx SignalStore を別 framework として区別（`angular-signal` / `signal-state` / `signal-store` / `ngrx-store`）（§7.6）
- [x] P11-03 state details（framework、宣言/インスタンス/state key）と `state-read` の tracking（tracked/snapshot/untracked）、effect の framework/実行 phase（§7.6）
- [x] P11-04 配送の分離（`action-dispatch`/`action-consume` と `event-dispatch`/`event-consume`、各々 busId・送信形式・scope・登録/生存条件）（§7.6）
- [x] P11-05 Store method は `call`、patchState は `state-write`、computed 等は `reactive-link`。全てを effect ノードに変換しない（§7.6）
- [x] P11-06 `signalStore(...)` の**変数へ返される生成クラス**のカタログ化（宣言ファイル・変数/シンボル位置・context で ID、インスタンスは DI provider/生成箇所。`class X extends signalStore(...)`、別名 import/re-export、再利用 feature の直接参照と factory 呼出しも追う）（§7.6）
- [x] P11-07 feature の引数順合成と同名 member の上書き判定（宣言順・実際の型/値解決）。未知 feature を透明として通過させない（§7.6）
- [x] P11-08 destructuring した state signal・method 内で捕捉した store 参照を元のインスタンスへ戻す（§7.6）
- [x] P11-09 Store の提供だけでは生成済みとせず、inject/new と withHooks の生存期間を確認。onInit は起動条件、onDestroy は終了条件として扱う（§7.6）
- [x] P11-10 SignalStore Events の scope 対応（`provideDispatcher`、self/parent/global、`toScope`/`mapToScope`、`injectDispatch(group)({scope:'parent'})`）。同じ event type でも無関係な sibling/local scope に配らない（§7.6）
- [x] P11-11 通常の NgRx Store と SignalStore Events を別 bus として扱い、同じ `{type, payload}` で自動的に双方へ届くとしない（§7.6）
- [x] P11-12 `withEventHandlers` の規則（初期化時の購読登録、出力が新 event の場合の再配送、void の副作用、受信 event の素通し、`[event, scope設定]` の区別）と `withReducer` 更新→handler 通知の順序（§7.6）
- [x] P11-13 明示 bridge（実例の `withViewBridge` 型）のみ両系統を接続し、`globalStore.dispatch(viewEvents.x())` を `Events.on` へ結ばない。橋渡し未検出は「送信済み・対応受信未検出」と記録（§7.6）
- [x] P11-14 `withEffects` のような古い名称を公開 API として追加せず、実際の exports を基準にする（§7.6）
- [x] P11-15 R01〜R16 の個別実装は末尾の [R 対応表](#必須検知契約-r01r16) で管理（§7.6）

実装メモ: P11 完了後に `rxMethod` の呼出し判定（R08）を P12 で厳格化した。下の [P12 の実装メモ](#p12-apihttp型75) を参照。

## P12 API・HTTP・型（§7.5）

- [x] P12-01 サービス→生成クライアント→共通ラッパー→HTTP の段階解決（HTTP method、URL の静的部分/式、request 引数、response 型）（§7.5）
- [x] P12-02 URL が動的でも method/型を失わず、URL だけ unresolved にする。`Observable<any>` でも内部 `post<Response>` の型を区別（§7.5）
- [x] P12-03 型の掲載範囲（値/引数/返却で実際に使われた interface・type alias・生成 DTO・ジェネリックのみ。import 全件を Model として列挙しない）（§7.5）
- [x] P12-04 Observable の作成と購読による通信開始の区別（subscribe、登録済み effect の flattening、async pipe、`firstValueFrom`/`lastValueFrom`、`toSignal` の内部購読、`rxMethod` の pipeline、`withEventHandlers` の購読）。作るだけなら通信候補で止める（§7.5）
- [x] P12-05 Promise API は呼出し時の開始と `await`/`then` の結果を分ける（§7.5）
- [x] P12-06 interceptor・キャッシュ・retry・share/replay・取消しを枝として示し、未知なら HTTP 境界の診断。購読の発見だけで「必ず1回通信」と書かない（§7.5）
- [x] P12-07 API 名や factory 宣言の発見だけを通信開始としない（登録・インスタンス生成・入力/トリガーからの到達を確認）（§7.5）

実装メモ: P12-07 の fixture（rxMethod の未呼出し判定）で P11 の誤検知が出たため、`src/adapters/reactive/methods.ts` の `signals/rxMethod` 名前フォールバックを厳格化した（コミット 3a41f6b）。ソース内に自前の宣言を持つメンバー呼出し（例: 生成クライアントの `client.search(...)`）は、同名の Store メソッド `search: rxMethod(...)` の呼出しとは見なさない。P11 の判定を変える修正なので、R08 の subcase fixture（P16-03）を書く際はこの区別を期待値に含めること。

## P13 中間モデルと schema（`src/model`, §5）

- [x] P13-01 Markdown と JSON を同じ正規化済みモデルから生成する構造（§5）
- [x] P13-02 `docs/ng-wiring.schema.json`（`schemaVersion: "1.0.0"`）に必須フィールド・列挙・不変条件を表現。意味を変える変更は major を上げる（§5）
- [x] P13-03 トップレベルフィールド（schemaVersion/toolVersion/status/generatedAt/snapshotId/context/query/selection/nodes/edges/evidence/conditions/paths/operations/diagnostics/coverage/limits）（§5）
- [x] P13-04 定義ノードと使用箇所ノードの分離。`OccurrenceId` は context・所有者・使用 span・挿入/投影/route 文脈を含み、具体インスタンス数を表さない（§5）
- [x] P13-05 node kind の列挙（application/component/directive/pipe/element/template/route/listener/symbol/operation/state/action/event/event-bus/effect/service/http/type/boundary）と、参照先のない辺の禁止（§5）
- [x] P13-06 evidence（id/file/startOffset/endOffset/startLine/startColumn/endLine/endColumn/precision/symbolId/contentHash。offset は UTF-16、半開区間、行列 1 始まり、インラインは対応表、`approximate` を正確なタグ位置に使わない）（§5）
- [x] P13-07 edge（id/from/to/kind/evidenceIds/conditionId/confidence/origin/contextId/details。evidenceIds を空にしない。方向は親→子・原因→受け手で保存し、表示時のみ逆順に辿る）（§5）
- [x] P13-08 condition 木（true/false/predicate/all/any/not/phase。predicate は元の式・位置・スコープ、phase は lifecycle/defer/subscription/route activation。評価不能を false にしない）（§5）
- [x] P13-09 `confidence` 3 値（confirmed/conditional/unresolved）と単一路の最弱集約、分岐見出しでの最弱値 + 各枝値、false と証明できた枝の除外理由の診断（§5）
- [x] P13-10 `coverage`（complete-within-scope / partial）を confidence と独立に算出。親経路・各イベント・全体で別々に集約し、無関係な枝が親の確定度を書き換えない（§5）
- [x] P13-11 探索辺の扱い（解決不能は `boundary` kind、接続は判明して付随情報のみ未知なら元の kind に field 別 unresolved reason）（§5）
- [x] P13-12 モデル検証（全 ID 参照の存在、context 一致、edge kind と両端 node kind の整合、partial の理由、行/span 範囲）（§5）
- [x] P13-13 `paths` / `operations`（順序付き occurrence/edge ID、宣言元 ID、終端理由、confidence、coverage / 起点 event・listener ID と到達 node・edge ID）（§5）
- [x] P13-14 診断（id/code/severity/message/evidenceIds/relatedIds/stopReason。ソース根拠のない診断は evidenceIds を空配列可）（§5）
- [x] P13-15 単一出力には選択 context のみ格納し、別 context は候補一覧と集計に留める（§5）

実装メモ: §8 の kind 表を `src/model/types.ts` の `edgeContracts`（両端 node kind + 必須 details）として 1 箇所に持ち、`docs/ng-wiring.schema.json` の kind 別 `if/then` はこの表から起こした。P14-04 の定型文も同じ表を参照し、両者の一致は `test/model-p13.test.mjs` の schema 照合試験で固定する。kind を増やす変更は表・schema・定型文・試験を同時に直す。

`coverage.gaps` の `relation` / `resolvedBy` の判定は P15 の `src/model/gaps.ts` に入れた（`ReportBuilder.gap` は判定済みの relation を受け取るままで、`relateGaps` が判定して登録する）。インラインテンプレートの evidence は `EvidenceTable.registerInline` に対応表を登録して初めて TS ファイル位置へ解決するため、P16 の組み立てでテンプレート索引から登録すること。

## P14 renderer とファイル名（`src/render`, §3.4, §8）

- [x] P14-01 資料冒頭（対象/所有者、project・snapshot・適用設定、候補 ID、選択した表示経路と root、イベント、confidence/coverage、重要な未解決理由）（§8）
- [x] P14-02 本体構成（`01` から子→root のコンポーネント節、宣言元/挿入先への参照、イベント別の処理、背景入力、診断・制限）（§8）
- [x] P14-03 同名クラスのパス併記、同一クラスの別出現は別番号、循環末尾は参照先と打ち切りを表示、存在しない root を番号付きで追加しない（§8）
- [x] P14-04 §8 の全 kind の定型文実装（template-use / display-parent / projection / view-insertion / route-load / route-outlet / route-redirect / bootstrap / dynamic-create / dom-listener / event-propagation / input-binding / output-subscription / output-emit / call / value-flow / state-write / state-read / reactive-link / query-target / di-resolve / action-dispatch / action-consume / event-dispatch / event-consume / http-create / http-consume / type-use / boundary）（§8）
- [x] P14-05 未知 kind を自由作文に回さず schema/render エラーにする。`in/process/out/state/service/relation` は表示グループに限り解析 kind と混同しない（§8）
- [x] P14-06 details が未知なら null + 理由で unresolved 表記。`dispatchMode` は explicit/reactive-factory/named-dispatcher/automatic-output を Markdown と JSON 双方に残す（§8）
- [x] P14-07 conditions は条件式から機械的に表示し、自然言語で新しい因果を補わない。確定できない表示親・通信先を placeholder 名で確定表現しない（§8）
- [x] P14-08 全ての文末に根拠リンクと必要な条件/未解決理由を付ける（§8）
- [x] P14-09 ソースリンクは出力ファイルからの相対パス + `#L<行>`、空白/`#`/`%` を URL エンコード。相対化できない場合は絶対パスのテキストと診断（§8）
- [x] P14-10 テキスト/属性/コード抜粋を Markdown/HTML としてエスケープし、ソース文字列をリンク構文として実行させない（§8）
- [x] P14-11 JSON renderer（`--json` でファイル 1 個、拡張子のみ `.json`）（§3.1, §3.4）
- [x] P14-12 同一 IR を両 renderer に渡す一致試験（CLI 2 回実行のバイト比較は要求しない）（§8, 指摘 2-9）
- [x] P14-13 ファイル名の基本形 `ngwi-{処理名}-{YYMMDD.HHMMSS}.md` と処理順 1〜5 の実装（§3.4）
- [x] P14-14 見出しは `SearchComponent.data-id="searchInputField"`、ファイル名元文字列は `SearchComponent.data-id=searchInputField`。値内部の引用符は除かない（§3.4-1）
- [x] P14-15 `--source` の処理名は `ComponentClass.要素名-L行番号-パスハッシュ`（所有コンポーネント ID + ソースパスの SHA-256 先頭 12 桁）（§3.4-1）
- [x] P14-16 ファイル名用文字列のみ NFC 化し、ASCII 英数字・`_`・`-`・`.`・`=` 以外を `%HH`（大文字、`%` 自身も）に変換。照合用の値・識別子は正規化しない（§3.4-2）
- [x] P14-17 160 文字超過時の短縮（`%HH` を分断しない先頭 140 文字 + `-h<元文字列 SHA-256 先頭 12 桁>`、元文字列は本文に無損失で残す）（§3.4-3）
- [x] P14-18 解析開始時のローカル日時を付与し、本文に ISO 8601 + UTC offset を残す（§3.4-4）
- [x] P14-19 衝突回避（大小文字を無視した既存名検査、**処理名側**に `-c1`, `-c2`…）（§3.4-5）
- [x] P14-20 出力の直列化（`.ng-wiring-output.lock` を `wx` で作成、最終ファイルも `wx`、既存を上書きしない、ロック競合は code 4、他プロセスのロックを削除しない、finally で解放）（§3.4-5）
- [x] P14-21 完全な出力内容をメモリ上で検証してから書き、失敗時は自分が作った不完全ファイルを削除。成功するまで stdout にパスを出さない（§3.4）
- [x] P14-22 `status: partial` を本文冒頭/JSON に表示。対象外の局所 gap だけでは partial にせず、起動点・スコープ全体を壊す gap は関連として扱う（§3.3）

実装メモ: `src/render` は中間モデルだけを読み、確定度・coverage・ID を再計算しない。§8 の kind 表は `src/render/sentences.ts` の `sentenceTemplates` として持ち、`sentenceSlotProblems()` が `src/model/types.ts` の `edgeContracts` との一致を固定する。定型文の slot は必須 details の**部分集合**とする。`template-use` の `occurrence` のように、参照用に必須でも §8 の文には現れない details があるため。

`state` と `service` は表示グループ名であると同時に node kind でもある。混同を避けるため定型文は辺 kind だけで引き、表示グループは日本語ラベル（入力/処理/出力/状態/サービス/関連）として raw kind の隣に別に出す。`displayGroupProblems()` が「表示グループ名を辺 kind にしない」ことを固定する。

節の見出しラベルは occurrence node の `details.label`（無ければ `details.name`、宣言シンボル名、kind の順）から取る。P16 の組み立てでは要素 occurrence に `label` を入れること。同名クラスのパス併記は**宣言元**のパスで判定する（使用箇所のファイルでは同じ親テンプレート内の 2 つを区別できない）。

辺は必ず資料のどこか 1 箇所以上に出る。`produceReport` は書き出し前に全辺が出力に載ったことを確認し、1 つでも欠ければファイルを作らずに失敗する（P14-21）。例外は §8 が求める「通信」節で、そこだけ http 辺を再掲する。

`--json` の本文は schema の `additionalProperties: false` に従い report そのものだけを入れる。短縮前のファイル名元文字列は Markdown 本文にのみ載せ、JSON 側は `query.raw` と `selection.ownerId` から同じ文字列を再構成できる状態に留める。

P1-09 はこのフェーズで fixture が揃ったため `[~]` から `[x]` に繰り上げた（`test/render-p14.test.mjs` の CLI 経由試験で、`--json` がファイル 1 個のみを作り stdout に本文を流さないことを固定した）。

## P15 診断の関連付けと coverage 集計（§8）

- [x] P15-01 局所診断の判定（owner が選択経路/イベントの探索対象、候補 targets が対象、location が関連 route・directive・service のいずれかに一致）。owner だけでフィルターしない（§8）
- [x] P15-02 owner=null も location/candidates で関連付け、関連不明なら末尾の「解析全体の未検出範囲」へ（§8, 指摘 3-6）
- [x] P15-03 無関係な owner 付き gap はコード別件数として集計（§8）
- [x] P15-04 JSON の coverage に全 gap と `related | global-unknown | unrelated` を保持（§8）
- [x] P15-05 未検出カタログやスコープ全体の問題で候補漏れを否定できない gap は関連に昇格（§8）
- [x] P15-06 ng-wiring が補完した gap は原記録を消さず `resolvedBy` と補完根拠を添えて active な欠落から除く（§8）

実装メモ: 判定は `src/model/gaps.ts` の `placeGap` 1 箇所に置き、`ReportBuilder.relateGaps(gaps, scope)` が判定 → 登録をまとめる。`GapScope` は探索した owner（クラス/メンバー）、選択の候補 targets、関連 route・directive・service のファイル、そして「候補漏れを否定できない」理由（`incomplete`）を持つ。owner は `path#Class` と `path#Class.member` を同一所有者として突き合わせ、`def:` 前置と `\` 区切りも受け付ける。

判定順は owner → candidates → location → 昇格 → 既定で、owner が対象外でも candidates と location を必ず見る（§8「owner だけでフィルターしない」）。`incomplete` の項目は owner/file を持てば該当する gap だけを、どちらも持たなければスコープ全体の問題として全 gap を related に昇格する（P15-05）。関連付けの根拠文は `relateGaps` の戻り値にだけ載せ、schema は変えていない（1.0.0 のまま）。

`validateReport` に 3 分類の不変条件を足した（global-unknown は owner=null、unrelated は owner 必須、`gapCounts` は unrelated の code 別件数と一致、active な related gap は `coverage.reasons` に載る、`resolvedBy` は既知 ID と補完根拠を伴う）。Markdown は「関連する未検出」を active だけにし、補完済みは原記録として別の一覧に出す（P15-06）。

## P16 fixture・期待台帳・CI（`test/`, §10）

- [x] P16-01 `test/fixtures` に最小 Angular 22 アプリと偽陽性/欠落ケースを用意（§9, §10）
- [x] P16-02 期待する辺の存在だけでなく、**存在してはいけない親子/因果の辺が無いこと**を検査（§10）
- [x] P16-03 `test/contracts/reactive-cases.ts` に R01〜R16 を転記（API/subcase ごとに package/export/member、対象版、fixture ID、期待 node/edge、禁止 edge、期待 diagnostic）（§10）
- [x] P16-04 表の検知 API に加え、期待値欄の reducer/selector API と本文で追加した RxJS 消費 API も台帳対象にする（§10）
- [x] P16-05 テスト対象を実装レジストリから生成しない構成にする（実装から漏れた API がテストからも消えるため）（§10）
- [x] P16-06 CI で期待台帳 → 実装登録 → 実行された fixture 結果を突き合わせる（§10）
- [x] P16-07 CI 失敗条件（R01〜R15 の必須 API が unsupported、fixture が未登録/skip/todo、期待辺の欠落、禁止辺の出現、起点やソース根拠の誤り）（§10）
- [x] P16-08 R16 は所定の境界・partial・診断が出ることを合格条件にする。単語検出・件数一致・スナップショット更新を合格にしない（§10）
- [x] P16-09 effect/API が存在しない 4 ケースを独立した必須 fixture にする（`UI → signal.set/update → 表示`、`UI → SignalStore method → patchState → 表示`、`UI → Store.dispatch → reducer → selectSignal → 表示`、`UI → injectDispatch → withReducer → 表示`）（§10）
- [x] P16-10 別 fixture で `effect/handler → API → state 更新` を追加し、両方の経路が残ることを確認（§10）
- [x] P16-11 実ソース由来 fixture（ログ Store、設定 Store）には未対応境界も期待結果に含める。最小 fixture の成功で外部 feature 対応を主張しない（§10）
- [x] P16-12 API/subcase の削除・unsupported 化は設計契約の変更としてレビューし、テストを通すために期待台帳を減らさない（§10）
- [x] P16-13 設計表の R ID と台帳の各 API/subcase の転記を実装レビューで照合（§10）
- [x] P16-14 検出した構文/型/設定エラーと関連する解析欠落を必ず出す（対象アプリ全体のビルド成功は合格条件にしない）（§10）
- [x] P16-15 受け入れ条件 A01〜A24 は末尾の [A 対応表](#受け入れ条件-a01a24) で管理（§10）

実装メモ: 各解析層から中間モデルへの組み立ては `src/assemble` に置いた。`analyzeWorkspace` が context ごとに catalog・ngmaze 基礎グラフ・テンプレート索引・route グラフ・候補を作り、`assembleReport` が選択候補 1 件を §5 のモデルへ正規化する。確定度・coverage・ID は `ReportBuilder` が決め、組み立て側では再計算しない。`createBackend` が `analyze` と `write` で同じ Program を使い回す。

表示経路は `placeSteps` が ViewStep を occurrence ノードへ落とす。`component-use` と直後の `element` は同じ位置の 2 ステップなので 1 ノードに畳む（§5 の occurrence 鍵は relation を含まないため、畳まないと ID が衝突する）。route ノードは表示連鎖に入れず、`<router-outlet>` を持つ要素を表示親にする（§6.2）。bootstrap は `bootstrap`（application→component 宣言）と `display-parent` の 2 辺を出す。

操作側は listener ごとに 1 operation を作り、reactive 層 → NgRx/HTTP trace の順に材料化する。片方が止まった位置を他方が解決していれば、境界ではなく `resolvedBy` 付きの未検出として記録する（§8, P15-06）。Store member と signal の write は「解決済み受信者への呼出しで実際に入った method」に限って帰属させる。ハンドラー名と同名の Store member を取り違えないための条件である。

台帳 `test/contracts/reactive-cases.ts` は §7.6 の表からの手書き転記で、110 subcase を持つ。`scripts/check-contracts.mjs` が 台帳 → 実装レジストリ → fixture 実行結果 を突き合わせ、CI で失敗させる。2026-09-25 時点で 82 subcase が fixture 合格、28 subcase が未達で、いずれも「どの fixture のどの起点が何を示しているか」を `demonstratedBy` と `missingFixture` に持つ。未達の内訳は R08 が 6（rxMethod/signalMethod の本体に入れない）、R09/R10 が 7（createActionGroup、creator を介さない action object、`Store.next`、関数 overload の区別、`store.select().subscribe()` の稼働判定、`createFeature` 内の reducer）、R05/R06 が 6（extends・withFeature 越しの member 解決、provider 別インスタンス、生成 Store の withComputed/withLinkedState/withHooks）、R04 が 2（toSignal/toObservable の接続）、R07 が 2（watchState/deepComputed の接続）、R15 が 4（of/from/distinctUntilChanged の辺化、設定 Store の method 到達）、R14 が 1（mapToScope の fixture）。これらは P10〜P12 の解析側の未達であり、台帳を削って通すことはしない（§10, P16-12）。

P16 の作業中に他フェーズへ入れた修正: `src/resolve/operation/expressions.ts` に補間式（`{{ }}`）の解決を追加した（§7.2, P8）。これが無いと state が画面に届く辺を一切作れない。`src/adapters/reactive/capabilities.ts` に `of` / `from` / `distinctUntilChanged` / `tapResponse` / `mapResponse` を登録し、`injectDispatch` / `Dispatcher.dispatch` の contracts に R14 を加えた（§7.6, P11）。いずれも意味モデルは既にあり、レジストリへの登録だけが漏れていた。

## P17 配布・性能（§9, §10）

- [x] P17-01 独立した Node.js CLI として動作（グローバルインストール・ブラウザー拡張を要求しない）（§9）
- [ ] P17-02 bin は 1 個、ビルド済み `dist` を GitHub 配布に含め、CI でソースからの再ビルド一致を確認（§9）
- [ ] P17-03 空の npm cache・空の作業ディレクトリからのインストール/実行試験（ngmaze の固定 GitHub 依存に prepare があるため）（§9）
- [ ] P17-04 アダプタ起動用依存と対象ソースの型解決を分離（§9）
- [ ] P17-05 Linux/WSL・macOS・Windows の配布スモークテスト（固定 ngmaze の bin 起動を含む）（§4.2, §10 A18）
- [ ] P17-06 対応 Node 版での実行確認（§4.2）
- [ ] P17-07 性能測定（実アプリ + 大規模 fixture、cold/warm 差、ng-wiring と ngmaze 両プロセスの合算時間とピーク RSS）。単発参考値で済ませない（§2, §10 A18, 指摘 3-8）

## P18 実例シナリオの受け入れ（検索 input、§8）

> 出力済みの実測ではなく、受け入れ時の期待値。

- [ ] P18-01 SearchComponent: `input` → `onValueChange` → `value$.next` → `debounce(timer(0))` → `filter` → emit。空値/親 value との差異・`minimumChars` の条件を保持（§8）
- [ ] P18-02 使用コンテキストの入出力評価（`enableSearchOnSubmit` 既定 `false` で束縛なし、`minimumChars=1`、`debounceTime=0`、`timer(0)` を非同期境界として残す）（§2, §8）
- [ ] P18-03 EditableSectionComponent: `search-button` スロットへの投影と、式の宣言元としてのフォームコンテナ参照（§2, §8）
- [ ] P18-04 フォームコンテナ: `valueChanged` → `searchTable`（検索語変更時の state 更新・resetIndex と同ハンドラ内の `jumpToNextResult`）（§2, §8）
- [ ] P18-05 子表の枝: `searchedText` の input 変更 → `ngOnChanges` の再計算 → `searchCounterChanged`/`scrollToResultCounterReset`。即時ジャンプより後に再計算され得ることを区別（§2, §8）
- [ ] P18-06 「前へ」操作: アイコン自体ではなく親 button の click、`findNext(true)` が `output<string>()` に `null` を渡す点、strictNullChecks 設定の記録（型エラーと断定しない）（§2）
- [ ] P18-07 選択 route の祖先と bootstrap まで条件・出典付きで到達（`SearchComponent → EditableSectionComponent → ExperimentInfoHyperParametersFormContainerComponent → … → AppComponent → AppRootComponent`、終端を `sm-root` に固定しない）（§1, §8）
- [ ] P18-08 通信: 起点から検出した要求だけを載せ、未検出なら「この探索範囲で通信への接続は未検出」を coverage/停止理由付きで出す（「アプリに API がない」と書かない）。検索 input に無関係な保存 API を出さない（§8, A14）

## 受け入れ条件 A01〜A24

§10 の表に対応。3 列を別状態として管理する（実装 = matcher/解析が入った、fixture = 期待値と禁止辺を検査する試験が green、CI = 常時検査に載った）。

| ID | 条件 | 実装 | fixture | CI |
| --- | --- | --- | --- | --- |
| A01 | CLI 文法（属性の空値/内部引用符/`=`/Unicode、source の Windows path、project/tsconfig 排他、不正 candidate） | [ ] | [ ] | [ ] |
| A02 | 複数 context（両アプリを個別設定、共有部品の import closure、同名 alias の非混線） | [ ] | [ ] | [ ] |
| A03 | ngmaze 契約（正常 JSON、meta/schema/version 不一致、非ゼロ、timeout、サイズ超過、stderr、欠落補完、snapshot 変化） | [ ] | [ ] | [ ] |
| A04 | 候補（13 使用箇所、2 本のフォーム route、同一行複数タグ、共有 HTML、同名クラス、安定ソート/ID、非TTY・stdout pipe） | [ ] | [ ] | [ ] |
| A05 | スコープ（standalone/NgModule、同一 selector、複数 directive と hostDirectives、alias/継承/公開 metadata、未解決 import に偽の辺を作らない） | [ ] | [ ] | [ ] |
| A06 | 投影/fragment（search-button、既定/fallback/ngProjectAs、複数 select の優先順、多段投影、TemplateRef 入力/context、旧マイクロ構文、未生成 fragment、複数挿入先） | [ ] | [ ] | [ ] |
| A07 | route/root（componentless/loadChildren、同配列の複数使用、host=null、named outlet、複数 bootstrap、guard/redirect/未知 matcher） | [ ] | [ ] | [ ] |
| A08 | 制御フロー（if/else、for/empty、let、switch/default、defer の全 phase・OR trigger・prefetch・一度発火後の when=false、未知 AST の診断） | [ ] | [ ] | [ ] |
| A09 | DOM/output（アイコン→親 button、focus/blur 非バブル、focusin/out、smHesitate 非伝播、DOM/output 同名、stopPropagation と preventDefault、shadow/global listener） | [ ] | [ ] | [ ] |
| A10 | 式/query/DI（executionParamsForm の隠蔽と this/private/protected、query の undefined/複数候補、provider override/multi/factory、viewProviders と投影） | [ ] | [ ] | [ ] |
| A11 | 検索操作（input/keydown/click の分離、既定 false・minimumChars=1・debounceTime=0・filter・null による逆方向・即時ジャンプと後続再計算・clear の複数到達） | [ ] | [ ] | [ ] |
| A12 | データ伝播（alias/model/two-way/form accessor、signal、RxJS の条件/取消し/購読寿命、未知演算子を透過扱いしない） | [ ] | [ ] | [ ] |
| A13 | NgRx（登録済み/未登録/lazy effect、dispatch:false、同一 action type 衝突、success/error chain、selector 値の不変、背景 read と因果の分離） | [ ] | [ ] | [ ] |
| A14 | HTTP/Model（生成クライアント→ラッパー→要求/応答型、未購読 Observable、Promise、動的 URL、interceptor/cache/retry の境界、無関係な保存 API を出さない） | [x] | [~] | [~] |
| A15 | 有限化（同一クラス別出現を残す、合流を循環と誤認しない、循環・候補/深さ/状態数の上限で停止位置と partial、一意性を捏造しない） | [ ] | [ ] | [ ] |
| A16 | renderer（全 kind の定型文、同一 IR の Markdown/JSON 一致、schema、confidence と coverage の独立、局所/全体 gap、リンク/span/特殊文字） | [ ] | [ ] | [ ] |
| A17 | ファイル（合意形式、引用符/NFC 衝突/長名/同秒/大小文字/並行実行、排他作成、失敗時削除、stdout/stderr/終了コード） | [ ] | [ ] | [ ] |
| A18 | 配布/性能（固定 ngmaze の bin を各 OS で起動、Node 対応版、クリーン npx、dist 一致、cold/warm 時間・両プロセスのピーク RSS） | [ ] | [ ] | [ ] |
| A19 | Angular Signal（R01〜R04 の各 API/subcase、effect のない state 更新、untracked、linkedSignal、interop/購読） | [x] | [~] | [~] |
| A20 | SignalStore/SignalState（R05〜R08、生成 Store、feature 合成、patchState、hooks、rxMethod/signalMethod と未生成/未起動の反例） | [x] | [~] | [~] |
| A21 | 通常の dispatch（R09〜R11、effect なしの reducer 経路、facade、関数 overload、next、dispatch:false 内の明示 dispatch） | [ ] | [ ] | [ ] |
| A22 | SignalStore Events（R12〜R14、injectDispatch/Dispatcher、reducer のみ、handler の内部購読/自動配送、scope と別 bus の非接続） | [x] | [~] | [~] |
| A23 | 現物と非対応境界（R15/R16、ログ/設定 Store の実例と外部 feature の欠落診断を固定 fixture 化、未対応 API を無言で落とさない） | [x] | [x] | [x] |
| A24 | 実装・試験の対応漏れ（API 台帳照合で未登録 matcher/意味モデル、欠落・skip/todo の fixture、根拠や禁止辺の不足を CI で失敗に） | [x] | [x] | [x] |

`[~]` は一部の subcase だけが fixture/CI に載っている状態を指す。列の対応関係は `test/a-conditions-p16.test.mjs` が検査し、実装が `[ ]` のまま fixture や CI を `[x]` にできない。P16 時点の対応は次のとおり。

- A23: `test/fixtures/real-log-store` / `real-settings-store` / `unsupported-apis` と `test/real-source-p16.test.mjs` / `test/reactive-fixture-p16.test.mjs`。
- A24: `test/contracts/reactive-cases.ts`（台帳）、`scripts/check-contracts.mjs`（照合）、CI の `npm run check:contracts`。
- A14/A19/A20/A22 は P16 の fixture が一部の subcase を覆ったのみで、残りは台帳の `missingFixture` が示す。

## 必須検知契約 R01〜R16

§7.6 の表に対応。R01〜R15 は初期版の必須対応、R16 は未対応範囲を検知して止める必須診断。**複数 API/形態がある行は API・形態ごとに fixture subcase を持ち、1 例だけ通して行全体を対応済みにしない。**

| ID | 検知する API・形態 | matcher 実装 | 意味モデル | 台帳転記 | 全 subcase fixture |
| --- | --- | --- | --- | --- | --- |
| R01 | `signal`、read、`set/update/asReadonly`、別名・service/facade 経由 | [x] | [x] | [x] | [x] |
| R02 | `computed/linkedSignal`、equal、条件付き read、`untracked` | [x] | [x] | [x] | [x] |
| R03 | Angular `effect/afterRenderEffect`、cleanup/destroy | [x] | [x] | [x] | [x] |
| R04 | `input/model`、`toSignal/toObservable`、`Store.selectSignal` | [x] | [x] | [x] | [~] |
| R05 | `signalStore/signalStoreFeature/withFeature`、生成変数・extends・再利用 feature | [x] | [x] | [x] | [~] |
| R06 | `withState/withComputed/withLinkedState/withProps/withMethods/withHooks` | [x] | [x] | [x] | [~] |
| R07 | `signalState/patchState/getState/watchState/deepComputed`、state の深いプロパティ | [x] | [x] | [x] | [~] |
| R08 | `rxMethod`、`signalMethod` | [x] | [x] | [x] | [~] |
| R09 | `Store.dispatch(action)`、facade 経由、action object、`createAction/createActionGroup` | [x] | [x] | [x] | [~] |
| R10 | `Store.dispatch(() => action)` と明示 injector、`Store.next(action)` | [~] | [~] | [x] | [~] |
| R11 | NgRx `createEffect/ofType`、返却 action、手動 dispatch、`dispatch:false` | [x] | [x] | [x] | [x] |
| R12 | SignalStore `event/eventGroup`、`injectDispatch`、`Dispatcher.dispatch` | [x] | [x] | [x] | [x] |
| R13 | `withReducer/on`、`Events.on/ReducerEvents`、`withEventHandlers` | [x] | [x] | [x] | [x] |
| R14 | `provideDispatcher`、self/parent/global、`toScope/mapToScope`、複数 Store | [x] | [x] | [x] | [~] |
| R15 | 実アプリ由来の複合ケース（ログ画面の injectDispatch→event→withReducer/withEventHandlers、設定 Store の withMethods→lastValueFrom(forkJoin)→patchState） | [~] | [~] | [x] | [~] |
| R16 | 未対応版・未知 custom feature・`@ngrx/signals/entities`/resource 等（Angular resource/rxResource/httpResource、NgRx ComponentStore、外部 toolkit を含む） | [x] | [x] | [x] | [x] |

`[~]` は一部の API/形態だけが通っている状態。台帳転記は全行 `[x]`（`test/contracts/reactive-cases.ts` に 110 subcase）で、fixture 列は `npm run check:contracts` の結果と対応する。2026-09-25 時点で 82 subcase 合格・28 subcase 未達。未達は全て台帳の `demonstratedBy` が示す fixture 起点で再現でき、内訳は P16 の実装メモに記した。

## 完了時の報告規約（§10）

- [ ] リリース前に全 R ID・API/subcase と A19〜A24 の対応を確認する
- [ ] 「設計上の対象」「実装済み」「試験合格」を別状態で報告する（総称の「signal 対応」「NgRx 対応」で実装済み・試験済みと判定しない）
- [ ] 文書検査（リンク存在・行範囲・表・連番）の成功を受け入れ試験の代用にしない
- [ ] 途中で出せる部分資料は明示し、未達条件を無言で成功扱いしない
