import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app';
import { routes } from './routes';

export const start = (): Promise<unknown> =>
  bootstrapApplication(AppComponent, { providers: [provideRouter(routes)] });
