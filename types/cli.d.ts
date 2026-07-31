/// <reference types="node" />

// The published types entry for `exports["./cli"]`. A consumer importing only the
// CLI surface never loads `./index.d.ts`, so it needs its own copy of the
// reference directive. See `./index.d.ts` for why a shipped types entry is the
// only mechanism that works.
export * from '../dist/cli/index.js'
