import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export interface MetricResult { metric: string; variant: string }

@Injectable({ providedIn: 'root' })
export class MetricsApiService {
  private readonly http = inject(HttpClient);

  getUniqueMetrics(request: { workspace: string | null; include_subworkspaces: boolean;
    include_models?: boolean }): Observable<{ metrics: MetricResult[] }> {
    return this.http.post<{ metrics: MetricResult[] }>('/api/settings/metrics', request);
  }
}
