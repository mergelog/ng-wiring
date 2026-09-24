import { Component, inject } from '@angular/core';
import { ProjectSettingsStore } from './settings.store';

@Component({
  selector: 'app-project-settings',
  providers: [ProjectSettingsStore],
  template: `
    <button data-id="loadScalarsButton" (click)="load()">load</button>
    <button data-id="setProjectButton" (click)="select()">select</button>
    <span class="scalars">{{ store.scalars().length }}</span>
    <span class="project">{{ store.projectId() }}</span>
  `,
})
export class ProjectSettingsComponent {
  readonly store = inject(ProjectSettingsStore);

  load(): void {
    void this.store.loadScalars();
  }

  select(): void {
    this.store.setProject('demo');
  }
}
