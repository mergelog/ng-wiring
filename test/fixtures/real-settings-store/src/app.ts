import { Component } from '@angular/core';
import { ProjectSettingsComponent } from './settings.component';

@Component({
  selector: 'app-root',
  imports: [ProjectSettingsComponent],
  template: '<app-project-settings></app-project-settings>',
})
export class AppComponent {}
