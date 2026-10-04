import { createActionGroup, emptyProps } from '@ngrx/store';

export const catalogActions = createActionGroup({ source: 'Catalog', events: {
  'filter changed': emptyProps(),
  'open list': emptyProps(),
  'open project list': emptyProps(),
  'unrelated': emptyProps(),
} });
