# ng-wiring

Angular 22 source wiring analyzer. The implementation covers the library layers
through P15 in [x-tasks.md](x-tasks.md): project contexts, the pinned ngmaze JSON
adapter, Angular scope and element indexing, projection, TemplateRef display
paths, route/bootstrap reconstruction with outlet placement, control-flow
blocks with the finitization limits around them, listener/template expression
resolution, input/output and RxJS operation tracing, injector resolution,
registered NgRx Store action/reducer/effect paths, Angular Signal / SignalStore
state and the separate SignalStore event bus, and HTTP request sites with their
method, URL, used types and the consumer that starts them. The normalized
intermediate model lives in `src/model` with its JSON Schema in
[docs/ng-wiring.schema.json](docs/ng-wiring.schema.json), and `src/render` turns
that one model into either the Markdown report or the `--json` file, names the
output file as §3.4 fixes it and serializes writing through an output lock.
Detection gaps are placed against the selection before they are reported: a gap
is local when its owner, one of its candidates or its location belongs to the
selection, an owner-less gap that nothing ties to it is listed as a gap of the
whole analysis, the rest is counted per code, and a gap ng-wiring filled in
itself keeps its record with the grounds for the fill-in.
`src/assemble` connects those layers to the CLI, so the command runs from a
target element to a written report. What is still open is listed in
[x-tasks.md](x-tasks.md): 28 of the 110 reactive contract subcases have no
passing fixture yet, and P18 has not been accepted.

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
npx ng-wiring 'data-id="searchInputField"' --project app --out-dir reports
```

When one input appears on several screens, copy its selector from Chrome DevTools
and pass it with `--selector`. ng-wiring compares the component host tags and the
final element tag; CSS classes and `:nth-child()` do not establish a source path.
If several source paths remain, it asks you to choose one.

```sh
npx ng-wiring 'data-id=nameField' --project stackup \
  --selector 'body > sm-root > sm-app-shell > sm-common-experiments > sm-experiment-output > sm-experiment-info-header > sm-inline-edit > input'
```

Run times and peak memory for a real application and for generated workspaces
of several sizes are recorded in [docs/performance.md](docs/performance.md),
together with what that measurement could not obtain.

The analysed workspace supplies its own toolchain. ng-wiring resolves
TypeScript, `@angular/compiler` and `@angular/core` from the target's
`node_modules` (§4.2) and never falls back to a copy of its own; the pinned
ngmaze is ng-wiring's own dependency and runs as a separate process. The command
syntax and the output contract are documented in [x-structure.md](x-structure.md).
