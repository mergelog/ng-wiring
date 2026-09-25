import { provideHttpClient } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app';

export const start = (): Promise<unknown> =>
  bootstrapApplication(AppComponent, { providers: [provideHttpClient()] });
