import { type } from '@ngrx/signals';
import { event, eventGroup } from '@ngrx/signals/events';

/** A single creator, declared on its own rather than in a group. */
export const rowSelected = event('[Grid] row selected', type<{ id: string }>());

export const gridEvents = eventGroup({
  source: 'Grid',
  events: {
    pageChanged: type<number>(),
    filterCleared: type<void>(),
  },
});
