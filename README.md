# ng-wiring

Angular 22 source wiring analyzer. The implementation covers the library layers
through P13 in [x-tasks.md](x-tasks.md): project contexts, the pinned ngmaze JSON
adapter, Angular scope and element indexing, projection, TemplateRef display
paths, route/bootstrap reconstruction with outlet placement, control-flow
blocks with the finitization limits around them, listener/template expression
resolution, input/output and RxJS operation tracing, injector resolution,
registered NgRx Store action/reducer/effect paths, Angular Signal / SignalStore
state and the separate SignalStore event bus, and HTTP request sites with their
method, URL, used types and the consumer that starts them. The normalized
intermediate model lives in `src/model` with its JSON Schema in
[docs/ng-wiring.schema.json](docs/ng-wiring.schema.json). Report rendering and
the assembly of the analysis layers into that model are still under development.
The command validates arguments and reports that the analysis backend is
unavailable; it does not claim to produce a wiring report yet.

```sh
npm ci
npm run build
npm test
node dist/cli/index.js --help
```

The planned command syntax and output contract are documented in
[x-structure.md](x-structure.md). The P3–P13 APIs are library entry points until
the later CLI and renderer phases connect them.
