import { Component, inject, signal } from '@angular/core';
import { mapResponse, tapResponse } from '@ngrx/operators';
import { firstValueFrom, forkJoin, from, lastValueFrom, of } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import { MetricsApi } from './api';

/** §7.6 the RxJS consumption APIs the R08 and R15 routes need. */
@Component({
  selector: 'app-consume',
  template: `
    <button data-id="joinButton" (click)="loadBoth()">join</button>
    <button data-id="firstButton" (click)="loadFirst()">first</button>
    <button data-id="ofButton" (click)="fromValues()">of</button>
    <button data-id="fromButton" (click)="fromPromise()">from</button>
    <button data-id="tapButton" (click)="tapBoth()">tap</button>
    <button data-id="mapButton" (click)="mapBoth()">map</button>
    <span class="total">{{ total() }}</span>
    <span class="label">{{ label() }}</span>
    <span class="failed">{{ failed() }}</span>
  `,
})
export class ConsumeComponent {
  private readonly api = inject(MetricsApi);
  readonly total = signal(0);
  readonly label = signal('');
  readonly failed = signal(false);

  /** Both requests must complete before the Promise resolves. */
  async loadBoth(): Promise<void> {
    const metrics = await lastValueFrom(forkJoin([this.api.experiments(), this.api.models()]));
    this.total.set(metrics[0] + metrics[1]);
  }

  /** The first value settles the Promise. */
  async loadFirst(): Promise<void> {
    const experiments = await firstValueFrom(this.api.experiments());
    this.total.set(experiments);
  }

  /** A created Observable, with a comparison that may suppress an unchanged value. */
  fromValues(): void {
    of('alpha', 'alpha', 'beta').pipe(distinctUntilChanged()).subscribe(value => this.label.set(value));
  }

  /** A Promise converted to an Observable settles asynchronously. */
  fromPromise(): void {
    from(Promise.resolve('gamma')).subscribe(value => this.label.set(value));
  }

  /** The success and the failure handler follow their own notification. */
  tapBoth(): void {
    this.api.tapped().pipe(tapResponse({
      next: value => this.total.set(value),
      error: () => this.failed.set(true),
    })).subscribe();
  }

  mapBoth(): void {
    this.api.mapped().pipe(mapResponse({
      mapFn: value => value * 2,
      errorFn: () => 0,
    })).subscribe(value => this.total.set(value));
  }
}
