import { type } from '@ngrx/signals';
import { eventGroup } from '@ngrx/signals/events';

export const searchEvents = eventGroup({
  source: 'Search',
  events: { termChanged: type<string>() },
});
