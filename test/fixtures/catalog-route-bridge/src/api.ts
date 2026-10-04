import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { forkJoin, of, switchMap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly http = inject(HttpClient);

  search(project: string) {
    const projectIds = project
      ? this.http.post('/api/projects.get_all_ex', {})
      : of(null);
    return projectIds.pipe(switchMap(() => forkJoin([
        this.http.post('/api/tasks.get_all_ex', {}),
        this.http.post('/api/models.get_all_ex', {}),
      ])));
  }

  unrelated() { return this.http.post('/api/unrelated.get_all_ex', {}); }
}
