import {Component, ElementRef, OnInit, input, output, viewChild} from '@angular/core';
import {Subject, timer} from 'rxjs';
import {debounce, filter, tap} from 'rxjs/operators';
@Component({selector: 'app-search', templateUrl: './search.html'})
export class SearchComponent implements OnInit {
  value$ = new Subject<string>();
  minimumChars = input(3);
  debounceTime = input(300);
  enableSearchOnSubmit = input(false);
  value = input('');
  valueChanged = output<string>();
  searchBarInput = viewChild<ElementRef>('searchBar');
  ngOnInit() {
    this.value$.pipe(
      tap((val: string) => void val),
      debounce((val: string) => val.length > 0 ? timer(this.debounceTime()) : timer(0)),
      filter((val) => val.length === 0 || val !== this.value()),
      filter(val => val.length >= this.minimumChars() || val.length === 0)
    ).subscribe((value: string) => {
      if (value.length >= this.minimumChars()) this.valueChanged.emit(value);
      else this.valueChanged.emit('');
    });
  }
  onValueChange() { this.value$.next(this.searchBarInput().nativeElement.value); }
  validateValue() {}
  findNext(backward?: boolean) { this.valueChanged.emit(backward ? null : this.searchBarInput().nativeElement.value); }
}
