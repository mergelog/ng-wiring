import { provideHttpClient } from '@angular/common/http';
import { provideEffects } from '@ngrx/effects';
import { provideState, provideStore } from '@ngrx/store';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app';
import { SearchEffects } from './effects';
import { searchReducer } from './state';

bootstrapApplication(AppComponent, { providers: [
  provideHttpClient(), provideStore(), provideState('search', searchReducer), provideEffects([SearchEffects])
] });
