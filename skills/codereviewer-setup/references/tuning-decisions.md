# Tuning decisions during setup

Reach for this only after the user has read a real report and said the output is
not what they want. Do not tune preemptively.

**Change one dial, then look at a run.** Seed-to-seed variance on this engine's
own evaluation corpus is several percentage points of recall, so two runs that
differ slightly have told you nothing. If you want to claim a change helped, you
need repeated runs on a fixed corpus — see the project's `docs/05-quality/`.

The most recent three-run baseline puts the standard deviation of in-diff recall
at **2.89pp**; the previous one put it at 0.96pp. Judge a change against the
**wider** band, because under-stating it is the error that manufactures false
positives. Do not read the difference between the two as stability having
regressed: at three runs per arm an sd is barely an estimate, the two intervals
overlap heavily, and the project's own ledger declines to call the difference
established.

## "There is too much noise"

In this order:

1. **Raise the severity floor.**

   ```json
   { "aiReview": { "actionableSeverityThreshold": "high" } }
   ```

   Default `medium`. A model-origin candidate below the floor is rejected with
   reason `below-threshold` and still recorded in the run's rejected findings, so
   nothing is lost from the audit trail. Trusted deterministic-rule candidates are
   exempt.

2. **Drop unresolved suspicions instead of reporting them.**

   ```json
   { "promotionPolicy": { "modelWeakOrRefuted": "rejected" } }
   ```

   Default `artifact-only`, which admits a `needs-more-evidence` candidate into a
   dedicated report section, excluded from SARIF, from review comments, and from
   the gate. Switch to `rejected` only if nobody reads the full report — those
   entries are the compensating half of a strict refutation step.

3. **Raise the inline threshold.**

   ```json
   { "review": { "inlineSeverityThreshold": "critical" } }
   ```

   Default `high`. This admits and rejects nothing — it decides whether an
   already-admitted finding becomes an inline comment draft or stays
   summary-only. A finding also has to be anchorable: its line must fall inside a
   reviewed diff range.

## "It is missing things"

Be honest with the user about what is and is not fixable by configuration.

**Measured, on the 37-case real-repository corpus with the engine pinned
(`db78900`): in-diff recall is a mean 68.3% over three runs — 66.7 / 66.7 / 71.7,
sd 2.89pp — and recall on defects outside the diff is 0
of 27 — and every one of those 27 sat in a file the reviewer had already been
shown in full.** None of them needed extra context or retrieval. That is an
attention problem, not an information problem, and no configuration key addresses
it. A context scout that pre-selected the missing symbols was built and removed
for exactly this reason.

Two things to be clear about before tuning against these numbers:

- They were measured on `openai/gpt-5.3-codex`. On another model they are not a
  measurement of anything; the report itself prints that warning.
- `impact check` is the stage aimed at the out-of-diff population — it localises
  20 of 27 of them inside a symbol it flags as changed. That is coverage of a
  risk surface, not defect detection, and it reports references rather than
  findings.

So:

- **Cross-file retrieval is already on** (`review.crossFileRetrieval.enabled`,
  default `true`). Its old "net negative" verdict was measuring a truncation bug,
  not the feature. There is nothing to enable here.
- **Do not add discovery passes to chase recall.** An enumeration sweep, a
  diverse-lens pass, and an un-anchored pass were each built and measured against
  exactly this problem. None earned its cost; all three were removed.
- **There is no dial for the second defect in a file.** A discovery response tends
  to answer the diff and stop.

What actually helps: **re-run after each round of fixes**. Fixing one defect moves
the diff, which moves what the reviewer is pointed at. Wire the CI job to run on
every push to the branch.

## "It is missing security issues specifically"

```json
{ "security": { "dedicatedPass": { "enabled": true } } }
```

A second, security-only discovery call per task applying a generic OWASP/CWE
checklist. Its candidates are additive — they merge with the general pass's and
never displace them — and they pass the same refutation and admission.

It is a separate call rather than an in-prompt checklist because folding the
checklist into the general prompt was measured to trade the dominant
authorization class for the injection classes: finite attention.

**Cost:** it takes a task from 2 provider calls to 3, roughly +50% on the
discovery side. The security-specific lift is **not established** — it was
measured once at a sample size too small to resolve. Present it as an experiment,
not a fix.

## "It costs too much"

In order of leverage:

1. **Exclude non-reviewable files** — generated code, locale bundles, fixtures,
   vendored directories. Biggest win, no quality cost. See config-recipes.md.
2. **Turn off any optional pass you have not measured a benefit from.** Each one
   adds a call per task.
