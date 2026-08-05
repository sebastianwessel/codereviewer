# Reading A Report

A walk through `report.md` — every section it emits, in the order it emits them,
and what each one is telling you.

`report.md` is written to `.codereviewer/runs/<run-id>/report.md` whenever
`markdown` is in `reporting.formats` (it is by default). It is rendered from the
same validated report object as `report.json`, so anything here can be traced
into the JSON.

---

## At a glance

| Section | Always present? | What it answers |
| --- | --- | --- |
| Header | yes | What this document is, and how reliable it has measured. |
| Scope of this search | yes | Which run, against what, and how much source it read. |
| Summary | yes | How many findings, whether a threshold was crossed, what else is below. |
| Bounds that bound | only when non-empty | Warnings and incomplete coverage — reasons this search was thinner than usual. |
| Actionable Findings | yes | **The findings you are meant to act on**, with what each one survived and rests on. |
| Unresolved - Needs Human Decision | only when non-empty | Suspicions the engine could not settle. |
| Rejected Candidates | yes | What was proposed and thrown out, with the reason. |
| Refutation Results | yes | The verdict and rationale behind every candidate. |
| Provider Issues | only when non-empty | Model/provider trouble during the run. |
| Skipped Files | only when non-empty | What was never reviewed, and why. |
| Changed source files with no test file in this change | only when non-empty | Which changed source files no changed test file pairs with. |
| Cost And Timing | yes | Duration, and cost when the provider reported it. |

Sections after *Actionable Findings* are the audit trail. They are rendered so a
human can check the engine's work without opening JSON.

---

## Header

The document opens with two paragraphs before any data, and they are the two
paragraphs that decide whether the rest is read correctly.

The first says what the report *is*: a diff-scoped search for defects it could
prove, not a certificate that the change is correct.

The second states the **measured error rates**, so a finding can be weighed
rather than trusted. On the 37-case real-repository corpus with the engine
pinned, against `openai/gpt-5.3-codex` — the rates are a property of that model,
and the report says so on its own face, comparing it against the model the run
actually used:

| population | result |
| --- | --- |
| defects inside the diff | found about 3 in 5 (in-diff recall mean 61.1% over three runs, sd 0.96pp) |
| defects outside the diff, in the same changed files | **0 of 27** — by design; `impact check` covers that population |
| findings it reports that hold up | about 99 in 100 (adjusted precision mean 99.1%) |
| findings that land inside the diff | 94.2% |

Two consequences worth stating plainly, because they are what the rates mean for
a reviewer:

- **An empty findings list is not a clearance.** Roughly two in five defects
  inside the diff are missed.
- **Two runs over the same commit do not produce the same report.** Run-to-run
  standard deviation is 0.96pp on in-diff recall, and 0.66pp on blended recall.
  The two are different populations; quoting the blended figure for the in-diff
  rate understates the spread of the number above it.

→ [What limits recall](../05-quality/what-limits-recall.md),
[Current results](../05-quality/current-results.md)

---

## Scope of this search

```text
## Scope of this search

- Run: `run_5f2c9d` (mode ci, depth balanced)
- Model: `openai/gpt-5.3-codex`
- Base: `main`
- Head: `feat/session-rotation`
- Merge base: `9c41ab2`
- Files read in full: 3 of 3 reviewable (48,120 of 48,120 bytes). Coverage status: complete — a statement that the source reached a model, not that every defect in it was found.
- Files never reviewed at all: 2, listed under "Skipped Files" below.
```

`Mode` (`local` / `ci` / `pr` / `full`) and `Depth` (`fast` / `balanced` /
`thorough`) record the posture the run actually used, after config, environment,
and defaults were merged. Depth is what determines how files were clustered into
review tasks.

The coverage line is the **coverage certificate**: proof of what was read.

- `complete` means every reviewable file was fully covered — the sum of included
  source-chunk bytes equals each file's reviewable byte length. It says the
  source reached a model. It does **not** say the defects in it were found, and
  the sentence is printed on every report so the two cannot be confused.
- `incomplete` adds its reasons under **Bounds that bound**. A *completed* review
  is not supposed to reach this state; the engine fails closed on incomplete
  coverage rather than reporting success over source it never read.

