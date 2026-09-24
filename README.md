# ng-wiring

Angular 22 source wiring analyzer. The implementation currently covers project
setup, CLI contract primitives, and TypeScript workspace analysis through P2 in
[x-tasks.md](x-tasks.md). Graph analysis and report rendering (P3–P14) are still
under development. The command validates arguments and reports that the analysis
backend is unavailable; it does not claim to produce a wiring report yet.

```sh
npm ci
npm run build
npm test
node dist/cli/index.js --help
```

The planned command syntax and output contract are documented in
[x-structure.md](x-structure.md). `src/workspace` can already create independent
TypeScript Programs for Angular applications and explicit tsconfigs, include
workspace import closure, and verify the analysis snapshot before output.
