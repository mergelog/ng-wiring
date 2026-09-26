import {createReducer, on} from '@ngrx/store';
import {increment} from './actions';

export const countReducer = createReducer(0, on(increment, count => count + 1));
const nestedFeature = {countReducer};
export const featureReducers = {...nestedFeature};