`Files never reviewed at all` is the count of skipped files. Nothing anywhere in
the report says anything about those files.

---

## Summary

```text
## Summary

- **Findings to act on: 3** (1 critical, 1 high, 1 medium)
- By category: 1 security, 1 bug, 1 maintainability
- **Quality gate: FAILED.** 2 findings cross a configured threshold. Thresholds applied: maxCritical 0, maxHigh 0.
- Unresolved, needing a human decision: 1
- Candidates proposed and then rejected: 2
```

Categories come from a fixed set: `bug`, `security`, `performance`,
`maintainability`, `compatibility`, `policy`, `test`. Both counts are computed
over **actionable findings only** — anything marked `artifact-only` is excluded
and counted on its own line.

**The quality-gate line is a threshold comparison, not a verdict.** A run where
nothing crossed a threshold renders as:

```text
- **Quality gate: no reported finding crossed a configured threshold.** Thresholds applied: maxCritical 0, maxHigh 0. That is a comparison against what this run found, not a judgement about the change.
```

It is deliberately not phrased as `Passed: yes`. With recall measured at roughly
three in five in-diff defects, "nothing this run reported crossed a number" is
all the gate can establish. A failed gate is exit code `1`.

Artifact-only ("Unresolved") findings never contribute to the gate. When no gate
was evaluated, the line says so.

---

## Bounds that bound

```text
## Bounds that bound

- baseline file was 41 days old
```

Present only when there is something to say. It collects `run.warnings` and any
`coverage.incompleteReasons` — every recorded reason this search may have been
thinner than a normal one. A bound a reader cannot see is a bound they cannot
discount.

---

## Actionable Findings

The section that matters, and the first one after the summary. Findings are
sorted by severity (`critical` → `high` → `medium` → `low` → `info`), then path,
then start line, then title.

```text
### CRITICAL: Rotated session id is written before the old session is revoked

- **This finding is why the quality gate failed.**
- Location: `src/auth/session.ts:148-156` (new side)
- Category: security
- ID: `find_9a1c02`
- Baseline: new
- Survived refutation (proved): Attempted to find a transaction, lock, or single-write path that would make the two writes atomic. The store interface exposes neither, and both call sites use the plain client.
  - Check proof-review: passed - The ordering claim follows from the cited lines alone. (evidence: ev_diff_a1, ev_file_a2)
- Evidence this rests on:
  - diff at `src/auth/session.ts:151`: store.put(nextId, principal) at line 151 precedes store.delete(previousId) at line 155.
  - file at `src/auth/store.ts:30`: No transaction wrapper exists on the store client interface.
- Suggested fix (never applied automatically): Revoke the previous session id inside the same transaction that writes the new one.
- Fix evidence: ev_diff_a1
- Fix edits:
  - `src/auth/session.ts:148-156`: <replacement text> - <description>

<description of the defect>
```

| Field | Meaning |
| --- | --- |
| Heading | Severity in caps, then the title. |
| Gate line | Present only on a finding listed in `qualityGate.failingFindingIds`. This is the finding that is blocking the merge. |
| `Location` | Repository-relative path, the **whole** line span when the finding has one, and the side it is numbered on. Locations are validated against the reviewed head-file content; a candidate whose location does not resolve is rejected, not guessed. |
| `Category` | One of the seven categories above. |
| `ID` | Stable finding ID. Use it to find the full record in `report.json`. |
| `Baseline` | `new`, `existing`, `resolved`, or `unknown`. With `failOnNewOnly` (default true), only `new` can fail the gate. An `existing` finding is labelled as pre-dating the change. |
| `Survived refutation` | The refuter's verdict and its own account of what it tried against this finding and could not do, plus each individual check. This is why the finding is here. When no verdict was recorded, the line says that instead. |
| `Evidence this rests on` | The evidence records behind the finding — kind, location, and summary — not the bare IDs. An ID with no record in the report is named as missing rather than dropped. |
| `Suggested fix` / `Fix evidence` / `Fix edits` | Present only when a fix proposal exists. Every proposal is tied to at least one evidence record. **Nothing is ever applied to your files** — these are proposals for a human. |

Each of these findings passed the whole chain: refutation returned `proved`, the
admission gate accepted it, and it met the severity floor
(`aiReview.actionableSeverityThreshold`, default `medium`).

