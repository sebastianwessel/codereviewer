# Comparing Runs

Three commands read saved eval reports: `eval compare`, `eval recall-report`, and
`eval slice-manifest`. None of them makes a model call.

The commands are the easy part. The hard part is the statistics — a single-seed
difference on this corpus is usually noise, and the two rates people reach for
first (`severityAccuracy`, `lineAccuracy`) are not comparable across runs whose
recall differs. Both are covered below.

---

## The variance band

**Measured, not assumed.** Four seeds of one identical configuration on the
real-repository corpus produced recall of **81.3%, 87.5%, 81.3% and 75.0%** —
mean **81.3%**, **standard deviation 4.4 percentage points**. Across the same
four seeds, matched findings ranged 12–14, adjusted precision 92.3–100%, and
genuine false positives 0–1.

Two rules follow, and both are requirements rather than advice:

1. **A change measured on a single seed must move recall by more than roughly
   twice that deviation — about 9 percentage points — before it can be
   distinguished from noise.** A smaller claimed effect requires several seeds.
2. **A headline figure is the MEAN across seeds, never the best observed run.**
   A single-seed claim must be reported with the band; quoting the top of a range
   as "the result" overstates the engine.

Three corollaries worth internalising:

- **That band was measured on a 16-expected-finding version of the corpus.** All
  four recall values are exact multiples of 1/16, so the entire observed spread
  was ±1 finding around 13. The corpus has since grown to 37 cases and 87
  findings, and the band **has** since been re-measured at that size twice: three
  runs at one pinned engine (`6781a26`, 2026-08-02) first put the standard
  deviation at 0.96pp for in-diff recall and 0.66pp for blended recall, then a
  second pinned-engine measurement (`db78900`, 2026-08-05, same corpus and run
  count) put it at **2.89pp** for in-diff recall instead — three times wider,
  cause not yet understood. **Use 2.89pp, not 0.96pp**, as the current figure for
  a comparison against the current baseline — see [Current
  results](current-results.md#current-headline). Both figures describe only
  their own engine pin; the 4.4pp figure above describes only the older
  16-finding configuration it was measured on.
- **Denominator size sets the resolution.** One finding is worth ~6.3 points on a
  16-finding corpus, ~1.1 points on the current 87-finding one, and ~7.1 points
  on the 14-finding proof-quality slices. A smaller corpus quantises recall more
  coarsely and needs *more* seeds, not fewer.
- **The 4.4-point figure belongs to that corpus, that configuration, and that
  model — `openai/gpt-5.3-codex`**, which is also the model behind every other
  measured figure on this page. Re-measure the band when any of the three
  changes; do not carry the number across.

An A/B whose effect is smaller than the band is not a null result — it is an
*unmeasured* result. Say so, rather than reporting the direction of the noise.

---

## Deciding whether a change ships

The variance band above says when a difference is readable. It does not say what
to do with one. That is a separate discipline, and it is what keeps this
project's verdicts cheap to accept afterwards.

### Write the decision rule before the run

Every measured change is specified with a three-way outcome **before any
provider spend**, in the spec that introduces it. The shape is the same each
time:

| Outcome | Requires |
| --- | --- |
| **Adopt** | Recall rises **and** the paired test clears significance **and** `adjustedPrecision` and `genuineFalsePositiveCount` do not degrade **and** the cost per additional matched expectation is defensible |
| **Retain as configuration** | Recall rises without significance at n=3, or the result is a genuine trade a user might reasonably want either side of |
| **Remove** | Recall does not rise |

Committing the rule in advance is what stops a marginal result from being
re-argued into a shipped feature. A change that fails its own rule is
**removed** — code, configuration keys, and spec — rather than kept as an
unproven switch, because an option nobody can justify enabling is permanent
maintenance and documentation cost with no counterpart. Five structural
interventions have failed this rule so far; see
[What limits recall](what-limits-recall.md#what-has-been-tried-against-it).

Where a rule depends on a mechanism rather than a headline, say so in advance
too. The un-anchored discovery A/B pre-committed that refutation's kill rate had
to *rise*: had discovery raised 56% more candidates while the gate killed the
same fraction, the extra candidates would have been reaching reports rather than
being filtered, and the change would have failed regardless of what recall did.

### Compare paired expectations, not run means

**This is the primary verdict `eval compare` prints**, not a manual follow-up
step — see [the paired recall verdict](#the-paired-recall-verdict-is-the-headline).
It pools every run of each arm, so there is no longer a separate multi-seed path
to reach for.

A difference of arm means throws away the information that matters, and the
run-level standard deviation is a weak instrument on top of that: estimated from
three seeds, the two most recent figures on this corpus (0.96pp and 2.89pp) carry
95% intervals of roughly [0.50, 6.04] and [1.50, 18.17] — they overlap almost
entirely, so the spread itself is barely measured. Score each **individual
expected finding**, keyed by `caseId` + `expectedIndex`, across every seed of both
arms, then ask how many expectations changed side.

The difference this makes is not cosmetic. The un-anchored discovery pass
measured **+0.83pp** of mean recall, which reads like a small win. Paired, the
same data is **10 expectations gained and 9 lost, p = 0.82** — a coin flip, and
an unambiguous removal.

Gained-and-lost counts also diagnose a specific failure that means alone hide: a
mechanism that wrongly collapses or filters findings produces **one-sided**
loss. Symmetric churn is noise; nine lost against zero gained is a bug.

### Report the band, not the best run

A headline figure is the **mean across seeds** with its range. A single-seed
claim is reported with the band or not at all, and an effect below the
resolution of the run count is described as **unmeasured**, never as the
direction it happened to point.

---

## `eval compare`

```bash
codereviewer eval compare \
  --base .codereviewer/eval/runs/<base-id>/eval-report.json \
  --head .codereviewer/eval/runs/<head-id>/eval-report.json
```

**Both flags are repeatable — an arm is a set of runs.** Pass every seed of each
arm and the paired verdict pools them:

```bash
codereviewer eval compare \
  --base base/run-1.json --base base/run-2.json --base base/run-3.json \
  --head head/run-1.json --head head/run-2.json --head head/run-3.json
```

Both flags are required; omitting either is a usage error (exit `2`). **So is a
mismatched arm size** — three base reports against one head report is refused,
not zipped, because per-expectation outcomes measured over different run counts
are not paired observations. Output is Markdown on stdout. **The command exits
`0` even when it renders warnings**, so you can inspect partial overlap and
new/removed cases.

Within one arm the runs must agree: same `metricsVersion`, same
`provenance.answerKeyDigest`, and the same expectations scored by every run. Each
is a refusal — the runs share a per-expectation denominator, so a mixed arm
computes a rate over a population that never existed. Differences *between* the
arms are fine and are exactly what the command is for.

**With more than one run per arm, the per-report sections are omitted** — gate,
selection, metric deltas, ledger/stage counts, metric-group deltas and case
transitions all read one report per side. A `Run-Level Context` section says so.
Averaging reports would publish numbers no run produced, and picking one run per
arm would present an arbitrary choice as a result. Compare a single run per arm
when you need those; the paired verdict uses every run either way.

### It reads reports older than the current build

`eval compare` exists to compare runs across engine changes, and an engine change
is exactly what adds a field to the report. The command therefore reads both
reports through a **tolerant comparison view** rather than the producer contract:
an archived report missing a counter a later build introduced compares fine.

**What it never does is fill the gap in.** Any value a report did not record
renders `unknown (not recorded)`, and so does every delta that would have needed
it. A missing counter is never read as `0`, and a case whose report did not record
the inputs its status derives from renders `unknown`, never `PASS`.

### The hard refusals (the command throws, exit `2`)

- **A case BOTH arms scored was scored against different expectations** — the
  error names those cases. This is the exact failure this repository already hit
  once: an archived run reported 78.8% recall after its answer key had since
  changed underneath it, with nothing in the saved report revealing that. When the
  key moves underneath a comparison, no metric on either side means what it says.
  Every base report is checked against every head report, so a divergence in the
  third run of an arm cannot hide behind a clean first run.
- **An arm mixes scoring rules, answer keys, or scored expectations across its
  own runs** — see above. Pooling a heterogeneous arm is never right.

None can be bypassed with a flag. A differing case *selection* between the arms
is not this — see the warning below.

### A `metricsVersion` difference refuses metrics, not the report

A scoring-rule change alters what a metric reports for identical review output, so
a delta across one measures the ruler. But a bump almost never touches every
metric, and refusing all of them meant the comparison got done by hand or not at
all.

The command renders a **`Scoring Rules`** section naming both versions before any
number, then suppresses exactly the affected deltas as `not comparable` and
compares the rest. Which metrics are affected is derived from an ordered
scoring-rule history in `src/domains/evaluation/eval-metrics-versions.ts`, where
every version declares what it changed — it is not a hand-maintained list in the
renderer.

Worked example: across `2026-08-01.discovery-telemetry` →
`2026-08-03.plausibility-source-window`, the plausibility judge's source window
changed, so `adjustedPrecision`, `unlistedRealFindingCount` and
`genuineFalsePositiveCount` are refused — and `recall`, raw `precision`,
`linePlacementRate` and `severityAccuracy`, none of which read a plausibility
verdict, are compared normally.

Two cases refuse **everything**: a version whose entry declares an unbounded
change, and a version id absent from the declared history (a future build, or the
`pre-2026-07-26` sentinel). Nothing is known about what those changed, and
guessing narrow is the failure the mechanism exists to prevent.

Rendered, in order:

| Section | Contents |
| --- | --- |
| Scoring rules | Every report's `metricsVersion` by arm, and which metrics the difference makes incomparable |
| **Paired recall verdict** | **The primary verdict for a recall difference**, per diff-scope population — see below |
| Gate | Base/head gate status — single-run arms only |
| Selection | Whether `selection.selectedCaseIds` are identical and whether fixture source / slice root match — single-run arms only |
| Metric deltas | Aggregate quality, token, cost, duration, provider-health and refutation deltas — **context, not the decision rule**; single-run arms only |
| Context ledger | Base/head/delta entry counts by ledger kind — single-run arms only |
| Agentic stages | Refutation / fix / provider-recovery stage counts — single-run arms only |
| Metric-group coverage | Fixture-count deltas across the union of `sourceProfile` and `language` groups, including groups present in only one report; unchanged counts omitted — single-run arms only |
| Metric-group deltas | Quality, resource and proof-loop deltas — **only for groups present in both reports**; single-run arms only |
| Case transitions | Per-case status change — single-run arms only |
| Run-Level Context | Replaces every "single-run arms only" section above when an arm holds several runs, and says why |

### The paired recall verdict is the headline

`eval compare` runs the paired finding-level test itself and prints it **before**
every other number. Both arms scored the same expectations, so the unit is one
expectation (`caseId#expectedIndex`).

**One observation per expectation per arm.** An arm's value for an expectation is
the fraction of that arm's runs which matched it — `2/3` for a flaky one. Three
run pairs that each moved the *same* expectation are **one** gained expectation,
not three. Summing per-pair discordant counts across pairs would count the same
evidence repeatedly, and the tool refuses to do it.

**Populations are adjudicated separately, and blended is never the headline.**
The corpus holds two populations that behave differently by construction:

| Population | Behaviour |
| --- | --- |
| **`in-diff`** | The expectations that move. **This carries the headline verdict.** |
| **`out-of-diff`** | A measured hard zero in every arm of every run — the reviewer is diff-scoped. Ties in every pairing. |

Blending them was a real defect, not a stylistic one. On the three matched run
pairs of the 2026-08-02 (`6781a26`) and 2026-08-05 (`db78900`) sweeps, the
blended verdict read *"does NOT clear p < 0.05"* three times over — 5 gained
against 2 lost, 5 against 1, 9 against 3. The same data, adjudicated on the
in-diff population and pooled across the three runs, is **12 gained, 3 lost, 45
unchanged, p = 0.0352**. The 27 out-of-diff ties carried no information, but they
inflated the denominator and made the verdict describe a population that cannot
move.

So the verdict renders one section per population:

- `in-diff` and `out-of-diff` **always**, even when empty — an omitted population
  reads as a covered one;
- any other recorded scope (including `undetermined`) when non-empty;
- `scope-not-recorded` for expectations no arm labelled, and `scope-divergent`
  for expectations the two arms labelled differently. Neither is folded into a
  measured population;
- a **blended** figure last, labelled as depending on the fixture set's
  population mix rather than on reviewer quality. Do not quote it as a result.

A population with no expectations, and one with no discordant pair, say so
instead of printing a p over nothing. A population every run in both arms missed
says the stronger thing — *hard zero on both sides* — because that is not the
same result as two working arms tying.

**The test is named in the output, with its assumptions**, so you can check the
verdict instead of trusting it: the **exact two-sided sign test** (McNemar's
exact test) over the discordant expectations, plus a seeded paired-bootstrap 95%
interval. It is exact rather than a normal approximation because at these
discordant counts the two disagree across the threshold — 12 gained against 3
lost is p = 0.0201 approximated and **p = 0.0352** exactly. A verdict that clears
its threshold only under an approximation is a verdict about the approximation.

This replaces "difference of run means ± sd" as the decision rule for recall. It
costs nothing extra: the per-expectation outcome is already in every report.

The verdict is **withheld**, with the reason printed, when recall is not
comparable across the two scoring-rule versions, when a report did not record its
per-expectation outcomes, or when the two arms share no expectation. It is never
approximated — an arm whose expectations were not recorded is not an arm that
matched nothing.

### Warnings that invalidate the deltas

Rendered **before** the metric deltas, because the aggregates below them are not
same-dataset comparable:

- **Selected case sets differ**, or fixture source / slice root differ.
- **A report did not record its selected case set** — whether the aggregates are
  same-dataset comparable cannot be established, which is not the same as
  establishing that they are.
- **Either report has `scoring.judgeTrustworthy = false`.**
- **The two reports' `judgeAgreement` values differ materially** — the deltas may
  reflect judge variance rather than review quality.

Treat any of these as a stop sign, not a footnote.

> A differing case selection is a warning, not a refusal. The hard refusal fires
> only when a case BOTH runs scored was scored against different expectations,
> and it names those cases. Comparing a filtered run against a fuller one is
> ordinary work; the shared cases changing underneath you is not.

> Comparing gate status says little: under the default `stable`
> [profile](running-an-evaluation.md#the-regression-gate) both sides of a clean
> comparison read `PASS` regardless of quality, and under `strict` both read
> `FAIL`. Compare metrics.

> `generatedAt` is the run's real wall clock, so it orders reports — but two runs
> started in the same second collide. Identify runs by their archive directory,
> which is unique.

---

## Comparing matched-set rates on the intersection

`severityAccuracy`, `lineAccuracy` and the severity-weighted scores are computed
over the **matched** set. Their denominator therefore *changes* when recall
changes: a run that finds more defects adds previously-missed — typically
harder — findings to the denominator, which mechanically moves the rate.

**When recall differs between the two runs, the aggregate comparison of these
rates is meaningless.** Compare them on the **intersection**: the expected
findings matched in *both* runs.

Every match in `eval-report.json` already carries its own `severityMatches` and
`lineOverlaps` booleans, keyed by `caseId` + `expectedIndex`, so the
recomputation is a pure read:

```bash
node -e '
const fs = require("fs");
const load = (p) => {
  const r = JSON.parse(fs.readFileSync(p, "utf8"));
  const m = new Map();
  for (const c of r.caseResults)
    for (const f of c.matchedFindings) m.set(c.caseId + "#" + f.expectedIndex, f);
  return m;
};
const [a, b] = [process.argv[1], process.argv[2]].map(load);
const keys = [...a.keys()].filter((k) => b.has(k));
const rate = (m) => keys.filter((k) => m.get(k).severityMatches).length / keys.length;
console.log("matched base", a.size, "head", b.size, "intersection", keys.length);
console.log("severity accuracy on intersection:",
  "base", rate(a).toFixed(3), "head", rate(b).toFixed(3));
' base-report.json head-report.json
```

Swap `severityMatches` for `lineOverlaps` to do the same for line accuracy — but
only on a corpus whose expectations are `path-line`
([why](metrics.md#location-and-priority-accuracy)).

Until that paired check is done, **any headline movement in these rates must be
reported as composition, not as a quality change.**

---

## `eval recall-report`

```bash
codereviewer eval recall-report \
  --report run-a/eval-report.json \
  --report run-b/eval-report.json \
  --report run-c/eval-report.json
```

`--report` is repeatable and defaults to
`.codereviewer/eval/eval-report.json`. Output is Markdown on stdout; a missing or
unreadable report is a usage error (exit `2`).

**This is the multi-seed tool.** Given N reports over the same case set, it
builds one row per expected finding — keyed by `caseId` + `expectedIndex` — and
shows how each seed did:

| Section | Contents |
| --- | --- |
| Header | Report count, and `Case set: same \| different` |
| Runs | Per report: index, label (the path), `generatedAt`, fixture count |
| Summary | Expected findings, **always detected**, **never detected**, **flaky** |
| Expected findings | Case, index, severity, location, match mode, summary, `Rate` (e.g. `2/3`), and per-run marks `Y` / `N` / `-` |

The three summary buckets are the useful output:

- **Always detected** — solid, across every seed.
- **Never detected** — a genuine capability gap. This is the list to work from.
- **Flaky** — found by some seeds and not others. These are what generate the
  variance band; a change that converts flaky findings to always-detected is a
  real improvement even when aggregate recall barely moves.

`-` means the finding was absent from that report entirely (different case set),
and such runs leave the `Rate` denominator. Check the `Case set: same` line
before reading anything.

`eval run` also writes a single-report version of this table to
`eval-recall-report.md` automatically.

---

## `eval slice-manifest`

```bash
codereviewer eval slice-manifest --slice-root .codereviewer/eval/corpus-slices/real-repo-cross-file
```

`--slice-root` is required (usage error, exit `2`, otherwise). Prints a
deterministic JSON manifest of a repository-local slice pack.

**What it is for.** Proving that two local benchmark packs are the same, without
committing the pack or uploading it anywhere. Hydrated corpora live in the
git-ignored artifact directory, so "we ran the same corpus" is otherwise an
unverifiable claim.

| Field | Notes |
| --- | --- |
| `digest` | sha256 over manifest identity fields and case summaries, **excluding** `generatedAt` and `digest` — so two identical packs produce the same digest at different times |
| `caseCount`, `caseIds` | Cases in deterministic directory order |
| `cases[].sliceJsonSha256` | Digest of the case's `slice.json` |
| `cases[].repositoryTreeSha256` | Digest over repository-relative paths, byte sizes and file digests |
| `cases[].expectedFindingCount` | Answer-key size |
| `cases[].semanticOnlyExpectedCount` | Expectations that prove only semantic recall |
| `cases[].lineBearingExpectedCount` | Expectations with both path and line metadata |
| `cases[].changedFileCount`, `noFindingZoneCount`, `repositoryFileCount`, `repositoryBytes` | Shape and size |

It reads only the selected slice root and emits **hashes and counts only** —
never source text, prompts, provider payloads, secrets, or environment values.
A slice repository containing a symbolic link is rejected.

`semanticOnlyExpectedCount` vs `lineBearingExpectedCount` is the quickest way to
tell, before spending anything, whether a pack can support `lineAccuracy` at all.

---

## A defensible comparison, end to end

1. **Fix the corpus.** Hydrate once; capture its `eval slice-manifest` digest.
2. **Run N ≥ 3 seeds per arm**, same corpus, same flags. Keep every archived
   report path — the top-level copy is overwritten by the next run.
3. **Check trust flags first.** Any run with `judgeTrustworthy: false`, a
   non-zero `providerErrorRate`, or a non-zero `inconclusiveMatchCount` is
   evidence about the provider, not about the change.
4. **Report the mean and the range per arm**, not the best run.
5. **Apply the band.** Below ~9 points of recall on a single seed, say
   "unmeasured", not "improved".
6. **`eval recall-report` across all seeds of both arms.** Movement from *never
   detected* → *flaky* → *always detected* is the real signal.
7. **`eval compare` with every seed of both arms** (`--base` / `--head` are
   repeatable, and the arms must be the same size). Read the **in-diff** paired
   verdict — that is the decision. The blended figure below it is not a result,
   and the run-level deltas are context for token, cost, duration and segment
   movement, available when you compare a single run per arm.
8. **Intersect before comparing** `severityAccuracy` or `lineAccuracy`.

---

## See also

- [Running an evaluation](running-an-evaluation.md) — producing the reports.
- [Metrics](metrics.md#read-this-first-three-traps) — the traps these procedures work around.
- [Datasets](datasets.md) — corpus choice sets the resolution of any comparison.
- [Current results](current-results.md) — measured numbers.
