import { createReducer, createSelector, on } from '@ngrx/store';
import { changeOther, changeStatus, changeTerm } from './actions';

interface SearchState { term: string; status: string; other: number }
const initial: SearchState = { term: '', status: 'idle', other: 0 };

export const searchReducer = createReducer(initial,
  on(changeTerm, (state, action) => ({ ...state, term: action.term })),
  on(changeStatus, state => ({ ...state, status: 'ready' })),
  on(changeOther, state => ({ ...state, other: state.other + 1 })));

export const selectSearch = (state: { search: SearchState }) => state.search;
export const selectTerm = createSelector(selectSearch, state => state.term);
export const selectStatus = createSelector(selectSearch, state => state.status);
