import { provideHttpClient } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';
import { RootComponent } from './root';
import { routes } from './routes';
import { CatalogEffects } from './effects';

bootstrapApplication(RootComponent, { providers: [
  provideHttpClient(), provideRouter(routes), provideStore(), provideEffects([CatalogEffects]),
] });
