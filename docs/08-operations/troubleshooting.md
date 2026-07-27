# Troubleshooting

Every failure surfaces as a single JSON object on stderr:

```json
{ "code": "…", "message": "…" }
```

Find your `code` below. For the exit-code contract, see
[exit-codes-and-error-codes.md](../06-reference/exit-codes-and-error-codes.md).
For what a failed run leaves behind, see
[partial-and-failed-runs.md](partial-and-failed-runs.md).

---

## First moves

Print the fully merged, redacted configuration — most problems are visible
here:

```bash
npm run cli -- config validate
```

Re-run the failing command with debug logging to a file:

```bash
npm run cli -- review --debug --log-file .codereviewer/review.log
```

Logs are JSONL and carry run ids, step names, timings, counts and error codes.
They never carry source, prompts, provider responses or secrets, so they are
safe to attach to a bug report.

---

## Usage and configuration

### `usage_error` — exit 2

The command was not recognized, or a required argument was missing.

The full command set is `config validate`, `review`, `baseline write`,
`eval run`, `eval compare`, `eval recall-report`, `eval slice-manifest`,
`drift check`.

Two parsing rules cause most surprises:

- A flag and its value are **two separate tokens**. `--config=path` is not
  supported; use `--config path`.
- **Unknown flags are silently ignored.** A typo like `--base_ref` is not an
  error — it is simply not applied, and the run uses the configured default.
  If a flag seems to have no effect, check its spelling first.

### `config_error` — exit 2

Schema validation failed. The message names the field path and the rule, never
the submitted value.

| Symptom | Cause |
| --- | --- |
| `Unrecognized key` | Every config object is strict. Check spelling and nesting; the [configuration reference](../06-reference/configuration/README.md) has the exact shape. |
| A `security.*` key "must be false" | `allowShell`, `allowNetwork`, `allowFilesystemWrite` and `captureContentTelemetry` accept the literal `false` only. There is no override. |
| `aiReview.requireRefutation` rejected | It accepts the literal `true` only. Refutation cannot be disabled. |
| `Path must be repository-relative` / `must not traverse above root` | A configured path escapes the repository root. |
| `Config file must contain a JSON object` | The file parsed but is an array or scalar. |
| `Unsupported configuration key: __proto__` | Prototype-pollution keys are rejected. |
| `endpoint is required when OpenTelemetry is enabled` | Add `observability.openTelemetry.endpoint`. |
| `baseUrl is required for openai-compatible providers` | Add `provider.baseUrl`. |

Config precedence, from weakest to strongest: built-in defaults →
`.codereviewer/config.json` → process environment → `.env` file → CLI flags.
If a value is not what you set, something later in that chain overrode it. A
stray `.env` in the working tree beating a CI variable is the classic case.

### `invalid_git_ref` — exit 2

A ref is empty or starts with `-`. This is deliberate: it blocks argument
injection through a ref value.

### `instruction_read_denied` / `skill_read_denied` — exit 2

An instruction file or skill was not allowed for the run. Check that the path
is repository-relative and resolves under the repository root.

### Enabling skills fails with a missing-path error

`skills.directories` entries must exist. Enabling `skills.enabled` while
`.codereviewer/skills` does not exist fails when the index tries to resolve the
directory. Create it, or point `skills.directories` at a directory that exists.

Skill files also validate strictly: `SKILL.md` must start with a terminated
`---` frontmatter block, `name` must be a lowercase slug (letters, digits and
single dashes, 1–64 characters, no leading/trailing dash and no `--`), and
`description` must be 1–1024 characters. Duplicate names across all configured
directories fail the run.

---

## Repository and git

### `merge_base_unavailable` — exit 3

> No merge base exists for the configured base and head refs. Fetch enough
> history for both refs (for example a full-depth checkout) and retry.

Almost always a shallow CI clone. Fixes:

| Platform | Fix |
| --- | --- |
| GitHub Actions | `fetch-depth: 0` on `actions/checkout` |
| GitLab CI | `GIT_DEPTH: 0` |
| Bitbucket Pipelines | `git fetch --unshallow` plus an explicit fetch of the destination branch |
| Local | Make sure the base ref exists locally: `git fetch origin main` |

It can also mean the two refs genuinely share no history (an unrelated branch,
or a fresh orphan branch).

### `baseline_source_unavailable` — exit 3

> No completed review report was found to build a baseline from.

`baseline write` looks for the newest run with a report in
`<artifactDir>/index.json`. Run a review first, or pass the report explicitly:

```bash
npm run cli -- baseline write --report .codereviewer/runs/<runId>/report.json
```

### `repository_error` / `repository_timeout` — exit 3

A filesystem or git operation failed. Check that the working directory is a git
repository, that the artifact directory is writable, and that no path in the
configuration points outside the repository root.

---

## Provider

All of these are covered in more depth in
[providers.md](../04-guides/providers.md).

### `provider_adapter_missing` — exit 2

The peer package is not installed. The message names it. Install the matching
adapter:

```bash
npm run provider:install:openai
```

```bash
npm run provider:install:bedrock
```

```bash
npm run provider:install:azure
```

### `provider_credentials_missing` — exit 2

A required environment variable is empty or absent. The message names it:
`OPENAI_API_KEY`, `AWS_REGION`, `AZURE_AI_ENDPOINT` or `AZURE_AI_API_KEY`.

Remember that `.env` overrides the process environment, so an empty value there
masks a correctly exported shell variable.

### `provider_base_url_missing` — exit 2

`provider.id` is `openai-compatible` but `provider.baseUrl` is unset.

### `provider_adapter_invalid` — exit 2

The installed adapter package does not export the expected factory. Reinstall,
and align the adapter version with the installed `@purista/harness`.

### `provider_auth` — exit 4

