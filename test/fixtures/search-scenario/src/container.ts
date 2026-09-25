import {Component, viewChild} from '@angular/core';
import {SearchComponent} from './search';
import {EditableSectionComponent} from './section';
import {SearchResultsComponent} from './table';
@Component({selector: 'app-search-form', imports: [SearchComponent, EditableSectionComponent, SearchResultsComponent], templateUrl: './container.html'})
export class SearchFormComponent {
  executionParamsForm = viewChild(SearchResultsComponent);
  searchedText: string;
  searchResultsCount: number;
  scrollIndexCounter: number;
  searchTable(value: string) {
    const searchBackward = value === null;
    if (this.searchedText !== value && !searchBackward) {
      this.searchedText = value;
      this.scrollIndexCounter = -1;
      this.searchResultsCount = 0;
      this.executionParamsForm().resetIndex();
    }
    this.executionParamsForm().jumpToNextResult(!searchBackward);
  }
  searchCounterChanged(count: number) { this.searchResultsCount = count; }
  scrollIndexCounterReset() { this.scrollIndexCounter = -1; }
  save() { fetch('/api/save'); }
}
