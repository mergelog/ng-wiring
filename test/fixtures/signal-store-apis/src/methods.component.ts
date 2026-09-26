import { Component, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { MethodsStore } from './methods.store';

@Component({
  selector: 'app-methods',
  providers: [MethodsStore],
  template: `
    <button data-id="loadValueButton" (click)="loadValue()">value</button>
    <button data-id="loadSignalButton" (click)="loadSignal()">signal</button>
    <button data-id="loadStreamButton" (click)="loadStream()">stream</button>
    <button data-id="rememberButton" (click)="remember()">remember</button>
    <span class="hits">{{ store.hits() }}</span>
    <span class="last">{{ store.last() }}</span>
  `,
})
export class MethodsComponent {
  readonly store = inject(MethodsStore);
  readonly term = signal('boots');
  private readonly stream = new Subject<string>();

  loadValue(): void {
    this.store.load('shoes');
  }

  loadSignal(): void {
    this.store.load(this.term);
  }

  loadStream(): void {
    this.store.load(this.stream);
  }

  remember(): void {
    this.store.remember('saved');
    this.store.remember(this.term);
    this.store.remember(this.stream);
  }
}