HTTP 401/403, or an "api key"/"unauthorized"/"forbidden" message. Not retried.
Check the key, the account, and — for `openai-compatible` — that the key is
valid for that gateway.

### `provider_rate_limited` — exit 4

HTTP 429 or an overload message. It **is** retried, honoring `Retry-After`, up
to `provider.maxRetries` attempts and `provider.retryMaxDelayMs` per wait. A
required wait longer than the cap fails rather than blocking.

Reduce pressure with `review.maxConcurrentTasks`, or raise
`provider.retryMaxDelayMs`.

### `provider_context_length` — exit 4

The packet exceeded the model's context window. Not retried. Lower
`review.depth`, set `review.contextMaxBytes`, or narrow `paths.include`.

### `task_packet_budget_exceeded` — exit 4

A task packet exceeded the engine's own input budget even after shedding
optional context. For refutation this is usually invisible: an oversized batch
splits in half and retries. When it does surface, the task has a very large
changed file — check `review.maxFileBytes` and `paths.exclude`.

### `provider_timeout` / `provider_server_error` / `provider_error` — exit 4

Transient classes are retried. Persistent failures point at the endpoint.
Raise `provider.timeoutMs` for a slow gateway.

### `review_run_timeout` — exit 4

`review.runTimeoutMs` elapsed. Partial artifacts are written. Either raise the
budget or shrink the run (`paths.exclude`, lower `review.depth`).

---

## Gates and quality

### Exit 1 with `qualityGatePassed: false`

Not an error — the gate did its job. `report.json` lists
`qualityGate.failingFindingIds`. Options:

- Fix the findings.
- Adjust `qualityGate.maxCritical` / `maxHigh` / `maxMedium`.
- Adopt a baseline so only new findings count — see
  [ci-cd.md](../04-guides/ci-cd.md).

### `drift_gate_failed` — exit 1

Hard drift findings blocked the run. By default `generated-artifact-drift` and
`security-drift` are errors; other categories are warnings. Run the check
alone to see the findings:

```bash
npm run cli -- drift check
```

Generated-artifact drift usually means the checked-in JSON schemas are stale:

```bash
npm run generate:schemas
```

### `coverage_incomplete` — exit 1

The run did not assign all required source to review tasks, so it refuses to
claim success. `error.json` carries the reviewable and covered file and byte
counts. Look for files skipped by size (`review.maxFileBytes`) or by
`paths.exclude`.

### `cost_budget_exceeded` — exit 1

`review.maxCostUsd` was exceeded. The check runs **after** the review, so this
reports what was spent rather than stopping it. See
[controlling-cost.md](../04-guides/controlling-cost.md).

---

## Quality complaints

| Symptom | First thing to try |
| --- | --- |
| Too many low-value findings | Raise `aiReview.actionableSeverityThreshold`; set `promotionPolicy.modelWeakOrRefuted` to `rejected` |
| Report has a large "needs more evidence" section | Same: `promotionPolicy.modelWeakOrRefuted: "rejected"` |
| Findings exist but no inline comments | `reporting.reviewComments.enabled` must be true, and only `inline` findings on the new side of a reviewed diff range become drafts. Lower `review.inlineSeverityThreshold` |
| Misses a second defect in a file where it found one | Known limitation, no dial. Three passes built for it were measured and [removed](../03-concepts/optional-capabilities/extra-discovery-passes.md) |
| Misses security issues specifically | `security.dedicatedPass.enabled: true` |
| Misses defects that depend on unchanged code | `review.contextScout.enabled: true` |
| Two runs disagree | Expected. Model output is non-deterministic; a small difference between runs is noise. Measure on a corpus, not on one run — see the [quality docs](../05-quality/README.md) |

Depth guidance and the full dial list: [tuning-noise-and-recall.md](../04-guides/tuning-noise-and-recall.md).

---

## Nothing was reviewed

| Cause | Check |
| --- | --- |
| No changed files between the refs | `git diff --name-only $(git merge-base origin/main HEAD) HEAD` |
| Everything was excluded | `paths.include` / `paths.exclude` — setting `exclude` replaces the built-in list |
| Files above the size cap | `skippedFiles` in `report.json`; `review.maxFileBytes` |
| More files than the cap | `review.maxFiles` |
| No provider configured | `provider` absent means no model findings by design; `config validate` shows whether it is set |

---

## Cost shows as unavailable

The run warning `cost-unavailable` means no price could be resolved: the
provider reported no cost, no `costs.*` prices are configured, and the built-in
snapshot (OpenAI models only) has no entry for the model name. Set the prices
explicitly:

```json
{ "costs": { "inputPerMillion": 0.25, "outputPerMillion": 2.0 } }
```

Or refresh the snapshot:

```bash
npm run update:model-pricing
```

---

## Evaluation

### `eval run selected no cases` — exit 2

Every `--case` filter matched nothing, or the `--slice-root` directory has no
slice directories.

### `eval_semantic_judge_missing` — exit 2

A case declares expected findings but no provider is configured. The matcher is
judge-only and never falls back to a heuristic — configure a provider.

### `provider_capability_missing` — exit 2

The judge needs a provider with structured object output. Check the model
supports it.

### `sarif_invalid` — exit 5

The rendered SARIF failed its own validation. With
`reporting.sarif.target: "github"` the extra GitHub constraints apply (partial
fingerprints required, rule-count limit). Switch to `generic` to confirm.

---

## Still stuck

- `unknown_error` (exit 5) is an unexpected internal failure. `error.json`
  carries the normalized, redacted record.
- Re-run with `--debug --log-file`, then attach `error.json`, the log, and
  `run-summary.json`. None of them contain source, prompts or secrets.
- Confirm your Node version matches `.nvmrc` (`>=24.15.0`).