**When there are none**, the section is still rendered, with a count of zero and
a sentence saying what that does and does not mean. It is never rendered as an
empty heading, and never as a clearance.

> Text is redacted and Markdown-escaped before rendering, so descriptions may
> contain backslash escapes in front of characters like `*`, `[`, `#`, or `|`.
> That is the sanitizer, not the model.

---

## Unresolved - Needs Human Decision

Present only when the run produced artifact-only findings.

```text
## Unresolved - Needs Human Decision (1)

### MEDIUM: Possible unbounded retry when the store rejects the write

- Location: `src/auth/session.ts:203` (new side)
- Category: bug
- ID: `find_7c3e5b`
- Proposed by: review-agent
- Why unresolved: needs-more-evidence - The retry ceiling would live in the store client configuration, which was not in the reviewed context.
- Evidence gathered so far:
  - diff: while (true) retry loop added at line 203.

<description of the suspicion>
```

These are real suspicions that the refuter could neither prove nor disprove —
most often because the deciding evidence sits outside the context it could reach.
They are deliberately kept out of the quality gate, out of inline comments, and
out of SARIF results, so surfacing them cannot block a build or add review noise.

`Why unresolved` carries the refutation verdict and its rationale, so you can
judge whether the missing evidence is something you already know.

This section is the compensating half of a precision-first design. Skipping it
means taking the strictness without the recovery. See
[Why precision first](../01-overview/why-precision-first.md).

---

## Rejected Candidates

```text
## Rejected Candidates (2)

- `cand_31f0`: refuted (rejected) - The claimed missing null check is performed by the caller two lines above the hunk.
- `cand_88a2`: duplicate (rejected) - Same defect as cand_31f0 at a different line.
```

Every candidate the gate threw out, with a stable reason **and the message
explaining it** — a rejection can be right or wrong, and the message is the part
you can actually judge. The reasons are a closed set:

| Reason | Meaning |
| --- | --- |
| `refuted` | Refutation disproved it. |
| `below-threshold` | Below the actionable severity floor. |
| `location-invalid` | Line range did not resolve in the reviewed head file. |
| `not-in-scope` | Not in a changed file. |
| `insufficient-evidence` / `weak-evidence` | No adequate redacted evidence record. |
| `duplicate` | Already admitted elsewhere. |
| `deterministic-contradiction` | A deterministic check contradicted it. |
| `static-analysis-duplicate` | Restates what an external analyzer already reports. |
| `schema-invalid` | Model output failed contract validation. |
| `unsafe-content` | Failed a content safety check. |
| `provider-error` | A provider failure prevented adjudication. |

If the report feels too quiet, this section tells you exactly where the volume
went. When it is empty on a run that also found nothing, the section says so —
nothing was proposed, which is not the same as everything proposed being sound.

---

## Refutation Results

```text
## Refutation Results (1)

- `refute_a1`: proved for `cand_a100` - the guard is bypassed on the early-return path
  - Refutation evidence: ev_…, ev_…
  - Refutation check contradiction: passed - no deterministic contradiction found evidence: none cited
```

The complete adjudication ledger: one entry per candidate, the verdict, the
candidate it belongs to, the rationale, cited evidence IDs, and each individual
check (`passed` / `failed` / `unknown`). Verdicts are `proved`, `refuted`,
`needs-more-evidence`, or `provider-error`. `none cited` means exactly that — no
evidence was attached to that item, and it is shown rather than hidden.

This section exists so refutation can be audited without opening JSON. The
entries behind admitted findings are repeated on those findings above, so you do
not have to perform the join by hand.

---

## Provider Issues

```text
## Provider Issues (1)

- provider_timeout at refutation-check recovered: yes - request exceeded the configured timeout
```

Normalized, redacted provider trouble: a stable `code`, the `stage` it happened
in, and whether it was recovered. Recovered issues stay visible — a run that
retried its way to success still says so, because a retried or degraded stage is
a reason this search may be thinner than usual. Unrecovered issues can fail the
gate via `qualityGate.failOnProviderError` (default `true`).

Provider issues are also written into SARIF as run metadata rather than as
diagnostic results, so they cannot become spurious code-scanning alerts.

---

## Skipped Files

