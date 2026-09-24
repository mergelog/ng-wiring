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
Assembling the analysis layers into that model is still under development: the
command validates arguments and reports that the analysis backend is
unavailable; it does not claim to produce a wiring report yet.

```sh
npm ci
npm run build
npm test
node dist/cli/index.js --help
```

The planned command syntax and output contract are documented in
[x-structure.md](x-structure.md). The P3–P15 APIs are library entry points until
the assembly phase connects them to the CLI.
