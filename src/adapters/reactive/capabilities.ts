import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';

/** The reactive systems are kept apart: a shared shape never implies a shared bus or state source. */
export type ReactiveFramework = 'angular-signal' | 'signal-state' | 'signal-store' | 'ngrx-store';
export type CapabilitySupport = 'supported' | 'unsupported';
/** `invoke` is calling the produced value itself (a signal read); `option` is a configuration property. */
export type CapabilityForm = 'function' | 'member' | 'invoke' | 'class' | 'option' | 'module';

export interface Capability {
  matcherId: string;
  semanticId: string | null;
  contracts: string[];
  module: string;
  export: string | null;
  member: string | null;
  form: CapabilityForm;
  framework: ReactiveFramework | null;
  support: CapabilitySupport;
  note: string | null;
}

/** Versions the semantic models were read against; other versions are an R16 diagnostic, not a silent pass. */
export const SUPPORTED_PACKAGE_VERSIONS: Readonly<Record<string, string>> = {
  '@angular/core': '22.1.5', '@ngrx/store': '22.0.0', '@ngrx/effects': '22.0.0',
  '@ngrx/signals': '22.0.0', '@ngrx/operators': '22.0.0', 'rxjs': '7.8.2',
};

type Draft = Omit<Capability, 'support' | 'note' | 'member' | 'form' | 'framework'> &
  Partial<Pick<Capability, 'support' | 'note' | 'member' | 'form' | 'framework'>>;
const entry = (draft: Draft): Capability => ({ member: null, form: 'function', framework: null,
  support: 'supported', note: null, ...draft });

const ANGULAR = '@angular/core';
const INTEROP = '@angular/core/rxjs-interop';
const STORE = '@ngrx/store';
const EFFECTS = '@ngrx/effects';
const SIGNALS = '@ngrx/signals';
const SIGNALS_RX = '@ngrx/signals/rxjs-interop';
const EVENTS = '@ngrx/signals/events';

