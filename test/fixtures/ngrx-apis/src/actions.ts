import { createAction, createActionGroup, emptyProps, props } from '@ngrx/store';

export const termChanged = createAction('[Search] term changed', props<{ term: string }>());
export const searchRequested = createAction('[Search] requested', props<{ term: string }>());
export const searchSucceeded = createAction('[Search] succeeded', props<{ hits: number }>());
export const panelOpened = createAction('[Audit] panel opened');
export const noteAdded = createAction('[Notes] added', props<{ text: string }>());

export const auditEvents = createActionGroup({
  source: 'Audit',
  events: {
    'panel opened': emptyProps(),
    'panel closed': props<{ reason: string }>(),
  },
});
