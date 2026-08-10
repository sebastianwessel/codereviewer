# `review`, `aiReview`, `promotionPolicy`, `instructions`, `skills`, `paths`

What is reviewed, how deeply, and how model output is promoted to a finding.

Read the [strict-object rule and precedence](./README.md) first. Nesting matters:
`crossFileRetrieval` is nested **under `review`**, not under `security`.

## `review`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `review.mode` | `"local"` \| `"ci"` \| `"pr"` \| `"full"` | `"local"` | Run mode. `pr` does not publish anything; publishing is out of scope. |
| `review.depth` | `"fast"` \| `"balanced"` \| `"thorough"` | `"balanced"` | Task shape and the mediated-retrieval budget, never scope and never the packet. `fast` plans one task per file; `balanced` and `thorough` plan identical tasks and differ only in the retrieval budget. |
| `review.baseRef` | git ref | `"main"` | Diff base. Must not start with `-`. Overridable per run with `review --base-ref`. |
| `review.headRef` | git ref | `"HEAD"` | Diff head. Must not start with `-`. Overridable with `review --head-ref`. |
| `review.maxConcurrentTasks` | integer 1–32 | `4` | Caps concurrently active review tasks and provider calls. |
| `review.maxFiles` | integer 1–10000 | `500` | Intake hard cap; files beyond it are skipped with reason `too-many-files`. |
| `review.maxFileBytes` | integer 1–5000000 | `500000` | Files larger than this are skipped with reason `too-large`. |
| `review.contextMaxBytes` | integer 10000–10000000 | *unset* | Lowers the ceiling on one serialized model-input packet. Nothing else — it does not touch the cross-file per-read cap. **Leave it unset**: the provider then decides whether a packet is too large (see below). |
| `review.inlineSeverityThreshold` | severity | `"high"` | Minimum severity for a finding to be eligible for inline presentation. Reporting only — it does not affect admission or the gate. |
| `review.maxCostUsd` | number ≥ 0 | *unset* | Hard stop when the accumulated run cost exceeds it (`cost_budget_exceeded`, exit `1`). Enforced **only** when token counts and prices are both available; otherwise the run records the warning `cost-unavailable` and no cap applies. When unset, no cost cap is enforced at all. |

### What `contextMaxBytes` does when unset

Nothing bounds the review packet in advance. The change is sent whole, and is split
only if the **provider** refuses it as exceeding its context length — then the task
is halved and each half retried (spec 26). This is the recommended setting: a byte
budget chosen ahead of time is a guess about tokens, and the guess costs recall by
substituting several partial reviews for one whole-file review.

A serialized model-input packet is still capped at 8 MB — roughly 2M tokens, far
beyond any current model. That guard exists to stop a pathological packet being
serialized into memory; it fails **before** the provider call
(`task_packet_budget_exceeded`, exit `4`) rather than truncating source.

When you **do** set `contextMaxBytes`, it lowers that 8 MB ceiling and does
nothing else. It is **not** a cap on cross-file reads: that is
`crossFileRetrieval.maxBytesPerRead`, which is unset by default and independent
of this key and of `depth` alike. A per-depth read cap of 60 / 120 / 240 KB used
to exist and was removed by spec 28 — it was sized against an assumed context
window and cut retrieved files mid-read without telling the model.

If the lowered ceiling binds, the run stops loudly rather than truncating: recovery
is a larger value, unsetting it, or reduced scope.

### `aiReview.maxFilesPerDiscoveryCall`

How many changed files one discovery call may review. A task covering more is
partitioned across several calls whose findings are unioned (spec 27).

**Default `2`, chosen by measurement.** The reviewer finds roughly one problem per
call regardless of how much code it is shown, so how many calls a change is spread
across is the main lever on how many defects it finds.

A sweep on the largest benchmark changes, on `openai/gpt-5.3-codex` — the model
behind every measured figure on this page, and the model the one-problem-per-call
behaviour was observed in:

| Files per call | Defects found | False alarms | Relative cost |
| --- | --- | --- | --- |
| No limit | lowest | very low | baseline |
| 4 | better | low | +28% |
| **2** (default) | **best** | **lowest** | +89% |
| 1 | no better than 2 | lowest | +158% |

Two is where the curve flattens — one file per call finds nothing extra and costs
half as much again. Partitioning engages only above this many changed files, so
small changes are unaffected and the cost falls on large ones.

Raise it to `4` to trade some recall for roughly a third of the extra cost, or set it
very high to disable partitioning entirely.

### `review.crossFileRetrieval`

**Enabled by default.** The reviewer may open other files in the repository —
the callee, interface, or permission definition a suspected defect depends on.

