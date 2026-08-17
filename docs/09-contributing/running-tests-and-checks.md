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

This suite includes the two checks that validate the JSON printed in this
repository's Markdown against the schemas that produce and consume it — see
[Configuration examples and configuration files](#configuration-examples-and-configuration-files)
and [Artifact examples](#artifact-examples) below for the conventions they rely
on.

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

Markers on the fence's info string handle the cases classification cannot reach
on its own.

| Info string | Meaning |
| --- | --- |
| `json` | Classified by content, per the rules above. |
| `json config` | Force validation. Use it for an example content classification would miss (an intentionally empty `{}`). A block marked this way that is not valid JSON is a failure — an elision is not allowed under this marker. |
| `json not-config` | Not a configuration example. Use it only if a non-configuration document genuinely needs a top-level key name the schema also uses. |
| any other marker | Also not a configuration example. A marker is an explicit statement of what a block is, and the artifact check below uses the same slot — declaring a contract is declaring the block is not configuration. Without this rule a `run-summary` excerpt would be judged by the configuration schema, since both have a top-level `provider`. |

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

## Documented configuration defaults

`docs/06-reference/configuration/README.md` opens by saying every key, type and
default on those pages "is read from" `config.schema.ts`. That was a convention
and nothing enforced it: roughly a hundred defaults were hand-transcribed into
Markdown tables with nothing comparing them to the schema.
`src/domains/drift/config-default-table-checker.ts` compares them, under
`npm test`. It runs as a test rather than as a `drift check` category for the two
reasons the configuration-example check does.

Nothing was wrong when it was written — every documented default agreed with the
schema. This is drift **prevention**, and the failure it prevents is silent in
both directions:

- a default that moves in the schema leaves a page confidently stating the old
  value (`documented-default-mismatch`);
- a new option ships with no row at all (`undocumented-schema-key`), which is how
  an option nobody can discover gets released.

### The convention

- **Write the key as a fully-qualified dotted path in backticks** —
  `` `review.maxConcurrentTasks` ``. A key with no dot is qualified by the
  nearest enclosing backticked heading, which is how the single-row
  `` `review.signalFacts` `` and `` `review.citations` `` tables address their
  `enabled`.
- **Write the default as a backticked JSON literal** — `` `4` ``, `` `true` ``,
  `` `"stable"` ``, `` `[]` ``. Bold around it changes nothing.
- **Write `*unset*`** when the schema carries no default, and **`*required*`**
  when the key must also be supplied. They are checked as the different claims
  they are.
- **The table is recognised by its header**, `Key | Type | Default | …`. Any
  other table on the page is left alone.

When a default genuinely cannot be a cell, declare it in the row itself:

| Tag in the Default cell | Meaning |
| --- | --- |
| `<!-- no-literal-default <why> -->` | The default is too large to write in the cell and is printed elsewhere on the page — `paths.exclude`'s eighteen globs. The row is not compared. |
| `<!-- covers-subtree <why> -->` | The row documents a nested object, and its leaves are covered here on purpose rather than one row each — `evaluation.regressionGate.overrides`, whose thirteen keys are all profile-derived and are documented as a threshold table. |

Both need a reason of real length. The tag lives inside the cell so it cannot
come adrift from the row it exempts, and it does not render.

**The context-provider union table is not covered**, deliberately: its keys are
relative to a union member chosen by a first column, so they address array
elements rather than configuration paths. A test pins that exactly one such table
exists, so a second uncovered shape cannot appear quietly.

### If the check fails

Fix the row, or fix the schema — whichever is wrong. Do not add an exemption to
silence a mismatch: the tags exist for a default that cannot be written down, not
for one that disagrees.

The check cannot pass by finding nothing: a scanned root that holds Markdown and
yields no key table is reported, the table count is cross-checked against an
independent line scan, floors are held under the table and row counts, every row
must be either compared or exempted, and the exemption count is pinned to an
exact number rather than a ceiling.

---

## Artifact examples

A configuration example is something a reader **writes**. An artifact example is
something the engine **emits** — a report, a manifest, a comment draft — and it
rots the same way. `docs/02-getting-started/install-and-run.md` printed an
`impact check` report with a three-key summary for a week after the producer had
moved to a seventeen-field one, on the page a new user reads first. (The version
literals that incident also involved have since been reset to `"1.0"`
repository-wide — see spec 06; the shape drift is the part this check exists for.)

`src/domains/drift/artifact-example-checker.ts` walks every artifact example
under `README.md`, `docs/`, `skills/` and `specs/` against the exported Zod
contract its producer actually uses, under `npm test`.

### It checks three things, not four

A documented artifact example is almost always an **excerpt** — the three fields
the page is talking about, with `"…"` where a real timestamp or object name
would be. So the example is **not parsed** against the contract. Three things are
checked:

1. every key in the example **exists** in the contract, recursively, inside
   nested objects and array elements alike;
2. a `schemaVersion` shown equals the literal the producer emits today;
3. a value in a **closed enum** position is one of that enum's members.

Completeness is not required and leaf values are not validated. An excerpt is
legitimate; a key the producer cannot emit is not.

### Declaring what a block is

An artifact excerpt cannot be classified by content the way a configuration
example can — `{ "path": …, "line": … }` fits six contracts, and a wrong guess
validates against the wrong one. So a block **declares its contract in the fence's
info string**, in the same slot `json config` already uses:

````markdown
```json impact-report
{ "schemaVersion": "1.0", "status": "completed" }
```
````

**Every ` ```json ` block in those roots must be accounted for**: a configuration
example (classified by content, per the section above), a declared contract, or a
declared exemption. A block that is none of those fails the suite naming the file
and the line. You do not have to know this mechanism exists before adding an
example — the failure tells you.

| Info string | Meaning |
| --- | --- |
| `json <contract-tag>` | Walked against that contract. |
| `json no-contract <reason>` | No contract describes this block. The reason is required and must be a sentence, not a token — an exemption you cannot read is a skip list. |

The tags, each backed by the exported schema of the producer named beside it:

| Tag | Artifact |
| --- | --- |
| `review-report` | the report written to `report.json` |
| `run-summary` | the `run` block of a review report |
| `run-index` | `<artifactDir>/index.json` |
| `review-comment` | an inline review comment draft |
| `baseline` | the file `baseline write` writes |
| `review-stdout` | `review` on stdout |
| `baseline-write-stdout` | `baseline write` on stdout |
| `cli-error` | the JSON object a failing command writes to stderr |
| `run-error` | `<artifactDir>/error.json` for a failed run |
| `impact-report` | `impact check` |
| `intent-report` | `intent check` |
| `eval-report` | `eval run` |
| `eval-slice-manifest` | `eval slice-manifest` |
| `eval-case` | an entry of `eval/fixtures/sample-eval-cases.json` |
| `eval-slice-case` | a slice pack `slice.json` |
| `expected-finding` | an `expectedFindings` entry |
| `no-finding-zone` | an `expectedNoFindingZones` entry |
| `corpus-manifest`, `corpus-case` | a real-repository corpus manifest and its cases |
| `removed-comment-disclosure-review` | the disclosure judgement on a corpus case |
| `impact-corpus-manifest`, `impact-corpus-case` | the change-impact corpus manifest and its cases |

There is deliberately no `sarif` tag. SARIF is a third-party format this
repository does not define — `sarif-validation.ts` asserts a few structural
invariants before writing, not a key set — so the tag could only be backed by a
hand-transcribed copy of the OASIS schema, which would rot exactly like the
example it was meant to check. A page that prints SARIF must say so with
`no-contract`.

### If the check fails

Fix the example against the producer, not the checker. Run the command where you
can (`impact check` and `config validate` make no provider call) and read the
contract where you cannot. Adding `no-contract` to a block that really is an
artifact turns the check into the thing it replaced.

---

## Coverage

```bash
npm run test:coverage
```

The same suite as `npm test`, with the thresholds in `vitest.config.ts` applied.
**This is what CI runs** — `pr-checks.yml` and `publish.yml` both call it in place
of `npm test`, so the floors below are a gate rather than a preference.

They were neither until 2026-08-17: the thresholds were configured, no script and
no workflow step ever ran them, and this page said they were "enforced at 80%".

Floors are set just under the measured figures rather than at a round number.
Measured 2026-08-17 over 2 862 tests: statements 96.48%, branches 87.69%,
functions 97.64%, lines 96.49%. The floors are 95% for lines, functions and
statements and 85% for branches, over `src/**/*.ts`, excluding test files and
`src/cli/main.ts`. A floor at 80% against a real 96% is a gate that cannot fire.

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
