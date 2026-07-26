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
  was ±1 finding around 13. The corpus has since grown to 30 cases and 42
  findings; the band has not been re-measured at that size.
- **Denominator size sets the resolution.** One finding is worth ~6.3 points on a
  16-finding corpus, ~2.4 points on the current 42-finding one, and ~7.1 points
  on the 14-finding proof-quality slices. A smaller corpus quantises recall more
  coarsely and needs *more* seeds, not fewer.
- **The 4.4-point figure belongs to that corpus, that configuration, and that
  model.** Re-measure the band when any of them changes; do not carry the number
  across.

An A/B whose effect is smaller than the band is not a null result — it is an
*unmeasured* result. Say so, rather than reporting the direction of the noise.

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

Rendered, in order:

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

> Comparing gate status is not useful in practice: with the
> [hard-coded thresholds](running-an-evaluation.md#the-hard-coded-gate), both
> sides of any real comparison read `FAIL`. Compare metrics.

> `generatedAt` is a fixed constant in every CLI-produced report, so it cannot
> distinguish base from head. Identify runs by their archive directory.

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
