import { createFeatureSelector, createReducer, createSelector, on } from '@ngrx/store';
import { activateLoader, deactivateLoader } from './view.events';

export interface ViewState { loaders: string[] }

const initialState: ViewState = { loaders: [] };

export const viewFeature = createReducer(
  initialState,
  on(activateLoader, (state, { endpoint }) => ({ ...state, loaders: [...state.loaders, endpoint] })),
  on(deactivateLoader, (state, { endpoint }) => ({ ...state,
    loaders: state.loaders.filter(item => item !== endpoint) })),
);

export const selectView = createFeatureSelector<ViewState>('view');
export const selectLoaders = createSelector(selectView, state => state.loaders);
