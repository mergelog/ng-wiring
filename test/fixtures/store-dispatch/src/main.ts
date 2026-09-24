import { bootstrapApplication } from '@angular/platform-browser';
import { provideState, provideStore } from '@ngrx/store';
import { AppComponent } from './app';
import { searchReducer } from './reducer';

export const start = (): Promise<unknown> =>
  bootstrapApplication(AppComponent, { providers: [provideStore(), provideState('search', searchReducer)] });
