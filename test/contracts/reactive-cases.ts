/**
 * §10 the expectation ledger for the required detection contracts R01–R16.
 *
 * It is transcribed from the §7.6 table of [x-structure.md](../../x-structure.md) **by hand**. It is
 * never generated from `src/adapters/reactive/capabilities.ts`, because an API that fell out of the
 * implementation would then disappear from the tests as well (§10, P16-05). Every row of that table
 * contributes one entry per API and per form; one example passing never covers the whole row.
 *
 * A case without a fixture states why in `missingFixture`. That is a recorded gap the CI check reports,
 * not permission to drop the case: removing an API or moving it to unsupported is a change to the design
 * contract and is reviewed as one (§10, P16-12).
 */

export type ContractId = 'R01' | 'R02' | 'R03' | 'R04' | 'R05' | 'R06' | 'R07' | 'R08'
  | 'R09' | 'R10' | 'R11' | 'R12' | 'R13' | 'R14' | 'R15' | 'R16';

export const contractIds: readonly ContractId[] = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08',
  'R09', 'R10', 'R11', 'R12', 'R13', 'R14', 'R15', 'R16'];

/** What kind of thing the subcase fixes: a call, a member, a configuration option, a whole module. */
export type ApiForm = 'function' | 'member' | 'invoke' | 'class' | 'option' | 'module' | 'form';

/**
 * What the subcase asserts. `detect` requires a registered matcher and the expected relations;
 * `counter-example` requires the absence a row asks for and registers nothing; `unsupported` requires
 * the range to stay without a semantic model and to be diagnosed (§7.6 R16).
 */
export type CaseKind = 'detect' | 'counter-example' | 'unsupported';

export interface FixtureRef {
  /** Directory under `test/fixtures`. */
  id: string;
  /** The CLI target the fixture is analysed with. */
  target: string;
}

/** A relation that must not appear; any field left out matches anything. */
export interface EdgePattern {
  kind?: string;
  from?: string;
  to?: string;
  /** The mistake this pattern stands for, printed when it is found. */
  reason: string;
}

export interface ReactiveCase {
  contract: ContractId;
  kind: CaseKind;
  /** Unique id of the subcase, `R<nn>/<api or form>`. */
  id: string;
  /** What §7.6 requires of this API or form. */
  expectation: string;
  package: string;
  export: string | null;
  member: string | null;
  form: ApiForm;
  /** The package version the expectation was read against (§7.6). */
  version: string;
  fixture: FixtureRef | null;
  /** `kind|from|to` keys that must be in the fixture's report. */
  expectedEdges: string[];
  /** Nodes that must be in the fixture's report. */
  expectedNodes: { kind: string; label: string }[];
  /** Relations that must not be in it. */
  forbiddenEdges: EdgePattern[];
  /** Diagnostic codes that must be reported. */
  expectedDiagnostics: string[];
  /** Why no fixture covers this yet; required whenever `fixture` is null. */
  missingFixture: string | null;
  /**
   * A fixture that exists and shows the gap `missingFixture` names. It turns "not written yet" into a
   * recorded result, so the case is not merely waiting but has a run that demonstrates what is missing.
   */
  demonstratedBy: FixtureRef | null;
}

const ANGULAR = '22.1.5';
const NGRX = '22.0.0';
const RXJS = '7.8.2';

type Optional = 'kind' | 'export' | 'member' | 'form' | 'fixture' | 'expectedEdges' | 'expectedNodes'
| 'forbiddenEdges' | 'expectedDiagnostics' | 'missingFixture' | 'demonstratedBy';
type Draft = Omit<ReactiveCase, Optional> & Partial<Pick<ReactiveCase, Optional>>;

const entry = (draft: Draft): ReactiveCase => ({
  kind: 'detect', export: null, member: null, form: 'function', fixture: null, expectedEdges: [],
  expectedNodes: [], forbiddenEdges: [], expectedDiagnostics: [], missingFixture: null,
  demonstratedBy: null, ...draft,
});

const signalWrite = (target: string): FixtureRef => ({ id: 'signal-write', target });
const signalApis = (target: string): FixtureRef => ({ id: 'signal-apis', target });
const ngrxApis = (target: string): FixtureRef => ({ id: 'ngrx-apis', target });
const storeApis = (target: string): FixtureRef => ({ id: 'signal-store-apis', target });
const eventsApis = (target: string): FixtureRef => ({ id: 'events-apis', target });
const patchFixture: FixtureRef = { id: 'signal-store-patch', target: 'data-id=filterField' };
const dispatchFixture: FixtureRef = { id: 'store-dispatch', target: 'data-id=termField' };
const eventsFixture: FixtureRef = { id: 'events-reducer', target: 'data-id=termField' };
const unsupported = (target: string): FixtureRef => ({ id: 'unsupported-apis', target });
const logFixture: FixtureRef = { id: 'real-log-store', target: 'data-id=refreshLogButton' };
const settingsFixture: FixtureRef = { id: 'real-settings-store', target: 'data-id=loadScalarsButton' };

