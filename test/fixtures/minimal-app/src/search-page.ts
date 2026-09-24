import { Component } from '@angular/core';
import { EditableSectionComponent } from './section';
import { SearchComponent } from './search';

@Component({
  selector: 'app-search-page',
  imports: [EditableSectionComponent, SearchComponent],
  template: '<app-editable-section><app-search search-button></app-search></app-editable-section>',
})
export class SearchPageComponent {}
