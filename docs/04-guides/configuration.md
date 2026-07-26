# Configuration Recipes

Task-oriented recipes for `.codereviewer/config.json`. Each recipe shows the
smallest configuration that achieves one goal.

For the exhaustive list of keys, types, ranges and defaults, see the
[configuration reference](../06-reference/configuration/). For environment
variables, see [environment.md](../06-reference/environment.md).

---

## How configuration is resolved

Configuration comes from four layers. Later layers win:

```mermaid
flowchart LR
  A["Built-in defaults<br/>(Zod schema)"] --> B[".codereviewer/config.json"]
  B --> C["Process environment<br/>(CODEREVIEWER_*)"]
  C --> D[".env file<br/>(overrides process env)"]
  D --> E["CLI flags"]
```

Facts worth knowing before you start:

| Fact | Detail |
| --- | --- |
| The config file is optional | A missing file is not an error. The run records a `config-file-missing` warning and uses defaults. |
| Unknown keys are rejected | Every object is a Zod `strictObject`. A typo fails validation with exit code `2`. |
| Objects merge, arrays replace | Nested objects deep-merge across layers; an array you set replaces the default array entirely. |
| `.env` beats process env | The loader reads `.env` last, so a value there overrides the same variable in the real environment. `eval run` does **not** read `.env`. |
| Only some keys have env overrides | The `CODEREVIEWER_*` variables cover a deliberate subset. Everything else must go in the config file. |
| `__proto__`, `constructor`, `prototype` | Rejected as configuration keys. |

Validate whatever you write before you rely on it:

```bash
npm run cli -- config validate
```

The command prints the fully merged, defaulted config with secrets masked and
`baseUrl`/`endpoint` reduced to `scheme://host`.

---

## Recipe: the smallest useful config

You want model-backed review with the defaults for everything else.

```json
{
  "provider": {
    "id": "openai",
    "model": "gpt-4o-mini"
  }
}
```

Credentials never live in the config file. See
[providers.md](providers.md) and
[secrets-and-credentials.md](../07-security/secrets-and-credentials.md).

---

## Recipe: run with no model provider at all

You want to try the tool, or run in a network-restricted job, without a
provider. Omit the `provider` block entirely — it is optional.

```json
{
  "reporting": { "formats": ["json", "markdown"] }
}
```

With no provider configured the run performs no network IO: it collects the
diff, computes deterministic support signals, plans tasks, writes artifacts and
evaluates the gate. No model discovery or refutation runs, so the report
contains no model-origin findings.

---

## Recipe: point at a different config file

```bash
npm run cli -- config validate --config config/codereviewer.ci.json
```

The same `--config` flag works on `review`, `baseline write`, `eval run` and
`drift check`. `CODEREVIEWER_CONFIG_PATH` does the same thing from the
environment. The path must resolve inside the repository root.

---

## Recipe: choose what gets reviewed

`paths.include` and `paths.exclude` are glob lists applied to changed files.
Setting `exclude` **replaces** the built-in exclude list, so re-state the
defaults you still want.

```json
{
  "paths": {
    "include": ["src/**/*", "packages/**/*"],
    "exclude": [
      ".git/**",
      "node_modules/**",
      "dist/**",
      "coverage/**",
      ".codereviewer/**",
      "**/package-lock.json",
      "**/*.min.js",
      "**/*.map",
      "**/*.snap",
      "locales/**"
    ]
  }
}
```

The built-in list already skips VCS, dependency, build and artifact
directories plus lock files, minified bundles, source maps and test snapshots.
Add your own generated or data-only directories to keep them out of the model
context.

Two more scope limits live under `review`:

| Key | Default | Meaning |
| --- | --- | --- |
| `review.maxFiles` | `500` | Upper bound on reviewed files. |
| `review.maxFileBytes` | `500000` | Files larger than this are skipped and listed in `skippedFiles`. |

---

## Recipe: review a branch against its merge base

