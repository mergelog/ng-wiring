import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFixture, edgeKeys, findings } from './fixtures/harness.mjs';

/**
 * §10 P16-11: composite fixtures include boundaries this version does not cross, so a minimal fixture
 * passing never stands for support of an external toolkit feature or of a composed Store feature.
 */

// R15: the log screen — injectDispatch -> event -> withReducer and withEventHandlers.
test('signal-log-store: the event reaches the reducer and the handler, and the bridge stays explicit', async () => {
  const { report } = await analyzeFixture('signal-log-store', { target: 'data-id=refreshLogButton' });
  const keys = edgeKeys(report);
  // The dispatch, both consumers, the state the reducer writes, and the display of it.
  assert(keys.includes('event-dispatch|src/log.component.ts#LogViewerComponent|[Log Viewer] getLogs'));
  assert(keys.includes('event-consume|[Log Viewer] getLogs|src/log.store.ts:31:5'), keys.join('\n'));
  assert(keys.includes('event-consume|[Log Viewer] getLogs|src/log.store.ts:43:15'), keys.join('\n'));
  assert(keys.includes('state-write|src/log.store.ts:31:5|loading'));
  assert(keys.includes('state-write|src/log.store.ts:31:5|id'));
  assert(keys.includes('state-read|loading|<span>'));
  // The handler's output is a new event of the same bus and is redelivered.
  assert(keys.includes('event-dispatch|src/log.store.ts:43:15|[Log Viewer] setLog'));
  // The bridge to the NgRx bus is an explicit dispatch; it is never implied by a shared payload shape.
  assert(keys.includes('action-dispatch|src/log.store.ts:43:15|src/view.events.ts#activateLoader'), keys.join('\n'));
  assert.deepEqual(keys.filter(key => key.startsWith('action-consume|') &&
    key.includes('[Log Viewer]')), [], 'a SignalStore event was delivered to the action bus');

  // The external toolkit feature is part of the expected result, as the boundary it is.
  const found = findings(report);
  assert(found.diagnosticCodes.includes('unsupported-store-feature'), found.diagnosticCodes.join(', '));
  assert(found.activeGaps.some(gap => gap.code === 'unsupported-store-feature'),
    'the unidentified external feature is not an active gap');
  assert(report.diagnostics.some(item => item.code === 'ts-error' &&
    item.message.includes('@angular-architects/ngrx-toolkit')), 'the external toolkit import is not reported');
  assert.equal(report.status, 'partial');
  // What this version does not reach is recorded, not claimed: the redelivered event's own consumers
  // and the withComputed members are not connected to the display here.
  assert.deepEqual(keys.filter(key => key.startsWith('state-read|creator|')), [],
    'a withComputed member was connected although this fixture records it as a boundary');
  assert.deepEqual(keys.filter(key => key.startsWith('state-write|') && key.endsWith('|totalLogLines')), [],
    'the redelivered event was followed although this fixture records it as a boundary');
});

test('signal-log-store: an event with only a reducer needs no handler and no API', async () => {
  const { report } = await analyzeFixture('signal-log-store', { target: 'data-id=resetLogButton' });
  const keys = edgeKeys(report);
  assert(keys.includes('event-dispatch|src/log.component.ts#LogViewerComponent|[Log Viewer] resetLog'));
  assert(keys.includes('event-consume|[Log Viewer] resetLog|src/log.store.ts:30:5'), keys.join('\n'));
  assert.deepEqual(keys.filter(key => key.startsWith('http-')), [], 'a request was attributed to resetLog');
});

// R15: the settings Store — withMethods -> lastValueFrom(forkJoin) -> patchState behind a composed feature.
test('signal-settings-store: the composed feature and the unidentified one are recorded as boundaries', async () => {
  const { report } = await analyzeFixture('signal-settings-store', { target: 'data-id=loadScalarsButton' });
  const keys = edgeKeys(report);
  const found = findings(report);
  // The feature the build environment supplies cannot be identified, so the Store range stays partial.
  assert(found.diagnosticCodes.includes('unsupported-store-feature'), found.diagnosticCodes.join(', '));
  assert(report.diagnostics.some(item => item.code === 'unsupported-store-feature' &&
    item.message.includes('storeDevToolsFeature')), 'the unidentified feature is not named');
  assert.equal(report.status, 'partial');
  // The method of a Store composed through signalStoreFeature is not resolved in this version, so the
  // trace stops at the call instead of claiming the request and the patchState behind it.
  assert(report.edges.some(edge => edge.kind === 'boundary' && edge.confidence === 'unresolved'));
  assert.deepEqual(keys.filter(key => key.startsWith('http-')), [],
    'the request behind the composed feature was claimed although the method is not resolved');
  assert.deepEqual(keys.filter(key => key.startsWith('state-write|')), [],
    'a patchState behind the composed feature was claimed');
  // What is reached is still reported: the listener and the display path.
  assert(keys.includes('dom-listener|<button>|click → load()'));
  assert(keys.includes('bootstrap|bootstrapApplication(src/main.ts)|src/app.ts#AppComponent'));
});
