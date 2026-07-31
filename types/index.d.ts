/// <reference types="node" />

// The published types entry for `import … from '@sebastianwessel/codereviewer'`.
//
// It exists for one reason: to carry the reference directive above into the
// consumer's program. Three shipped declarations name `Buffer` in a public type
// position — `sha256`, the repository-intake `readFile` port, and the
// context-ledger `content` field — and without this, a consumer compiling against
// the package got three TS2591 "Cannot find name 'Buffer'" errors raised inside
// our own `.d.ts`, curable only by adding `"types": ["node"]` to THEIR tsconfig.
// That is a fix nobody can be expected to guess from the error.
//
// Why this file rather than a directive in the source — all four alternatives were
// measured against TypeScript 6.0.3, and all four failed:
//
//  1. `/// <reference types="node" />` at the top of `src/index.ts` — pruned from
//     the emitted declaration, because `index.ts` itself uses no Node type.
//  2. The same directive in `src/shared/hash/hash.ts`, which does use `Buffer` —
//     also stripped. TypeScript does not preserve the directive when `types` is
//     set in the compiler options, and `tsconfig.build.json` must set it.
//  3. Removing `types` from `tsconfig.build.json` so TypeScript emits the
//     reference itself — it does not. The build still compiles, but only because
//     a dependency's own declarations pull the Node types in transitively, so
//     TypeScript sees no reference it needs to add.
//  4. `import type { Buffer } from 'node:buffer'` in each of the three modules —
//     the import itself fails to resolve in the consumer, because `node:buffer`'s
//     types live in `@types/node`, which is not yet in the program. This is the
//     same failure one step removed.
//
// TypeScript 6 does not auto-include `@types/node` from `node_modules/@types`;
// installing it in the consumer is NOT sufficient on its own. A directive is the
// only mechanism that pulls it in, which is also why `@types/node` is a runtime
// `dependency` rather than a dev one — a consumer must be able to resolve it
// without having asked for it.
//
// Keep this file and `./cli.d.ts` in step with the `exports` map in package.json:
// a consumer importing only `./cli` never loads this file.
export * from '../dist/index.js'