```json
{
  "review": {
    "baseRef": "origin/main",
    "headRef": "HEAD"
  }
}
```

The engine resolves `git merge-base <baseRef> <headRef>` first and diffs from
there, so commits that landed on the base branch after you branched are not
attributed to your change. Refs must not start with `-`.

Both refs can be overridden per invocation:

```bash
npm run cli -- review --base-ref origin/main --head-ref HEAD
```

---

## Recipe: review specific files instead of a diff

```bash
npm run cli -- review --file src/app.ts --file src/router.ts
```

Explicit-file runs skip git diffing entirely. There is no merge base and no
diff ranges, so every finding is judged against whole-file context.

---

## Recipe: tune the noise floor

The two severity dials do different jobs:

| Key | Default | Effect |
| --- | --- | --- |
| `aiReview.actionableSeverityThreshold` | `medium` | A model-origin candidate below this severity is **rejected** at admission (recorded as a rejected finding, so it stays auditable). |
| `review.inlineSeverityThreshold` | `high` | An admitted finding below this severity is `summary-only` instead of `inline`, so it never becomes an inline review comment. |

See [tuning-noise-and-recall.md](tuning-noise-and-recall.md) for how to move
them safely.

---

## Recipe: set the quality gate

```json
{
  "qualityGate": {
    "maxCritical": 0,
    "maxHigh": 0,
    "maxMedium": 5,
    "failOnProviderError": true
  }
}
```

`maxMedium` is omitted by default, which means medium findings never fail the
gate. A gate failure exits `1`; see
[ci-cd.md](ci-cd.md) and
[exit-codes-and-error-codes.md](../06-reference/exit-codes-and-error-codes.md).

---

## Recipe: suppress pre-existing findings with a baseline

```json
{
  "baseline": {
    "enabled": true,
    "path": ".codereviewer/baseline.json",
    "failOnNewOnly": true,
    "includeResolvedInReport": true
  }
}
```

Generate the file from a completed run:

```bash
npm run cli -- baseline write
```

`baseline write` reads the newest run that has a report from
`<artifactDir>/index.json`, or an explicit `--report <path>`. With
`failOnNewOnly` on, the gate only counts findings whose baseline status is
`new` or `unknown` — a configured-but-missing baseline is treated as `unknown`,
so a lost baseline file never silently disables the gate.

---

## Recipe: choose report formats

```json
{
  "reporting": {
    "formats": ["json", "markdown", "sarif"],
    "sarif": {
      "target": "github",
      "category": "codereviewer",
      "maxResults": 5000,
      "redact": true
    }
  }
}
```

`sarif.target: "github"` applies GitHub Code Scanning constraints (partial
fingerprints required, rule-count limit). Use `generic` for any other SARIF
consumer. Artifact names are fixed; see
[artifacts.md](../06-reference/artifacts.md).

---

## Recipe: emit inline review comments for your platform

```json
{
  "reporting": {
    "reviewComments": {
      "enabled": true,
      "platform": "auto"
    }
  }
}
```

The run writes a neutral `review-comments.json` plus a rendered
`review-comments.<platform>.json`. It publishes nothing — posting the comments
is your pipeline's job. `auto` detection is local only (CI environment
variables, then the `origin` git remote host, then `generic`); it makes no
network call. Pin the value to `github`, `gitlab`, `bitbucket` or `generic` to
skip detection. Details in [ci-cd.md](ci-cd.md).

---

## Recipe: add project review instructions

```json
{
  "instructions": {
    "files": [".codereviewer/instructions/house-rules.md"],
    "inline": "Treat any new public HTTP handler without an authorization check as critical."
  }
}
```

Instruction files resolve under the repository root, are redacted before use,
and are recorded in the context ledger and in each finding's provenance hashes.
See [instructions-and-skills.md](instructions-and-skills.md).

---

## Recipe: cap what a run may cost or how long it may take

