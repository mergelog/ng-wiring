import { type } from '@ngrx/signals';
import { eventGroup } from '@ngrx/signals/events';

export interface LogLine { timestamp: number; msg: string; worker: string }

export const experimentOutputLogEvents = eventGroup({
  source: 'Experiment Output Log',
  events: {
    getLogs: type<{ id: string; direction: string; refresh?: boolean }>(),
    resetLog: type<void>(),
    setLog: type<{ id: string; events: LogLine[]; total: number }>(),
    setLoading: type<{ loading: boolean }>(),
  },
});
