import { createAction, props } from '@ngrx/store';

export const termChanged = createAction('[Search] term changed', props<{ term: string }>());
