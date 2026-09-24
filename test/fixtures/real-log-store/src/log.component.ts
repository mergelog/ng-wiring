import { Component, inject } from '@angular/core';
import { injectDispatch } from '@ngrx/signals/events';
import { experimentOutputLogEvents } from './log.events';
import { ExperimentOutputLogStore } from './log.store';

@Component({
  selector: 'app-experiment-output-log',
  providers: [ExperimentOutputLogStore],
  template: `
    <button data-id="refreshLogButton" (click)="refresh()">refresh</button>
    <button data-id="resetLogButton" (click)="reset()">reset</button>
    <span class="lines">{{ store.totalLogLines() }}</span>
    <span class="loading">{{ store.loading() }}</span>
    <span class="creator">{{ store.creator() }}</span>
  `,
})
export class ExperimentOutputLogComponent {
  readonly store = inject(ExperimentOutputLogStore);
  private readonly dispatch = injectDispatch(experimentOutputLogEvents);

  refresh(): void {
    this.dispatch.getLogs({ id: 'task-1', direction: 'prev', refresh: true });
  }

  reset(): void {
    this.dispatch.resetLog();
  }
}
