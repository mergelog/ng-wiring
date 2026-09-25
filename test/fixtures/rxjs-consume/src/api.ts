import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class MetricsApi {
  private readonly http = inject(HttpClient);

  sets(): Observable<number> {
    return this.http.get<number>('/api/metrics/sets');
  }

  types(): Observable<number> {
    return this.http.get<number>('/api/metrics/types');
  }

  /** Its own request site, so the consumption this one reaches is not shared with another caller. */
  tapped(): Observable<number> {
    return this.http.get<number>('/api/metrics/tapped');
  }

  mapped(): Observable<number> {
    return this.http.get<number>('/api/metrics/mapped');
  }
}
