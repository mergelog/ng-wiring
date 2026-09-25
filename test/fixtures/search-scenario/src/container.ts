import {Component, viewChild} from '@angular/core';
import {SearchComponent} from './search';
import {EditableSectionComponent} from './section';
import {ExperimentExecutionParametersComponent} from './table';
@Component({selector: 'sm-form-container', imports: [SearchComponent, EditableSectionComponent, ExperimentExecutionParametersComponent], templateUrl: './container.html'})
export class ExperimentInfoHyperParametersFormContainerComponent {
  executionParamsForm = viewChild(ExperimentExecutionParametersComponent);
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
