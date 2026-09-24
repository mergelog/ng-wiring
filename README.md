# ng-wiring

Angular 22 source wiring analyzer. The implementation covers the library layers
through P5 in [x-tasks.md](x-tasks.md): project contexts, the pinned ngmaze JSON
adapter, Angular scope and element indexing, projection, and TemplateRef display
paths. Route/bootstrap analysis, operation tracing, and report rendering are still
under development. The command validates arguments and reports that the analysis
backend is unavailable; it does not claim to produce a wiring report yet.

```sh
npm ci
npm run build
npm test
node dist/cli/index.js --help
```

The planned command syntax and output contract are documented in
[x-structure.md](x-structure.md). The P3–P5 APIs are library entry points until
the later CLI and renderer phases connect them.
