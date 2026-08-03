# Config recipes for a new setup

Every key here is verified against the Zod schema in
`src/shared/contracts/config/config.schema.ts`. Every object is a `strictObject`,
so an unrecognised key exits `2` with the key named. Validate anything you write:

```bash
codereviewer config validate
```

## The starting config

```json
{
  "provider": { "id": "openai", "model": "gpt-5.3-codex" }
}
```

That is the whole recommended install. Add below only what the project actually
needs.

Every accuracy rate this project publishes was measured on
`openai/gpt-5.3-codex`. A different model is allowed and supported, but the rates
are not a measurement of it — the review report says so itself, naming both
models, on its `- Model:` line and in its opening paragraph.

The rest of the `provider` block is optional and already sensible:
`temperature` (default `0`), `maxOutputTokens` (unset), `reasoningEffort`
(`minimal`|`low`|`medium`|`high`, unset — raises token cost on reasoning
models), `timeoutMs` (`120000`, the only time bound that exists), `maxRetries`
(`2`), `retryBackoffMs` (`500`), `retryMaxDelayMs` (`30000`). `baseUrl` is
required for, and only meaningful to, `openai-compatible`.

## Keys that are legitimately project-specific

### `paths.exclude` — the one you will usually need

Setting `exclude` **replaces** the built-in list, so restate the parts you still
want. The built-in list already covers `.git/**`, `node_modules/**`, `dist/**`,
`coverage/**`, `.codereviewer/**`, the common lock files, `**/*.min.js`,
`**/*.min.css`, `**/*.map` and `**/*.snap`.

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
      "generated/**",
      "locales/**"
    ]
  }
}
```

Excluding generated, vendored and data-only directories is the highest-leverage
change available: those files carry no reviewable logic and cost full input
tokens. Do it before touching any other cost lever.

### `review.baseRef` — when the default branch is not `main`

```json
{ "review": { "baseRef": "origin/develop" } }
```

Per-invocation `--base-ref` / `--head-ref` override it.

### `review.maxCostUsd` — a tripwire while you are still learning the tool

```json
{ "review": { "maxCostUsd": 5 } }
```

Checked **after** the run completes: exceeding it fails the run with
`cost_budget_exceeded` (exit `1`) and still writes the artifacts. It does not stop
a run in flight.

### `baseline` — adopting on an existing codebase

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

All four values are already the defaults; write the block only if you are changing
one. Generate the file with `codereviewer baseline write`.

### `qualityGate` — loosening a gate that is too strict to adopt

The block has exactly five keys, and this is all of them:

```json
{
  "qualityGate": {
    "maxCritical": 0,
    "maxHigh": 0,
    "maxMedium": 5,
    "failOnProviderError": true,
    "failOnNewOnly": true
  }
}
```

| Key | Default | Note |
| --- | --- | --- |
| `maxCritical` | `0` | |
| `maxHigh` | `0` | |
| `maxMedium` | *unset* | Unset means medium findings never fail the gate. |
| `failOnProviderError` | `true` | |
| `failOnNewOnly` | *unset* | Falls back to `baseline.failOnNewOnly` at runtime. |

Anything else under `qualityGate` exits `2`. In particular `minProductRecall`,
`minRecall` and `maxFalsePositiveCount` are **`eval run` regression-gate** keys
(`evaluation.regressionGate.overrides`) and have nothing to do with a review.

An **absent** gate result on a completed run is not a pass: the CLI fails with
`quality_gate_missing` (exit `5`). There is no configuration that turns the gate
off.

### `reporting.reviewComments` — if the pipeline will post inline comments

```json
{ "reporting": { "reviewComments": { "enabled": true, "platform": "auto" } } }
```

Writes `review-comments.json` plus a rendered `review-comments.<platform>.json`.
**It publishes nothing** — posting is a separate pipeline step with its own token
scope. `auto` detection is local only (CI environment variables, then the `origin`
remote host, then `generic`).

### `contextSources` — required before `intent check` is useful

```json
{
  "contextSources": {
    "enabled": true,
    "providers": [
      { "type": "inbox", "dir": ".codereviewer/context" },
      { "type": "changed-files", "include": ["docs/**/*.md", "specs/**/*.md"] }
    ]
  }
}
```

Both providers are filesystem-only. The engine never calls a tracker or forge API,
so the pipeline fetches the context and writes markdown into the inbox directory
before the run. Gathered text is redacted, bounded, summarised, and injected as
**untrusted informational context** — it cannot approve a finding, change a
severity, or affect the gate.

## Keys people reach for and should not

| Key | Why not |
| --- | --- |
| `review.crossFileRetrieval.maxBytesPerRead` | Unset by default on purpose. It used to default to 24 000 bytes, cut files mid-read without telling the model, and caused three measurements to record cross-file retrieval as harmful when they were measuring the cap. |
| `review.contextMaxBytes` | Lowers the packet ceiling. Leave unset so the provider decides packet size; the local 8 MB guard is a runaway guard, not a ration. |
| `intentFulfilment.maxObligations` / `maxChangeLines` | Both were set as rations and both were measured as harmful: 24 of 28 corpus runs returned exactly the old obligation cap, and 43% of real commits exceeded the old line cap, so the judgement silently saw a partial diff. Defaults are now the contract maxima. |
| `aiReview.maxFilesPerDiscoveryCall` | Default `2` was chosen by a sweep of 1 / 2 / 4 / unlimited. `2` matched the strongest setting on recall and adjusted precision at 27% lower cost, and it is the only arm in that sweep to reach conventional significance. |
| A whole-run timeout | There is none, deliberately. `provider.timeoutMs` (default 120000) is the only time bound. |

## Keys that do not exist

Writing any of these exits `2`:

- `reporting.sarif.redact` — SARIF output is redacted unconditionally.
- `security.signals` — the deterministic security-signal layer has no
  implementation, so no toggle ships for it.
- `changeImpact.blocking`, `intentFulfilment.blocking` — the advisory commands
  always exit `0`.
- `evaluation.enabled` — eval case selection is driven by `eval run` flags.
- `review.contextScout` — the capability was removed.
- `invariantConformance` — the capability was removed on 2026-08-02 after its own
  firing-rate measurement failed the kill criterion its spec fixed in advance.
  The whole block exits `2`, including `{ "enabled": false }`. There are three
  stages, not four.
- `qualityGate.minProductRecall` and every other eval threshold — see the
  `qualityGate` recipe above.

## Keys that accept only one value

Setting any of these to anything else is a validation error:

- `aiReview.requireRefutation` — literal `true`. Refutation is not optional.
- `security.allowShell`, `security.allowNetwork`, `security.allowFilesystemWrite`,
  `security.captureContentTelemetry` — literal `false`.

## Configuration precedence

```text
built-in defaults
  → .codereviewer/config.json
  → process environment (CODEREVIEWER_*)
  → .env at the repository root
  → CLI flags
