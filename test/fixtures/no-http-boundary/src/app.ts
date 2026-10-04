import { Component, inject, signal } from '@angular/core';
import { ExternalService } from './external';

@Component({ selector: 'app-root', templateUrl: './app.html' })
export class AppComponent {
  readonly active = signal(false);
  private readonly external = inject(ExternalService);

  toggle() { this.active.update(value => !value); }
  unrelated() { this.external.run(); }
}