```text
## Skipped Files (3)

- `assets/logo.png`: binary
- `src/generated/schema.ts`: excluded
- `docs/legacy.md`: deleted
```

Files that were part of the change set but never reviewed. Reasons include
`deleted`, `binary`, `too-large` (over `review.maxFileBytes`, default 500000
bytes), and `excluded` (matched `paths.exclude` — lock files, minified bundles,
source maps, and snapshots are excluded by default).

Nothing above says anything about these files. Check this whenever a review looks
thinner than the change was.

---

## Changed source files with no test file in this change

```text
## Changed source files with no test file in this change (2)

- `src/session/rotate.ts`
- `src/session/store.ts`
```

A free, deterministic observation — **not a finding**. It carries no severity,
counts toward no threshold, and did not affect the quality gate. No model was
asked anything to produce it.

It pairs a changed source file with a changed test file using each language's own
naming and location convention — `foo.test.ts` beside `foo.ts`, `foo_test.go`
beside `foo.go`, `test_foo.py` beside `foo.py` — and it looked at nothing outside
the files the change touched.

**A file listed here may already be covered completely by an existing test that
the change had no reason to touch. This signal cannot see that test.** Read the
list as "no test moved with these files", never as "these files have no tests".

The paragraph above the list also states how many changed files could not be asked
the question at all — files in a language the engine does not analyse, and files
that were never read for this run. Those are *unknown*, not untested, and are
never in the list.

The section is absent whenever there is nothing to say: a documentation-only
change, a test-only change, or a change where every source file paired with a
test. In `report.json` the same signal is the `testAdequacy` object, which is
present on every completed run even when its counts are zero.

There is no configuration key for this. It is free, it cannot block anything, and
it renders nothing when it has nothing to report.

---

## Cost And Timing

```text
## Cost And Timing

- Duration: 48,213 ms
- Cost: $0.1840
- Input tokens: 612,884 (401,408 cached)
- Output tokens: 26,115
```

`Cost` (USD) appears only when token usage and pricing data were available.
Missing pricing is reported as `unavailable` — never as a free run. You can
supply pricing overrides with the `CODEREVIEWER_COST_*` environment variables.

Tokens are shown alongside because cost alone cannot be acted on: input dominates
output by roughly 23:1, so a reader deciding whether to narrow `paths.include`
needs to see which side is large. Cached input tokens are a **subset** of input
tokens, never an addition.

---

## Auditing a finding end to end

The report now carries the first two steps inline; the rest is for when you want
the whole record.

1. Read `Survived refutation` and `Evidence this rests on` directly under the
   finding.
2. Take the finding `ID` from **Actionable Findings**.
3. Open `report.json` and find it in `admittedFindings` — it carries
   `evidenceIds`, `refutationId`, `fingerprints`, `reporterEligibility`, and the
   full location.
4. Follow `refutationId` into `refutationResults` for the verdict, rationale, and
   checks.
5. Follow `evidenceIds` into the report's evidence records for the diff ranges,
   symbol facts, and rationale summaries the decision rested on.
6. If you want to know *why the model saw what it saw*, read
   `context-ledger.json`: every context item considered, with its decision
   (`included` / `skipped` / `truncated` / `summarized`), byte counts, and a
   content hash — never the content itself.

---

## Other report formats

| Format | Notes |
| --- | --- |
| `report.json` | Canonical. Everything above, plus candidates, evidence, admission decisions, and coverage detail. |
| `report.sarif` | SARIF 2.1.0. **Excludes artifact-only findings** so unresolved suspicions cannot become code-scanning alerts. Provider issues appear as run metadata. |
| `review-comments*.json` | Inline comment drafts, gated by `review.inlineSeverityThreshold` (default `high`) and by overlap with a changed diff hunk. Written only when `reporting.reviewComments.enabled` is true. The engine never publishes them. |

See [Reference](../06-reference/) for the full artifact and schema contracts.

---

## Next

- [Why precision first](../01-overview/why-precision-first.md) — why the audit sections exist.
- [Glossary](../01-overview/glossary.md) — `artifact-only`, `reporter eligibility`, `baseline status`.
- [Concepts: review lifecycle](../03-concepts/review-lifecycle.md)
- [Guides](../04-guides/) — tuning thresholds and report formats.
