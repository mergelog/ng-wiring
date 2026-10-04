import { createAction, props } from '@ngrx/store';

export const changeTerm = createAction('[Search] Change term', props<{ term: string }>());
export const changeStatus = createAction('[Search] Change status');
export const changeOther = createAction('[Search] Change other');
export const loadResults = createAction('[Search] Load results');
export const loadStatus = createAction('[Search] Load status');