const registry: Capability[] = [
  // R01 Angular Signal state source, write, read, read-only alias.
  entry({ matcherId:'angular/signal', semanticId:'state-source:signal', contracts:['R01'], module:ANGULAR,
    export:'signal', framework:'angular-signal' }),
  entry({ matcherId:'angular/signal.read', semanticId:'state-read:signal', contracts:['R01'], module:ANGULAR,
    export:'signal', form:'invoke', framework:'angular-signal' }),
  entry({ matcherId:'angular/signal.set', semanticId:'state-write:signal-set', contracts:['R01'], module:ANGULAR,
    export:'WritableSignal', member:'set', form:'member', framework:'angular-signal' }),
  entry({ matcherId:'angular/signal.update', semanticId:'state-write:signal-update', contracts:['R01'], module:ANGULAR,
    export:'WritableSignal', member:'update', form:'member', framework:'angular-signal' }),
  entry({ matcherId:'angular/signal.asReadonly', semanticId:'reactive-link:readonly-alias', contracts:['R01'],
    module:ANGULAR, export:'WritableSignal', member:'asReadonly', form:'member', framework:'angular-signal' }),
  // R02 derived values and the tracking rules around them.
  entry({ matcherId:'angular/computed', semanticId:'reactive-link:computed', contracts:['R02'], module:ANGULAR,
    export:'computed', framework:'angular-signal' }),
  entry({ matcherId:'angular/computed.equal', semanticId:'reactive-link:equality-gate', contracts:['R02'],
    module:ANGULAR, export:'computed', member:'equal', form:'option', framework:'angular-signal' }),
  entry({ matcherId:'angular/linkedSignal', semanticId:'reactive-link:linked-signal', contracts:['R02'],
    module:ANGULAR, export:'linkedSignal', framework:'angular-signal' }),
  entry({ matcherId:'angular/untracked', semanticId:'state-read:untracked', contracts:['R02'], module:ANGULAR,
    export:'untracked', framework:'angular-signal' }),
  // R03 effects, their phase, and their teardown.
  entry({ matcherId:'angular/effect', semanticId:'effect:angular-effect', contracts:['R03'], module:ANGULAR,
    export:'effect', framework:'angular-signal' }),
  entry({ matcherId:'angular/afterRenderEffect', semanticId:'effect:after-render', contracts:['R03'], module:ANGULAR,
    export:'afterRenderEffect', framework:'angular-signal' }),
  entry({ matcherId:'angular/effect.onCleanup', semanticId:'effect:cleanup', contracts:['R03'], module:ANGULAR,
    export:'effect', member:'onCleanup', form:'option', framework:'angular-signal' }),
  entry({ matcherId:'angular/EffectRef.destroy', semanticId:'effect:destroy', contracts:['R03'], module:ANGULAR,
    export:'EffectRef', member:'destroy', form:'member', framework:'angular-signal' }),
  // R04 inputs, the RxJS interop boundary, and the Store signal consumer.
  entry({ matcherId:'angular/input', semanticId:'state-source:input-signal', contracts:['R04'], module:ANGULAR,
    export:'input', framework:'angular-signal' }),
  entry({ matcherId:'angular/input.required', semanticId:'state-source:input-signal-required', contracts:['R04'],
    module:ANGULAR, export:'input', member:'required', form:'member', framework:'angular-signal' }),
  entry({ matcherId:'angular/model', semanticId:'state-source:model-signal', contracts:['R04'], module:ANGULAR,
    export:'model', framework:'angular-signal' }),
  entry({ matcherId:'angular/toSignal', semanticId:'reactive-link:observable-to-signal', contracts:['R04'],
    module:INTEROP, export:'toSignal', framework:'angular-signal' }),
  entry({ matcherId:'angular/toObservable', semanticId:'reactive-link:signal-to-observable', contracts:['R04'],
    module:INTEROP, export:'toObservable', framework:'angular-signal' }),
  entry({ matcherId:'ngrx-store/Store.selectSignal', semanticId:'state-read:selector-signal', contracts:['R04'],
    module:STORE, export:'Store', member:'selectSignal', form:'member', framework:'ngrx-store' }),
  // R05 the generated Store class and feature composition entry points.
  entry({ matcherId:'signals/signalStore', semanticId:'store-declaration:signal-store', contracts:['R05'],
    module:SIGNALS, export:'signalStore', framework:'signal-store' }),
  entry({ matcherId:'signals/signalStoreFeature', semanticId:'store-feature:composite', contracts:['R05'],
    module:SIGNALS, export:'signalStoreFeature', framework:'signal-store' }),
  entry({ matcherId:'signals/withFeature', semanticId:'store-feature:deferred', contracts:['R05'], module:SIGNALS,
    export:'withFeature', framework:'signal-store' }),
  // R06 the built-in features.
  entry({ matcherId:'signals/withState', semanticId:'store-feature:state', contracts:['R06'], module:SIGNALS,
    export:'withState', framework:'signal-store' }),
  entry({ matcherId:'signals/withComputed', semanticId:'store-feature:computed', contracts:['R06'], module:SIGNALS,
    export:'withComputed', framework:'signal-store' }),
  entry({ matcherId:'signals/withLinkedState', semanticId:'store-feature:linked-state', contracts:['R06'],
    module:SIGNALS, export:'withLinkedState', framework:'signal-store' }),
  entry({ matcherId:'signals/withProps', semanticId:'store-feature:props', contracts:['R06'], module:SIGNALS,
    export:'withProps', framework:'signal-store' }),
  entry({ matcherId:'signals/withMethods', semanticId:'store-feature:methods', contracts:['R06'], module:SIGNALS,
    export:'withMethods', framework:'signal-store' }),
  entry({ matcherId:'signals/withHooks', semanticId:'store-feature:hooks', contracts:['R06'], module:SIGNALS,
    export:'withHooks', framework:'signal-store' }),
  // R07 the state source API shared by SignalState and generated Stores.
  entry({ matcherId:'signals/signalState', semanticId:'state-source:signal-state', contracts:['R07'], module:SIGNALS,
    export:'signalState', framework:'signal-state' }),
  entry({ matcherId:'signals/patchState', semanticId:'state-write:patch-state', contracts:['R07'], module:SIGNALS,
    export:'patchState', framework:'signal-store' }),
  entry({ matcherId:'signals/getState', semanticId:'state-read:snapshot', contracts:['R07'], module:SIGNALS,
    export:'getState', framework:'signal-store' }),
  entry({ matcherId:'signals/watchState', semanticId:'effect:state-watcher', contracts:['R07'], module:SIGNALS,
    export:'watchState', framework:'signal-store' }),
  entry({ matcherId:'signals/deepComputed', semanticId:'reactive-link:deep-computed', contracts:['R07'],
    module:SIGNALS, export:'deepComputed', framework:'signal-store' }),
  // R08 the method factories; their Observable support differs and is not inferred from one another.
  entry({ matcherId:'signals/rxMethod', semanticId:'call:rx-method', contracts:['R08'], module:SIGNALS_RX,
    export:'rxMethod', framework:'signal-store' }),
  entry({ matcherId:'signals/signalMethod', semanticId:'call:signal-method', contracts:['R08'], module:SIGNALS,
    export:'signalMethod', framework:'signal-store' }),
  // R09 the action bus: dispatch, creators, reducers, selectors, registration.
  entry({ matcherId:'ngrx-store/Store.dispatch', semanticId:'action-dispatch:action-instance', contracts:['R09'],
    module:STORE, export:'Store', member:'dispatch', form:'member', framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-store/createAction', semanticId:'action-creator:single', contracts:['R09'], module:STORE,
    export:'createAction', framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-store/createActionGroup', semanticId:'action-creator:group', contracts:['R09'],
    module:STORE, export:'createActionGroup', framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-store/createReducer', semanticId:'action-consume:reducer', contracts:['R09'],
    module:STORE, export:'createReducer', framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-store/on', semanticId:'action-consume:case-reducer', contracts:['R09'], module:STORE,
    export:'on', framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-store/createSelector', semanticId:'state-read:selector', contracts:['R09'], module:STORE,
    export:'createSelector', framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-store/createFeature', semanticId:'state-read:feature', contracts:['R09'], module:STORE,
    export:'createFeature', framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-store/createFeatureSelector', semanticId:'state-read:feature-selector', contracts:['R09'],
    module:STORE, export:'createFeatureSelector', framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-store/Store.select', semanticId:'state-read:selector-observable', contracts:['R09'],
    module:STORE, export:'Store', member:'select', form:'member', framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-store/provideStore', semanticId:'registration:store-root', contracts:['R09'], module:STORE,
    export:'provideStore', framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-store/provideState', semanticId:'registration:store-feature', contracts:['R09'],
    module:STORE, export:'provideState', framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-store/StoreModule', semanticId:'registration:store-module', contracts:['R09'],
    module:STORE, export:'StoreModule', form:'class', framework:'ngrx-store' }),
  // R10 the registration-shaped dispatch overload and the Observer entry point.
  entry({ matcherId:'ngrx-store/Store.dispatch#thunk', semanticId:'action-dispatch:reactive-registration',
    contracts:['R10'], module:STORE, export:'Store', member:'dispatch', form:'member', framework:'ngrx-store',
    note:'the function overload re-dispatches on signal changes and returns an EffectRef' }),
  entry({ matcherId:'ngrx-store/Store.next', semanticId:'action-dispatch:observer-next', contracts:['R10'],
    module:STORE, export:'Store', member:'next', form:'member', framework:'ngrx-store',
    note:'distinct from a plain rxjs Subject.next' }),
  // R11 effects.
  entry({ matcherId:'ngrx-effects/createEffect', semanticId:'action-consume:effect', contracts:['R11'],
    module:EFFECTS, export:'createEffect', framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-effects/ofType', semanticId:'action-consume:of-type', contracts:['R11'], module:EFFECTS,
    export:'ofType', framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-effects/createEffect#dispatch', semanticId:'action-dispatch:effect-return',
    contracts:['R11'], module:EFFECTS, export:'createEffect', member:'dispatch', form:'option',
    framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-effects/provideEffects', semanticId:'registration:effects', contracts:['R11'],
    module:EFFECTS, export:'provideEffects', framework:'ngrx-store' }),
  entry({ matcherId:'ngrx-effects/EffectsModule', semanticId:'registration:effects-module', contracts:['R11'],
    module:EFFECTS, export:'EffectsModule', form:'class', framework:'ngrx-store' }),
  // R12 the event bus entry points.
  entry({ matcherId:'signals-events/event', semanticId:'event-creator:single', contracts:['R12'], module:EVENTS,
    export:'event', framework:'signal-store' }),
  entry({ matcherId:'signals-events/eventGroup', semanticId:'event-creator:group', contracts:['R12'], module:EVENTS,
    export:'eventGroup', framework:'signal-store' }),
  entry({ matcherId:'signals-events/injectDispatch', semanticId:'event-dispatch:named', contracts:['R12'],
    module:EVENTS, export:'injectDispatch', framework:'signal-store' }),
  entry({ matcherId:'signals-events/Dispatcher.dispatch', semanticId:'event-dispatch:direct', contracts:['R12'],
    module:EVENTS, export:'Dispatcher', member:'dispatch', form:'member', framework:'signal-store' }),
  // R13 event consumption.
  entry({ matcherId:'signals-events/withReducer', semanticId:'event-consume:reducer', contracts:['R13'],
    module:EVENTS, export:'withReducer', framework:'signal-store' }),
  entry({ matcherId:'signals-events/on', semanticId:'event-consume:case-reducer', contracts:['R13'], module:EVENTS,
    export:'on', framework:'signal-store' }),
  entry({ matcherId:'signals-events/Events.on', semanticId:'event-consume:subscription', contracts:['R13'],
    module:EVENTS, export:'Events', member:'on', form:'member', framework:'signal-store' }),
  entry({ matcherId:'signals-events/ReducerEvents.on', semanticId:'event-consume:reducer-subscription',
    contracts:['R13'], module:EVENTS, export:'ReducerEvents', member:'on', form:'member', framework:'signal-store',
    note:'receives events before Events' }),
  entry({ matcherId:'signals-events/withEventHandlers', semanticId:'event-consume:handlers', contracts:['R13'],
    module:EVENTS, export:'withEventHandlers', framework:'signal-store' }),
  // R14 delivery scope.
  entry({ matcherId:'signals-events/provideDispatcher', semanticId:'registration:event-scope', contracts:['R14'],
    module:EVENTS, export:'provideDispatcher', framework:'signal-store' }),
  entry({ matcherId:'signals-events/toScope', semanticId:'event-dispatch:scope-config', contracts:['R14'],
    module:EVENTS, export:'toScope', framework:'signal-store' }),
  entry({ matcherId:'signals-events/mapToScope', semanticId:'event-dispatch:scope-operator', contracts:['R14'],
    module:EVENTS, export:'mapToScope', framework:'signal-store' }),
  // R15 the RxJS consumption APIs the real-world composite cases depend on.
  entry({ matcherId:'rxjs/lastValueFrom', semanticId:'call:promise-consume', contracts:['R15'], module:'rxjs',
    export:'lastValueFrom' }),
  entry({ matcherId:'rxjs/firstValueFrom', semanticId:'call:promise-consume', contracts:['R15'], module:'rxjs',
    export:'firstValueFrom' }),
  entry({ matcherId:'rxjs/forkJoin', semanticId:'call:join', contracts:['R15'], module:'rxjs', export:'forkJoin' }),
  // R16 the ranges with no semantic model. They stop the trace instead of being read as a known feature.
  entry({ matcherId:'unsupported/signals-entities', semanticId:null, contracts:['R16'],
    module:'@ngrx/signals/entities', export:null, form:'module', support:'unsupported',
    note:'entity state shape and updaters have no semantic model in this version' }),
  entry({ matcherId:'unsupported/signals-resource', semanticId:null, contracts:['R16'],
    module:'@ngrx/signals/resource', export:null, form:'module', support:'unsupported',
    note:'resource extensions have no semantic model in this version' }),
  entry({ matcherId:'unsupported/component-store', semanticId:null, contracts:['R16'],
    module:'@ngrx/component-store', export:null, form:'module', support:'unsupported',
    note:'ComponentStore is a separate state system and is not read as a SignalStore' }),
  entry({ matcherId:'unsupported/angular-resource', semanticId:null, contracts:['R16'], module:ANGULAR,
    export:'resource', support:'unsupported', note:'resource loading and status have no semantic model' }),
  entry({ matcherId:'unsupported/angular-rxResource', semanticId:null, contracts:['R16'], module:INTEROP,
    export:'rxResource', support:'unsupported', note:'resource loading and status have no semantic model' }),
  entry({ matcherId:'unsupported/angular-httpResource', semanticId:null, contracts:['R16'],
    module:'@angular/common/http', export:'httpResource', support:'unsupported',
    note:'resource loading and status have no semantic model' }),
  // Named because the published docs still show it; it is absent from this version's exports.
  entry({ matcherId:'unsupported/signals-events-withEffects', semanticId:null, contracts:['R16','R13'],
    module:EVENTS, export:'withEffects', support:'unsupported',
    note:'not exported by @ngrx/signals/events in the supported version; an identifier of this name is an unknown feature' }),
];

