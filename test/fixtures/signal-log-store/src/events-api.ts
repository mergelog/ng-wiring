import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { LogLine } from './log.events';

@Injectable({ providedIn: 'root' })
export class ApiEventsService {
  private readonly http = inject(HttpClient);

  getLogEntries(request: { itemId: string; batch_size: number; navigate_earlier: boolean }):
  Observable<{ events: LogLine[]; total: number }> {
    return this.http.post<{ events: LogLine[]; total: number }>('/api/logs/list', request);
  }
}
