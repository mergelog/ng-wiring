import { inject } from '@angular/core';
import { signalStore, withState } from '@ngrx/signals';
import { Events, ReducerEvents, mapToScope, on, withEventHandlers, withReducer } from '@ngrx/signals/events';
import { gridEvents, rowSelected } from './events';

/** The local Store of one panel; a sibling panel has its own bus instance. */
export const GridStore = signalStore(
  withState({ page: 0, selected: '', early: '' }),
  withReducer(
    on(gridEvents.pageChanged, ({ payload }) => ({ page: payload })),
    on(rowSelected, ({ payload }) => ({ selected: payload.id })),
    on(gridEvents.filterCleared, () => ({ page: 0 })),
  ),
  withState({ noted: false }),
  withReducer(
    // ReducerEvents receives before the Events handlers do.
    on(rowSelected, () => ({ noted: true })),
  ),
  withEventHandlers((_, events = inject(Events)) => ({
    pageChanged$: events.on(gridEvents.pageChanged).pipe(mapToScope('parent')),
  })),
);

export const injectReducerEvents = (): ReducerEvents => inject(ReducerEvents);
