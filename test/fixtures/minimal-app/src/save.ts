import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

/** Unrelated to the search input: no operation that starts there may reach this request. */
@Injectable({ providedIn: 'root' })
export class SaveService {
  private readonly http = inject(HttpClient);

  save(body: { text: string }): Observable<{ id: string }> {
    return this.http.post<{ id: string }>('/api/documents', body);
  }
}
