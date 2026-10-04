import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SearchApi {
  private readonly http = inject(HttpClient);
  search() { return this.http.get<string[]>('/api/results'); }
  status() { return this.http.get<string>('/api/status'); }
}
