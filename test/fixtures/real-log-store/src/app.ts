import { Component } from '@angular/core';
import { ExperimentOutputLogComponent } from './log.component';

@Component({
  selector: 'app-root',
  imports: [ExperimentOutputLogComponent],
  template: '<app-experiment-output-log></app-experiment-output-log>',
})
export class AppComponent {}