```

Nested objects deep-merge; arrays replace wholesale. Note that `.env` is read
**after** the process environment and therefore wins — never ship one into a CI
image. (`eval run` does not read `.env` at all.)

## Environment variables

This is the complete set of variables mapped into configuration. Anything else
named `CODEREVIEWER_*` is ignored.

| Variable | Maps to |
| --- | --- |
| `CODEREVIEWER_CONFIG_PATH` | Config file location (same as `--config`) |
| `CODEREVIEWER_PROVIDER_ID` | `provider.id` |
| `CODEREVIEWER_PROVIDER_MODEL` | `provider.model` |
| `CODEREVIEWER_PROVIDER_BASE_URL` | `provider.baseUrl` |
| `CODEREVIEWER_PROVIDER_REASONING_EFFORT` | `provider.reasoningEffort` |
| `CODEREVIEWER_REVIEW_MODE` | `review.mode` |
| `CODEREVIEWER_REVIEW_DEPTH` | `review.depth` |
| `CODEREVIEWER_BASE_REF` / `CODEREVIEWER_HEAD_REF` | `review.baseRef` / `review.headRef` |
| `CODEREVIEWER_ARTIFACT_DIR` | `paths.artifactDir` |
| `CODEREVIEWER_SKILLS_DIR` | `skills.directories` |
| `CODEREVIEWER_AI_DETERMINISTIC_SIGNAL_MODE` | `aiReview.deterministicSignalMode` |
| `CODEREVIEWER_LOG_LEVEL` | `observability.logging.level` |
| `CODEREVIEWER_OPENTELEMETRY_ENABLED` / `_ENDPOINT` / `_HEADERS` | OpenTelemetry export |
| `CODEREVIEWER_COST_INPUT_PER_MILLION` / `_CACHED_INPUT_PER_MILLION` / `_OUTPUT_PER_MILLION` | `costs.*` pricing overrides |

Provider **credentials** are never config keys. The adapter reads them from the
environment itself: `OPENAI_API_KEY`; `AWS_REGION` / `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`; `AZURE_AI_ENDPOINT` / `AZURE_AI_API_KEY`.