It was previously off, recorded as harmful. That verdict was measuring a bug: files
were cut off mid-read and the reviewer was never told, so it concluded things were
missing from code it had only partly seen. With the cut disclosed, two runs put it
ahead on defects found, false alarms, cost and reliability alike. No specific gain is
claimed — the recall difference alone is within noise — but nothing measured argues
against it.

`maxBytesPerRead` is **unset by default**: a read is not cut in advance. The reviewer
narrows a large file itself, using `repo_grep` to locate what it needs and then
re-reading that line range. Setting the value is a deliberate operator choice and
still binds, with the cut disclosed to the reviewer rather than silent.

Agentic cross-file discovery. The discovery agent may call the mediated
`repo_read` / `repo_list` / `repo_grep` tools to inspect files outside the
changed set; its candidates pass the same refutation and admission as any other.
Set `enabled: false` and discovery is single-shot with no tools.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `review.crossFileRetrieval.enabled` | boolean | **`true`** | Master switch. |
| `review.crossFileRetrieval.maxToolCallsPerTask` | integer 1–500 | `100` | Runaway-loop guard on mediated tool calls per task. It is not a context ration — models self-limit well below it. |
| `review.crossFileRetrieval.maxBytesPerRead` | integer 1000–4000000 | *unset* | Per-read byte cap. Unset means a read is not cut in advance. Setting it is a deliberate operator choice and still binds, with the cut disclosed to the reviewer rather than silent. |

### `review.refutationRetrieval` — removed

Giving the *refutation* stage the same mediated `repo_read` / `repo_list` /
`repo_grep` tools discovery may hold. It shipped disabled on 2026-08-06, was
measured the same day against the rule written down before the measurement, and was
**removed**. Because the schema is strict, a config that still sets
`review.refutationRetrieval` — even to `{ "enabled": false }` — now fails validation
with **exit code 2**. Delete the block.

On the 37-case real-repository corpus, `openai/gpt-5.3-codex`, three runs per arm
interleaved, zero provider errors in either arm:

| | control | retrieval on |
| --- | ---: | ---: |
| in-diff recall | 66.1% | 65.0% |
| adjusted precision | **96.1%** | **92.9%** |
| genuine false positives / run | 1.67 | 3.00 |
| cost / run | $1.15 | $1.26 (+10%) |

Paired over the in-diff population: 5 expectations gained, 7 lost, 48 unchanged,
**p = 0.7744** — no recall effect. The rule's removal clause named a fall in adjusted
precision, and adjusted precision fell. **The honest limit:** n = 3 per arm, and that
difference is not formally significant on its own. The rule did not require
significance for that clause on purpose — the burden was on the capability to show it
had earned its extra 10% per run, not on the control to disprove it. The full record
is in
[`specs/05-review-workflow-and-runtime.md`](../../../specs/05-review-workflow-and-runtime.md).

What survives it: a refused mediated tool call still tells the model *why* it was
refused, in the tool result's own content, for the discovery lane that still holds
those tools.

### `review.guardedRegionContext` — removed

Spec 25's guarded-region context. Both arms were **measured on 2026-07-30 and
removed**; the whole configuration block went with them. Because the schema is
strict, a config that still sets `review.guardedRegionContext` — even to
`{ "signal": false }` — now fails validation with **exit code 2**. Delete the
block.

On the 37-case real-repository corpus, against a 46.0% baseline at 95.2% adjusted
precision:

| arm | product recall | adjusted precision |
| --- | ---: | ---: |
| `signal` — name the changed conditionals | 48.3% | 93.3% |
| `signal` + `calleeRanking` | 44.8% | 90.7% |

The recall movement is **two findings out of 87**, inside the ±4.8pp noise band,
and precision fell in both arms. Neither is a result.

### `review.contextScout` — removed

The context scout and its whole configuration block were removed on 2026-07-27.
Because the schema is strict, a config that still sets `review.contextScout` —
even to `{ "enabled": false }` — now fails validation with **exit code 2**. Delete
the block. What it was and why it went:
[context scout (removed)](../../03-concepts/optional-capabilities/context-scout.md).

