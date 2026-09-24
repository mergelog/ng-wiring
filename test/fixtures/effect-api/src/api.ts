import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SearchApi {
  private readonly http = inject(HttpClient);

  search(term: string): Observable<string[]> {
    return this.http.get<string[]>('/api/search', { params: { term } });
  }
}