```json
{
  "review": {
    "maxCostUsd": 2.5,
    "runTimeoutMs": 900000,
    "maxConcurrentTasks": 4
  }
}
```

`maxCostUsd` is checked **after** the review completes: exceeding it fails the
run with `cost_budget_exceeded` (exit `1`) and still writes partial artifacts.
It is a tripwire, not a mid-run brake. `runTimeoutMs` aborts the run and writes
partial artifacts with `review_run_timeout` (exit `4`). See
[controlling-cost.md](controlling-cost.md).

---

## Recipe: turn on logging for one run

```bash
npm run cli -- review --debug --log-file .codereviewer/review.log
```

Logging defaults to `silent`. `--debug` sets level `debug`; `--log-level
<level>` sets any level. `--log-file` appends JSONL (it never truncates) and
writes a `log-run-start` header line per invocation. Logs carry run ids, step
names, timings, counts and error codes — never source, prompts, provider
responses or secrets.

Persist the level instead:

```json
{
  "observability": {
    "logging": { "level": "info" }
  }
}
```

---

## Recipe: feed pull-request or ticket context into the review

Off by default. Your pipeline writes markdown files into an inbox directory
before the run, or you select changed repository files:

```json
{
  "contextSources": {
    "enabled": true,
    "providers": [
      { "type": "inbox", "dir": ".codereviewer/context", "maxFiles": 20, "maxFileBytes": 64000 },
      { "type": "changed-files", "include": ["docs/**/*.md", "specs/**/*.md"] }
    ],
    "summary": { "mode": "model", "maxBytes": 4000 }
  }
}
```

Both providers are filesystem-only: the product performs no tracker or platform
fetch and holds no tracker credentials. An inbox file is plain markdown with an
optional `---` frontmatter block (`id`, `title`, `source` are read). Gathered
text is redacted, bounded, summarized into a brief of at most `summary.maxBytes`
bytes, and injected as untrusted, informational context that cannot approve or
suppress a finding. With `summary.mode` unset the mode resolves at runtime to
`model` when a provider is configured and `digest` (deterministic, no model
call) otherwise.

---

## Recipe: enable the optional discovery and investigation passes

All of these are off by default and each adds provider calls:

```json
{
  "review": {
    "contextScout": { "enabled": true, "maxSymbols": 8, "maxBytesPerSymbol": 4000 },
    "discoverySweep": { "maxAdditionalRounds": 1 },
    "discoveryLensPass": { "enabled": true },
    "crossFileRetrieval": { "enabled": false }
  },
  "security": {
    "dedicatedPass": { "enabled": true }
  },
  "verification": { "enabled": false },
  "fix": { "enabled": false }
}
```

Read [tuning-noise-and-recall.md](tuning-noise-and-recall.md) before enabling
any of them, and [controlling-cost.md](controlling-cost.md) for what each one
adds to the bill.

---

## Recipe: keep the drift gate honest

```json
{
  "drift": {
    "enabled": true,
    "failOn": ["generated-artifact-drift", "security-drift"],
    "includeDocs": true,
    "includeSpecs": true,
    "includeGenerated": true
  }
}
```

The drift checker is deterministic and never sends anything to a provider. It
runs as a preflight step inside `review` and as its own command:

```bash
npm run cli -- drift check
```

---

## What you cannot configure

| Attempt | Result |
| --- | --- |
| `security.allowShell: true` | Validation error, exit `2`. The key accepts the literal `false` only. |
| `security.allowNetwork: true` | Validation error, exit `2`. |
| `security.allowFilesystemWrite: true` | Validation error, exit `2`. |
| `security.captureContentTelemetry: true` | Validation error, exit `2`. |
| `aiReview.requireRefutation: false` | Validation error, exit `2`. Refutation is not optional. |
| Any path escaping the repository root | Rejected before IO. |

See [permissions-and-path-containment.md](../07-security/permissions-and-path-containment.md).
