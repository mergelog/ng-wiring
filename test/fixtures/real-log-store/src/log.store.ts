import { computed, inject } from '@angular/core';
import { signalStore, withComputed, withState } from '@ngrx/signals';
import { Events, on, withEventHandlers, withReducer } from '@ngrx/signals/events';
import { Store } from '@ngrx/store';
import { mergeMap, switchMap } from 'rxjs/operators';
// External toolkit of the real application; it is not installed here and has no semantic model.
import { withDevtools } from '@angular-architects/ngrx-toolkit';
import { ApiEventsService } from './events-api';
import { experimentOutputLogEvents, type LogLine } from './log.events';
import { activateLoader, deactivateLoader } from './view.events';

export interface ExperimentOutputLogState {
  id: string | null;
  log: LogLine[];
  totalLogLines: number;
  loading: boolean;
}

const initialState: ExperimentOutputLogState = { id: null, log: [], totalLogLines: 0, loading: false };

/** §7.6 R15: the log screen — injectDispatch -> event -> withReducer / withEventHandlers. */
export const ExperimentOutputLogStore = signalStore(
  withState(initialState),
  withDevtools('consoleLog'),
  withComputed(state => ({
    creator: computed(() => state.log().at(-1)?.worker ?? ''),
    hasLog: computed(() => state.log().length > 0),
  })),
  withReducer(
    on(experimentOutputLogEvents.resetLog, () => initialState),
    on(experimentOutputLogEvents.getLogs, ({ payload }) => ({ loading: !payload.refresh, id: payload.id })),
    on(experimentOutputLogEvents.setLoading, ({ payload }) => ({ loading: payload.loading })),
    on(experimentOutputLogEvents.setLog, ({ payload }) => ({
      log: payload.events, totalLogLines: payload.total, loading: false,
    })),
  ),
  withEventHandlers((
    store,
    events = inject(Events),
    eventsApi = inject(ApiEventsService),
    globalStore = inject(Store),
  ) => ({
    getLogs$: events.on(experimentOutputLogEvents.getLogs).pipe(
      switchMap(({ payload }) => {
        // An explicit bridge to the other bus; it is not implied by the shared payload shape.
        globalStore.dispatch(activateLoader({ endpoint: 'getExperimentLog' }));
        return eventsApi.eventsGetTaskLog({
          task: payload.id, batch_size: 1000, navigate_earlier: payload.direction !== 'next',
        }).pipe(mergeMap(response => [
          experimentOutputLogEvents.setLog({ id: payload.id, events: response.events, total: response.total }),
          deactivateLoader({ endpoint: 'getExperimentLog' }),
        ]));
      }),
    ),
  })),
);
