#!/usr/bin/env node
/**
 * §2 the large fixture for the performance measurement: a workspace of `size` pages that all display
 * the same search element, so the run has display paths to expand, control flow to finitize, listeners
 * and expressions to resolve, and signal, NgRx and HTTP flows to follow — the work whose dependence on
 * size §10 A18 asks about, rather than file count alone (P17-07).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkTargetWorkspace } from '../test/fixtures/target.mjs';

const page = (index) => `import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngrx/store';
import { SearchComponent } from '../shared/search';
import { SectionComponent } from '../shared/section';
import { termChanged } from '../shared/actions';

@Component({
  selector: 'app-page-${index}',
  imports: [SearchComponent, SectionComponent],
  template: \`<app-section title="Page ${index}">
      <app-search search-button [minimumChars]="1" (valueChanged)="onSearch($event)"></app-search>
      @if (rows().length) {
        <ul>@for (row of rows(); track row) { <li (click)="select(row)">{{ row }}</li> }</ul>
      } @else {
        <p class="empty">{{ term() }}</p>
      }
    </app-section>\`,
})
export class Page${index}Component {
  private readonly http = inject(HttpClient);
  private readonly store = inject(Store);
  readonly term = signal('');
  readonly items = signal<string[]>([]);
  readonly rows = computed(() => this.items().filter(item => item.includes(this.term())));

  onSearch(value: string): void {
    this.term.set(value);
    this.store.dispatch(termChanged({ value }));
    this.http.get<string[]>(\`/api/page-${index}/items?q=\${value}\`).subscribe(items => this.items.set(items));
  }

  select(row: string): void {
    this.store.dispatch(termChanged({ value: row }));
  }
}
`;

export async function generateLargeFixture(root, size) {
  await mkdir(path.join(root, 'src/pages'), { recursive: true });
  await mkdir(path.join(root, 'src/shared'), { recursive: true });
  const indexes = Array.from({ length: size }, (_, index) => index + 1);

  await writeFile(path.join(root, 'src/shared/search.ts'), `import { Component, input, output, signal } from '@angular/core';

@Component({
  selector: 'app-search',
  template: '<input data-id="searchInputField" [value]="value()" (input)="onValueChange($event)" (keydown.enter)="submit()"><button (click)="clear()">x</button>',
})
export class SearchComponent {
  readonly minimumChars = input(0);
  readonly valueChanged = output<string>();
  readonly value = signal('');

  onValueChange(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.value.set(text);
    if (text.length >= this.minimumChars()) this.valueChanged.emit(text);
  }

  submit(): void { this.valueChanged.emit(this.value()); }
  clear(): void { this.value.set(''); this.valueChanged.emit(''); }
}
`);
  await writeFile(path.join(root, 'src/shared/section.ts'), `import { Component, input } from '@angular/core';

@Component({
  selector: 'app-section',
  template: '<h2>{{ title() }}</h2><ng-content select="[search-button]"></ng-content><ng-content></ng-content>',
})
export class SectionComponent { readonly title = input(''); }
`);
  await writeFile(path.join(root, 'src/shared/actions.ts'), `import { createAction, props } from '@ngrx/store';

export const termChanged = createAction('[Search] term changed', props<{ value: string }>());
`);
  await writeFile(path.join(root, 'src/shared/reducer.ts'), `import { createReducer, on } from '@ngrx/store';
import { termChanged } from './actions';

export const searchReducer = createReducer({ term: '' }, on(termChanged, (state, { value }) => ({ ...state, term: value })));
`);

  for (const index of indexes) await writeFile(path.join(root, `src/pages/page-${index}.ts`), page(index));

  await writeFile(path.join(root, 'src/routes.ts'), `import { Routes } from '@angular/router';
${indexes.map(index => `import { Page${index}Component } from './pages/page-${index}';`).join('\n')}

export const routes: Routes = [
${indexes.map(index => `  { path: 'page-${index}', component: Page${index}Component },`).join('\n')}
];
`);
  await writeFile(path.join(root, 'src/app.ts'), `import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({ selector: 'app-root', imports: [RouterOutlet], template: '<router-outlet></router-outlet>' })
export class AppComponent {}
`);
  await writeFile(path.join(root, 'src/main.ts'), `import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { AppComponent } from './app';
import { routes } from './routes';
import { searchReducer } from './shared/reducer';

void bootstrapApplication(AppComponent, { providers: [provideRouter(routes), provideStore({ search: searchReducer })] });
`);
  await writeFile(path.join(root, 'angular.json'), `${JSON.stringify({ version: 1, projects: { app: {
    projectType: 'application', root: '',
    targets: { build: { builder: '@angular/build:application', options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } },
  } } }, null, 2)}\n`);
  await writeFile(path.join(root, 'tsconfig.app.json'), `${JSON.stringify({ compilerOptions: {
    target: 'es2022', module: 'esnext', moduleResolution: 'bundler', strict: true, skipLibCheck: true,
    experimentalDecorators: false, useDefineForClassFields: false, lib: ['es2022', 'dom'],
  }, files: ['src/main.ts'] }, null, 2)}\n`);
  await linkTargetWorkspace(root);
  return root;
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  const [root, size] = process.argv.slice(2);
  if (!root) { console.error('usage: generate-large-fixture.mjs <directory> [size]'); process.exit(2); }
  await generateLargeFixture(path.resolve(root), Number(size ?? 100));
  console.log(`generated a ${size ?? 100} page workspace in ${path.resolve(root)}`);
}
