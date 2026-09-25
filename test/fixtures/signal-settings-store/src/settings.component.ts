import { Component, inject } from '@angular/core';
import { SettingsStore } from './settings.store';

@Component({
  selector: 'app-workspace-settings',
  providers: [SettingsStore],
  template: `
    <button data-id="loadScalarsButton" (click)="load()">load</button>
    <button data-id="setProjectButton" (click)="select()">select</button>
    <span class="scalars">{{ store.scalars().length }}</span>
    <span class="workspace">{{ store.workspaceId() }}</span>
  `,
})
export class ProjectSettingsComponent {
  readonly store = inject(SettingsStore);

  load(): void {
    void this.store.loadScalars();
  }

  select(): void {
    this.store.setProject('demo');
  }
}
