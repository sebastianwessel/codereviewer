# `review`, `aiReview`, `promotionPolicy`, `instructions`, `skills`, `paths`

What is reviewed, how deeply, and how model output is promoted to a finding.

Read the [strict-object rule and precedence](./README.md) first. Nesting matters:
`crossFileRetrieval` and `contextScout` are nested **under `review`**, not under
`security`.

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
| `review.discoveryPosture` | `"precise"` \| `"investigative"` | `"precise"` | How much self-evidence discovery demands of itself before raising a candidate. See below. |
| `review.discoverySampleCount` | integer 1–5 | `1` | How many independent discovery samples run per task. Their candidates are combined by union. See below. |

### `review.discoveryPosture`

Discovery is the only stage that *finds* things, and how much certainty it
demands of itself before speaking is what decides how much reaches refutation.

| Posture | What the reviewer is told |
| --- | --- |
| `precise` | Raise a candidate only when the claim can be supported from the code in front of it. This is the default and the behaviour every published measurement was taken under. |
| `investigative` | Additionally pursue a pattern that looks wrong, report what can be supported, and say what could not be determined — leaving adjudication to refutation and admission. |

The posture changes **only** the evidentiary bar. It names no defect category,
adds no checklist, gives no examples, issues no extra model call, and changes
neither the packet nor the order of its fields; the `investigative` prompt is the
`precise` prompt plus a trailing paragraph. Candidates from either posture face
the same refutation, semantic merge, and admission.

`investigative` widens what reaches those stages; it never widens what leaves
them. Expect more candidates and therefore a larger refutation batch per task.

### `review.discoverySampleCount`

The same change reviewed twice does not always yield the same findings. Setting
this above `1` runs discovery that many times per task and keeps **everything any
sample found**.

- **The samples are blind to each other.** Each is a fresh call carrying only its
  own packet: no sample is shown another's findings, reasoning, or output, and
  every sample receives a byte-identical packet.
- **Candidates are combined by union — never by agreement.** A finding raised by
  one sample out of five survives exactly like one every sample raised. There is
  no vote and no agreement threshold, because samples agree on wrong answers too,
  and a vote would delete precisely the rare finding that sampling exists to find.
- **Deduplication belongs to the [semantic finding
  merge](../../03-concepts/pipeline/04-holistic-discovery.md).** Nothing else
  collapses the union, and position is never used as an identity test. Expect the
  merge to run far more often above `k = 1`; that is what it was built for.
- **A failed sample does not fail the review.** The remaining samples proceed and
  the run's `warnings` record how many of the requested samples completed. A task
  whose every sample fails still fails, exactly as a single call does today.
- **Cost rises close to linearly.** Each sample is a full discovery call, and
  provider-side caching is not reachable for a repeated identical request.

`run-summary.json` records the applied count as `run.discoverySampleCount`.

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

### `review.contextScout`

A cheap scout call that names out-of-change symbols the changed code depends on;
deterministic code then resolves and injects their bodies. The reviewer itself
stays single-shot with no tools. The scout only selects context — it can never
influence a finding, a severity, or the gate, and a symbol it names is injected
only if deterministic resolution finds it.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `review.contextScout.enabled` | boolean | `false` | Master switch. |
| `review.contextScout.maxSymbols` | integer 1–40 | `8` | Symbols one scout call may request. A relevance ration, not a loop guard. |
| `review.contextScout.maxBytesPerSymbol` | integer 500–40000 | `4000` | Per-symbol byte cap on an extracted body. Budget pressure sheds scout context before changed-file source. |

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
