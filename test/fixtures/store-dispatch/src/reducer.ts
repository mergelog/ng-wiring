import { createFeatureSelector, createReducer, createSelector, on } from '@ngrx/store';
import { termChanged } from './actions';

export interface SearchState { term: string }

const initialState: SearchState = { term: '' };

/** P16-09 case 3: the reducer is the only consumer; no effect is registered for this action. */
export const searchReducer = createReducer(
  initialState,
  on(termChanged, (state, { term }) => ({ ...state, term })),
);

export const selectSearch = createFeatureSelector<SearchState>('search');
export const selectTerm = createSelector(selectSearch, state => state.term);
