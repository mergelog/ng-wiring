import { Component, inject } from '@angular/core';
import { injectDispatch } from '@ngrx/signals/events';
import { logViewerEvents } from './log.events';
import { LogViewerStore } from './log.store';

@Component({
  selector: 'app-log-viewer',
  providers: [LogViewerStore],
  template: `
    <button data-id="refreshLogButton" (click)="refresh()">refresh</button>
    <button data-id="resetLogButton" (click)="reset()">reset</button>
    <span class="lines">{{ store.totalLogLines() }}</span>
    <span class="loading">{{ store.loading() }}</span>
    <span class="creator">{{ store.creator() }}</span>
  `,
})
export class LogViewerComponent {
  readonly store = inject(LogViewerStore);
  private readonly dispatch = injectDispatch(logViewerEvents);

  refresh(): void {
    this.dispatch.getLogs({ id: 'task-1', direction: 'prev', refresh: true });
  }

  reset(): void {
    this.dispatch.resetLog();
  }
}
