# Running Tests and Checks

Every command here runs from a source checkout of this repository. The package
is `"private": true` and is not published, so there is no global install and no
`npx` form.

---

## Set up

Match the Node version pinned in `.nvmrc` (`24.15.0`; `package.json` requires
`>=24.15.0`):

```bash
nvm install && nvm use
```

Install dependencies:

```bash
npm ci
```

Provider adapters are optional peer packages. `@purista/harness-openai` is
already a devDependency, so the default suite runs without installing anything
else.

---

## The required gates

Run all five before claiming a change is complete. They are what
`.agent/IMPLEMENTATION.md` and `AGENTS.md` require.

### 1. Typecheck

```bash
npm run typecheck
```

Strict TypeScript with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
and `verbatimModuleSyntax`. `npm run lint` is an alias for this — there is no
separate linter.

### 2. Tests

```bash
npm test
```

Vitest over `src/**/*.test.ts`. **Hermetic and free**: it never calls a real
model provider. `src/**/*.live.test.ts` is excluded.

### 3. Generated-schema check

```bash
npm run generate:schemas:check
```

Compares the checked-in JSON Schemas against what the Zod contracts generate
today, and exits `1` naming any stale file. Required — it is **not** covered by
`npm test`.

Regenerate when it fails:

```bash
npm run generate:schemas
```

Outputs:

| File | Generated from |
| --- | --- |
| `schema/codereviewer-config.schema.json` | `CodeReviewerConfigSchema` |
| `specs/03-contracts/config.schema.json` | `CodeReviewerConfigSchema` |
| `specs/03-contracts/review-report.schema.json` | `ReviewReportSchema` |

Stale output is `generated-artifact-drift`, a hard error in the drift gate.

### 4. Drift check

```bash
npm run cli -- drift check
```

Deterministic, no provider call. Exits `1` when a hard-error category fires
(`generated-artifact-drift` and `security-drift` by default) and prints every
finding as JSON. Required alongside the schema check: the two catch different
things — stale generated artifacts versus docs/specs/CLI disagreement.

### 5. Build

```bash
npm run build
```

`tsc -p tsconfig.json`. Remove the output afterwards unless a spec explicitly
requires tracked build artifacts:

```bash
rm -rf dist
```

> The build uses `tsconfig.build.json`, not `tsconfig.json`. It pins
> `rootDir` to `src` and excludes tests, so the emitted layout is
> `dist/cli/main.js` and `dist/index.js` — the paths `package.json` declares in
> `bin` and `exports`. `tsconfig.json` stays broader on purpose: `typecheck`
> covers the tests and `vitest.config.ts` as well, which the build must not
> emit.

---

## Coverage

```bash
npx vitest run --coverage
```

Thresholds are enforced at 80% for lines, branches, functions and statements
over `src/**/*.ts`, excluding test files and `src/cli/main.ts`.

---

## Running a subset while you work

One file:

```bash
npx vitest run src/domains/admission/admission-gate.test.ts
```

Watch a path:

```bash
npx vitest watch src/domains/reporting
```

By test name:

```bash
npx vitest run -t "rejects a candidate below the severity threshold"
```

The default config sets `PURISTA_HARNESS_LOG_LEVEL=fatal`, because
negative-path workflow tests deliberately trigger provider failures and the
expected error logs would otherwise flood the output.

---

## Live tests — these cost money

```bash
npm run test:live
```

`src/**/*.live.test.ts` only, using `vitest.live.config.ts`. They resolve a
**real** provider from the environment and make real calls. Facts to know:

- The script loads `.env` via Node's `--env-file-if-exists=.env`.
- Each live test **skips itself** when no provider environment is present, so
  running the command without credentials is safe — it simply reports skips.
- Timeouts are 180 s and file parallelism is disabled so a run does not walk
  into a rate-limit wall.
- Live tests are excluded from `npm test` and from default CI.

---

## Verifying the CLI by hand

```bash
npm run cli -- config validate
```

```bash
npm run cli -- review --base-ref origin/main --head-ref HEAD
```

```bash
npm run cli -- review --debug --log-file .codereviewer/review.log
```

`npm run cli` is
`node --env-file-if-exists=.env --import tsx src/cli/main.ts`, so it runs from
TypeScript source with `.env` loaded. Everything after `--` is passed to the
CLI.

Reviewing with a provider configured makes real provider calls and costs money.
Omit `provider` from the config to exercise the pipeline for free.

---

## Evaluation

`eval run` performs a full review per case plus judge calls. It is the
expensive command in this repository — see
[adding-evaluation-cases.md](adding-evaluation-cases.md) before running it.

Hydrate the captured-pull-request benchmark slices (git fetches only, no
provider call):

```bash
npm run eval:hydrate
```

Hydrate and run the benchmark end to end (**costs provider spend**):

```bash
npm run eval:benchmark
```

Same, with debug logging to a file:

```bash
npm run eval:benchmark:debug
```

Compare two eval reports (free, no provider call):

```bash
npm run cli -- eval compare --base .codereviewer/eval/before.json --head .codereviewer/eval/eval-report.json
```

Render a recall report from existing reports (free):

```bash
npm run cli -- eval recall-report --report .codereviewer/eval/eval-report.json
```

---

## Other scripts

| Command | Does |
| --- | --- |
| `npm run audit:high` | `npm audit --audit-level=high` |
| `npm run update:model-pricing` | Fetch current model prices and report differences |
| `npm run update:model-pricing:write` | Write the refreshed prices into the pricing snapshot |
| `npm run provider:install:openai` | Install `@purista/harness-openai` |
| `npm run provider:install:bedrock` | Install `@purista/harness-bedrock` |
| `npm run provider:install:azure` | Install `@purista/harness-azure-foundry` |
| `npm run dev` | Run `src/index.ts` under `tsx` |

---

## Writing tests

From `specs/00-conventions.md` and `.agent/IMPLEMENTATION.md`:

- Colocate: `name.test.ts` next to `name.ts`.
- Hermetic by default. Use fake or scripted providers; never require network
  credentials in the default suite.
- Contract tests validate fixtures against the Zod schemas.
- Snapshot tests must prove reports and logs exclude raw source, prompts,
  provider responses and secrets.
- Add POSIX-style **and** Windows-style path cases when you touch path parsing,
  report locations, diff mapping, config loading or repository discovery.
- Prefer a failing test before the business logic, then the passing test.
- When you fix a bug, put the regression test next to the module you changed.

---

## Pre-flight checklist

```bash
nvm use && npm run typecheck && npm test && npm run generate:schemas:check && npm run cli -- drift check && npm run build && rm -rf dist
```

If any of these fail, the change is not done. See
[spec-driven-workflow.md](spec-driven-workflow.md) for what each gate protects.