3. **Set `aiReview.deterministicSignalMode: "disabled"`** if the support facts are
   not earning their bytes. Planning still uses them; only the injection into the
   model packet stops.
4. **Trim `instructions`, or scope them** — they ride along on *every* call,
   discovery and refutation alike. `instructions.files[].scope` limits a file to
   the tasks that touch matching paths, which in a monorepo removes those bytes
   from every packet that had no use for them. See below.
5. **Always pass `--base-ref`** so the diff is against the merge base rather than a
   stale branch point.
6. **Set `review.maxCostUsd`** so a runaway change fails loudly.

The arithmetic: a review task costs **one refutation call plus one discovery call
per two changed files** (`aiReview.maxFilesPerDiscoveryCall`, default `2`;
a task covering more is partitioned and the candidates unioned). Refutation is
batched, so one call adjudicates all of a task's candidates and cost scales with
tasks and file count, not with findings.

`review.maxConcurrentTasks` (default 4) changes throughput and rate-limit
pressure. It does **not** change the number of calls or the total cost.

A cold cache roughly doubles the bill. The three-run baseline recorded **$1.97
for a cold run against $0.82–$0.83 warm** over the same 37-case corpus, with 79–80%
of input tokens served from cache once warm. Quote both numbers, and never compare
two configurations by running them back to back — the second arm inherits the
first arm's warm cache.

What is free: `config validate`, `drift check`, `baseline write`,
`intent check` while disabled, `impact check` unless
`changeImpact.adjudication.enabled` is set, and any `review` run with no provider
configured.

## Project review instructions

If the team has house rules the reviewer keeps missing:

```json
{
  "instructions": {
    "files": [{ "path": ".codereviewer/instructions/house-rules.md" }],
    "inline": "Treat any new public HTTP handler without an authorization check as critical."
  }
}
```

`files` is an array of **objects**, not of path strings. The config object is
strict, so the old `["…/house-rules.md"]` spelling exits `2`.

Instruction files resolve under the repository root, are redacted before use, and
are recorded in the context ledger and in each finding's provenance hashes. They
are added to every matching task packet — the discovery call and the refutation
call both receive them — so keep them short; they are on the bill twice per task.

### Scope a file to part of the repository

An entry with no `scope` key applies repository-wide, exactly as `files` behaved
before scoping existed. Add `scope` to limit a file to review tasks that touch
matching paths:

```json
{
  "instructions": {
    "files": [
      { "path": ".codereviewer/instructions/house-rules.md" },
      {
        "path": ".codereviewer/instructions/payments-service.md",
        "scope": ["services/payments/**"]
      }
    ]
  }
}
```

`scope` is a list of glob patterns in the same dialect as
`paths.include`/`paths.exclude` (`*`, `**`, `?`, matched against
repository-relative paths) — there is one glob matcher in the project and this
reuses it.

A review task can cover more than one changed file, so "matches" needs a rule for
a many-files-to-many-patterns comparison: **a scope matches when any one file in
the packet matches any one pattern**, and the whole packet then gets the
instruction. That fails safe towards inclusion — guidance a reviewer never sees is
invisible and uncatchable, while guidance shown for one extra file in a mixed
packet is noise a reader can see and discount.

`scope: []` is rejected at config load. Delete the key to go back to unscoped;
an empty list would otherwise silently hide a configured instruction with nothing
saying why.

`inline` has no `scope` and always applies repository-wide. A team that wants
area-specific free text should use a short scoped file instead.

**This is a cost and attention lever, not tidiness.** An unscoped instruction
rides on every packet of every task and is paid for on every call. In a monorepo,
scoping one service's rules to that service removes those bytes from every other
service's packets and stops them competing with source for the model's attention.
Where a scope keeps a file out of a packet, the context ledger records it —
`decision: "skipped"`, reason `instruction-scope-excluded`, with the byte count
withheld — so "scoped out of this task" stays distinguishable from "never
loaded".

## What cannot be turned off

`aiReview.requireRefutation` accepts the literal `true` only. Every model-origin
candidate is independently adjudicated before it can be admitted. That is the
mechanism the measured **96.2% mean adjusted precision** rests on; there is no
fast path around it.

`security.allowShell`, `security.allowNetwork`, `security.allowFilesystemWrite`
and `security.captureContentTelemetry` accept the literal `false` only. The
engine does not execute shell commands, does not reach the network outside the
configured provider, does not write outside its artifact directory, and does not
capture source content in telemetry — and none of that is negotiable through
config.
