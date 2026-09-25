import { provideHttpClient } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideState, provideStore } from '@ngrx/store';
import { AppComponent } from './app';
import { viewFeature } from './view.reducer';

export const start = (): Promise<unknown> => bootstrapApplication(AppComponent, {
  providers: [provideHttpClient(), provideStore(), provideState('view', viewFeature)],
});
