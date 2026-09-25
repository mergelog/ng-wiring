import { Component } from '@angular/core';
import { ProjectSettingsComponent } from './settings.component';

@Component({
  selector: 'app-root',
  imports: [ProjectSettingsComponent],
  template: '<app-workspace-settings></app-workspace-settings>',
})
export class AppComponent {}
