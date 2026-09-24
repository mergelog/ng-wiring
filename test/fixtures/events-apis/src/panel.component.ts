import { Component } from '@angular/core';
import { provideDispatcher } from '@ngrx/signals/events';
import { GridComponent } from './grid.component';

/** Provides its own dispatcher, so the panel is the local bus instance its children dispatch into. */
@Component({
  selector: 'app-panel',
  imports: [GridComponent],
  providers: [provideDispatcher()],
  template: '<app-grid></app-grid>',
})
export class PanelComponent {}