## `aiReview`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `aiReview.enabled` | boolean | `true` | Model-backed review runs when this is `true` **and** a `provider` is configured. Set `false` to force a deterministic-only run even with a provider present. It is a plain boolean, not a tri-state: it used to be optional, which made `undefined` and `true` behave identically and forced every reader to test `=== false`. |
| `aiReview.maxFilesPerDiscoveryCall` | integer ≥ 1 | `2` | Changed files one discovery call reviews; a task covering more is partitioned across several calls. See above. |
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
| `instructions.files` | `{ path, scope? }[]` | `[]` | Reviewer instruction files, applied in listed order. `path` is repository-relative and validated; traversal above the root is rejected, and a missing file fails the run. Optional `scope` is a non-empty glob-pattern array (same dialect as `paths.include`/`paths.exclude`) that limits the file to review tasks with at least one matching path; a task packet includes it once ANY of its files match. Omitted `scope` applies the file to every task, unchanged from before scoping existed. `scope: []` is rejected. Run summaries record path + SHA-256 only. |
| `instructions.inline` | string | `""` | Inline instructions, added alongside every `files` entry that applies. Always repository-wide — `inline` has no `scope`; use a scoped file for area-specific free text. |

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
| `paths.include` | glob[] | `["**/*"]` | Files eligible for review, and the files the mediated `read`/`list`/`grep` tools may serve. It scopes **files**: a directory is traversable when an included file could live beneath it, so `["src/**/*"]` still lets a search start at the repository root, and each file that search reaches is checked against the list on its own. |
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

### `review.signalFacts`

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Show discovery the deterministic signal facts. |

The facts are what the parser extracted from the changed files: what each one
declares, exports and imports, with line spans, plus the source-to-test mappings.
Every run computes them and every run accounts for their bytes — and until this
key existed only the refutation stage was shown them. The discovery packet is one
rendered document, and nothing rendered the facts into it, so the engine paid for
the map and showed it only to the stage that checks a route rather than the stage
that picks one.

**Off by default, and not because the gap is in doubt.** Closing it adds a section
to every discovery prompt, and this project promotes a prompt-shaped change on
measurement rather than on the argument that it ought to help — four attention
mechanisms and five prompt clauses have already measured flat here. With the key
off, the packet is byte-for-byte what it was before the section existed.

When on, the section is framed as facts rather than findings and states plainly
that the list is incomplete: a symbol's absence means no extractor emitted a fact
for it, not that the symbol does not exist.

**Measured 2026-08-10, and not promoted.** On the security-advisory corpus (72
cases — not comparable to the real-repository figures elsewhere in this
documentation), turning this on moved in-diff recall from 64.9% to 61.7%
(pooled per-expectation sign test: 3 gained, 3 lost, p = 1.0000 — indistinguishable
from noise) at **+10.1% input tokens**. Adjusted precision rose (96.7% →
100.0%), but that alone does not clear the promotion bar. The key stays off by
default. See [the decision
table](../../03-concepts/optional-capabilities/README.md#decision-table) and
`reports/2026-08-10-signal-facts-result.md`.

### `review.citations`

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Ask discovery to quote the line that shows the defect, and verify it. |

Discovery built every candidate with no evidence attached. The refutation packet
picks its evidence by matching candidate evidence ids, so the reviewer that
decides whether a finding is real was handed an **empty** evidence array for every
candidate, always — measured at 78 of 78 findings, where the single record each
one carried was the refuter's own rationale written afterwards. That is why
"could not prove it" outnumbers "disproved" five to one.

With this on, discovery quotes the source line and its number, and a
**deterministic** check re-reads that line in the same numbered content discovery
was shown. A quote that is really there becomes a `citation` evidence record the
refuter can check against. A quote that is not is simply not recorded.

**A failed citation never costs you a finding.** An absent, malformed, or
unverifiable citation leaves the candidate exactly as it would have been with the
key off. Rejecting candidates for bad citations is a different and riskier idea;
it is deliberately not part of this.

**On by default since 2026-08-11 — for readability, not for accuracy.** The
measurement was null both ways: recall 63.1% → 62.2% (sign test 3 gained / 7 lost,
p = 0.3438) and adjusted precision 98.6% → 99.3%, on `openai/gpt-5.3-codex`. So
this does not make the reviewer better at finding things. It makes each finding
show the line it rests on.

It costs **+5.6% input tokens** per discovery call. Set `enabled: false` to return
that to zero; the disabled path is byte-for-byte the packet from before this
existed.

**Measured 2026-08-10, and not promoted.** On the security-advisory corpus (72
cases — not comparable to the real-repository figures elsewhere in this
documentation), turning this on moved in-diff recall from 63.1% to 62.2%
(pooled per-expectation sign test: 3 gained, 7 lost, p = 0.3438) while adjusted
precision rose 98.6% → 99.3%; neither movement clears the promotion bar. **The
mechanism did engage** — findings carrying an evidence record went from 0% to
90%, closing the empty-evidence gap described above at scale — but that
engagement did not move recall or precision far enough to promote. The key
stays off by default. See [the decision
table](../../03-concepts/optional-capabilities/README.md#decision-table) and
`reports/2026-08-10-citations-result.md`.

## Related

- [provider.md](./provider.md) — model, retries, budgets
- [quality-gate-and-baseline.md](./quality-gate-and-baseline.md) — what turns findings into an exit code
- [security-and-verification.md](./security-and-verification.md) — the additive security pass and post-review lanes