export function capabilities(): readonly Capability[] { return registry; }
export function capabilityById(matcherId: string): Capability | undefined {
  return registry.find(item => item.matcherId === matcherId);
}
export function capabilitiesForContract(contract: string): Capability[] {
  return registry.filter(item => item.contracts.includes(contract));
}
export const CONTRACT_IDS: readonly string[] = Array.from({ length: 16 },
  (_unused, index) => `R${String(index + 1).padStart(2, '0')}`);

const slash = (value: string): string => value.replaceAll('\\', '/');
const moduleMaps = new Map<string, Map<string, string>>();
const fileModules = new WeakMap<AnalysisContext, Map<string, string | null>>();

function exportTargets(value: unknown, into: Map<string, string>, key: string): void {
  if (typeof value === 'string') { if (!into.has(value)) into.set(value, key); return; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [condition, nested] of Object.entries(value as Record<string, unknown>)) {
    if (condition.startsWith('.')) exportTargets(nested, into, condition);
    else exportTargets(nested, into, key);
  }
}
/** Maps a declaration file back to the specifier that publishes it, so subpaths stay distinct. */
export function moduleIdForFile(context: AnalysisContext, fileName: string): string | null {
  let cache = fileModules.get(context);
  if (!cache) { cache = new Map(); fileModules.set(context, cache); }
  const file = slash(fileName);
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const marker = file.lastIndexOf('/node_modules/');
  if (marker < 0) { cache.set(file, null); return null; }
  const rest = file.slice(marker + '/node_modules/'.length).split('/');
  const name = rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1] ?? ''}` : rest[0] ?? '';
  if (!name) { cache.set(file, null); return null; }
  const packageRoot = `${file.slice(0, marker)}/node_modules/${name}`;
  let map = moduleMaps.get(packageRoot);
  if (!map) {
    map = new Map();
    const text = context.toolchain.typescript.sys.readFile(`${packageRoot}/package.json`);
    if (text) {
      try { exportTargets((JSON.parse(text) as { exports?: unknown }).exports, map, '.'); }
      catch { /* an unreadable manifest leaves the package name as the only identity */ }
    }
    moduleMaps.set(packageRoot, map);
  }
  const relative = `.${file.slice(packageRoot.length)}`;
  const key = map.get(relative);
  const result = key && key !== '.' && !key.includes('*') ? `${name}${key.slice(1)}` : name;
  cache.set(file, result);
  return result;
}

export interface CapabilityMatch { capability: Capability; module: string; export: string; member: string | null }
function symbolOf(context: AnalysisContext, node: ts.Node): ts.Symbol | undefined {
  const t = context.toolchain.typescript;
  let found = context.checker.getSymbolAtLocation(node);
  if (found && found.flags & t.SymbolFlags.Alias) found = context.checker.getAliasedSymbol(found);
  return found;
}
function locate(context: AnalysisContext, symbol: ts.Symbol | undefined): { module: string; name: string } | null {
  if (!symbol) return null;
  const name = symbol.getName();
  for (const declaration of symbol.declarations ?? []) {
    const module = moduleIdForFile(context, declaration.getSourceFile().fileName);
    if (module) return { module, name };
  }
  return null;
}
/** Resolves an identifier through import aliases and re-exports before consulting the registry. */
export function matchIdentifier(context: AnalysisContext, node: ts.Node,
  forms: CapabilityForm[] = ['function', 'class']): CapabilityMatch | null {
  const found = locate(context, symbolOf(context, node));
  if (!found) return null;
  const capability = registry.find(item => item.module === found.module && item.export === found.name &&
    forms.includes(item.form));
  return capability ? { capability, module: found.module, export: found.name, member: null } : null;
}
/** Resolves the receiver's declared class, so `dispatch` on an unrelated object never matches. */
export function matchMember(context: AnalysisContext, receiver: ts.Expression, member: string): CapabilityMatch | null {
  const found = locate(context, context.checker.getTypeAtLocation(receiver).getSymbol());
  if (!found) return null;
  const capability = registry.find(item => item.form === 'member' && item.module === found.module &&
    item.export === found.name && item.member === member);
  return capability ? { capability, module: found.module, export: found.name, member } : null;
}
export interface UnsupportedUse { capability: Capability; module: string; specifier: string; location: ts.Node }
/** Reports imports of ranges with no semantic model; the caller turns these into R16 diagnostics. */
export function unsupportedImports(context: AnalysisContext, file: ts.SourceFile): UnsupportedUse[] {
  const t = context.toolchain.typescript;
  const result: UnsupportedUse[] = [];
  for (const statement of file.statements) {
    if (!t.isImportDeclaration(statement) || !t.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const byModule = registry.find(item => item.form === 'module' && item.support === 'unsupported' &&
      item.module === specifier);
    if (byModule) { result.push({ capability: byModule, module: specifier, specifier, location: statement }); continue; }
    const clause = statement.importClause?.namedBindings;
    if (!clause || !t.isNamedImports(clause)) continue;
    for (const element of clause.elements) {
      const name = (element.propertyName ?? element.name).text;
      const capability = registry.find(item => item.support === 'unsupported' && item.form === 'function' &&
        item.module === specifier && item.export === name);
      if (capability) result.push({ capability, module: specifier, specifier: name, location: element });
    }
  }
  return result;
}

export interface CapabilityAudit { matcherId: string; problem: string }
/** Checks the registry against the installed packages so a renamed or removed export cannot pass unnoticed. */
export function auditCapabilities(context: AnalysisContext): CapabilityAudit[] {
  const t = context.toolchain.typescript;
  const problems: CapabilityAudit[] = [];
  const exportsOf = new Map<string, Set<string> | null>();
  const namesFor = (module: string): Set<string> | null => {
    const cached = exportsOf.get(module);
    if (cached !== undefined) return cached;
    const resolved = t.resolveModuleName(module, `${context.workspaceRoot}/index.ts`,
      context.compilerOptions, { fileExists: file => t.sys.fileExists(file), readFile: file => t.sys.readFile(file) });
    const file = resolved.resolvedModule && context.program.getSourceFile(resolved.resolvedModule.resolvedFileName);
    const symbol = file && context.checker.getSymbolAtLocation(file);
    const names = symbol ? new Set(context.checker.getExportsOfModule(symbol).map(item => item.getName())) : null;
    exportsOf.set(module, names);
    return names;
  };
  for (const capability of registry) {
    if (capability.form === 'module' || !capability.export) continue;
    const names = namesFor(capability.module);
    if (!names) continue;
    const present = names.has(capability.export);
    if (capability.support === 'supported' && !present)
      problems.push({ matcherId: capability.matcherId, problem: `${capability.module} does not export ${capability.export}` });
    if (capability.support === 'unsupported' && present && capability.note?.includes('not exported'))
      problems.push({ matcherId: capability.matcherId, problem: `${capability.module} now exports ${capability.export}; the unsupported note is stale` });
  }
  for (const item of context.toolchain.reactive) {
    const expected = SUPPORTED_PACKAGE_VERSIONS[item.name];
    if (expected && item.version !== expected)
      problems.push({ matcherId: `version/${item.name}`, problem: `${item.name}@${item.version} is outside the tested ${expected}` });
  }
  return problems;
}