const ledger: ReactiveCase[] = [
  // ---- R01 Angular Signal state source, read, write, read-only alias ------------------------------
  entry({ contract: 'R01', id: 'R01/signal', package: '@angular/core', export: 'signal', version: ANGULAR,
    expectation: 'signal() の呼出しを状態の生成として検知し、同名の一般関数を Signal と誤認しない',
    fixture: signalWrite('data-id=incrementButton'),
    expectedNodes: [{ kind: 'state', label: 'count' }] }),
  entry({ contract: 'R01', id: 'R01/signal.read', package: '@angular/core', export: 'signal', form: 'invoke',
    version: ANGULAR, expectation: 'count() をテンプレート/コードの read として検知する',
    fixture: signalWrite('data-id=incrementButton'),
    expectedEdges: ['state-read|count|<span>'] }),
  entry({ contract: 'R01', id: 'R01/signal.set', package: '@angular/core', export: 'WritableSignal', member: 'set',
    form: 'member', version: ANGULAR, expectation: 'set を write とし、UI 操作から表示まで effect なしで完結する',
    fixture: signalWrite('data-id=countField'),
    expectedEdges: ['state-write|input → setCount($event)|count', 'state-read|count|<span>'],
    forbiddenEdges: [{ kind: 'http-create', reason: 'set の経路に通信を混ぜない' }] }),
  entry({ contract: 'R01', id: 'R01/signal.update', package: '@angular/core', export: 'WritableSignal',
    member: 'update', form: 'member', version: ANGULAR, expectation: 'update を write として set と別に検知する',
    fixture: signalWrite('data-id=incrementButton'),
    expectedEdges: ['state-write|click → increment()|count'] }),
  entry({ contract: 'R01', id: 'R01/signal.asReadonly', package: '@angular/core', export: 'WritableSignal',
    member: 'asReadonly', form: 'member', version: ANGULAR,
    expectation: 'asReadonly の参照を同一状態の読み取り用参照として結ぶ',
    fixture: signalApis('data-id=termField'),
    expectedEdges: ['reactive-link|term|currentTerm', 'state-read|currentTerm|<span>'] }),
  entry({ contract: 'R01', id: 'R01/signal.via-service', package: '@angular/core', export: 'signal', form: 'form',
    version: ANGULAR, expectation: '別名・service/facade 経由で参照された同じ signal を同一状態として結ぶ',
    fixture: signalApis('data-id=termField'),
    expectedEdges: ['call|src/term.component.ts#TermComponent|service.setTerm', 'state-read|currentTerm|<span>'] }),

  // ---- R02 derived values and the tracking rules ---------------------------------------------------
  entry({ contract: 'R02', id: 'R02/computed', package: '@angular/core', export: 'computed', version: ANGULAR,
    expectation: '依存する signal の write から computed への再計算を接続する',
    fixture: signalWrite('data-id=incrementButton'),
    expectedEdges: ['reactive-link|count|doubled', 'state-read|doubled|<span>'] }),
  entry({ contract: 'R02', id: 'R02/computed.equal', package: '@angular/core', export: 'computed', member: 'equal',
    form: 'option', version: ANGULAR, expectation: 'equal の比較関数を条件として残す',
    fixture: signalApis('data-id=termField'),
    expectedEdges: ['reactive-link|term|upper', 'state-read|upper|<span>'] }),
  entry({ contract: 'R02', id: 'R02/linkedSignal', package: '@angular/core', export: 'linkedSignal', version: ANGULAR,
    expectation: 'source 変化による再計算と明示 write の双方を検知する',
    fixture: signalApis('data-id=draftButton'),
    expectedEdges: ['state-write|click → stageDraft()|draft', 'state-read|draft|<span>'] }),
  entry({ contract: 'R02', id: 'R02/untracked', package: '@angular/core', export: 'untracked', version: ANGULAR,
    expectation: 'untracked 内の read を依存にせず、中の write/dispatch は残す',
    fixture: signalApis('data-id=silentButton'),
    expectedEdges: ['state-write|click → countSilently()|hits', 'state-read|hits|<span>'],
    forbiddenEdges: [{ kind: 'reactive-link', from: 'term', reason: 'untracked の read を再実行の依存にしない' }] }),
  entry({ contract: 'R02', id: 'R02/conditional-read', package: '@angular/core', export: 'computed', form: 'form',
    version: ANGULAR, expectation: '条件付き read の依存追加/除去を条件付きで表示する',
    missingFixture: '条件分岐で read が変わる fixture が未作成' }),

  // ---- R03 effects, phase, teardown ----------------------------------------------------------------
  entry({ contract: 'R03', id: 'R03/effect', package: '@angular/core', export: 'effect', version: ANGULAR,
    expectation: '初回実行・依存変化を区別し、生成だけで全 callback を操作の結果にしない',
    fixture: signalApis('data-id=termField'),
    expectedEdges: ['reactive-link|term|angular/effect'] }),
  entry({ contract: 'R03', id: 'R03/afterRenderEffect', package: '@angular/core', export: 'afterRenderEffect',
    version: ANGULAR, expectation: '描画後 phase を effect と別に保持する',
    missingFixture: 'afterRenderEffect の fixture が未作成' }),
  entry({ contract: 'R03', id: 'R03/effect.onCleanup', package: '@angular/core', export: 'effect', member: 'onCleanup',
    form: 'option', version: ANGULAR, expectation: 'cleanup 登録を終了条件として残す',
    fixture: signalApis('data-id=termField'),
    expectedEdges: ['reactive-link|term|angular/effect'] }),
  entry({ contract: 'R03', id: 'R03/EffectRef.destroy', package: '@angular/core', export: 'EffectRef',
    member: 'destroy', form: 'member', version: ANGULAR, expectation: '明示破棄を生存期間の終端として残す',
    missingFixture: 'EffectRef.destroy の fixture が未作成' }),
  entry({ contract: 'R03', kind: 'counter-example', id: 'R03/effect.await-read', package: '@angular/core', export: 'effect', form: 'form',
    version: ANGULAR, expectation: 'await 後の read を自動依存にしない',
    fixture: signalApis('data-id=silentButton'),
    forbiddenEdges: [{ kind: 'reactive-link', to: 'angular/effect', reason: '追跡外の read を effect の依存にしない' }] }),

  // ---- R04 inputs, the RxJS interop boundary, the Store signal consumer -----------------------------
  entry({ contract: 'R04', id: 'R04/input', package: '@angular/core', export: 'input', version: ANGULAR,
    expectation: '親からの入力束縛を state source として追う',
    missingFixture: 'input() を使う fixture が未作成' }),
  entry({ contract: 'R04', id: 'R04/input.required', package: '@angular/core', export: 'input', member: 'required',
    form: 'member', version: ANGULAR, expectation: 'required 形態を input と別 subcase として検知する',
    missingFixture: 'input.required の fixture が未作成' }),
  entry({ contract: 'R04', id: 'R04/model', package: '@angular/core', export: 'model', version: ANGULAR,
    expectation: 'model の暗黙出力（親への書き戻し）を条件付きで残す',
    missingFixture: 'model() の fixture が未作成' }),
  entry({ contract: 'R04', id: 'R04/toSignal', package: '@angular/core/rxjs-interop', export: 'toSignal',
    version: ANGULAR, expectation: '内部購読の開始と破棄を保持し、Observable の消費側として扱う',
    missingFixture: 'toSignal の fixture が未作成' }),
  entry({ contract: 'R04', id: 'R04/toObservable', package: '@angular/core/rxjs-interop', export: 'toObservable',
    version: ANGULAR, expectation: 'set と通知が同数になると仮定しない',
    missingFixture: 'toObservable の fixture が未作成' }),
  entry({ contract: 'R04', id: 'R04/Store.selectSignal', package: '@ngrx/store', export: 'Store',
    member: 'selectSignal', form: 'member', version: NGRX,
    expectation: 'selector から Signal を経て表示まで追う', fixture: dispatchFixture,
    expectedEdges: ['reactive-link|src/reducer.ts#selectTerm|src/filter.ts:15:19', 'state-read|term|<span>'] }),

  // ---- R05 the generated Store class and feature composition ---------------------------------------
  entry({ contract: 'R05', id: 'R05/signalStore', package: '@ngrx/signals', export: 'signalStore', version: NGRX,
    expectation: 'クラス宣言が無くても変数へ返される生成 Store を発見する', fixture: patchFixture,
    expectedNodes: [{ kind: 'state', label: 'term' }] }),
  entry({ contract: 'R05', id: 'R05/signalStore.class-extends', package: '@ngrx/signals', export: 'signalStore',
    form: 'class', version: NGRX, expectation: 'class X extends signalStore(...) も同じ Store として扱う',
    missingFixture: 'extends 形態の fixture が未作成' }),
  entry({ contract: 'R05', id: 'R05/signalStoreFeature', package: '@ngrx/signals', export: 'signalStoreFeature',
    version: NGRX, expectation: '再利用 feature の合成順と member を対応付ける',
    fixture: storeApis('data-id=setTermButton'),
    expectedEdges: ['state-read|term|<span>', 'state-write|click → setTerm()|term'],
    expectedNodes: [{ kind: 'state', label: 'term' }] }),
  entry({ contract: 'R05', id: 'R05/withFeature', package: '@ngrx/signals', export: 'withFeature', version: NGRX,
    expectation: '遅延合成 feature を透明として通過させない',
    missingFixture: 'withFeature の fixture が未作成' }),
  entry({ contract: 'R05', id: 'R05/signalStore.alias', package: '@ngrx/signals', export: 'signalStore', form: 'form',
    version: NGRX, expectation: '別名 import/re-export 越しでも同じ Store と解決する',
    fixture: storeApis('data-id=setTermButton'),
    expectedEdges: ['call|src/catalog.component.ts#CatalogComponent|store.setTerm'],
    forbiddenEdges: [{ kind: 'state-write', to: 'ProductCatalogStore',
      reason: '別名 import を 2 つ目の Store にしない' }] }),
  entry({ contract: 'R05', id: 'R05/signalStore.provider-instance', package: '@ngrx/signals', export: 'signalStore',
    form: 'form', version: NGRX, expectation: 'provider 別インスタンスを分離する',
    missingFixture: '複数 provider で同じ Store を分ける fixture が未作成' }),

  // ---- R06 the built-in features -------------------------------------------------------------------
  entry({ contract: 'R06', id: 'R06/withState', package: '@ngrx/signals', export: 'withState', version: NGRX,
    expectation: 'state key を Store の状態として登録し、テンプレート read に接続する', fixture: patchFixture,
    expectedEdges: ['state-read|term|<span>'] }),
  entry({ contract: 'R06', id: 'R06/withMethods', package: '@ngrx/signals', export: 'withMethods', version: NGRX,
    expectation: 'Store method の呼出しを call として残し、effect ノードに変換しない', fixture: patchFixture,
    expectedEdges: ['call|src/filter.ts#FilterComponent|store.setTerm'],
    forbiddenEdges: [{ kind: 'reactive-link', to: 'store.setTerm', reason: 'Store method を effect 扱いにしない' }] }),
  entry({ contract: 'R06', id: 'R06/withComputed', package: '@ngrx/signals', export: 'withComputed', version: NGRX,
    expectation: '派生 member を reactive-link として残す',
    demonstratedBy: storeApis('data-id=setTermButton'),
    missingFixture: 'signal-store-apis の label が表示に接続されない（生成 Store の withComputed member 未対応）' }),
  entry({ contract: 'R06', id: 'R06/withLinkedState', package: '@ngrx/signals', export: 'withLinkedState',
    version: NGRX, expectation: 'linked state の再計算と明示 write を区別する',
    demonstratedBy: storeApis('data-id=setTermButton'),
    missingFixture: 'signal-store-apis の draft が表示に接続されない（生成 Store の withLinkedState member 未対応）' }),
  entry({ contract: 'R06', id: 'R06/withProps', package: '@ngrx/signals', export: 'withProps', version: NGRX,
    expectation: 'props は値であり step にしない',
    kind: 'counter-example', fixture: storeApis('data-id=setTermButton'),
    forbiddenEdges: [{ kind: 'state-read', from: 'pageSize', reason: 'withProps の値を状態の読み出しにしない' },
      { kind: 'state-write', to: 'pageSize', reason: 'withProps の値は書き換え対象ではない' }] }),
  entry({ contract: 'R06', id: 'R06/withHooks', package: '@ngrx/signals', export: 'withHooks', version: NGRX,
    expectation: 'onInit は起動条件、onDestroy は終了条件として扱う',
    demonstratedBy: storeApis('data-id=setTermButton'),
    missingFixture: 'signal-store-apis の withHooks が起動/終了条件として記録されない（R06 未達）' }),
  entry({ contract: 'R06', kind: 'counter-example', id: 'R06/withHooks.not-created', package: '@ngrx/signals', export: 'withHooks',
    form: 'form', version: NGRX, expectation: '未生成 Store の hook/handler を稼働中としない',
    missingFixture: 'provider だけで inject されない Store の fixture が未作成' }),

  // ---- R07 the state source API shared by SignalState and generated Stores -------------------------
  entry({ contract: 'R07', id: 'R07/signalState', package: '@ngrx/signals', export: 'signalState', version: NGRX,
    expectation: 'DI クラスとは限らない別の state source として扱う',
    fixture: storeApis('data-id=pageButton'),
    expectedEdges: ['state-write|click → nextPage()|filters', 'state-read|filters|<span>'] }),
  entry({ contract: 'R07', id: 'R07/patchState.object', package: '@ngrx/signals', export: 'patchState', version: NGRX,
    expectation: '部分オブジェクトの書き換え key と依存 read を残す', fixture: patchFixture,
    expectedEdges: ['state-write|input → onInput($event)|term', 'state-read|term|<span>'] }),
  entry({ contract: 'R07', id: 'R07/patchState.updater', package: '@ngrx/signals', export: 'patchState', form: 'form',
    version: NGRX, expectation: 'updater 関数の形態を部分オブジェクトと別に検知する',
    fixture: storeApis('data-id=clearButton'),
    expectedEdges: ['state-write|click → clear()|term', 'state-read|term|<span>'] }),
  entry({ contract: 'R07', id: 'R07/patchState.multiple', package: '@ngrx/signals', export: 'patchState', form: 'form',
    version: NGRX, expectation: '複数 updater を順に評価する',
    fixture: storeApis('data-id=clearButton'),
    expectedEdges: ['state-write|click → clear()|term', 'state-write|click → clear()|hits'],
    forbiddenEdges: [{ kind: 'state-write', to: 'draft',
      reason: 'updater が触れない key を書き換え対象にしない' }] }),
  entry({ contract: 'R07', id: 'R07/getState', package: '@ngrx/signals', export: 'getState', version: NGRX,
    expectation: 'snapshot read として tracked read と区別する',
    fixture: storeApis('data-id=snapshotButton'),
    expectedEdges: ['state-write|click → snapshot()|seen', 'state-read|seen|<span>'],
    forbiddenEdges: [{ kind: 'reactive-link', from: 'filters',
      reason: 'getState の snapshot read を再実行の依存にしない' }] }),
  entry({ contract: 'R07', id: 'R07/watchState', package: '@ngrx/signals', export: 'watchState', version: NGRX,
    expectation: '初回通知と更新通知を区別する',
    demonstratedBy: storeApis('data-id=pageButton'),
    missingFixture: 'signal-store-apis の watchState が filters の書き換えに接続されない（R07 未達）' }),
  entry({ contract: 'R07', id: 'R07/deepComputed', package: '@ngrx/signals', export: 'deepComputed', version: NGRX,
    expectation: '深いプロパティの派生を reactive-link として残す',
    demonstratedBy: storeApis('data-id=pageButton'),
    missingFixture: 'signal-store-apis の deepComputed が filters の書き換えに接続されない（R07 未達）' }),
  entry({ contract: 'R07', kind: 'counter-example', id: 'R07/deep-mutation', package: '@ngrx/signals', export: 'patchState', form: 'form',
    version: NGRX, expectation: 'deep mutation を Signal の通知と同一視しない',
    fixture: storeApis('data-id=mutateButton'),
    forbiddenEdges: [{ kind: 'state-write', reason: 'deep mutation を Signal の通知と同一視しない' }] }),

  // ---- R08 the method factories --------------------------------------------------------------------
  entry({ contract: 'R08', id: 'R08/rxMethod.value', package: '@ngrx/signals/rxjs-interop', export: 'rxMethod',
    version: NGRX, expectation: '値引数での起動を定義と分けて検知する',
    demonstratedBy: storeApis('data-id=loadValueButton'),
    missingFixture: 'signal-store-apis の rxMethod 呼出しで「resolved service method body is unavailable」となり本体に入れない（R08 未達）' }),
  entry({ contract: 'R08', id: 'R08/rxMethod.signal', package: '@ngrx/signals/rxjs-interop', export: 'rxMethod',
    form: 'form', version: NGRX, expectation: 'Signal 引数での再実行を値引数と別に検知する',
    demonstratedBy: storeApis('data-id=loadSignalButton'),
    missingFixture: 'signal-store-apis の rxMethod 呼出しで「resolved service method body is unavailable」となり本体に入れない（R08 未達）' }),
  entry({ contract: 'R08', id: 'R08/rxMethod.observable', package: '@ngrx/signals/rxjs-interop', export: 'rxMethod',
    form: 'form', version: NGRX, expectation: 'Observable 引数の対応を rxMethod 固有として検知する',
    demonstratedBy: storeApis('data-id=loadStreamButton'),
    missingFixture: 'signal-store-apis の rxMethod 呼出しで「resolved service method body is unavailable」となり本体に入れない（R08 未達）' }),
  entry({ contract: 'R08', kind: 'counter-example', id: 'R08/rxMethod.uncalled', package: '@ngrx/signals/rxjs-interop', export: 'rxMethod',
    form: 'form', version: NGRX, expectation: '未呼出しの定義を稼働中としない',
    fixture: storeApis('data-id=loadValueButton'),
    forbiddenEdges: [{ kind: 'state-write', to: 'hits', reason: '未呼出しの rxMethod を稼働中にしない' }] }),
  entry({ contract: 'R08', id: 'R08/signalMethod.value', package: '@ngrx/signals', export: 'signalMethod',
    version: NGRX, expectation: '値引数での起動を検知する',
    demonstratedBy: storeApis('data-id=rememberButton'),
    missingFixture: 'signal-store-apis の signalMethod 呼出しで本体に入れない（R08 未達）' }),
  entry({ contract: 'R08', id: 'R08/signalMethod.signal', package: '@ngrx/signals', export: 'signalMethod',
    form: 'form', version: NGRX, expectation: 'Signal 引数の再実行を検知する',
    demonstratedBy: storeApis('data-id=rememberButton'),
    missingFixture: 'signal-store-apis の signalMethod 呼出しで本体に入れない（R08 未達）' }),
  entry({ contract: 'R08', kind: 'counter-example', id: 'R08/signalMethod.no-observable', package: '@ngrx/signals', export: 'signalMethod',
    form: 'form', version: NGRX, expectation: 'rxMethod と同じ Observable 引数対応だと推定しない',
    demonstratedBy: storeApis('data-id=rememberButton'),
    missingFixture: 'signalMethod の本体に入れないため、Observable 非対応を反例として確認できない（R08 未達）' }),

  // ---- R09 the action bus: dispatch, creators, reducers, selectors, registration --------------------
  entry({ contract: 'R09', id: 'R09/Store.dispatch', package: '@ngrx/store', export: 'Store', member: 'dispatch',
    form: 'member', version: NGRX, expectation: 'effect の無い dispatch→reducer→selector→表示を完結させる',
    fixture: dispatchFixture,
    expectedEdges: ['action-dispatch|src/filter.ts#FilterComponent|src/actions.ts#termChanged'],
    forbiddenEdges: [{ kind: 'action-consume', to: 'src/reducer.ts#selectTerm', reason: 'selector は action の受け手ではない' }] }),
  entry({ contract: 'R09', id: 'R09/Store.dispatch.via-facade', package: '@ngrx/store', export: 'Store',
    member: 'dispatch', form: 'form', version: NGRX, expectation: 'facade/wrapper 内部の dispatch も対象にする',
    fixture: ngrxApis('data-id=facadeButton'),
    expectedEdges: ['call|src/panel.component.ts#SearchPanelComponent|facade.changeTerm',
      'action-dispatch|src/facade.ts#SearchFacade|src/actions.ts#termChanged',
      'action-consume|src/actions.ts#termChanged|src/reducer.ts#searchReducer'] }),
  entry({ contract: 'R09', id: 'R09/Store.dispatch.action-object', package: '@ngrx/store', export: 'Store',
    member: 'dispatch', form: 'form', version: NGRX, expectation: 'creator を介さない action object も検知する',
    demonstratedBy: ngrxApis('data-id=objectButton'),
    missingFixture: 'ngrx-apis の objectButton で creator を介さない action object が dispatch として解決されない（R09 未達）' }),
  entry({ contract: 'R09', id: 'R09/createAction', package: '@ngrx/store', export: 'createAction', version: NGRX,
    expectation: 'action の type を静的に読み、dispatch 側と結ぶ', fixture: dispatchFixture,
    expectedEdges: ['action-dispatch|src/filter.ts#FilterComponent|src/actions.ts#termChanged'] }),
  entry({ contract: 'R09', id: 'R09/createActionGroup', package: '@ngrx/store', export: 'createActionGroup',
    version: NGRX, expectation: 'group の各 action を個別に対応付ける',
    demonstratedBy: ngrxApis('data-id=groupButton'),
    missingFixture: 'ngrx-apis の groupButton で createActionGroup の action が解決されず dispatch 辺にならない（R09 未達）' }),
  entry({ contract: 'R09', id: 'R09/createReducer', package: '@ngrx/store', export: 'createReducer', version: NGRX,
    expectation: '登録された reducer が action を受け取り state を更新する', fixture: dispatchFixture,
    expectedEdges: ['action-consume|src/actions.ts#termChanged|src/reducer.ts#searchReducer',
      'state-write|src/reducer.ts#searchReducer|search'] }),
  entry({ contract: 'R09', id: 'R09/on', package: '@ngrx/store', export: 'on', version: NGRX,
    expectation: 'case reducer が扱う action を列挙する', fixture: dispatchFixture,
    expectedEdges: ['action-consume|src/actions.ts#termChanged|src/reducer.ts#searchReducer'] }),
  entry({ contract: 'R09', id: 'R09/createSelector', package: '@ngrx/store', export: 'createSelector', version: NGRX,
    expectation: 'selector の依存と読み出しを残す', fixture: dispatchFixture,
    expectedEdges: ['state-read|search|src/reducer.ts#selectTerm'] }),
  entry({ contract: 'R09', id: 'R09/createFeatureSelector', package: '@ngrx/store', export: 'createFeatureSelector',
    version: NGRX, expectation: 'feature key からの読み出しを残す', fixture: dispatchFixture,
    expectedEdges: ['state-read|search|src/reducer.ts#selectSearch'] }),
  entry({ contract: 'R09', id: 'R09/createFeature', package: '@ngrx/store', export: 'createFeature', version: NGRX,
    expectation: 'createFeature の reducer/selector も登録済みとして扱う',
    missingFixture: 'createFeature は解析未対応（reducer が object literal 内にあり未検出）。P10 の契約変更としてレビューが必要' }),
  entry({ contract: 'R09', id: 'R09/Store.select', package: '@ngrx/store', export: 'Store', member: 'select',
    form: 'member', version: NGRX, expectation: 'Observable 読み出しを selectSignal と別に検知する',
    demonstratedBy: ngrxApis('data-id=effectButton'),
    missingFixture: 'ngrx-apis の store.select(...).subscribe(...) が稼働中の consumer と判定されない（R09 未達）' }),
  entry({ contract: 'R09', id: 'R09/provideStore', package: '@ngrx/store', export: 'provideStore', version: NGRX,
    expectation: 'root Store の登録を配送の前提条件として扱う', fixture: dispatchFixture,
    expectedEdges: ['action-consume|src/actions.ts#termChanged|src/reducer.ts#searchReducer'] }),
  entry({ contract: 'R09', id: 'R09/provideState', package: '@ngrx/store', export: 'provideState', version: NGRX,
    expectation: 'feature reducer の登録を確認してから受信辺を作る', fixture: dispatchFixture,
    expectedEdges: ['state-write|src/reducer.ts#searchReducer|search'] }),
  entry({ contract: 'R09', id: 'R09/StoreModule', package: '@ngrx/store', export: 'StoreModule', form: 'class',
    version: NGRX, expectation: 'NgModule 経由の登録も同じ前提条件として扱う',
    fixture: ngrxApis('data-id=effectButton'),
    expectedEdges: ['state-write|src/reducer.ts#auditReducer|audit',
      'action-consume|src/actions.ts#searchRequested|src/effects.ts#runSearch$'] }),
  entry({ contract: 'R09', kind: 'counter-example', id: 'R09/creator-call-only', package: '@ngrx/store', export: 'createAction', form: 'form',
    version: NGRX, expectation: 'creator の呼出しだけでは dispatch 辺を作らない', fixture: dispatchFixture,
    forbiddenEdges: [{ kind: 'action-dispatch', from: 'src/actions.ts#termChanged',
      reason: 'action creator の呼出し自体は送信ではない' }] }),

  // ---- R10 the registration-shaped dispatch overload and the Observer entry point -------------------
  entry({ contract: 'R10', id: 'R10/Store.dispatch.thunk', package: '@ngrx/store', export: 'Store',
    member: 'dispatch', form: 'form', version: NGRX,
    expectation: 'Signal 依存で再 dispatch する登録として単発 dispatch と区別する',
    demonstratedBy: ngrxApis('data-id=thunkButton'),
    missingFixture: 'ngrx-apis の thunkButton は dispatch として検知されるが dispatchMode が explicit のままで登録形態と区別されない（R10 未達）' }),
  entry({ contract: 'R10', id: 'R10/Store.dispatch.thunk-injector', package: '@ngrx/store', export: 'Store',
    member: 'dispatch', form: 'form', version: NGRX, expectation: '明示 injector 指定時の生存期間を残す',
    demonstratedBy: ngrxApis('data-id=thunkButton'),
    missingFixture: '関数 overload 自体が区別されないため、明示 injector の生存期間も記録されない（R10 未達）' }),
  entry({ contract: 'R10', id: 'R10/Store.next', package: '@ngrx/store', export: 'Store', member: 'next',
    form: 'member', version: NGRX, expectation: '当該 Store の送信 API として識別する',
    demonstratedBy: ngrxApis('data-id=nextButton'),
    missingFixture: 'ngrx-apis の nextButton で Store.next が送信 API として解決されない（R10 未達）' }),
  entry({ contract: 'R10', kind: 'counter-example', id: 'R10/Subject.next', package: 'rxjs', export: 'Subject', member: 'next',
    form: 'form', version: RXJS, expectation: '一般の Subject.next を Store の dispatch と混同しない',
    fixture: ngrxApis('data-id=subjectButton'),
    expectedEdges: ['state-write|src/panel.component.ts#SearchPanelComponent|this.local'],
    forbiddenEdges: [{ kind: 'action-dispatch',
      reason: '一般の Subject.next を Store の dispatch と同一視しない' }] }),

  // ---- R11 effects ---------------------------------------------------------------------------------
  entry({ contract: 'R11', id: 'R11/createEffect', package: '@ngrx/effects', export: 'createEffect', version: NGRX,
    expectation: '登録済み effect が action を受け取る',
    fixture: ngrxApis('data-id=effectButton'),
    expectedEdges: ['action-consume|src/actions.ts#searchRequested|src/effects.ts#runSearch$'] }),
  entry({ contract: 'R11', id: 'R11/ofType', package: '@ngrx/effects', export: 'ofType', version: NGRX,
    expectation: '受信する action type を列挙する',
    fixture: ngrxApis('data-id=effectButton'),
    expectedEdges: ['action-consume|src/actions.ts#searchSucceeded|src/effects.ts#auditSearch$'],
    forbiddenEdges: [{ kind: 'action-consume', from: 'src/actions.ts#searchRequested',
      to: 'src/effects.ts#auditSearch$', reason: 'ofType が選ばない action を effect に届けない' }] }),
  entry({ contract: 'R11', id: 'R11/createEffect.returned-action', package: '@ngrx/effects', export: 'createEffect',
    form: 'form', version: NGRX, expectation: '返却 action の自動 dispatch を検知する',
    fixture: ngrxApis('data-id=effectButton'),
    expectedEdges: ['action-dispatch|src/effects.ts#runSearch$|src/actions.ts#searchSucceeded',
      'action-consume|src/actions.ts#searchSucceeded|src/reducer.ts#searchReducer'] }),
  entry({ contract: 'R11', id: 'R11/createEffect.dispatch-false', package: '@ngrx/effects', export: 'createEffect',
    member: 'dispatch', form: 'option', version: NGRX,
    expectation: 'dispatch:false でも callback 内の手動 dispatch は残す',
    fixture: ngrxApis('data-id=effectButton'),
    expectedEdges: ['action-dispatch|src/effects.ts#auditSearch$|src/actions.ts#panelOpened'],
    forbiddenEdges: [{ kind: 'action-dispatch', from: 'src/effects.ts#auditSearch$',
      to: 'src/actions.ts#searchSucceeded', reason: 'dispatch:false の出力は自動送信されない' }] }),
  entry({ contract: 'R11', id: 'R11/provideEffects', package: '@ngrx/effects', export: 'provideEffects', version: NGRX,
    expectation: '未登録 effect を稼働中にしない',
    fixture: ngrxApis('data-id=effectButton'),
    expectedEdges: ['action-consume|src/actions.ts#panelOpened|src/effects.ts#recordOpen$'],
    forbiddenEdges: [{ kind: 'action-consume', to: 'src/effects.ts#ignored$',
      reason: '未登録 effect を稼働中にしない' }] }),
  entry({ contract: 'R11', id: 'R11/EffectsModule', package: '@ngrx/effects', export: 'EffectsModule', form: 'class',
    version: NGRX, expectation: 'NgModule 経由の登録も同様に扱う',
    fixture: ngrxApis('data-id=effectButton'),
    expectedEdges: ['action-consume|src/actions.ts#searchRequested|src/effects.ts#runSearch$'] }),

  // ---- R12 the event bus entry points --------------------------------------------------------------
  entry({ contract: 'R12', id: 'R12/event', package: '@ngrx/signals/events', export: 'event', version: NGRX,
    expectation: '単体 event creator を検知し、生成だけの event と送信を区別する',
    fixture: eventsApis('data-id=directButton'),
    expectedEdges: ['event-dispatch|src/grid.component.ts#GridComponent|[Grid] row selected',
      'event-consume|[Grid] row selected|src/grid.store.ts:11:5'] }),
  entry({ contract: 'R12', id: 'R12/eventGroup', package: '@ngrx/signals/events', export: 'eventGroup', version: NGRX,
    expectation: 'group の各 event を個別に対応付ける', fixture: eventsFixture,
    expectedEdges: ['event-dispatch|src/filter.ts#FilterComponent|[Search] termChanged'] }),
  entry({ contract: 'R12', id: 'R12/injectDispatch', package: '@ngrx/signals/events', export: 'injectDispatch',
    version: NGRX, expectation: '名前付き送信を直接送信と同じ event に対応付ける', fixture: eventsFixture,
    expectedEdges: ['event-dispatch|src/filter.ts#FilterComponent|[Search] termChanged'],
    forbiddenEdges: [{ kind: 'action-dispatch', reason: 'SignalStore event を NgRx action bus に流さない' }] }),
  entry({ contract: 'R12', id: 'R12/Dispatcher.dispatch', package: '@ngrx/signals/events', export: 'Dispatcher',
    member: 'dispatch', form: 'member', version: NGRX, expectation: '直接送信を名前付き送信と別形態として検知する',
    fixture: eventsApis('data-id=directButton'),
    expectedEdges: ['event-dispatch|src/grid.component.ts#GridComponent|[Grid] row selected',
      'state-write|src/grid.store.ts:11:5|selected'] }),

  // ---- R13 event consumption -----------------------------------------------------------------------
  entry({ contract: 'R13', id: 'R13/withReducer', package: '@ngrx/signals/events', export: 'withReducer',
    version: NGRX, expectation: 'handler/API の無い event→reducer→state→表示を検知する', fixture: eventsFixture,
    expectedEdges: ['event-consume|[Search] termChanged|src/store.ts:9:15',
      'state-write|src/store.ts:9:15|term', 'state-read|term|<span>'] }),
  entry({ contract: 'R13', id: 'R13/on', package: '@ngrx/signals/events', export: 'on', version: NGRX,
    expectation: 'case reducer が受け取る event を列挙する', fixture: eventsFixture,
    expectedEdges: ['event-consume|[Search] termChanged|src/store.ts:9:15'] }),
  entry({ contract: 'R13', id: 'R13/Events.on', package: '@ngrx/signals/events', export: 'Events', member: 'on',
    form: 'member', version: NGRX, expectation: '購読による受信を reducer と別に検知する', fixture: logFixture,
    expectedEdges: ['event-consume|[Experiment Output Log] getLogs|src/log.store.ts:43:15'] }),
  entry({ contract: 'R13', id: 'R13/ReducerEvents.on', package: '@ngrx/signals/events', export: 'ReducerEvents',
    member: 'on', form: 'member', version: NGRX, expectation: 'Events より先に受け取る順序を残す',
    fixture: eventsApis('data-id=directButton'),
    expectedEdges: ['event-consume|[Grid] row selected|src/grid.store.ts:17:5',
      'state-write|src/grid.store.ts:17:5|noted', 'state-read|noted|<span>'] }),
  entry({ contract: 'R13', id: 'R13/withEventHandlers', package: '@ngrx/signals/events', export: 'withEventHandlers',
    version: NGRX, expectation: '生成時の購読登録と void 副作用を検知する', fixture: logFixture,
    expectedEdges: ['event-consume|[Experiment Output Log] getLogs|src/log.store.ts:43:15'],
    forbiddenEdges: [{ kind: 'event-consume', to: 'src/log.store.ts:30:5',
      reason: 'getLogs は resetLog の case reducer には届かない' }] }),
  entry({ contract: 'R13', id: 'R13/withEventHandlers.redelivery', package: '@ngrx/signals/events',
    export: 'withEventHandlers', form: 'form', version: NGRX, expectation: 'handler の出力 event を自動再配送する',
    fixture: logFixture,
    expectedEdges: ['event-dispatch|src/log.store.ts:43:15|[Experiment Output Log] setLog'] }),

  // ---- R14 delivery scope --------------------------------------------------------------------------
  entry({ contract: 'R14', id: 'R14/provideDispatcher', package: '@ngrx/signals/events', export: 'provideDispatcher',
    version: NGRX, expectation: '新しい bus インスタンスの起点として扱う',
    fixture: eventsApis('data-id=pageButton'),
    expectedEdges: ['event-consume|[Grid] pageChanged|src/grid.store.ts:10:5',
      'state-write|src/grid.store.ts:10:5|page'] }),
  entry({ contract: 'R14', id: 'R14/scope.self', package: '@ngrx/signals/events', export: 'injectDispatch',
    form: 'option', version: NGRX, expectation: 'self scope をローカル bus に限定する',
    fixture: eventsApis('data-id=pageButton'),
    expectedEdges: ['event-dispatch|src/grid.component.ts#GridComponent|[Grid] pageChanged',
      'event-consume|[Grid] pageChanged|src/grid.store.ts:10:5'] }),
  entry({ contract: 'R14', id: 'R14/scope.parent', package: '@ngrx/signals/events', export: 'injectDispatch',
    form: 'option', version: NGRX, expectation: 'parent scope を注入された dispatcher の親に向ける',
    fixture: eventsApis('data-id=parentButton'),
    expectedEdges: ['event-dispatch|src/grid.component.ts#GridComponent|[Grid] pageChanged'],
    forbiddenEdges: [{ kind: 'event-consume', to: 'src/grid.store.ts:10:5',
      reason: 'parent scope の送信をローカル bus の consumer に届けない' }] }),
  entry({ contract: 'R14', id: 'R14/scope.global', package: '@ngrx/signals/events', export: 'injectDispatch',
    form: 'option', version: NGRX, expectation: 'global scope を root bus に向ける', fixture: eventsFixture,
    expectedEdges: ['event-consume|[Search] termChanged|src/store.ts:9:15'] }),
  entry({ contract: 'R14', id: 'R14/toScope', package: '@ngrx/signals/events', export: 'toScope', version: NGRX,
    expectation: 'scope 設定付き送信を検知する', fixture: eventsApis('data-id=scopedButton'),
    expectedEdges: ['event-dispatch|src/grid.component.ts#GridComponent|[Grid] row selected'],
    forbiddenEdges: [{ kind: 'event-consume', to: 'src/grid.store.ts:11:5',
      reason: 'toScope(parent) の送信をローカル bus の consumer に届けない' }] }),
  entry({ contract: 'R14', id: 'R14/mapToScope', package: '@ngrx/signals/events', export: 'mapToScope', version: NGRX,
    expectation: '演算子による scope 変更を検知する', demonstratedBy: eventsApis('data-id=scopedButton'),
    missingFixture: 'events-apis は toScope までを覆う。演算子形態の mapToScope を使う handler fixture が未作成' }),
  entry({ contract: 'R14', kind: 'counter-example', id: 'R14/cross-bus', package: '@ngrx/signals/events', export: 'Dispatcher', form: 'form',
    version: NGRX, expectation: '異なる bus の同名 type を結ばず、明示 bridge のときだけ接続する',
    fixture: eventsApis('data-id=globalButton'),
    expectedEdges: ['event-dispatch|src/grid.component.ts#GridComponent|[Grid] filterCleared'],
    forbiddenEdges: [{ kind: 'event-consume',
      reason: '別 bus の同名 type を結ばない（明示 bridge があるときだけ接続する）' }] }),

  // ---- R15 the real-world composite cases and the RxJS consumption they need ------------------------
  entry({ contract: 'R15', id: 'R15/log-store', package: '@ngrx/signals/events', export: 'injectDispatch',
    form: 'form', version: NGRX,
    expectation: 'ログ画面の injectDispatch→event→withReducer/withEventHandlers を実ソース由来 fixture で検証する',
    fixture: logFixture,
    expectedEdges: ['event-dispatch|src/log.component.ts#ExperimentOutputLogComponent|[Experiment Output Log] getLogs',
      'event-consume|[Experiment Output Log] getLogs|src/log.store.ts:31:5',
      'event-consume|[Experiment Output Log] getLogs|src/log.store.ts:43:15',
      'state-write|src/log.store.ts:31:5|loading',
      'action-dispatch|src/log.store.ts:43:15|src/view.events.ts#activateLoader'],
    forbiddenEdges: [{ kind: 'action-consume', to: 'src/log.store.ts:31:5',
      reason: 'SignalStore event を NgRx action bus 経由で reducer に届けない' }],
    expectedDiagnostics: ['unsupported-store-feature'] }),
  entry({ contract: 'R15', id: 'R15/settings-store', package: '@ngrx/signals', export: 'withMethods', form: 'form',
    version: NGRX, expectation: '設定 Store の withMethods→lastValueFrom(forkJoin)→patchState を検証する',
    missingFixture: '実ソース由来 fixture が未作成（P16-11）' }),
  entry({ contract: 'R15', id: 'R15/rxjs.lastValueFrom', package: 'rxjs', export: 'lastValueFrom', version: RXJS,
    expectation: 'Promise 化した消費として購読開始を検知する',
    demonstratedBy: settingsFixture,
    missingFixture: 'real-settings-store の method に到達できず lastValueFrom まで追えない' }),
  entry({ contract: 'R15', id: 'R15/rxjs.firstValueFrom', package: 'rxjs', export: 'firstValueFrom', version: RXJS,
    expectation: 'lastValueFrom と別形態として検知する',
    missingFixture: 'firstValueFrom の fixture が未作成' }),
  entry({ contract: 'R15', id: 'R15/rxjs.forkJoin', package: 'rxjs', export: 'forkJoin', version: RXJS,
    expectation: '複数 Observable の合流を保持する', demonstratedBy: settingsFixture,
    missingFixture: 'real-settings-store の method に到達できず forkJoin まで追えない' }),
  entry({ contract: 'R15', id: 'R15/rxjs.of', package: 'rxjs', export: 'of', version: RXJS,
    expectation: 'ObservableInput の生成として既知アダプタに含める', missingFixture: 'of の fixture が未作成' }),
  entry({ contract: 'R15', id: 'R15/rxjs.from', package: 'rxjs', export: 'from', version: RXJS,
    expectation: '配列/Promise の ObservableInput を既知アダプタに含める',
    missingFixture: 'from の fixture が未作成' }),
  entry({ contract: 'R15', id: 'R15/rxjs.distinctUntilChanged', package: 'rxjs', export: 'distinctUntilChanged',
    version: RXJS, expectation: '条件付き通過として扱い、未知演算子を透過扱いしない',
    missingFixture: 'distinctUntilChanged の fixture が未作成' }),
  entry({ contract: 'R15', id: 'R15/ngrx-operators.tapResponse', package: '@ngrx/operators', export: 'tapResponse',
    version: NGRX, expectation: '成功/失敗の分岐を保持する', missingFixture: 'tapResponse の fixture が未作成' }),
  entry({ contract: 'R15', id: 'R15/ngrx-operators.mapResponse', package: '@ngrx/operators', export: 'mapResponse',
    version: NGRX, expectation: 'tapResponse と別形態として検知する',
    missingFixture: 'mapResponse の fixture が未作成' }),

  // ---- R16 the ranges with no semantic model --------------------------------------------------------
  entry({ contract: 'R16', kind: 'unsupported', id: 'R16/signals-entities', package: '@ngrx/signals/entities', form: 'module',
    version: NGRX, expectation: 'import と使用箇所を検出して unsupported と根拠を出す',
    expectedDiagnostics: ['unsupported-reactive-api'],
    fixture: unsupported('data-id=entitiesButton') }),
  entry({ contract: 'R16', kind: 'unsupported', id: 'R16/signals-resource', package: '@ngrx/signals/resource', form: 'module',
    version: NGRX, expectation: 'resource 拡張を unsupported として止める',
    expectedDiagnostics: ['unsupported-reactive-api'],
    fixture: unsupported('data-id=resourceExtensionButton') }),
  entry({ contract: 'R16', kind: 'unsupported', id: 'R16/component-store', package: '@ngrx/component-store', form: 'module',
    version: NGRX, expectation: '別の state system として SignalStore と誤認しない',
    expectedDiagnostics: ['unsupported-reactive-api'],
    fixture: unsupported('data-id=componentStoreButton') }),
  entry({ contract: 'R16', kind: 'unsupported', id: 'R16/angular-resource', package: '@angular/core', export: 'resource', version: ANGULAR,
    expectation: 'resource の読み込み/状態に意味モデルが無いことを診断する',
    expectedDiagnostics: ['unsupported-reactive-api'],
    fixture: unsupported('data-id=angularResourceButton') }),
  entry({ contract: 'R16', kind: 'unsupported', id: 'R16/angular-rxResource', package: '@angular/core/rxjs-interop', export: 'rxResource',
    version: ANGULAR, expectation: 'rxResource を resource と別に診断する',
    expectedDiagnostics: ['unsupported-reactive-api'],
    fixture: unsupported('data-id=rxResourceButton') }),
  entry({ contract: 'R16', kind: 'unsupported', id: 'R16/angular-httpResource', package: '@angular/common/http', export: 'httpResource',
    version: ANGULAR, expectation: 'httpResource を通信と状態の双方で unsupported として扱う',
    expectedDiagnostics: ['unsupported-reactive-api'],
    fixture: unsupported('data-id=httpResourceButton') }),
  entry({ contract: 'R16', kind: 'unsupported', id: 'R16/signals-events-withEffects', package: '@ngrx/signals/events',
    export: 'withEffects', version: NGRX,
    expectation: '旧名称を公開 API として追加せず、未知の識別子として診断する',
    expectedDiagnostics: ['unsupported-reactive-api'],
    fixture: unsupported('data-id=withEffectsButton') }),
  entry({ contract: 'R16', kind: 'unsupported', id: 'R16/unknown-custom-feature', package: '@ngrx/signals',
    form: 'form', version: NGRX,
    expectation: '既知 state/member を上書きし得る未知 feature は関連範囲を partial とし、透明扱いしない',
    expectedDiagnostics: ['unsupported-store-feature'],
    fixture: unsupported('data-id=unknownFeatureButton') }),
];

export function reactiveCases(): readonly ReactiveCase[] { return ledger; }
export function casesFor(contract: ContractId): ReactiveCase[] {
  return ledger.filter(item => item.contract === contract);
}
export function fixturedCases(): ReactiveCase[] { return ledger.filter(item => item.fixture !== null); }
export function unfixturedCases(): ReactiveCase[] { return ledger.filter(item => item.fixture === null); }
