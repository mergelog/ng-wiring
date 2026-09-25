import {Component, input, output, OnChanges, SimpleChanges} from '@angular/core';
@Component({selector: 'sm-experiment-execution-parameters', template: '<p>{{ matchIndex }}</p>'})
export class ExperimentExecutionParametersComponent implements OnChanges {
  searchedText = input<string>();
  searchCounterChanged = output<number>();
  scrollToResultCounterReset = output();
  matchIndex = -1;
  searchIndexList: number[] = [];
  resetIndex() { this.matchIndex = -1; }
  jumpToNextResult(forward: boolean) { this.matchIndex = forward ? this.matchIndex + 1 : this.matchIndex - 1; }
  ngOnChanges(changes: SimpleChanges) {
    if (changes?.searchedText) {
      const count = this.searchedText()?.length ?? 0;
      this.searchCounterChanged.emit(count);
      this.scrollToResultCounterReset.emit();
      this.searchIndexList = [count];
    }
  }
}
