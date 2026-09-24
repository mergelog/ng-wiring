import { createFeature, createFeatureSelector, createReducer, createSelector, on } from '@ngrx/store';
import { auditEvents, noteAdded, panelOpened, searchSucceeded, termChanged } from './actions';

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

/** The reducer sits inside an object literal, which is the form R09 also requires. */
export const notesFeature = createFeature({
  name: 'notes',
  reducer: createReducer({ notes: [] as string[] },
    on(noteAdded, (state, { text }) => ({ ...state, notes: [...state.notes, text] }))),
});

export const selectSearch = createFeatureSelector<SearchState>('search');
export const selectTerm = createSelector(selectSearch, state => state.term);
export const selectHits = createSelector(selectSearch, state => state.hits);
export const selectAudit = createFeatureSelector<AuditState>('audit');
export const selectOpened = createSelector(selectAudit, state => state.opened);
