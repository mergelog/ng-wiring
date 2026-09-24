import { Component } from '@angular/core';
import { BrokenComponent } from './broken';
import { MissingTemplateComponent } from './missing-template';

@Component({
  selector: 'app-root',
  imports: [BrokenComponent, MissingTemplateComponent],
  template: '<app-broken></app-broken><app-missing-template></app-missing-template>',
})
export class AppComponent {}
