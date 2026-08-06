# Running Tests and Checks

Every command here runs from a source checkout of this repository. Publishing
the package to npm is automated and described in [releasing.md](releasing.md);
this page is about the checks that run before a release, not the release itself.

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

This suite includes the check that validates every JSON configuration example
printed in `docs/` and `skills/` — see
[Configuration examples in documentation](#configuration-examples-in-documentation)
below for the convention it relies on.

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

`tsc -p tsconfig.build.json`, preceded by `prebuild`, which deletes `dist/` so
a rename or deletion in `src/` cannot leave an orphan compiled module behind to
be published. Remove the output afterwards unless a spec explicitly requires
tracked build artifacts:

```bash
npm run clean
```

> The build uses `tsconfig.build.json`, not `tsconfig.json`. It pins
> `rootDir` to `src`, excludes tests and test-only fixtures, and turns
> `sourceMap` off, so the emitted layout is `dist/cli/main.js` and
> `dist/index.js` — the paths `package.json` declares in `bin` and `exports` —
> and nothing else. `tsconfig.json` stays broader on purpose: `typecheck`
> covers the tests and `vitest.config.ts` as well, which the build must not
> emit, and it keeps source maps on for local debugging.

---

## Configuration examples and configuration files

Every JSON configuration in `README.md`, `docs/`, `skills/` and `scripts/` is
validated against `CodeReviewerConfigSchema` itself by
`src/domains/drift/config-example-checker.ts`, under `npm test`. That covers two
kinds of thing:

- **examples** — fenced ` ```json ` blocks inside Markdown, the shapes a reader
  copies. One the schema rejects fails the suite naming the file, the line of the
  opening fence and the configuration path the schema objected to;
- **documents** — whole checked-in `*.json` files that are configuration, such as
  `scripts/github/codereviewer.github.json`, which the code-review workflow runs
  this repository with. A file is recognised the same way a block is, by carrying
  a top-level key of the schema, so a configuration file added tomorrow is covered
  the day it lands with no list to maintain. Unlike a fenced block, a checked-in
  `.json` file that is not valid JSON is reported rather than passed over.

It runs as a test rather than as a `drift check` category for two reasons. A new
drift category would be gated by `drift.failOn`, whose default set is
`generated-artifact-drift` and `security-drift` — so a broken example would be
reported as a warning while `drift check` exited `0`, which is the "absence
produces a confident pass" shape this project has a standing rule against. And
`drift check` scans `README.md`, `docs/` and `specs/`, never `skills/`, which is
where the defect that motivated the check actually lived.

### The convention

- **Write a configuration example rooted at the top level of the configuration
  document** — the shape you would paste into `.codereviewer/config.json`. A
  block is recognised as a configuration example when at least one of its
  top-level keys is a top-level key of `CodeReviewerConfigSchema`.
- **A fragment needs no marker and no exemption.** Every top-level block of the
  schema is optional, so `{ "review": { "maxCostUsd": 5 } }` is a complete,
  valid configuration document on its own. A fragment is validated exactly as
  far as it goes and is never reported for what it leaves out.
- **Everything else is left alone.** A report body, an error envelope, an eval
  fixture, or an illustration with a `…` elision in it carries no top-level
  configuration key, so it is never parsed as configuration.

Two markers on the fence's info string handle the cases classification cannot
reach on its own. Neither is needed anywhere today; they exist so a page that
needs one is not forced to choose between a wrong classification and a silent
skip.

| Info string | Meaning |
| --- | --- |
| `json` | Classified by content, per the rules above. |
| `json config` | Force validation. Use it for an example content classification would miss (an intentionally empty `{}`). A block marked this way that is not valid JSON is a failure — an elision is not allowed under this marker. |
| `json not-config` | Not a configuration example. Use it only if a non-configuration document genuinely needs a top-level key name the schema also uses. |

### If the check fails

Fix the example. Do not weaken the check or add `not-config` to silence it — a
documented configuration that `config validate` exits `2` on is worse than no
example, because it is a broken setup handed to somebody who trusted the page.

The check cannot pass by finding nothing: a scanned root that holds Markdown and
yields no configuration example is itself reported, its block count is
cross-checked against an independent line scan, and each root carries a floor on
how many examples it must still contain. Configuration documents are held the
same way from the test side — `scripts/` must still yield exactly the one
configuration file this repository runs with, and that file is additionally
parsed by name, so a walk that stops seeing `*.json` fails instead of reporting a
clean sweep of nothing.

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
| `npm run audit:high` | `npm audit --audit-level=high` over the whole tree, dev dependencies included |
| `npm run audit:release` | The same at `high`, but `--omit dev` — only what ships. This is the release gate |
| `npm run clean` | Delete `dist/` |
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
nvm use && npm run typecheck && npm test && npm run generate:schemas:check && npm run cli -- drift check && npm run build && npm run clean
```

If any of these fail, the change is not done. See
[spec-driven-workflow.md](spec-driven-workflow.md) for what each gate protects.

The `PR checks` workflow runs the same gates, then packs the package and installs
the tarball to prove it still runs. See [releasing.md](releasing.md).

> `drift check` used to be excluded from CI because the repository did not pass
> it. Both blocking findings turned out to be defects in the checker, not stale
> documentation:
>
> - a reference to the `review` field of `CodeReviewerConfigSchema`, written as a
>   dotted property path, was read as the obsolete artifact directory — an
>   **error**-gated finding. The check now also requires that the dot not follow
>   an identifier character, which a directory root never does;
> - `intent` was missing from the checker's hand-maintained CLI inventory, so
>   every spec that documented `intent check` — a command that has shipped for a
>   long time — was reported as documenting a command that does not exist.
>
> Both are fixed, and a test pins the CLI inventory against the CLI's real
> dispatch. The rule that kept them visible still stands: **fix what the gate
> reports, or fix the gate's logic — never relax the gate to accommodate a
> finding.** A checker that reports the truth as drift is worse than no checker,
> because it teaches people to skip it.
