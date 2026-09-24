import { Injectable, signal } from '@angular/core';

/** The state lives in a service; the component reaches the same signal through it. */
@Injectable({ providedIn: 'root' })
export class TermService {
  private readonly term = signal('');
  readonly currentTerm = this.term.asReadonly();

  setTerm(value: string): void {
    this.term.set(value);
  }
}
