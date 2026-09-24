import { signalStore, withState } from '@ngrx/signals';
import { on, withReducer } from '@ngrx/signals/events';
import { searchEvents } from './events';

/** P16-09 case 4: the event reaches the state through withReducer, with no handler and no effect. */
export const SearchStore = signalStore(
  { providedIn: 'root' },
  withState({ term: '' }),
  withReducer(on(searchEvents.termChanged, ({ payload }) => ({ term: payload }))),
);
