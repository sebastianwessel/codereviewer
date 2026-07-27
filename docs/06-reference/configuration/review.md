# `review`, `aiReview`, `promotionPolicy`, `instructions`, `skills`, `paths`

What is reviewed, how deeply, and how model output is promoted to a finding.

Read the [strict-object rule and precedence](./README.md) first. Nesting matters:
`crossFileRetrieval` is nested **under `review`**, not under `security`.

## `review`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `review.mode` | `"local"` \| `"ci"` \| `"pr"` \| `"full"` | `"local"` | Run mode. `pr` does not publish anything; publishing is out of scope. |
| `review.depth` | `"fast"` \| `"balanced"` \| `"thorough"` | `"balanced"` | Budget preset. Affects context caps and retrieval caps only, never scope. |
| `review.baseRef` | git ref | `"main"` | Diff base. Must not start with `-`. Overridable per run with `review --base-ref`. |
| `review.headRef` | git ref | `"HEAD"` | Diff head. Must not start with `-`. Overridable with `review --head-ref`. |
| `review.maxConcurrentTasks` | integer 1–32 | `4` | Caps concurrently active review tasks and provider calls. |
| `review.maxFiles` | integer 1–10000 | `500` | Intake hard cap; files beyond it are skipped with reason `too-many-files`. |
| `review.maxFileBytes` | integer 1–5000000 | `500000` | Files larger than this are skipped with reason `too-large`. |
| `review.contextMaxBytes` | integer 10000–10000000 | *unset* | Per-packet model-bound context budget. When unset, resolved from `depth` (see below). An explicit value overrides the depth-scaled safety default. |
| `review.inlineSeverityThreshold` | severity | `"high"` | Minimum severity for a finding to be eligible for inline presentation. Reporting only — it does not affect admission or the gate. |
| `review.maxCostUsd` | number ≥ 0 | *unset* | Hard stop when the accumulated run cost exceeds it (`cost_budget_exceeded`, exit `1`). Enforced **only** when token counts and prices are both available; otherwise the run records the warning `cost-unavailable` and no cap applies. When unset, no cost cap is enforced at all. |
| `review.runTimeoutMs` | integer 10000–7200000 | *unset* | Whole-run timeout (`review_run_timeout`, exit `4`). When unset, no run-level timeout is imposed; individual provider calls still use [`provider.timeoutMs`](./provider.md). |

### Effective `contextMaxBytes` when unset

| `depth` | No provider configured | Provider configured |
| --- | --- | --- |
| `fast` | 100 000 | 60 000 |
| `balanced` | 200 000 | 120 000 |
| `thorough` | 500 000 | 240 000 |

A serialized model-input packet is additionally capped at 360 000 bytes. The
guard fails **before** the provider call (`task_packet_budget_exceeded`, exit
`4`) rather than truncating source: recovery is task splitting, a larger budget,
or reduced scope.

### `review.crossFileRetrieval`

Agentic cross-file discovery. When enabled, the discovery agent may call the
mediated `repo_read` / `repo_list` / `repo_grep` tools to inspect files outside
the changed set. Its candidates pass the same refutation and admission as any
other. Disabled, discovery is single-shot with no tools.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `review.crossFileRetrieval.enabled` | boolean | `false` | Master switch. |
| `review.crossFileRetrieval.maxToolCallsPerTask` | integer 1–500 | `100` | Runaway-loop guard on mediated tool calls per task. It is not a context ration — models self-limit well below it. |
| `review.crossFileRetrieval.maxBytesPerRead` | integer 1000–200000 | `24000` | Per-read byte cap for cross-file reads. Large single reads measurably dilute a review. |

### `review.contextScout` — removed

The context scout and its whole configuration block were removed on 2026-07-27.
Because the schema is strict, a config that still sets `review.contextScout` —
even to `{ "enabled": false }` — now fails validation with **exit code 2**. Delete
the block. What it was and why it went:
[context scout (removed)](../../03-concepts/optional-capabilities/context-scout.md).

## `aiReview`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `aiReview.enabled` | boolean | *unset* | When unset, model-backed review runs iff `provider` is configured. Set `false` to force a deterministic-only run even with a provider present. |
| `aiReview.requireRefutation` | `true` (literal) | `true` | Every model candidate must survive the refutation pass before admission. `false` is not an accepted value. |
| `aiReview.deterministicSignalMode` | `"support"` \| `"disabled"` | `"support"` | `support` injects deterministic facts into model packets (materially better recall). `disabled` keeps the facts for task clustering and admission contradiction checks but sends none to the model — cheaper, lower recall. |
| `aiReview.actionableSeverityThreshold` | severity | `"medium"` | Severity floor for a MODEL-origin finding to be admitted as actionable. Below it, findings are recorded as rejected with reason `below-threshold` (still auditable in `report.json`). Trusted deterministic-rule findings are exempt. Lower to `low`/`info` to surface more. |

## `promotionPolicy`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `promotionPolicy.modelWeakOrRefuted` | `"artifact-only"` \| `"rejected"` | `"artifact-only"` | Disposition for a candidate the refuter judged `needs-more-evidence`. `artifact-only` keeps it in the artifacts but out of the inline review; `rejected` drops it. A `refuted` candidate is always rejected; only a `proved` candidate that meets the severity floor becomes actionable. |

## `instructions`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `instructions.files` | repository-relative path[] | `[]` | Reviewer instruction files, applied in listed order. Paths are validated; traversal above the root is rejected. Run summaries record path + SHA-256 only. |
| `instructions.inline` | string | `""` | Inline instructions. Config inline takes precedence over files. |

## `skills`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `skills.enabled` | boolean | `false` | Mounts skill directories for provider-backed reviewer agents. |
| `skills.directories` | repository-relative path[] | `[".codereviewer/skills"]` | Directories scanned for nested skill folders, each with a `SKILL.md` carrying unique `name` and `description` frontmatter. Overridable with `CODEREVIEWER_SKILLS_DIR` (which replaces the array with a single entry). |
| `skills.allowTools` | array of `"read"` \| `"list"` \| `"grep"` | `["read", "list", "grep"]` | Read-only built-ins available to mounted skills. No other tool is permitted. |

Skill bodies are never inlined into workflow input, reports, logs, traces, or
shared-context artifacts; only paths and hashes are recorded.

## `paths`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `paths.include` | glob[] | `["**/*"]` | Files eligible for review. |
| `paths.exclude` | glob[] | see below | Files removed from review. **Replaces** the default list when set — re-list the defaults you want to keep. |
| `paths.artifactDir` | repository-relative path | `".codereviewer/runs"` | Root for per-run artifact directories and the run index. Overridable with `CODEREVIEWER_ARTIFACT_DIR`. |

Default `paths.exclude` (18 patterns):

- `.git/**`, `node_modules/**`, `dist/**`, `coverage/**`, `.codereviewer/**`
- lock files: `**/package-lock.json`, `**/yarn.lock`, `**/pnpm-lock.yaml`,
  `**/npm-shrinkwrap.json`, `**/composer.lock`, `**/Gemfile.lock`,
  `**/poetry.lock`, `**/Cargo.lock`, `**/go.sum`
- generated/non-reviewable: `**/*.min.js`, `**/*.min.css`, `**/*.map`,
  `**/*.snap`

`paths.artifactDir` does **not** contain the baseline file or eval artifacts —
see [artifacts.md](../artifacts.md).

## Related

- [provider.md](./provider.md) — model, retries, budgets
- [quality-gate-and-baseline.md](./quality-gate-and-baseline.md) — what turns findings into an exit code
- [security-and-verification.md](./security-and-verification.md) — the additive security pass and post-review lanes
