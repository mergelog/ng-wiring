import { Component } from '@angular/core';

@Component({
  selector: 'app-editable-section',
  template: '<section class="editable"><ng-content select="[search-button]"></ng-content></section>',
})
export class EditableSectionComponent {}
