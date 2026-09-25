import { Component } from '@angular/core';
import { LogViewerComponent } from './log.component';

@Component({
  selector: 'app-root',
  imports: [LogViewerComponent],
  template: '<app-log-viewer></app-log-viewer>',
})
export class AppComponent {}
