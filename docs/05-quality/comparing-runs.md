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

A difference of arm means throws away the information that matters. Score each
**individual expected finding**, keyed by `caseId` + `expectedIndex`, across
every seed of both arms, then ask how many expectations changed side.
`src/domains/evaluation/eval-significance.ts` does this and reports:

- the per-expectation hit-rate difference and a confidence interval on the mean;
- **gained**, **lost**, and **discordant** counts;
- a normal approximation to McNemar's statistic over the discordant
  expectations, so an effect built from a handful of coin flips is reported as
  such;
- **unpaired expectations** — anything scored in only one arm — held out of the
  comparison entirely.

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

Both flags are required; omitting either is a usage error (exit `2`). Output is
Markdown on stdout. **The command exits `0` even when it renders warnings**, so
you can inspect partial overlap and new/removed cases.

### Hard refusals (the command throws, exit `2` — not a warning)

Before rendering anything, the command refuses outright when either check below
fails, because a delta across either boundary reports a change in the RULER or
in the ANSWER KEY, not in the engine, and it is indistinguishable from a real
regression or win:

- **`metricsVersion` differs between the two reports** — they computed metrics
  under different rules.
- **`provenance.answerKeyDigest` differs between the two reports** — they were
  scored against different expected-finding content, even if `metricsVersion`
  matches. This is unconditional: it fires whenever the digests differ,
  including when the two reports also select different cases (a differing
  selection almost always changes the digest too). This is the exact failure
  this repository already hit once — an archived run reported 78.8% recall
  after its answer key had since changed underneath it, with nothing in the
  saved report revealing that.

Re-run both sides with the current build, against the same fixture selection,
before comparing. Neither check can be bypassed with a flag.

Rendered, in order (once both checks above pass):

| Section | Contents |
| --- | --- |
| Gate | Base/head gate status |
| Selection | Whether `selection.selectedCaseIds` are identical and whether fixture source / slice root match |
| Metric deltas | Aggregate quality, token, cost, duration, provider-health and refutation deltas |
| Context ledger | Base/head/delta entry counts by ledger kind |
| Agentic stages | Refutation / fix / provider-recovery stage counts |
| Metric-group coverage | Fixture-count deltas across the union of `sourceProfile` and `language` groups, including groups present in only one report; unchanged counts omitted |
| Metric-group deltas | Quality, resource and proof-loop deltas — **only for groups present in both reports** |
| Case transitions | Per-case status change |

### Warnings that invalidate the deltas

Rendered **before** the metric deltas, because the aggregates below them are not
same-dataset comparable:

- **Selected case sets differ**, or fixture source / slice root differ.
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
7. **`eval compare` the representative reports** for token, cost, duration and
   segment deltas.
8. **Intersect before comparing** `severityAccuracy` or `lineAccuracy`.

---

## See also

- [Running an evaluation](running-an-evaluation.md) — producing the reports.
- [Metrics](metrics.md#read-this-first-three-traps) — the traps these procedures work around.
- [Datasets](datasets.md) — corpus choice sets the resolution of any comparison.
- [Current results](current-results.md) — measured numbers.
