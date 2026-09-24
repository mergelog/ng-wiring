import { importProvidersFrom } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { EffectsModule, provideEffects } from '@ngrx/effects';
import { StoreModule, provideState, provideStore } from '@ngrx/store';
import { AppComponent } from './app';
import { AuditEffects, SearchEffects } from './effects';
import { auditReducer, searchReducer } from './reducer';

/** Both registration styles: the standalone providers and the NgModule ones. */
export const start = (): Promise<unknown> => bootstrapApplication(AppComponent, {
  providers: [
    provideStore(),
    provideState('search', searchReducer),
    provideEffects([AuditEffects]),
    importProvidersFrom(StoreModule.forFeature('audit', auditReducer), EffectsModule.forFeature([SearchEffects])),
  ],
});
