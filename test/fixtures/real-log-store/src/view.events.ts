import { createAction, props } from '@ngrx/store';

/** The global NgRx bus of the application; the SignalStore event bus is a different one. */
export const activateLoader = createAction('[View] activate loader', props<{ endpoint: string }>());
export const deactivateLoader = createAction('[View] deactivate loader', props<{ endpoint: string }>());
