# ng-wiring

Angular 22 source wiring analyzer. The implementation covers the library layers
through P15: project contexts, the pinned ngmaze JSON
adapter, Angular scope and element indexing, projection, TemplateRef display
paths, route/bootstrap reconstruction with outlet placement, control-flow
blocks with the finitization limits around them, listener/template expression
resolution, input/output and RxJS operation tracing, injector resolution,
registered NgRx Store action/reducer/effect paths, Angular Signal / SignalStore
state and the separate SignalStore event bus, and HTTP request sites with their
method, URL, used types and the consumer that starts them. The normalized
intermediate model lives in `src/model` with its JSON Schema in
[docs/ng-wiring.schema.json](docs/ng-wiring.schema.json), and `src/render` turns
that one model into the short tracking map, the detailed Markdown report
(`--detail`), or the `--json` file. Output names begin with a two-digit sequence
(`ngwi-01-...`), which grows to three digits after 99. The next number is based
on files at the Angular workspace root and in the output directory; writing is
serialized through an output lock.
Detection gaps are placed against the selection before they are reported: a gap
is local when its owner, one of its candidates or its location belongs to the
selection, an owner-less gap that nothing ties to it is listed as a gap of the
whole analysis, the rest is counted per code, and a gap ng-wiring filled in
itself keeps its record with the grounds for the fill-in.
`src/assemble` connects those layers to the CLI, so the command runs from a
target element to a written report. All 110 reactive contract subcases have
passing fixtures. Current follow-up work is recorded in
[x-reactive-followups.md](x-reactive-followups.md). Local acceptance tracking is
in `x-local/x-open-work.md`. The P18 usage scenario is accepted.

## Running it

ng-wiring is a single Node.js CLI. It needs no global installation and no
browser extension: one `bin`, no install-time hook, and nothing outside the Node
builtins and `ajv` in the built code. The supported Node versions are
`^22.22.3 || ^24.15.0 || >=26.0.0` on Linux/WSL, macOS and Windows.

```sh
npm ci
npm run build
npm test
node dist/cli/index.js --help
```

Installed into a workspace, the same command is `npx ng-wiring`:

```sh
npx ng-wiring 'data-id="targetInput"' --project app --out-dir reports
```

When one input appears on several screens, copy its selector from Chrome DevTools
and pass it with `--selector`. ng-wiring compares the component host tags and the
final element tag; CSS classes and `:nth-child()` do not establish a source path.
If several source paths remain, it asks you to choose one.

For Angular Material form fields, you can use the lowercased DOM attribute
`formcontrolname` as the target. A selector ending at Material's generated
`div.mat-mdc-form-field-infix` also matches the authored child `<input>` or
`<textarea>`.

```sh
npx ng-wiring 'data-id="saveButton"' --project app \
  --selector 'body > app-root > app-settings > button'
```

The default Markdown is a short root-to-operation map with source links. Use
`--detail` for the previous full report, or `--belowData` to start the short map
at the selected event. `--json` keeps the normalized intermediate model.

Optional workspace integration tests read `.env`. Copy `.env.example` to
`.env` and set `NGWI_TEST_PROJECT_PATH`, `NGWI_TEST_PROJECT`, and
`NGWI_TEST_TARGET`; `.env` is ignored by git. `npm test` then runs an optional
workspace smoke check; set `NGWI_TEST_CANDIDATE` to also generate a full report.
Relative workspace paths use the repository root. Without a workspace path, the
integration check is skipped.

The analysed workspace supplies its own toolchain. ng-wiring resolves
TypeScript, `@angular/compiler` and `@angular/core` from the target's
`node_modules` (§4.2) and never falls back to a copy of its own; the pinned
ngmaze is ng-wiring's own dependency and runs as a separate process. The command
syntax and the output contract are documented in the local archived design,
`x-local/_old/x-structure.md`.
