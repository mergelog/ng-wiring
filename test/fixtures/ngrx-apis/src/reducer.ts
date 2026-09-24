import { createFeatureSelector, createReducer, createSelector, on } from '@ngrx/store';
import { auditEvents, panelOpened, searchSucceeded, termChanged } from './actions';

export interface SearchState { term: string; hits: number }
export interface AuditState { opened: number }

const searchInitial: SearchState = { term: '', hits: 0 };
const auditInitial: AuditState = { opened: 0 };

export const searchReducer = createReducer(
  searchInitial,
  on(termChanged, (state, { term }) => ({ ...state, term })),
  on(searchSucceeded, (state, { hits }) => ({ ...state, hits })),
);

export const auditReducer = createReducer(
  auditInitial,
  on(panelOpened, state => ({ ...state, opened: state.opened + 1 })),
  on(auditEvents.panelClosed, state => ({ ...state, opened: state.opened - 1 })),
);

export const selectSearch = createFeatureSelector<SearchState>('search');
export const selectTerm = createSelector(selectSearch, state => state.term);
export const selectHits = createSelector(selectSearch, state => state.hits);
export const selectAudit = createFeatureSelector<AuditState>('audit');
export const selectOpened = createSelector(selectAudit, state => state.opened);
