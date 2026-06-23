# Quick Setup

## Prerequisites

| Requirement | Version |
| --- | --- |
| Node.js | `>=24.15.0` |
| npm | bundled with Node |
| Git | required for repository review flows |

Use the repository Node version:

```bash
nvm install
nvm use
```

Install dependencies and run the baseline checks:

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Environment

Create a local `.env` from the template:

```bash
cp .env.example .env
```

The `.env` file is ignored by git. Keep provider credentials there or in your
CI secret store.

## Validate Configuration

```bash
npx tsx src/cli/main.ts config validate
```

Missing `.codereviewer/config.json` is valid. Built-in defaults are applied and
environment overrides are merged on top.

## Current Usable Review Commands

```bash
npx tsx src/cli/main.ts review --file src/app.ts
npm run eval
```

The review command writes run artifacts under `.codereviewer/runs/`. Evaluation uses
development fixtures under `eval/fixtures/`, writes `.codereviewer/eval/`, prints a
human-readable summary, and does not load `.env` for the deterministic default.
Use `npm run eval:with-env` or `npm run eval:semantic` when provider-backed
eval should use `.env`.

Benchmark slices must be hydrated before running `npm run eval:benchmark`:

```bash
npm run eval:hydrate
npm run eval:benchmark
```

Running `eval:benchmark` against un-hydrated positive slices causes the eval to abort
with an error rather than silently recording zero recall.
