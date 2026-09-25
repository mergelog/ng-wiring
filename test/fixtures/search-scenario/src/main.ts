import {bootstrapApplication} from '@angular/platform-browser';
import {provideRouter} from '@angular/router';
import {AppRootComponent} from './root';
import {routes} from './routes';
bootstrapApplication(AppRootComponent, {providers: [provideRouter(routes)]});
