import {Component} from '@angular/core';
@Component({selector: 'app-section', template: '<section><ng-content select="[search-button]"></ng-content><ng-content></ng-content></section>'})
export class EditableSectionComponent {}
