import {bootstrapApplication} from '@angular/platform-browser';
import {provideRouter} from '@angular/router';
import {provideStore} from '@ngrx/store';
import {AppRoot} from './root';
import {routes} from './routes';

bootstrapApplication(AppRoot, {providers: [provideStore(), provideRouter(routes)]});
