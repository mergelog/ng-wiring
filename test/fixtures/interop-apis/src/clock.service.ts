import { Injectable } from '@angular/core';
import { Subject, type Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ClockService {
  private readonly ticks = new Subject<number>();

  readonly stream: Observable<number> = this.ticks.asObservable();

  tick(value: number): void {
    this.ticks.next(value);
  }
}
