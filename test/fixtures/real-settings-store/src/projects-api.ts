import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export interface MetricVariantResult { metric: string; variant: string }

@Injectable({ providedIn: 'root' })
export class ApiProjectsService {
  private readonly http = inject(HttpClient);

  projectsGetUniqueMetricVariants(request: { project: string | null; include_subprojects: boolean;
    model_metrics?: boolean }): Observable<{ metrics: MetricVariantResult[] }> {
    return this.http.post<{ metrics: MetricVariantResult[] }>('/projects.get_unique_metric_variants', request);
  }
}
