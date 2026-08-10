> **Provenance warning, added 2026-08-01.** Every figure recorded below before the
> `2026-08-01` entries was measured WITHOUT a recorded dependency digest. Engine
> pinning covered `src/` only; the pinned worktree symlinks the live
> `node_modules`, so a dependency change in the working tree reached backwards into
> historical runs undetected. This was demonstrated, not suspected: re-running the
> identical engine SHA against a verified dependency tree moved recall from 46.0%
> to ~42% and adjusted precision from 100% to ~95%. Treat any number here whose
> `engine.json` lacks `dependencyDigest` as unverified.

# Evaluation results ledger

Append-only record of every measurement, with what invalidates it. Newest first.

Corpus `real-repo-cross-file`: **37 cases, 87 expectations** as of 2026-07-27.
Entries above the clean-corpus baseline use earlier keys (36/80, then 31/74) and
do not pool across them; the tooling refuses cross-key deltas by digest.
Raw artifacts under `.codereviewer/eval/runs/<timestamp>/eval-report.json`.

---

## 2026-08-06 — widening the prohibition verdict: it fires more, and the bar still fails

The `not-contradicted` verdict was measured at a 1.1–1.9% firing rate against a
population the diagnosis put at 39.8% of intent-check false positives. The blocker
was diagnosed offline from the stored rounds and was **not** strictness: for a kept
prohibition, `not-evidenced`'s own sentence is literally true at the same moment as
`not-contradicted`'s, and the prompt offered both with no tie-break. Three
statements drew a different verdict in each round from identical inputs. A second
pull came from the people-and-process rule, which opened on "asking for something
no line of a code change could carry" — the exact description of an obligation
honoured by absence — and named `not-evidenced` in the same breath.

Two hypotheses were ruled out before touching anything: the downgrade-to-
`undetermined` rule never fired once in either round, and extraction is fine —
19.4% of reported obligations carry an explicit negative imperative.

Three prompt lines state the tie-break, extend the whole-not-part rule to the
fourth verdict as the guard against over-widening, and re-scope the process rule to
test the obligation's subject rather than its phrasing. No new call, no schema
change. Engine `fca6d04`, clean tree, 21 of 21 pre-written cases scored in both
rounds, `openai/gpt-5.3-codex`.

| | before (A / B) | after (C2 / D2) | prior baseline |
| --- | ---: | ---: | ---: |
| **`not-contradicted` fired** | 5 (1.1%) / 8 (1.9%) | **7 (1.6%) / 13 (2.8%)** | n/a |
| — of those, wrong | 0 / 1 | **0 / 0** | n/a |
| LIST precision | 51.6% / 50.4% | **53.5% / 53.0%** | 51.5% |
| outstanding recall | 87.8% / 84.7% | 85.6% / 87.9% | — |
| false-satisfied | 4.3% / 5.3% | 6.1% / 4.9% | 6.0% |
| spend | $5.06 / $4.65 | $4.80 / $4.20 | ~$4.87 |

**Against the four pre-registered points: the primary one still FAILS.** Precision
had to reach 60%; it moved 51.5% → ~53%. Recall held, spend is flat, and
false-satisfied stayed at or below its baseline. **Not one of the 20
`not-contradicted` verdicts across both rounds was wrong** — 0 landed on an
obligation the answer key calls outstanding, where the earlier pair had 1.

**The interesting result is the gap that did not close.** Two designs and four
rounds in, the verdict reaches **1.6–2.8%** of obligations while the classification
that motivated it put prohibition-shaped false positives at **39.8%**. Firing rate
roughly +50% relative, and still an order of magnitude short. Either the boundary
is still far too narrow, or **that 39.8% counted obligations a prohibition verdict
could never honestly claim** — an obligation satisfied by absence is not the same
as one this stage can prove nothing violates, and the diagnosis did not separate
them. The second reading is now the more likely one, and it is a question about the
diagnosis rather than about the implementation.

The change stays: it is free, it is right every time it fires, and it does not
regress its guardrails. **Do not attempt a third widening without first re-deriving
what fraction of that 39.8% a change-scoped verdict could ever settle.**

## 2026-08-06 — the prohibition verdict measured: correct, and far too rare to matter

Spec 23 gained a fourth verdict, `not-contradicted`, for prohibition-shaped
obligations — the 39.8% of false positives that were satisfied by ABSENCE and so
could only ever be reported as unmet. Two rounds, engine `d2f5adb`,
`openai/gpt-5.3-codex`, pre-written arm, **20 of 21 cases scored in both rounds**.

| | round A | round B | prior baseline |
| --- | ---: | ---: | ---: |
| LIST precision | 51.6% (65/126) | 50.4% (61/121) | **51.5%** |
| LANE precision | 93.7% | 93.4% | — |
| outstanding recall | 87.8% (65/74) | 84.7% (61/72) | — |
| false-satisfied | 4.3% (9/209) | 5.3% (11/209) | **6.0%** |
| **`not-contradicted` fired** | **5 of 436 (1.1%)**, 0 wrong | **8 of 428 (1.9%)**, **1 wrong** | n/a |
| spend | $5.06 | $4.65 | ~$4.87 |

**Against its own pre-registration: the primary point FAILS.** Point 1 required
outstanding precision to reach 60% from 51.5%. It measured 51.6% and 50.4% —
unchanged. Points 2–4 hold: detection did not fall beyond the band, false-satisfied
did not rise (it fell, 6.0% → 4.3/5.3%), and spend is flat.

**The diagnosis is in the firing rate, not the precision.** The verdict fires on
**1.1–1.9%** of obligations, where the classification that motivated it put
prohibition-shaped obligations at **39.8% of the false positives**. It is right when
it fires — 12 of 13 uses across both rounds were correct — and it is simply not
reaching the population it was built for. **The boundary is too narrow, and the idea
is not refuted.** That is a far more actionable result than the precision figure.

One `not-contradicted` in round B landed on an obligation the answer key calls
outstanding. It is counted twice, as the pre-registration demands: a recall loss and
a false-satisfied claim. The corpus can catch this failure mode, which is the reason
it was checked for before the run.

**Corpus property worth knowing before any re-run.** `pw09-spec15-measure` sits
exactly on its `maxObligations: 40` cap and therefore refuses non-deterministically:
it scored in round A and returned `intent_too_many_obligations` (exit 4) in round B.
The cap is NOT raised — the capped-to-uncapped move is recorded as worth 27.6 points
of end-to-end recall, which would swamp anything a fourth verdict does. The case is
excluded from every rate above, by id, in both rounds.

**Three instrument defects were fixed before this could be read at all**, each the
same shape as the engine bugs this project keeps finding: the scorer classified an
unknown verdict by falling through to "satisfied"; the two scorers held separate
copies of the vocabulary; and a legitimate refusal (exit 4, empty report) crashed
the scorer with a raw `SyntaxError` instead of being recorded as a refusal. Both
scorers now share one status table, throw on an unknown status, and classify a
refusal as data.

**Provenance caveat.** The sidecar records 1 dirty file at `d2f5adb` — a working-tree
edit to `specs/23-*.md`, which the engine never reads but the harness counts as part
of engine identity. Both rounds share it, so they pool with each other and **not**
with any later re-run.

## 2026-08-06 — change-impact adjudication measured for the first time (after a void run)

The first attempt on this corpus was **void**: in every case the scorer called
"fully adjudicated" the model was called **zero times**, and a contract-delta bug
(comment lines matched as real code, so a deprecation shim's commented-out `raise`
cancelled the real one) returned an empty delta that routed every dependent down
the deterministic `no-impact` branch. Fixed in `96991a1`; the instrument that made
a silent sweep look like a judgement was fixed in `a9896b0`. Nothing from the void
run is pooled here.

Engine `a9896b0`, `openai/gpt-5.3-codex`, 10 cases / 11 proven dependents, 61 model
calls, $0.08. Verdicts **10 `relies` / 37 `does-not-rely` / 14 `undetermined`** — a
healthy distribution, which is itself the check that the judge ran.

| | reference list | after adjudication |
| --- | ---: | ---: |
| destination files predicted | 67 | **9** |
| of those, proven dependents | 5 | **2** |
| precision (lower bound; upper not measurable here) | **7.5%** | **22.2%** |
| directly reachable recall | 50.0% (3/6) | 0.0% (0/5) [+1 n/m] |
| whole-repo-search recall | 40.0% (2/5) | 50.0% (2/4) [+1 n/m] |

**Decision-rule denominator — of the proven dependents the reference list itself
contains, how many survive adjudication: 50.0% (2/4).** Adjudication cannot report
what discovery never found, so this is the denominator spec 22 pre-registered.

**Verdict: ships disabled, not removed, not promoted.**
- Not removable: the removal clause fires if the model tier does not beat the
  deterministic tier. It does, visibly. The model-involved group kept 4 of 33
  reference files and retained both proven dependents of the repaired case; the
  deterministic-only group kept **0 of 9** and lost one proven dependent.
- Not promotable: the promote bar needs precision ≥50%, and only a **lower bound**
  of 22.2% exists. The upper bound is unmeasurable on this corpus by construction,
  so ≥50% cannot be established here at all — not now, and not by re-running.
- Precision rose roughly threefold against the deterministic baseline and lands in
  the band the published prior art reports (~28%). Recall fell, which spec 22
  pre-registered as the intended trade.

**The binding constraint has moved, and that is the most useful finding.** Five of
ten cases spent **zero** model calls, and three of those enumerate **no reference
files at all**. Adjudication is no longer what limits this capability; the
deterministic tier is. The next work here is deterministic, not model work.

**CORRECTION (2026-08-08): "the deterministic tier seeded no changed symbol" was
wrong for two of those three cases.** Verified by running `collectChangedSymbols`
against the fixtures rather than inferring from the zero:

| case | seeded | why zero references |
|---|---|---|
| `django-messages-package-import-pulls-in-level-tag-initialisation` | **none** | genuine seeding defect: import-only diff, and `changedSymbolFactKinds` excludes `import`/`module` |
| `django-union-default-ordering-not-cleared-for-combined-queries` | `_combinator_query` | seeded fine — `attribute-owner`, no textual link to the changed name |
| `django-relation-transform-guards-removed-from-lookup-resolution` | `build_lookup`, `build_filter` | seeded fine — `whole-repo-search`, no textual link |

So **one** seeding defect, not three; the other two are this lane's documented
reachability ceiling. Likewise two of the five zero-model-call cases are the
deterministic `no-impact` branch working as designed (symbols seeded, references
found, no contract-delta dimension matched inside the changed lines) rather than
anything failing.

The misdiagnosis was possible because a seeded-but-unreferenced run and a
never-seeded run published identical counts. Spec 22 now requires them to be
distinguishable and the lane emits a separate warning for each.

**Limits.** 11 dependents, 3 cases with any model involvement, and the largest cell
is 5 expectations — a single expectation moves a rate by 20 points. 8 of 10 cases
are contaminated (the model has likely seen both the change and its repair), and
the split is reported rather than pooled. Nothing here decides anything on its own.

## 2026-08-06 — refutation retrieval measured and REMOVED; control arm is the current baseline

Two arms, three runs each, **interleaved C,T,C,T,C,T** rather than run in blocks, so
neither arm inherits the other's warm provider cache. Engine pinned `c3c0c3d`,
37-case real-repository corpus, `openai/gpt-5.3-codex`, metrics version
`2026-08-03.plausibility-source-window` — the same version as the 2026-08-05
re-baseline, so these figures ARE comparable with it. Zero provider errors in all
six runs. Artefacts: `.codereviewer/eval/campaign-2026-08-06/`.

| metric | control | `refutationRetrieval` on |
| --- | ---: | ---: |
| in-diff recall | 60.0 / 68.3 / 70.0 — mean **66.1%** | 65.0 / 65.0 / 65.0 — mean **65.0%** |
| adjusted precision | 97.3 / 93.2 / 97.7 — mean **96.1%** | 92.9 / 90.7 / 95.1 — mean **92.9%** |
| raw precision | mean 74.5% | mean 75.5% |
| genuine false positives | 1 / 3 / 1 | **3 / 4 / 2** |
| out-of-diff recall | 0/27 in every run | 0/27 in every run |
| cost per run | $1.15 | $1.26 (+10%) |

Pooled per-expectation paired test over the in-diff population, one observation per
expectation across three runs per arm: **5 gained, 7 lost, 48 unchanged, exact
two-sided sign test p = 0.7744.** No recall effect.

**Removed under its own pre-registered rule**, which named "adjusted precision
falls" as a removal condition. It fell, and the genuine-false-positive counts were
higher in every seed position (mean 1.67 → 3.00), which is what makes the fall
credible rather than an artefact of one run. The capability was justified as a
verification-QUALITY improvement, and it produced no recall movement and more false
positives. Recorded in spec 05 under a new identifier; the removed one is not reused.

**Honest limit:** n=3 per arm, and the adjusted-precision difference is not formally
significant on its own. The rule deliberately did not require significance for that
clause — the burden was on the feature to show it earned its cost, not on the
control to disprove it.

**What this does not establish.** It does not refute the published finding that
motivated the arm (cross-file navigation was the largest single factor in a
verification-stage study). It establishes that the effect did not transfer to this
engine, this corpus and this model. Both differ from the study in ways that could
account for it, and the study itself reports the benefit concentrating in the
strongest models.

### The control arm supersedes the 2026-08-05 baseline

Same corpus, same model, same metrics version, one engine later. In-diff **66.1%**
against the previous **68.3%**, adjusted precision **96.1%** against **96.2%**,
out-of-diff unchanged at 0/27. The recall difference is small and this run cannot
separate it from noise; the two engines differ by a large amount of work whose
individual effects were not isolated.

**The spread is the finding worth carrying forward.** The control arm produced
60.0 / 68.3 / 70.0 on identical inputs — a **10-point range across three runs of the
same engine.** Every single-run comparison in this project's history should be read
against that, and it is a stronger argument for the paired per-expectation
instrument than any variance statistic quoted so far.

## 2026-08-05 — stage 1 re-baselined after the instruction and disclosure changes

Owed since the 2026-08-05 improvement pass changed what the model sees. Three runs,
engine pinned `db78900`, dependency digest `52d22c4858028742` — **identical to the
2026-08-02 baseline's digest**, verified before running, so the engine is the only
intended difference. 37-case real-repository corpus, `openai/gpt-5.3-codex`,
`--review-mode pr --review-depth thorough --max-concurrent-tasks 1`. Zero provider
errors in all three. Artefacts under `.codereviewer/eval/rebaseline-2026-08-05/`.

| metric | 2026-08-02 (`6781a26`) | 2026-08-05 (`db78900`) | comparable? |
| --- | ---: | ---: | --- |
| in-diff recall | 61.7 / 60.0 / 61.7 — **61.1%**, sd 0.96pp | 66.7 / 66.7 / 71.7 — **68.3%**, sd 2.89pp | yes |
| out-of-diff recall | 0 / 0 / 0 — **0 of 27** | 0 / 0 / 0 — **0 of 27** | yes |
| blended recall | 42.5 / 41.4 / 42.5 — 42.1% | 46.0 / 46.0 / 49.4 — 47.1% | yes |
| raw precision | 78.7 / 72.0 / 74.0 — 74.9% | 78.4 / 76.9 / 78.2 — 77.8% | yes |
| line placement | 100 / 97.2 / 100 — 99.1% | 92.5 / 95.0 / 95.3 — **94.3%** | yes |
| severity accuracy | 59.5 / 50.0 / 54.1 — 54.5% | 60.0 / 65.0 / 58.1 — 61.0% | yes |
| adjusted precision | 100 / 97.3 / 100 — 99.1% | 95.2 / 100 / 93.5 — 96.2% | **NO** |
| genuine false positives | 0 / 1 / 0 | 2 / 0 / 3 | **NO** |
| unlisted-real findings | 10 / 13 / 13 | 9 / 12 / 9 | **NO** |

**In-diff recall rose 7.2pp, and it survives the sharper test.** The three new runs
do not overlap the three old ones at all (60.0–61.7 against 66.7–71.7). An exact
permutation test over the 20 ways to split six runs into two arms of three puts
one-sided **p = 0.050** — the smallest p attainable at three runs per arm.

Re-adjudicated 2026-08-05 with the paired per-expectation instrument, which is
sharper because both arms score the same expectations: pooling all three runs per
arm into **one observation per expectation** and restricting to the population that
can move gives **12 gained, 3 lost, 45 unchanged over 60 in-diff expectations,
exact two-sided sign test p = 0.0352**. Out-of-diff is a hard zero in all six runs
and is reported as such rather than tested.

**The blended paired verdict does NOT clear p < 0.05, and that is the instrument's
fault, not the result's.** Adjudicated one run pair at a time over all 87
expectations it gives 5 gained/2 lost (p = 0.2568), 5/1 (p = 0.1025) and 9/3
(p = 0.0833). The 27 out-of-diff expectations are ties in every pairing, so they add
nothing to a test that reads only discordant pairs while diluting the reported rate
and the prose. Both defects — blending populations, and discarding four of six runs
— are fixed; see spec 06.

**Out-of-diff stayed at a hard 0 of 27, in every run.** Nothing in this bundle
targeted it, and nothing moved it. The wall is where it was.

**Three precision-side metrics are NOT comparable across this pair and must not be
read as a regression.** `EVAL_METRICS_VERSION` moved from
`2026-08-01.discovery-telemetry` to `2026-08-03.plausibility-source-window`, and that
bump's own note states it changes which findings are credited unlisted-real — hence
`adjustedPrecision`, `unlistedRealFindingCount` and `genuineFalsePositiveCount` — for
**identical review output** on any case with a file above the cap. The 99.1% → 96.2%
movement therefore mixes a scorer correction with whatever the engine did, and this
run cannot separate them. Raw precision, which the bump does not touch, went **up**.

`eval compare` **refused this pair outright**: the report contract gained a required
`cappedByLimitCount` since the baseline was written, so the old report no longer
parses. The comparison above was computed by hand from both reports' metrics blocks.
The refusal is the guard behaving correctly and is worth keeping.

**Attribution: unknown, and deliberately not claimed.** The eval run configures no
reviewer instructions, so the 2026-08-05 instruction work is **inert on this corpus**
— an empty instruction set renders an empty section. The delta therefore belongs to
the whole span `6781a26…db78900`, which also carries the previous session's
disclosure work (grep/list truncation notices and the refutation withholding notice
reaching the model) and today's refutation-context fix for partitioned sub-tasks.
Which of those moved recall is not established by this run.

**The spread is wider — 0.96pp → 2.89pp — but that difference is NOT established.**
An sd from three runs is barely an estimate: its own 95% interval is [0.50, 6.04]pp
for the old figure and [1.50, 18.17]pp for the new one, and an F-test on the ratio
gives F = 9.06 against a critical 19.0 at df 2,2. So "variance tripled" is not a
finding, and chasing a cause would be chasing noise. The prudent operational choice
is still to judge a stage-1 change against the wider 2.89pp rather than 0.96pp,
because under-stating the band is the error that produces false positives — but that
is caution, not a measured regression in stability.

**Cache utilisation is roughly double what was last recorded.** Caching was fixed on
2026-07-26 by removing the per-run `runId` UUID from the head of the model-bound
packet, and measured then at 36–39% cached input on a warm 30-case run. Here run 1
cached 5% of its input cold, and runs 2 and 3 cached **79% and 80%**, cutting review
cost from $1.97 to $0.83 and $0.82. So the warm/cold spread is now more than 2x
rather than the ~30% recorded in July. **This re-confirms that A/B cost figures are
confounded by arm order** — an arm running second inherits the first arm's warm
cache. Quote cold cost, or alternate arm order.

Cost for the sweep: **$3.62 review + $0.81 scoring = $4.44** for 3 × 37 cases.

## 2026-08-02 — stage 1, three runs at one pinned engine

The figures the report renderer now prints to users. Recorded here so the prose in
`markdown-reporter.ts` and `summary-comment.ts` cannot drift from the measurement
it cites. Engine `6781a26`, same dependency digest across all three runs.

| metric | value |
| --- | ---: |
| in-diff recall | 61.7 / 60.0 / 61.7 — mean 61.1%, **sd 0.96pp** |
| blended recall | 42.5 / 41.4 / 42.5 — mean 42.1%, **sd 0.66pp** |
| adjusted precision | 100 / 97.3 / 100 — mean 99.1% |
| out-of-diff recall | 0 / 0 / 0 — **0 of 27**, a measured zero over a full denominator |
| reported findings landing in-diff | 94.2% (49 of 52); the 3 strays were all judged real |

Two consequences worth keeping attached to these numbers.

The **sd is ~0.7pp, not the ±4.8pp** this project used for months. That older band
was estimated from too few samples and made every single-run comparison unreadable
in both directions; it produced at least three wrong calls in one day, including two
opposite readings of the same change.

The **out-of-diff zero is a scope boundary, not a defect**. `impact check` covers
that population at 20 of 27 (74.1%). Quoting a blended recall scores stage 1
against stage 3's job — the error spec 22 warns about by name.


## 2026-08-02 — `intent check`'s repeatability measured for the first time: 87.0% verdict agreement against ITSELF, which is the limit on every intent figure in this ledger

Artifacts: `.codereviewer/eval/intent-corpus-realistic/score-2026-08-02-repeatability.txt`,
`.../score-2026-08-02-current-engine-list.txt`, pre-registration at
`.../prereg-2026-08-02-postrename.md`, runs preserved under
`.../runs-2026-08-02-postrename/` and `.../runs-2026-08-02-postrename-repeat/`.
Engine pinned at `54ea0c0` with a dependency digest, provenance sidecar per case.

**Why this round exists.** Three commits changed the domain after the entry below
was measured: `21b9a1c` removed the citation-aptness stage, `ecd69bf` renamed the
two decided statuses **in the judgement prompt as well as the schema**, `70cde9b`
made the obligation limit refuse instead of truncate. None of the 28 stored runs
carries an `engine.json`, so `score.mjs` refuses to score them at all. Every intent
figure in this ledger therefore describes an engine that no longer exists.

**1. The aptness removal, re-read exactly on the stored runs** (`score.mjs
--no-aptness`; the stage only ever downgraded an already-decided verdict, so
dropping its flag reconstructs the list the current engine would build from answers
it already gave). Pre-written arm, primary reading:

| | as run | current engine's list |
| --- | ---: | ---: |
| outstanding recall, reported | 84.6% (88/104) | **81.7% (85/104)** |
| outstanding recall, end-to-end | 81.2% (56/69) | **78.3% (54/69)** |
| outstanding precision | 51.5% (88/171) | **55.6% (85/153)** |
| false-satisfied | 6.0% (16/265) | **6.7% (19/283)** |

The stage was adding **18 entries to the pre-written arm's outstanding list, 15 of
them already done** — 16.7% precision on its own additions against the lane's 51.5%.
Its removal was decided on the *other* corpus; this corroborates it on this one.
It costs 2.9pp of end-to-end recall and buys 4.1pp of precision.

**2. Whether the rename moved answers — and the noise floor that question needs.**
Three cases (`pw11` the purest question-mismatch case, `pw08` the opposite shape,
`ph01` the cheapest control), pre-registered before running, matched across rounds
by the statement matcher `carryover.mjs` already used.

| arm | statements matched | verdict agreement | spend |
| --- | ---: | ---: | ---: |
| stored round → current engine | 80.4% (45/56) | **86.7% (39/45)** | $0.3298 |
| current engine → **itself, same inputs** | 83.6% (46/55) | **87.0% (40/46)** | $0.2681 |

**The lane disagrees with itself as much as it disagrees with its predecessor.** The
pre-registered falsification bar was 80% agreement (rename detectable) versus ≥95%
same-engine (rename real); the control landed at 87.0%, so the rename is not
detectable at this sample size and the stored hand ground truth can be carried
forward. What the control actually establishes is larger than what it was run for:
**one in eight verdicts flips on identically-worded statements, one in six
statements is not reproduced at all, and identical inputs cost 19% more one run than
the next** ($0.3298 vs $0.2681). No intent figure in this ledger — including 81.2%
and 51.5% — has ever had a variance band, and every one of them is a single run.

**What this does NOT establish.** Nothing about the corpus at large: n=3, one repeat.
It is a repeatability probe and a carry-forward check, not a re-measurement, and the
28-case round below is still the only scored population.

Total provider spend for this entry: **$0.5979** (three cases twice). The
counterfactual in part 1 cost nothing — it re-reads stored artifacts.

---

## 2026-08-01 — Spec 23's "extraction is the bottleneck" diagnosis was 60% a BINDING CAP. Re-measured uncapped: end-to-end recall 53.6% → 81.2%

Detail: `reports/2026-08-01-intent-uncapped-remeasurement.md`. Capped runs preserved
run-for-run under `.codereviewer/eval/intent-corpus-realistic/runs-2026-08-01-capped/`,
which still reproduces its published figures exactly.

The entry below reported **52.9% end-to-end outstanding recall** and concluded the
extractor was too narrow to trust as a checklist. **24 of its 28 runs returned
exactly their configured `maxObligations` cap** (8–12, against a product default of
20), and `obligationsTruncated` reported `false` in all 28 and hid it. `76cfe3b`
fixed the flag; this round re-runs all 28 cases at a cap of 40, changing nothing
else. One case returned exactly 40 and was re-run at 60, where it returned 39. No
scored run is truncated.

### Single variable, and the movement is far outside the noise band

| pre-written arm, 21 cases | capped (8–12) | **uncapped (40)** |
|---|---:|---:|
| reported obligations | 192 | **469** |
| extraction fidelity | 100.0% (192/192) | **100.0% (469/469)** |
| outstanding recall, of what it proposed | 83.3% (40/48) | **84.6% (88/104)** |
| **outstanding recall, end-to-end** | **53.6% (37/69)** | **81.2% (56/69)** |
| **outstanding precision** | **69.0% (40/58)** | **51.5% (88/171)** |
| false-satisfied | 7.1% (8/112) | 6.0% (16/265) |

Permissive reading of the decision clauses moves every figure and changes no
conclusion: end-to-end 60.2% → **81.6%**, precision 76.6% → **57.4%**, false-satisfied
8.8% → 8.5%.

Denominator note: one item of the fixed human enumeration was **removed** as
factually wrong (`pw05`'s genericity-guard item — the guard *is* applied to the new
section text, from a new test file). Both rounds are restated on 69, which is why
the capped figure reads 53.6% here and 52.9% in the entry below.

### The answer, decomposed — extraction is NO LONGER the bottleneck

| how a leftover was missed | capped | **uncapped** |
|---|---:|---:|
| extractor **never proposed** an obligation for it | **24** | **4** |
| proposed and **wrongly judged addressed** | 8 | **9** |

**The cap accounts for 27.6 of the 46.4-point shortfall (≈60%), and for 20 of the 24
extraction misses.** Judgement misses are unchanged — exactly what a cap change
should do to a stage the cap does not touch, and corroborating evidence that this is
the cap rather than run-to-run drift. After the fix extraction is **4/69 (5.8%)** of
misses and judgement is **9/69 (13.0%)**. The binding constraint is now **precision,
51.5%**: roughly half the outstanding list is something an *earlier* change already
did, which the reviewed diff cannot evidence. `pw11` alone contributes 18 such
entries (33 obligations, 18 flagged, 0 genuinely outstanding).

The false-satisfied shape is unchanged and unaffected by the cap: *an obligation
about a thing that does not exist is credited to the nearest thing that does*, six of
sixteen instances.

### Post-hoc control reproduces exactly

7 cases, 60 → 89 obligations on the same diffs, **0 genuinely outstanding** in both
rounds, precision 0/6 → 0/7. A 1.5× larger sample does not make a commit message
contain leftovers.

### Recommendation: the default that landed mid-run (20 → 100) is SUPPORTED

`8993ab7` raised `maxObligations` 20 → 100 while this measurement was running, and
`70cde9b` then made the limit refuse (exit 4) instead of truncating. **This round
supports both and proposes no further change.** Eleven of 28 cases returned ≥ 20, so
20 reproduces this defect on 39% of this corpus; the case re-run at a cap of 60
returned 39, so the extractor stops well below 40 unaided; seventeen cases returned
fewer than 20 and cost the same at any cap. Cost per obligation is flat across the two
rounds ($0.0123 → $0.0108 — one judgement call plus one aptness call each), so **the
cap does not set the bill, the intent does**, and a generous default cannot make a
thin ticket expensive. Refusal rather than truncation argues for a *higher* cap, not a
lower one: a low cap is no longer a silent money-saver, it is a run that does not
answer, and the refusal happens before any judgement call so nothing is spent on work
that would be discarded. Unmeasured: anything between 40 and 100 — nothing here
produced more than 39 obligations.

Spend: **$6.3431** of a $9.00 ceiling — $6.0231 for the 28 scored runs plus $0.3200
for the superseded cap-40 run of `pw12`. 1.95× the capped round's cost for 2.21× the
obligations.

### Also found, recorded not patched

The context redactor mangles a backticked configuration constant: spec 11's
`` `task-context-change-intent` `` reached the extractor as `` `ta[REDACTED]` ``. A
secret-pattern rule is firing on a hyphenated identifier in backticks. Harmless here;
`src/` was not modified.

### What invalidates this entry

- **The engine was not pinned.** `run-case.sh` executes `src/cli/main.ts` from the
  working tree, and five commits landed on the branch during the sweep, so the runs
  span `76cfe3b`..`a374d09`. Assessed and inert on three checks: every case config
  sets all three limits explicitly so the default changes cannot reach them; the
  refusal `70cde9b` introduced fires only at the cap and **no scored run reached its
  cap** (max 39 at cap 60, 35 at cap 40), asserted from obligation counts rather than
  from `obligationsTruncated`, which `70cde9b` pins to false; and
  `intent-fulfilment` imports neither `context-retrieval` nor `review-workflow`. The
  extraction packet, judgement call, aptness call and all three prompts are identical
  across the run window. The clean form of this experiment pins the engine and this
  one did not — fix `run-case.sh` before re-running.
- One run per case, no variance band. The +27.6-point end-to-end move is far outside
  the demonstrated ±10% extraction noise; the sub-figures are not.
- The 4 remaining extraction misses are at the instrument's resolution limit, and one
  of them was proposed in the capped run and missed here.
- Precision 51.5% depends on the truth rule *"addressed means the demanded state
  holds at head, whoever made it hold"*. A reader who thinks only work in the
  reviewed diff should count would score it far higher.
- The 69-item denominator is the capped round's, deliberately, so the comparison is
  clean — but this round surfaced **39 obligations judged genuinely outstanding that
  no item of that list names**. Neither round's end-to-end figure is an absolute
  coverage rate; the difference between them is what is established.
- Spec sections are unusually well-formed intent. 22 obligations per case is not a
  forecast for a Jira ticket.

---

## 2026-08-01 — Stage 1's context budgets are sized for a previous generation of models

Raised as a question about whether the caps are anachronistic. They are, and the
consequence is bigger than the earlier per-file check suggested — that check
measured single files, but a task packs SEVERAL changed files up to the budget, so
the figure that matters is total changed bytes per change.

Measured over this repository's last 60 commits:

| | total changed-file bytes |
|---|---:|
| median | 72,089 |
| p75 | 176,808 |
| p90 | 329,660 |
| max | 680,900 |

| budget | exceeded by |
|---|---:|
| fast, 60 KB | **52% of commits** |
| **balanced, 120 KB (the default)** | **37%** |
| thorough, 240 KB | 12% |
| packet ceiling, 360 KB | 7% |

**On 37% of real changes the default budget splits the change across several
tasks** — and this project measured whole-file holistic review as OUT-RECALLING the
chunked alternative. So on more than a third of changes the reviewer performs a
measurably worse variant of itself, decided by a limit rather than by a model
constraint: 240 KB is roughly 60k tokens, against context windows of 200k to over
1M.

**This is a different severity from the truncation defects.** Chunking reviews every
line, just not in one piece, so it degrades a result rather than producing a wrong
one. It is a silent QUALITY change, not a silent wrong answer — which is why the fix
here is visibility plus a measurement, not a refusal.

`chunkedFileCount` is now reported. Nothing previously said when the substitution
happened.

**Deliberately NOT raised.** Stage 1 is the one capability that demonstrably works
(46.0% recall, 95.2% adjusted precision), raising its budget changes the recorded
baseline, and long-context attention degradation is real enough that bigger is not
automatically better. That makes it an A/B, and the corpus and harness for it
already exist. Raising it on reasoning alone would repeat the mistake that produced
these values.

---

## 2026-08-01 — CAVEAT on cross-file retrieval's withdrawal: reads were silently truncated

Prompted by the question of whether any withdrawn approach was rejected because a
cap bound rather than because the idea failed. Audit of every pre-existing stage-1
limit; the intent limits are excluded by date, having been introduced the same day
in `411c438`.

**Cleared:** the per-task context budget never bound on the corpus every A/B used —
0 of 57 changed files exceed even the default-depth 120KB (median 11.8KB, max
113.8KB). No withdrawn intervention was measured against a chunked baseline. The
packet budget above it refuses rather than truncates, by design.

**Not cleared — spec 16, cross-file retrieval.** `maxBytesPerRead` (20–24KB) cuts a
file mid-content with `subarray`, and the model-facing `RepoToolOutputSchema` is
`{ summary, content }` with **no truncation field**. The summary said only *"Read
&lt;path&gt; for investigation context."* A model receiving a file cut at an arbitrary
line, with no indication it continued, can conclude a guard is absent when the guard
was below the cut.

That mechanism produces **exactly the signature the withdrawal recorded**: recall
66.7% → 44.4% at nine cases and 68.8% → 56.3% at sixteen, with **precision holding
at 100%** — the loss was purely recall, which is what silently missing content
causes. It was never ruled out.

**This does not overturn the verdict.** No re-measurement has been run, the cap was
itself a response to a real observed harm (a 162KB single read losing a finding the
same task found without retrieval), and dilution and truncation both cost recall. It
means the verdict was reached against an implementation with a defect that plausibly
contributed to it, which is a different claim from "the idea does not work".

Fixed: a truncated read now appends an explicit marker to the content the model
reads — including *"absence of something below this point is NOT evidence it is
missing"* — and marks the summary. The ledger entry already carried
`bytesConsidered`/`bytesIncluded`; only the model-facing output omitted them.

**Spec 16 should be re-measured before its "net negative" verdict is treated as
settled.** Two prior withdrawals in this project have already been voided by
implementation defects found afterwards (spec 24's firing rate, spec 18's void A/B).

Also caveated, separately and already recorded: spec 25 Arm B re-ranked the
referenced-definition budget, which holds about three files, so ranking had little
room to express a difference.

---

## 2026-08-01 — Spec 23 measured on intent WRITTEN BEFORE THE CHANGE: the commit-message corpus was measuring nothing

New corpus `.codereviewer/eval/intent-corpus-realistic/`: **28 cases over 15
commits**, 21 of them carrying intent that is a verbatim slice of a `specs/*.md`
section as it existed at a **strict git ancestor** of the change under test
(`build.mjs` asserts the ancestry and refuses a case that fails it). 7 control cases
judge the **same diffs** against the commit's own message. **No synthetic cases and
no planted obligations.** Spend **$3.9401** of a $6.00 ceiling. Full analysis:
`reports/2026-08-01-intent-realistic-corpus-measurement.md`. Decision rule written
down before the corpus was built.

| | commit-message corpus, real arm | this corpus, post-hoc control | this corpus, **pre-written** |
|---|---:|---:|---:|
| cases / obligations | 12 / 80 | 7 / 60 | **21 / 192** |
| **genuinely outstanding obligations** | **0** | **0** | **48** |
| extraction faithful | 96.3% | 100.0% | **100.0% (192/192)** |
| outstanding recall, reported | not measurable | not measurable | **83.3% (40/48)** |
| outstanding recall, end-to-end | not measurable | not measurable | **52.9% (37/70)** |
| outstanding precision | — | 0.0% (0/6) | **69.0% (40/58)** |
| false-satisfied | 0.0% of nothing | 0.0% of nothing | 7.1% (8/112) |

### The answer, and it is structural rather than a matter of degree

A commit message is a report of work done, so its obligations are addressed by
construction. Three prior rounds recorded **zero** opportunities to be wrong about an
unaddressed obligation; the control arm here reproduces that exactly. **Caught in the
act on one diff:** spec 25 names two trigger shapes and `4c1e9dd` implements one.
Against the spec (`pw05`/`obl_3`) that clause is outstanding and the run reports it.
Against the commit message (`ph06`/`obl_10`) the extractor reads *"…which is NOT
implemented"* and produces *"do not implement the second trigger shape"* — which the
change satisfies. The same gap is an unmet requirement under one intent and a
satisfied one under the other.

### Real, unplanted leftovers this corpus contains

Spec 25's exit-path trigger clause; spec 15's whole Mechanism 2 and its held-out set
and per-mechanism precision; spec 11's `platform` provider and both its transports;
spec 22's contract delta, impact adjudication and missing blocking key; spec 24's
conformance adjudication; spec 23's own evaluation corpus; spec 05's defence-in-depth
severity rule; spec 13's observability step.

### Where the capability is right and wrong

- **Extraction accuracy is not the weak link**: 252/252 obligations across both arms
  are faithful readings of the line they cite, `uncitedObligationCount` 0 in all 28
  runs, no run truncated.
- **Breadth is**: end-to-end recall 52.9% against reported-level 83.3% — the entire
  gap is obligations the extractor never proposed. `pw09` proposed none of the seven
  undone anti-contamination items.
- **The false-satisfied shape, six of eight instances**: an obligation about an
  artefact that does not exist is credited to the nearest artefact that does — a
  requirement on the *evaluation* credited to the *implementation*, a held-out set
  credited to the dev set, a constraint on an unbuilt model call credited to the
  deterministic code around it.
- **18 false-outstanding entries** are mostly obligations an EARLIER change already
  satisfied, which this diff cannot evidence. Under spec 23's economics that is the
  cheap direction, and it is ~3 in 10 outstanding entries.

### What invalidates this entry

- One run per case, no variance band; extraction non-determinism is ±10% on any count.
- 22 obligations are conditional decision rules (*"adopt only if"*, *"retain as
  configuration if"*). The primary scoring calls them **unclassifiable**; the
  permissive reading gives 69 opportunities, recall 85.5%, precision 76.6%,
  false-satisfied 8.8%. Both readings support the same verdict; neither is hidden.
- A spec section is unusually well-formed intent. 100% extraction fidelity is an
  upper bound, not a forecast for a real ticket.
- The truth rule is *"addressed means the demanded state holds at head, whoever made
  it hold"*. A reader who thinks only in-diff work should count would score precision
  much higher.
- 8 false-satisfied and 18 false-outstanding events establish direction and
  mechanism, not a second digit. One repository, TypeScript, `gpt-5.3-codex`.
- The capability remains **off by default**. Nothing here argues with that.

---

## 2026-07-31 — Spec 23 citation-aptness check MEASURED: it works as designed and still costs more than it saves. WITHDRAW THE STAGE

Same 34 cases, same corpus, `1ae0db3` with the aptness stage active. Spend
**$2.5174** live + **$0.1365** probe = **$2.6539** of a $5.00 ceiling. Full analysis:
`reports/2026-07-31-intent-fulfilment-aptness-measurement.md`. Baseline:
`reports/2026-07-31-intent-fulfilment-remeasurement.md`, preserved run-for-run under
`.codereviewer/eval/intent-corpus/runs-2026-07-31-pre-aptness/`. Decision rule written
down before any result was read: the previous six clauses unchanged, plus a
**false-downgrade** definition, a pre-registered **exchange rate**, three hard floors,
and an attribution rule for a downgrade the report does not label.

| arm | extraction faithful | unaddressed detection | false-satisfied | opportunities | inapt citations |
|---|---:|---:|---:|---:|---:|
| **real** (80 obligations) | 96.3% | not measurable | 0.0% (0/75) | **0** | 2.7% (2/75) |
| **synthetic** (223 obligations) | 99.6% | **92.5% (74/80)** | **2.2% (3/135)** | **80**, 3 taken | 6.1% (8/132) |

**DHB sub-arm: 52 opportunities, 2 TAKEN** (was 3). Bound 11.6%. The pre-registered
bar for clearing the route is still ≥30 opportunities taken **zero** times, so the
route remains demonstrated and the capability stays **off by default**.

### What the stage did, itemised — 8 downgrades, attribution EXACT

`inaptCitationCount` sums to **8** and reconciles exactly with 8 hand-attributed rows
(every case with other `undetermined` rows reports 0, and no run had a failed
judgement). No counter bug.

- **1 BENEFIT**: `s32`/`obl_20` — *"the declaration-analysis barrel refuses a stage-3
  consumer at runtime"*, previously certified on an added line of a TEST, downgraded.
  A false-satisfied verdict genuinely removed. **Not the deleted-line route.**
- **1 correct-by-necessity**: `s24`/`obl_13` *"keep the numbers in the LEDGER"* — the
  ledger is not in the diff, so no apt citation could exist.
- **5 FALSE DOWNGRADES**: `r4`/`obl_4` and `s5`/`obl_4` (*"keep the field name
  unchanged"*, same obligation on the same commit, both suppressed — the direct probe
  reproduces this 3/3 and 2/3), `s12`/`obl_4` (*"update the test invariant"* —
  suppressed while its two SIBLING assertions in the same test survived),
  `s24`/`obl_14` (*"keep the numbers in the DOCS"*, where the docs table is added on
  lines 58-67), `s28`/`obl_5` (*"keep Arm A off by default"*, where the added spec line
  says exactly that).
- **1 undecidable**, excluded.

**Exchange rate FAILS: 2 × 1 = 2 < 5.**

### The verdict it was built for SURVIVED

`s17`/`obl_13` — *"make runs that request the withdrawn `guarded-region` context kind
fail intake with exit code 2"* — is reported `addressed` again on the same two REMOVED
lines, and `inaptCitationCount` for that case is **0**. The aptness call read exactly
that citation and did not call it inapt. `s33`/`obl_14` and `s28`/`obl_7` also survived
unchanged. **10 inapt citations and 3 false-satisfied verdicts were left standing.**

### The mechanism, from a direct probe of the stage alone (68 hand-labelled pairs, $0.1162)

| label | n | → apt | → undetermined | → **inapt** |
|---|---:|---:|---:|---:|
| apt | 50 | 46 | 3 | **1 (2.0%)** |
| inapt | 14 | 4 | 8 | **2 (14.3%)** |
| false-satisfied | 4 | 1 | 2 | **1** |

The stage is **correctly calibrated and pointed at a rare event**. `addressed`
verdicts are ~92% aptly cited, so a 2% false-inapt rate over ~200 apt citations
produces ≈4 wrong downgrades while a 14% catch rate over ~18 bad ones produces ≈2.5
right ones — expected downgrade precision ≈38%, which is what the live runs produced.
Making the check stricter raises the cost faster than the benefit; the fix has to be
**narrowing what it is asked about**, or **disclosing instead of suppressing**.

### Recommendation

**Withdraw the stage as it stands.** Two directions, both needing a spec decision, not
an edit: (1) run it only on behavioural obligations cited exclusively to removed
lines — four of the five false downgrades were preservation obligations whose evidence
can only ever be an added line that mentions the thing; (2) annotate the citation
instead of demoting the verdict, which cannot suppress anything.

### What invalidates this entry

- One run per case, no variance band. The five cases sharing `52ff75d`'s message
  reported 14 / 16 / 23 / 20 / 14 obligation rows against 14 / 16 / 20 / 20 / 15 last
  round on identical inputs.
- 8 downgrade events. The **direction** and the **mechanism** are established; no rate
  is claimed (the pre-registered floor for quoting one was 10 events).
- **The DHB inapt rate moving 33.3% → 0.0% is NOT the stage's doing** and must never be
  quoted as its benefit: the stage cannot improve a citation, and the judgement simply
  happened to cite the apt docs line every time this round.
- False-satisfied 4 → 3 is one attributable removal plus denominator movement
  (142 → 135 reported-addressed) from extraction non-determinism.
- A downgraded row's citation is dropped from the report, so two of the five
  false-downgrade classifications lean on the pre-aptness citation for the same
  statement plus what the diff contains; the probe on those exact citation sets
  answered `undetermined`.
- Real arm had **zero** opportunities to false-satisfy for the third round running.
- Twelve commits of one TypeScript repository, one provider, engineered synthetic
  mismatches.

---

## 2026-07-31 — Spec 23 re-measured after the amendment: the new false-satisfied route is REAL. NO SHIP, on evidence this time

34 cases (12 real, 22 synthetic) over 12 commits, spend **$2.3277** of a $4.00
ceiling. Full analysis: `reports/2026-07-31-intent-fulfilment-remeasurement.md`.
Decision rule written down before any result was read, carrying forward
2026-07-30's rule unchanged plus two new clauses (a deletion-heavy-behavioural
sub-arm, and citation aptness as a separate non-gating axis).

All 21 existing cases were re-run and re-scored; 13 new cases were added on four
deletion-heavy commits (`52ff75d`, `ee0589e`, `2882f4c`, `a6e6c5c`), every synthetic
plant a **behavioural** obligation.

| arm | extraction faithful | unaddressed detection | false-satisfied | opportunities | inapt citations |
|---|---:|---:|---:|---:|---:|
| **real** (76 obligations) | 96.1% | **not measurable** | 0.0% (0/73) | **0** | 4.1% (3/73) |
| **synthetic** (225 obligations) | 98.7% | 90.0% (72/80) | **2.8% (4/142)** | **80**, 4 taken | 8.0% (11/138) |

**The deciding sub-arm: 52 deletion-heavy behavioural opportunities, 3 TAKEN
(5.8%, 95% upper bound 14.2%).** The pre-registered bar for clearing the route was
≥30 opportunities taken **zero** times. It was not cleared.

### The answer to the question the amendment forced

**Yes — the tool can be made to say "done" for a behavioural obligation the change
did not satisfy, by citing deleted lines.** `s17-52ff75d-behaviour`/`obl_13`:

> *"Make runs that request the withdrawn guarded-region context kind by name fail
> intake with exit code 2 instead of assembling an empty section."*

Reported **`addressed`** on exactly two citations, **both removed lines**
(`agent-contracts.ts:49 'guarded-region'` and `context.ts:316 inputContext.kind ===
'guarded-region'`). The commit adds no intake check and no exit path, and the kind
is an internal enum with no user-facing way to name it. Two more false-satisfied
verdicts came from added lines (`s32`/`obl_20` credited a *test* for a claim about
runtime behaviour; `s33`/`obl_14` credited docs prose about **config** validation
for a claim about **builds**), plus one non-behavioural (`s28`/`obl_7`).

**`unevidencedAddressedCount` and `uncitedObligationCount` were 0 in all 34 runs and
no run was truncated.** Every citation was a real line the change really touched.
The structural guard cannot catch this: the failure is a valid address attached to
the wrong claim.

### What the amendment demonstrably fixed, stated beside the cost

`r9-52ff75d` went from 5 addressed / 9 wrongly-unaddressed to **14 addressed / 0
unaddressed**, all correct. `r7`/`obl_2` moved from a code-comment citation to the
29 removed export lines. `s7`/`obl_1` and `s10`/`obl_6` (last round's near-miss)
both became correct. The deletion blind spot is genuinely closed.

The same change produced the three behavioural false-satisfied verdicts above and a
**33.3% inapt-citation rate (4/12) on behavioural obligations in deletion-heavy
changes**. Neither half of this trade should be quoted without the other.

### Aptness on one obligation shape is a coin flip

*"A config still setting the removed block fails validation with exit code 2"* was
judged on `52ff75d` four times. Three runs cited removed schema keys, which show the
key deleted and say nothing about exit code 2 (**inapt**). One cited the added docs
line *"now fails validation with exit code 2"* (**apt**). The apt citation was in
scope all four times. Same split on `ee0589e`: apt in `r13` and `s33`, inapt in
`s21`.

### Also reproduced, and still unfixed

`r4-4731580`'s two explicit *"Not changed, and deliberately"* paragraphs became
obligations again and were again answered `unaddressed` — both of the real arm's two
false `unaddressed` verdicts. And extraction can collapse on a message that is
mostly measurement narrative: `r10-a6e6c5c` extracted 3 obligations from a message
stating 5; `s18` on the same commit extracted 1 of 5.

### What invalidates this entry

- One run per case, and extraction is visibly non-deterministic: the same
  `52ff75d` message yielded 14, 12, 13, 13 and 15 real obligations across five
  cases. No variance band for any figure.
- The real arm again had **zero** opportunities to false-satisfy, so its 0.0% is
  uninformative and says nothing about pre-written tickets or PR descriptions.
- 4 events. The route's **existence** is established; its rate is bounded only
  below 11.1% (per opportunity, synthetic).
- The 52 DHB opportunities are 52 report rows from about 31 planted statements, and
  they were engineered to be tempting. That is how to find a failure mode, not how
  to estimate its frequency in the wild.
- Two of ~31 plants turned out ambiguous once extracted (`s21`/`obl_8`,
  `s21`/`obl_10`) and are recorded `unclassifiable`, not scored.
- Three larger deletion-heavy commits with the same obligation shape (`a75e429`,
  `4656955`, `fd31dc9`) were dropped for budget and remain unmeasured.
- Twelve commits of one TypeScript repository, one provider, one day.

The capability stays **off by default**. The difference from 2026-07-30 matters:
that entry said no false-satisfied claim had been observed. This one says four have,
and names the shape that produces them.

---

## 2026-07-30 — Spec 23 amended: a removed line is evidence. Deletion blind spot closed, and a new risk opened

Spec 23 was amended (its first post-implementation amendment) so an addressed
obligation may cite a line the change **removed**, identified on the pre-change
side, with the report required to disclose which side a citation is on.

Same revert commit, same intent, before and after:

| | before | after |
|---|---:|---:|
| addressed | 6 | **14** |
| unaddressed | 7 | **0** |
| undetermined | 2 | **0** |

Ground truth for this commit, established by hand in the first measurement, is
that **all of its obligations were genuinely done**. The verdicts are now correct
where they were previously wrong on every removal.

### The new risk, stated because it is real

**Removed lines are abundant in a deletion-heavy change, so a citation is now easy
to satisfy.** Inspecting the run above, one obligation — *"make configs that still
set the removed block fail validation with exit 2"* — was credited against
*removed* lines of a generated schema file. That obligation is about **behaviour**,
and deleted schema lines are weak evidence for it. The verdict happens to be
correct; the evidence is not apt.

So the amendment trades a systematic false-*unaddressed* on deletions for a
plausible new route to false-*satisfied* on behavioural obligations in
deletion-heavy changes. Spec 23 is explicit that false-satisfied is the costlier
error, which makes this worth watching rather than shrugging at.

**The measured false-satisfied rate (0/56, 21 opportunities) predates this change
and no longer describes the current behaviour.** It must be re-measured, and the
corpus needs deletion-heavy cases with behavioural obligations, which the current
21 cases do not emphasise.

### What did not change

The safety property. A cited line still has to be one the change actually touched:
`verifyJudgement` resolves every citation against the change surface, drops what
does not match, and downgrades an `addressed` verdict left with no valid citation
to `undetermined`. A test asserts a line the change never touched is still
rejected, and another asserts the **side is taken from the change, not from the
answer** — a model claiming a line was added when it was removed is corrected, so
the required disclosure cannot be self-reported.

---

## 2026-07-30 — Spec 23 first measurement: NO SHIP VERDICT, sample cannot support one

21 cases over 9 commits of this repository, spend **$0.7663** of a $3.00 ceiling.
Full analysis: `reports/2026-07-30-intent-fulfilment-measurement.md`. Decision rule
written down before any result was read.

| arm | extraction faithful | unaddressed detection | false-satisfied | opportunities |
|---|---:|---:|---:|---:|
| **real** (commit message as intent, 58 obligations) | 94.8% | **not measurable** | 0.0% (0/47) | **0** |
| **synthetic** (12 marked cases, 79 obligations) | 98.7% | **95.2%** (20/21) | 0.0% (0/56) | 21 |

**No ship verdict, and that is the correct outcome rather than a disappointing
one.** The real arm never exercised the deciding metric: all 58 real obligations
were genuinely addressed, so `addressed` was always the right answer and a tool
that returned it unconditionally would have scored identically. The synthetic arm
passes on rate but has **21 opportunities to false-satisfy, not the 30** needed to
bound the rate below 10% — it bounds it below ~14%.

Nothing argues against the capability. Every signal is favourable. It stays off by
default because favourable is not the same as demonstrated.

**Why more of this repository's commits cannot fix it:** a commit message
describes what the commit did, so an obligation drawn from one is almost always
addressed by construction. Spec 23 predicted exactly this. Measuring
false-satisfied needs intent written *before* the work — tickets and pull-request
descriptions — which is also a harder input than a retrospective message.

### Deletions are invisible — verified independently

Re-run directly against the revert `52ff75d`, using its own commit message as
intent, and the split is total:

| obligation shape | result |
|---|---|
| *"Remove the guarded-region trigger…"* ×7 | **unaddressed** |
| *"Remove the packet section…"*, *"Remove the config block"* | **undetermined** |
| *"Keep declaration-analysis"*, *"Mark spec 25 Withdrawn"*, *"Make configs fail with exit 2"* ×6 | **addressed** |

**Every removal obligation failed; every retention or addition obligation
succeeded.** On a revert or cleanup change the tool tells a reviewer most of the
work was not done.

The cause is structural and spec-mandated: spec 23 requires an addressed
obligation to cite a path and line, and `verifyJudgement` requires that line to be
one the change touched. **A deletion has no such line.** Fixing it means amending
spec 23, which is a human decision, not an implementation choice.

Note the direction is the safe one — false *unaddressed*, never false *satisfied*,
which is the trade spec 23 explicitly asks for. This is a usefulness problem on a
common change shape, not a safety problem.

### Two more findings, recorded not patched

- **Non-scope disclaimers become obligations.** A commit message's *"Not changed,
  and deliberately: …"* section became three obligations, answered inconsistently.
- **Prose can satisfy an obligation.** In 5 of 103 addressed obligations the only
  cited evidence was *text asserting the work was done* — a spec paragraph or a
  code comment. All were truthful here. **A change that documents more than it
  implements is untested and is the exact shape that produces a false satisfied.**

### What invalidates this entry

One run per case; extraction is visibly non-deterministic (the same commit gave 5
and 4 obligations on two runs). Every case draws intent from a commit message
written after the work.

---

## 2026-07-30 — 37 real repositories: a JS blind spot, and spec 24 does fire

Deterministic, offline, **zero provider spend**. 37 hydrated slices, 4,974 source
files, 10 languages. Full analysis:
`reports/2026-07-30-signal-coverage-and-conformance-yield.md`.

### The JavaScript extractor sees ESM exports and nothing else

`fastify`'s `lib/route.js` — **701 lines of real JavaScript — produces zero
facts.** Isolated: `export const`/`export function` yield a fact; a `function`
declaration, `module.exports`, `exports.x`, and a `class` all yield **nothing**.
Across four real JavaScript repositories (1,046 `.js` files) the extractor
produced **6 declarations in total**.

This is not confined to an optional capability. Deterministic facts feed three
consumers, and each degrades *silently* — reporting "nothing to say" rather than
"cannot see":

- **stage 1**, where `deterministicSignalMode: 'support'` is the mode this project
  has measured as materially better for recall;
- **`impact check`**, whose changed symbols come from these facts;
- **`conformance check`**, hence the zeros.

The documentation asserted the opposite (*"Deep support signals exist for
TypeScript/JavaScript"*) and has been corrected. A likely route to the error:
`INV-ESM-001` requires **our own source** to be ESM-only, which is an invariant
about what we write, not about what we can review.

Correct and not a defect: C#, PHP, Elixir, C and Kotlin yield nothing because they
are not supported languages.

### Spec 24 is not gated into silence

The question left open this morning. Every declaration marked changed, so this is
the total divergence *population*, not a firing rate:

| | |
|---|---:|
| declarations | 21,498 |
| peer sets | 21,339 |
| **divergences** | **849 (3.9%)** |
| repositories yielding ≥1 | **18 / 37** |

**But yield is strongly language-dependent, and that is a problem for a capability
whose selling point is language-neutrality:** rust **17.0%**, typescript 14.2%,
python 3.2%, ruby 2.8%, go **0.7%**. A 24× spread between Rust and Go is either a
real property of those ecosystems or an artefact of how indentation and lexical
traits behave per language, and **this measurement cannot separate them**. Settle
it before recommending the capability anywhere.

Naively scaling 3.9% by ~4 changed declarations per commit suggests ~0.16 per
commit, inside the ≈0.5 criterion — recorded as an **estimate from a population
rate, not a measurement**. It assumes changed declarations diverge at the same rate
as all declarations, which is precisely what a real firing-rate run would test.

### The honest firing-rate test could not be run — CORRECTED DIAGNOSIS

**The first diagnosis published here was wrong and is retracted.** It said the
`baseSha` commit was *"absent from the shallow object store (verified on all 37)"*.
It is present on all 37 — `git cat-file -t <baseSha>` returns `commit` — and the
original check was a faulty shell loop, not a property of the corpus. The
depth-2 fetch in `real-repo-corpus-hydration.ts` pulls the fix commit and its
parent exactly as intended.

The real obstacle is a **semantic** mismatch, and it is more interesting:

- the corpus checks out the **parent** (pre-fix, defective) tree as `HEAD`, and
  defines the reviewed change as *the upstream fix reversed* — `baseSha` is the
  fix commit, `headSha` the parent;
- `conformance check` resolves its diff through **`git merge-base`**, and the
  parent is an **ancestor** of the fix, so `merge-base(fix, parent) = parent =
  HEAD`. The command therefore diffs `HEAD..HEAD` and correctly sees **nothing**.

Re-run with the correct refs across all 37: 37 completed, **0 changed files**,
0 declarations, 0 divergences — the empty diff, not a detector result. Nothing
about spec 24 can be read from it.

Reversing the refs does not help either, because the working tree is checked out
at the parent: a `head-ref` the filesystem does not match would compare a diff
against the wrong content.

**The reviewed change simply cannot be expressed as a ref pair under merge-base
semantics.** Two ways out, both real work rather than a one-command fix:

1. let `conformance check` accept a diff directly, as the eval runner already does
   with `slice.json.diff`; or
2. hydrate the corpus forward — check out the fix and review `parent → fix`.

The earlier claim that this was "a one-command measurement away" was wrong on both
the cause and the cost.

### What invalidates this entry

The divergence counts come from treating every declaration as changed; they are an
upper bound on what any real change could surface, not a prediction of one. No
divergence here was adjudicated, so none is claimed to be worth showing a human.

---

## 2026-07-30 — Spec 24 firing rate re-measured post-span-fix: 0.000/commit

20 consecutive commits of this repository, `conformance check` with adjudication
enabled, immediately after the `declarationSpanAt` fix. Total spend **$0.0509**.

| | before the span fix | after |
|---|---:|---:|
| changed declarations seen | — | **79 (3.95/commit)** |
| change-attributed divergences | 0.0125/commit | **0.000/commit** |
| pre-existing divergences | ~0.74/commit | **0.000/commit** |
| **combined** | **0.70/commit** | **0.000/commit** |

Gate is ≈0.5 per commit. **It is no longer blown; it is not approached.**

The reversal is the point. The detector now sees **four times as many
declarations** — 79 where the truncated span surfaced almost none — and reports
**nothing at all**. That is consistent with the void notice below: the old noise
came from the narrow set of shapes a truncated span could still see, single-line
schema-builder chains that formed large peer sets of near-identical members. Give
every declaration its real body and those bogus majorities dissolve.

**Do not read this as the capability working.** Two readings fit equally well and
this measurement cannot separate them:

1. The gates (majority pattern, three-cited-peer floor, membership precondition)
   are now correctly rejecting resemblance that was never a convention.
2. The gates are too strict for real trait sets, and the capability will report
   nothing on any codebase.

Twenty commits of one repository producing zero reports is compatible with both.
What it does settle is that the **noise objection is gone**: spec 24 was suspended
because it fired 0.70 per commit against its own 0.5 kill criterion, and that
number described a bug, not the design.

**Still true and unchanged: no positive on real code, ever.** The only case it has
ever caught is synthetic. The open question is now recall, not noise — the exact
inverse of where this capability stood this morning.

### What invalidates this entry

One repository, one 20-commit window, and this repository's style is unusually
uniform (heavy Zod schema builders, consistent arrow-function exports). A codebase
with more varied conventions could produce a very different rate. Re-measure
elsewhere before treating 0.000 as a property of the design.

---

## 2026-07-30 — VOID: every spec 24 firing-rate measurement predates a span bug

`declarationSpanAt` bounded a declaration by indentation alone, so a **multi-line
signature** ended the span at the line closing its parameter list. The body was
excluded, the declaration extracted no traits, and `peer-sets.ts` drops a
trait-less declaration — so it never reached the capability at all.

Measured on this repository's own `src/cli/args.ts`: **nine of ten exported
declarations extracted ZERO traits**, and `conformance check` reported no changed
declarations for a commit that plainly added two. After the fix the same file
yields nine declarations carrying 4–14 traits each, and a range that previously
produced 0 changed declarations now produces 3 with 3 peer sets.

**Consequence: the recorded spec 24 firing rates are not measurements of spec 24.**
They are measurements of a detector that could only see declarations whose
signature fitted on one line. That includes:

- the **0.70 / 0.75 per commit** combined rates, and the kill-criterion comparison
  drawn from them
- the earlier **0.075/commit** figure already recorded as unreproducible
- the conclusion that noise originates from schema-heavy modules — which is now
  *expected* rather than informative, because a single-line `z.strictObject({...})`
  chain was one of the few shapes the broken span could see at all

Nothing about spec 24 should be decided on those numbers. The firing rate has to
be re-measured before its kill criterion means anything, and the capability's
"no positive on real code" record is likewise not evidence about the design: the
design was never actually run on most declarations.

This does **not** rehabilitate spec 24. It says the case against it was never
properly made either, and both directions are now open.

Found by smoke-testing `conformance check` on this repository while verifying that
the stage-3 commands were runnable — not by reading the code.

---

## 2026-07-30 — "Unlisted real findings" measures FRAGMENTATION, not key gaps

Offline diagnosis of the 29 unlisted-real rows the three spec-25 arms produced.
Full analysis: `reports/2026-07-30-unlisted-real-diagnosis.md`. No provider spend,
no fixture touched.

**16 distinct findings: 0 genuine-unlisted defects, 13 restatements, 2
judge-errors, 1 deliberate exclusion.**

**Recall is NOT understated. The denominator stays 87 and 46.0% is accurate.**
This retracts the working hypothesis — repeated three times in this session — that
the engine "finds more than the answer key knows" and that recall is a floor of
unknown tightness. On this corpus it is not.

### Independently verified before acceptance

The load-bearing claim was re-checked directly against the run artifacts rather
than taken from the analysis:

| finding | arm0 | armA | armB |
|---|---|---|---|
| traefik `kubernetes_http.go:593` (+5 siblings) | **duplicate** | **unlisted-real** | **unlisted-real** |
| fastify `lib/route.js:617` | matched | **unlisted-real** | **unlisted-real** |

The same defect text lands in a different bucket in different arms. That is a
matcher artifact and cannot be a property of the key.

### Consequence for how arms are ranked

armB leads on unlisted-real (14 against arm0's 4) while **trailing on recall**
(44.8% against 46.0%). It did not discover more; it split defects into more
findings and absorbed fewer as duplicates. **A metric that rewards fragmentation
was being read as a discovery signal.**

### A proposed fix that was checked and rejected

The analysis recommended seeding the plausibility judge with the case's
already-matched findings so it can recognise a restatement. **That is already
implemented** — `judgeUnmatchedFindingsPlausibility` takes `matchedFindings` and
seeds `creditedByPath` from them before judging anything. The judge sees them and
answers "not the same defect" anyway, which is *defensible*: `*p.Name` at line 592
and `*p.Port` at 593 are two distinct nil dereferences, and the judge is
explicitly instructed that two real defects sitting near each other are not one
defect.

Widening `isDuplicateOfMatchedFinding`'s zero line tolerance was also rejected,
for the reason already recorded in that function: it is a purely textual check
with no view of what either finding says, so it would merge two genuinely
different defects as readily as a restatement, silently discarding a true
positive.

**The real cause is neither.** The key folds several defect sites into one
expectation — traefik expectation 0 names both `Name` and `Port` across lines
591-596 — while precision is counted per finding. One-to-one matching consumes the
expectation with the first finding, and the second is then literally an unlisted
real defect. Every layer behaves correctly and the aggregate is still misleading.

### What actually needs to change

Not the matcher's semantics and not the key. The **name and the breakdown**: the
counter asserts key incompleteness and measures something else. It needs to
separate findings that fall inside an already-matched expectation's own declared
`lineRange` (accounted territory) from those outside it (genuinely uncovered) —
additive, reversible, and destroying no signal.

### Also found

- `eval-report.json` persists only finding titles — no body, no judge rationale —
  which made this diagnosis interpretive rather than mechanical. Two verdicts
  stayed at medium confidence for that reason alone.
- `slim` expectation 0's `lineRange [25,36]` does not reach the title sink at line
  57 that its own summary claims.
- armB's credited pydantic finding states its mechanism **backwards** and the
  plausibility judge accepted it.

### What invalidates this entry

A second classifier disagreeing on the two medium-confidence items (ws, pydantic).
Even promoting both to genuine-unlisted moves the denominator to 89 and arm0 to
44.9% — still not an understatement, so the headline is robust to that.

---

## 2026-07-30 — Spec 25 guarded-region context: BOTH ARMS FAIL. Delete both.

Three arms, one session, same corpus state, `real-repo-cross-file` (37 cases,
**87 expectations**). Decision rule fixed in spec 25 **before** the run.
Total spend **$5.33**.

| arm | matched | product recall | adj. precision | genuine FP | unlisted real | cost |
|---|---:|---:|---:|---:|---:|---:|
| **0** baseline | 40/87 | **46.0%** | **95.2%** | 2 | 4 | $2.23 |
| **A** signal | 42/87 | **48.3%** | 93.3% | 3 | 11 | $1.52 |
| **B** signal + callee ranking | 39/87 | **44.8%** | 90.7% | 4 | 14 | $1.57 |

Provider error rate 0.0% in all three arms.

**Every pre-registered test fails.**

- **Inside the noise band.** A is **+2.3pp**, B is **−1.2pp**; the band is
  **±4.8pp**. On 87 expectations the whole effect is **two findings** for A and
  **one** for B. That is not a result, it is the corpus breathing.
- **Adjusted precision fell, in both arms, monotonically with added context**:
  95.2% → 93.3% → 90.7%. Spec 25 makes "precision MUST NOT fall" a standalone
  disqualifier, and this is a precision-first reviewer.
- **B did not beat A** (44.8% against 48.3%), which was Arm B's own separate bar.

Per spec 25 — *"Neither arm ships on a point estimate. Both are deleted outright
if they fail"* — both arms are removed. No "off by default, revisit later".

### The cost clause was inert, and cost at n=1 is not trustworthy

No arm added packet bytes by design, and none raised cost — the **baseline was the
most expensive arm** ($2.23 against $1.52 and $1.57). Cost here tracks
nondeterministic refutation volume, not packet size. Do not read a cost ordering
off single runs; the +25% referral clause never engaged and could not have.

### Recorded as a HYPOTHESIS, explicitly NOT as a result

**Unlisted real findings rose 4 → 11 → 14** while genuine false positives moved
only 2 → 3 → 4. Both arms surfaced substantially more findings the plausibility
judge accepted as real defects but which the answer key does not list.

This is stated as a hypothesis for a **pre-registered** test and nothing more. The
primary endpoint failed; reading a secondary movement as a win afterwards is the
post-hoc rescue this ledger exists to prevent, and the same discipline was applied
to the investigative arm's precision movement on 2026-07-27. It would need its own
decision rule, fixed in advance, on a corpus whose key is complete enough to
credit the findings.

### What does NOT follow

**Spec 24 is unaffected.** Spec 25 made retirement conditional on an arm winning;
none did. The conformance capability stands or falls on its own firing-rate work.

**This is not evidence that guard-shaped changes do not matter.** It is evidence
that pointing the reviewer at them, and re-ranking retrieval toward them, do not
move recall on this corpus. Four context interventions have now failed here
(spec 16 cross-file, spec 18 scout, spec 19 un-anchored pass, spec 25 both arms)
against one framing change that worked. The pattern is worth more than any of the
individual results.

### What invalidates this entry

A corpus key change, or a fix to the answer key that credits the unlisted-real
findings — the 87-expectation key is the denominator for every number above.
Baselines measured on the earlier 30-case/42-expectation corpus (recall 54.8%) are
**not comparable** and must not be differenced against arm 0.

---

## 2026-07-30 — Conformance adjudication: both live controls pass. NOT a measurement.

First live run of spec 24's adjudication layer, real provider, real model.
**Total spend $0.007.**

| arm | divergences | requested | convention | incidental | reported |
|---|---:|---:|---:|---:|---:|
| **Negative** — this repository | 2 | 2 | **0** | **2** | **0** |
| **Positive** — synthetic handler package | 1 | 1 | **1** | 0 | **1** |

The negative arm's two divergences are the genuine ones the deterministic core
produces here — *"4 of 7 sibling declarations call `string`"* and *"…call `min`"*.
Both were rejected as incidental and the report is empty, which is the correct
output for this repository.

The positive arm survived with a reason that draws exactly the distinction the
prompt asks for:

> All cited siblings are HTTP handlers in the same file that follow the same
> request-processing pattern (auth check gate, then response). That shared
> role-level structure indicates a file-local handler convention rather than a
> coincidental similarity.

"Because of what they are" rather than "most of them do it" — the sentence the
prompt was built around.

### Why this is not a measurement, and must not be quoted as one

- **n = 3 divergences.** Two negative, one positive, one run each. This is a
  smoke test with real models, not an effect size.
- **The positive control is synthetic** — written for this purpose. No case yet
  exists where a *real* change removed a *real* convention in a *real* repository.
- **Non-determinism is untested.** Single run per arm. Comparable systems show
  ~50% of LLM-only findings appearing in only 1 of 5 identical scans, so a single
  pass says nothing about stability.
- Firing rate on benign refactors was measured for the deterministic arm only
  (0.075 per commit); the adjudicated firing rate is unmeasured.

**What is established:** the wiring is correct, the packet carries enough evidence
for a real model to draw the distinction, and both directions work end to end.
**What is not:** whether it holds on real fixtures, across seeds, or on codebases
other than a synthetic control and one schema-heavy TypeScript repository.

---

## 2026-07-27 — Convergence measured at scale: the loop does NOT raise the catch rate

10 same-file multi-defect cases on the 37-case corpus. Three arms, 12 runs each,
round one **re-measured on the current build**. $5.21 of a $12 ceiling.

**Answer: no. The catch rate does not rise materially across rounds, and what rise
there is comes from the diff shrinking, not from the repair.**

| population | round 1 | round 2 | **control** |
|---|---:|---:|---:|
| per-defect (7 unrepaired targets) | 17.9% | 21.4% | **29.8%** |
| per-case (≥1 target found) | 29.2% | 37.5% | **52.1%** |

Run-level permutation test, 200k resamples:

| comparison | Δ targets/run | p |
|---|---:|---:|
| round 1 → round 2 | +0.25 | **0.60** |
| round 1 → control | +0.83 | 0.09 |
| round 2 → control | +0.58 | 0.25 |

**Zero percent of the round-2 lift is attributable to repair.** The control —
first defect **left in the code**, merely removed from the reviewed scope — beats
round 2 on three of four cases and ties the fourth. This is stronger than the
pilot's "indistinguishable": the control is at least as good as repair everywhere.

There is a hint repair may even *cost* a little: in `netty-kqueue`, the sibling
expression being fixed appears to make the surviving buggy one less salient
(10/12 → 8/12).

### The control construction, which is what makes this trustworthy

Base = parent tree **plus the complement of the fix slice**; head = the pristine
parent tree with the first defect still present. That makes the control's diff
**hunk-identical to round 2's** — only the head tree the reviewer reads differs.
Every fix byte is the upstream maintainer's; no engine output was used.

### Rounds to clean

| outcome | cases |
|---|---:|
| clean after round 1 | **3 / 10** |
| clean after round 2 | **0 / 10** |
| clean after round 3 | **0 / 10** |
| testable but not clean | 4 / 10 |
| **structurally not convergeable** | **3 / 10** |

Those last three are the important row: repairing the found defect **removes the
target from every later diff**, because the fix hunk spans the sibling defect's
lines or empties the reviewed diff entirely. No number of rounds reaches them.

### What this settles

**The single-pass figure is the honest headline. There is no iterative figure that
beats it.** The mechanism already in this ledger is confirmed at scale: the
reviewer reports roughly one defect per reviewed diff and re-aims when the diff
changes. Two of the four arm cases produced *zero findings of any kind* once the
diff shrank.

Round 1 here is 54.9% per-defect, **not** comparable to the 64.4% headline: this
population is the in-diff expectations of multi-defect cases only, which are the
harder tail by construction.

### Limits

n=12 per arm, so what is established is that round 2 **does not beat** the
control; "the control beats round 2" is not established (p=0.25). Six of ten cases
were dropped — three because round one already found everything, three because the
target can never re-enter a diff — so the tested four are the hard tail. Single
model, single config.

---

## 2026-07-27 — BASELINE ON THE CLEAN CORPUS (37 cases / 87 expectations)

**Status: CURRENT.** First measurement against the post-contamination answer key.
Supersedes every earlier entry for comparison purposes; the key moved twice today.

| metric | value | per seed |
|---|---:|---|
| **Recall, in-diff** | **64.4%** (116/180) | |
| **Recall, out-of-diff** | **0.0%** (0/81) | |
| Blended | 44.4% | 42.5 / 48.3 / 42.5 |
| Adjusted precision | 0.872 | 0.881 / 0.913 / 0.822 |
| Genuine false positives / run | 5.7 | 5 / 4 / 8 |
| **No-finding-zone false positives** | **0** | 0 / 0 / 0 |
| Refutation kill rate | 3.2% | 4.1 / 2.9 / 2.6 |
| Cost / run | $1.41 | 2.08 / 1.10 / 1.04 |

Expectation mix: 60 in-diff, 27 out-of-diff (31% out, down from 42.5%).

### In-diff recall FELL, and that is the cleanup working

69.8% on the old key against **64.4%** here. The five cases removed for answer-key
disclosure were scoring 83.3%, so their removal was always going to lower the
headline — that is what removing a leak looks like. The six added cases are
multi-defect by construction and therefore harder. **A number that went down here
is more trustworthy than the one that went up.**

### Out-of-diff recall is 0.0% again, on a different key

0 of 81, replicating 0 of 81 on the previous corpus. Two independent answer keys,
same result: **the engine finds nothing outside a hunk.** This is now the
best-replicated finding in the ledger and should be treated as an architectural
property rather than a measurement.

### Precision improved

Adjusted precision 0.831 → 0.872 and genuine false positives 7.7 → 5.7. Some of
that is the corpus change rather than the engine. Zone false positives remain
**zero across every run ever recorded** — the engine does not invent defects in
code verified to be clean.

---

## 2026-07-27 — Independent sampling k=3 vs k=1 — FAILS, and falsifies its own premise

n=3 per arm, paired finding-level test over 80 expectations.

| metric | k=1 | k=3 |
|---|---:|---:|
| Recall | 46.25% | **48.33%** |
| Adjusted precision | **0.819** | **0.628** |
| Genuine false positives / run | **8.3** | **23.3** |
| Candidates / run | 74.8 | 127.0 |
| Semantic merge collapses / run | ~1.7 | **78.0** |
| Refutation kill rate | 1.7% | 5.2% |
| Cost / run | $1.43 | $2.38 (**+67%**) |

Recall delta **+2.08pp**, 95% CI **[−1.67, +6.25]**, 7 gained / 5 lost,
**p = 0.56**. Cost per additional matched expectation: **$0.57**.

**Verdict: remove.** Recall did not rise significantly, adjusted precision fell by
0.19, and genuine false positives nearly tripled.

### The premise was wrong, and this run measured it

Spec 21 rested on a union ceiling of "~67% against ~46% single-run" — roughly 20pp
of run-to-run variance supposedly waiting to be harvested. That figure came from a
different corpus and configuration. Measured here:

| | recall |
|---|---:|
| Single run, mean of 3 | 46.3% |
| **Post-hoc union of the same 3 runs** | **50.0%** |
| k=3 sampling inside one run | 48.3% |

**The harvestable variance on this corpus is about 4pp, not 20pp.** And k=3
captures most of it — 48.3% against a 50.0% ceiling.

### Scope of that claim — CORRECTION

The ceiling above was measured with **byte-identical packets** on every sample, so
the only diversity available was sampling randomness. It therefore bounds
**identical-input resampling**, which is narrower than the claim first written
here ("no value of k fixes that").

The published sources this spec drew on did something we did not: Cursor's v1 ran
eight parallel passes with the **diff order randomised** specifically to force
different reasoning paths, and the self-aggregation result used n=10 with a plateau
at n=5. **Input-perturbed sampling has a higher potential ceiling and is untested
here.**

The honest prediction — and it is a prediction, not a measurement — is that it
still would not pay: precision collapsed hard at k=3, the extra candidates were
distinct wrong findings rather than near-misses, and more induced diversity should
produce more of them. But nothing measured here establishes that.

### Why precision collapsed

The semantic merge fired **78 times per run**, up from ~1.7, and adjusted
precision still fell hard. So the extra candidates from independent samples are
not mainly restatements of one defect — they are **distinct wrong findings**. The
samples disagree about what is wrong, rather than agreeing about a defect one of
them happened to miss.

That is the mechanism behind the small union ceiling: run-to-run variance here is
mostly noise, not near-misses.

### On the literal decision rule

Spec 21's rule says "retain as configuration if recall rises without significance
at n=3", which would literally permit keeping this disabled-by-default. It is
removed anyway, and the deviation is deliberate: the rule was written on the
assumption that ~20pp was available. The measurement falsified that assumption, so
retaining an option nobody should ever enable would be keeping configuration
surface for a strictly worse setting.

**What survives:** the semantic finding merge was exercised hard here — 78
collapses per run — and did its job without one-sided loss. It stays.

---

## 2026-07-27 — Convergence pilot: the mechanism exists, but it is not repair

3 cases testable of 36. **A pilot, not a measurement.** $1.87.

**The reviewer reports roughly one defect per reviewed diff and re-aims when the
diff changes.** It is not blocked by the first defect and unblocked by its repair.

The control arm is what establishes this. On `pydantic-dataclass-field-flags-lost-in-translation`:

| arm | second defect found |
|---|---:|
| Round 1 — full diff, first defect present | **0 / 9** |
| Round 2 — first defect **repaired**, so out of diff | **6 / 6** |
| Control — first defect **still present**, merely out of diff | **5 / 6** |

Round 2 and the control are indistinguishable. **The cause is the diff shrinking,
not the repair.** Round 1 produced exactly one finding per run with zero false
positives.

Operationally the iterative loop still works, because in a real pull request
fixing a defect *is* what removes it from the diff. But the honest description is
scope redirection, not unblocking — and that distinction determines what fixtures
must control for.

### The other two cases

- `rack-static-header-rules-match-encoded-path` — **negative.** The found defect
  was repaired; the two remaining in-diff expectations stayed at 0/6. Notable:
  in 5 of 6 round-2 runs the engine relocated to the exact added line of
  expectation 1 but made a different claim, scored unlisted-real. Attention moved;
  semantics did not match. A more permissive matcher would call this partial
  convergence — the result is sensitive to that boundary.
- `laravel-eloquent-dictionary-key-not-normalized` — **uninformative, then
  negative.** Round 2 found the next defect 2/3, but fresh round-1 replications
  also found it 2/3 despite the archive showing 0/3. Round 3 stalled at 0/3.

### The methodological finding, which matters more than the result

**Fresh round-1 replications, not the archive, are what kept this honest.** Three
archived runs said 0/3 for an expectation six fresh runs found twice. Trusting the
archive alone would have produced a false positive for laravel.

**Any future convergence fixture MUST carry a diff-narrowing control arm** — the
defect left in place, merely removed from the reviewed scope. Without it, a
convergence measurement measures scope, not repair, and will overstate the loop.

### Why the tested set is biased

Three of six candidate cases were skipped because the engine *already* found every
in-diff expectation, or because repairing the found defect pushed the target out
of the diff entirely. Skips correlate with cases the engine handles well, so the
tested set is biased toward hard cases.

---

## 2026-07-27 — Discovery posture: `investigative` vs `precise` — FAILS ITS RULE

n=4 per arm, paired finding-level test over 80 expectations.

| metric | `precise` | `investigative` |
|---|---:|---:|
| Recall | **45.94%** | **44.69%** |
| Adjusted precision | 0.819 | **0.873** |
| Raw precision | 0.669 | **0.748** |
| Genuine false positives / run | 8.3 | **5.3** |
| Candidates / run | 74.8 | **70.8** |
| Refutation kill rate | 1.7% | 3.5% |
| Cost | $1.32 | $1.36 |

Recall delta **−1.25pp**, 95% CI **[−4.38, +1.25]**, 5 gained / 5 lost,
**p = 1.0000**.

**Verdict under spec 20's pre-committed rule: remove.** The rule reads "remove if
recall does not rise". Recall did not rise.

### The intervention did not do what it was designed to do

The posture was meant to *lower* the reviewer's self-evidence bar and therefore
raise candidate volume. **Candidate count fell**, 74.8 → 70.8. So this did not
test "widen discovery and see whether the gate absorbs it" — discovery never
widened. The added paragraph appears to have made the reviewer more careful, not
less, plausibly because it repeats that severity must reflect impact rather than
confidence and asks the reviewer to state what it could not determine.

A future attempt at this idea should first demonstrate, on a handful of cases,
that the prompt actually raises candidate count, before spending on an arm.

### This was not a faithful test of the source — CORRECTION

The idea came from Cursor's documented v1 → agentic rewrite, which changed **two**
things: it replaced a fixed pipeline with an agent that **calls tools and decides
its own investigation depth**, and it made prompting aggressive.

**We implemented only the prompt.** This engine's discovery lane is single-shot
and tools-off by design, so the reviewer was instructed to "investigate every
suspicious pattern" **with no mechanism to investigate anything**. That is a
plausible reason candidate count fell rather than rose: words were added, not
capability.

So what failed here is a prompt. **The source's actual approach — aggressive
prompting paired with an agent that can act on the instruction — remains untested
in this engine**, and this entry must not be cited as evidence against it.

### The precision movement is NOT a reason to keep it

Adjusted precision rose 0.819 → 0.873 and genuine false positives fell 36%, at
equal cost. That is a post-hoc reading of an experiment that failed its primary
endpoint, on the arm whose candidate count happened to fall — the classic shape of
a finding that does not replicate. Keeping a feature on this basis is exactly how
measurement discipline erodes, and five interventions have already been removed
under this rule.

Recorded as a hypothesis worth its own pre-registered test — *does an instruction
that makes the reviewer more explicit about uncertainty improve precision at no
recall cost?* — not as a result.

---

## 2026-07-27 — Baseline after harness-wide conversation-history suppression

**Status: CURRENT.** This is the reference baseline for all subsequent arms.

| metric | value | per seed |
|---|---:|---|
| Recall (blended) | **46.3%** | 48.8 / 43.8 / 46.3 |
| **Recall, in-diff** | **73.9%** (102/138) | |
| **Recall, out-of-diff** | **8.8%** (9/102) | |
| Adjusted precision | 0.831 | 0.813 / 0.875 / 0.804 |
| Raw precision | 0.666 | 0.639 / 0.673 / 0.685 |
| Genuine false positives | 7.7 / run | 9 / 5 / 9 |
| Refutation kill rate | **0.9%** | 0.0 / 1.4 / 1.4 |
| Cost | **$1.43** / run | 2.20 / 1.05 / 1.03 |

n=3 seeds. Config: defaults — posture `precise`, `discoverySampleCount` 1,
security pass off, cross-file retrieval off.

### What changed since the previous baseline, and what it did

Paired finding-level comparison against the six history-carrying runs
(same corpus, same answer key):

| | value |
|---|---|
| before / after recall | 46.25% / 46.25% |
| delta | **−0.00pp** |
| 95% CI | [−3.13, +2.71] |
| gained / lost | 7 / 5 |
| p | **0.56** |

**Conversation-history suppression changed nothing measurable in accuracy, and
cut cost by 26%** ($1.92 → $1.43).

**A hypothesis this refutes.** It was argued — by me, at some length — that
refutation was rubber-stamping because it opened each call holding discovery's
findings *attributed to itself*, and that self-consistency pressure would bias it
toward `proved`. If that were the dominant effect, removing the history should
have raised the kill rate. It did not: 1.3% → 0.9%, and adjusted precision moved
within noise. **The ~1% kill rate is a genuine property of the pipeline, not an
artefact of contaminated context.** Refutation rarely finds anything to kill
because discovery rarely proposes anything speculative.

The change is still correct — the stages are specified to judge independently and
now do — and the 26% cost reduction is real. But it must not be described as an
accuracy improvement.

---

## Pre-2026-07-27 measurements: VOID for accuracy comparison

Every earlier figure was produced with conversation history forwarded into every
agent call. The paired test above shows the effect on recall was nil, so those
numbers are not *wrong* — but they were measured on a different pipeline and are
superseded by the baseline above. Cost figures from that period are inflated by
roughly 26%.

Additionally, every adjusted-precision figure recorded before the restatement
collapse landed (`EVAL_METRICS_VERSION 2026-07-27.plausibility-restatement-collapse`)
counted a reviewer's restatements of one defect as separate real findings, and
therefore overstated adjusted precision. Reports across that boundary do not pool.

### Un-anchored discovery pass A/B — REMOVED

+0.83pp recall (CI [−3.13, +4.79], 10 gained / 9 lost, p=0.82) for +136% cost.
Failed its pre-committed rule; the pass was removed. Detail:
`2026-07-27-unanchored-pass-ab-result.md`.

What survives it: refutation absorbed a 56% candidate increase, kill rate rising
1.3% → 16.0%, with adjusted precision holding — so the gate has headroom. And the
semantic finding merge collapsed 19.3 restatements per run with no one-sided loss.

### Untrusted-input guard — re-priced

First reported as +18.8pp (62.5% → 81.3–87.5%) on a 16-finding corpus. On the
133-finding benchmark the archived paired arms `crbA-guard-on.json` /
`crbB-guard-off.json` give 48 matched against 43 — 36.1% vs 32.3%, **+3.8pp**.
The larger figure was mostly small-corpus noise. Plan against +3.8pp.

---

### Spec 26 measurability precheck (2026-08-01, $0)

Before paying for the spec 26 A/B, a free static check of how many corpus cases the
OLD engine would actually have split. Both corpora run at `thorough` depth, so the
proactive chunk threshold was 108,000 B (`floor(min(240000, 360000) * 0.45)`).

| corpus | cases | a file over the chunk budget | files summing over it (upper bound) | over the old 360 KB packet ceiling | **unaffected** |
|---|---|---|---|---|---|
| real-repo | 37 | 1 | 2 | 0 | **34 (92%)** |
| crb benchmark | 59 | 9 | 12 | 7 | **38 (64%)** |

The "summing" column is an upper bound: task planning already caps a task at 8 paths,
so some of those cases never formed one oversized task.

**The spec's measurement plan names the wrong corpus.** On the 37-case real-repo
corpus the two arms are byte-identical on 34 of 37 cases; an effect confined to 3
cases cannot be resolved against a measured ±4.8pp band, so that A/B would cost real
money to produce a number that means nothing.

The crb benchmark is the corpus where the change actually bites — 21 of 59 cases,
which matches the 37% figure measured over this repository's own commits.

**Cheaper and stronger still: run only the 21 affected cases**, in both arms. The
38 unaffected cases are identical between arms by construction, so they can only
dilute a paired comparison while costing full price.


### Spec 26 reactive splitting — A/B, 21 affected crb cases (2026-08-01, $13.81)

Pinned engines: arm 0 `5902de3` (proactive), arm 1 `c11579c` (reactive). Paired at
expectation level, 71 expectations, 0 provider errors either arm.

| | proactive | reactive |
|---|---|---|
| recall (paired) | 43.7% | **35.2%** |
| adjusted precision | 83.8% | **96.2%** |
| candidates refuted | 106 | 75 |
| findings emitted | 113 | 84 |
| cost | $7.41 | $6.40 (**−14%**) |

Paired delta **−8.5pp**, 95% CI [−16.9, 0.0], discordant 10 (gained 2, lost 8),
McNemar z −1.90, **p = 0.058**.

**The provider refused ZERO packets** — no `context_length_exceeded`, no splits, on
any of 21 cases including one carrying 1.2 MB of changed source. Spec 26's premise
is therefore **confirmed and now measured, not assumed**: the old byte budget was
splitting for no provider-side reason whatsoever.

**But the recall loss is real and it is not about splitting.** Since reactive
splitting never engaged, the only difference between the arms is TASK COUNT: the old
budget's batching made several tasks per case, the new assembly makes one. Candidates
fell 106 → 75 and findings 113 → 84 in step with it. Discovery yield is **per task**,
not per defect present — the long-standing "one finding per file" behaviour, here
measured as the binding constraint on recall.

So the change trades recall for precision and cost by shrinking the number of looks
the reviewer takes. **Do not ship it as the default until discovery yield stops being
per-task**; the yield fix is the prerequisite, not a follow-up.

### Spec 16 cross-file retrieval — REVERSES the earlier net-negative verdict (2026-08-01, $3.94)

Same pinned engine `c11579c` both arms, 37-case real-repo corpus, 87 expectations,
`maxToolCallsPerTask: 8`, `maxBytesPerRead: 24000` — the same cap as the original
run. The only difference is that a truncated cross-file read now **discloses the cut
to the model**.

| | off | on |
|---|---|---|
| recall (paired) | 42.5% | **48.3%** |
| adjusted precision | 97.4% | **100%** |
| cost | $2.05 | $1.89 (**−7%**) |

Paired delta **+5.7pp**, 95% CI [−1.1, 12.6], discordant 9 (gained 7, lost 2),
McNemar z 1.67, **p = 0.096**.

The earlier verdict (66.7% → 44.4% at 9 cases, 68.8% → 56.3% at 16) was recorded as
net negative and the feature was left off by default. That verdict **does not
survive**: the direction flips on a corpus four times larger, with precision rising
to 100% and cost falling. Every `repo_read` had been cut at 24,000 bytes with the
model told nothing — the exact mechanism that produces "recall falls, precision
holds" — and the earlier measurement could not distinguish the feature from that bug.

**Not yet conclusive**: +5.7pp is barely outside the measured ±4.8pp band at p = 0.096,
on a single run. It refutes the negative verdict; it does not yet establish the
positive one. Replicate before making it the default.


### Spec 27 discovery partitioning — `maxFilesPerDiscoveryCall: 1` (2026-08-01, $16.51)

Same 21 crb cases, paired at expectation level, 71 expectations, 0 provider errors.
Control is spec 26's arm 1 (an existing artefact, so it cost nothing to re-use).

| | whole task (control) | per file | old proactive default |
|---|---|---|---|
| recall (paired) | 35.2% | **46.5%** | 43.7% |
| raw precision | 45.5% | 26.2% | 41.3% |
| adjusted precision | 96.2% | **97.1%** | 83.8% |
| cost | $6.40 | **$16.51** | $7.41 |
| wall clock | 9.4 min | 28.4 min | 13.6 min |

vs control: **+11.3pp**, 95% CI [0.0, 22.5], discordant 18 (gained 13, lost 5),
McNemar z 1.89, **p = 0.059**.
vs the old proactive default: **+2.8pp**, CI [−8.5, 14.1], **p = 0.617**.

**The mechanism is confirmed.** Recall responds strongly to how many discovery calls
the same code is spread across, exactly as the spec 26 arms implied. Nothing about
the prompt, the model, or the context changed — only the number of looks.

**Raw precision fell 45.5% → 26.2% while ADJUSTED precision held at 97.1%.** Those
move in opposite directions because the extra findings are overwhelmingly
*real-but-unlisted* rather than false: the crb answer key is a curated subset, and
raw precision counts an unlisted real defect as a false positive. Adjusted precision
holding is the load-bearing number here.

**But `1` is the wrong operating point.** It costs **+158%** over the control and
**+123%** over the old proactive default, to land recall that is *not distinguishable*
from that old default (p = 0.617). What it clearly does beat the old default on is
adjusted precision, 83.8% → 97.1%.

Pre-registered rules, applied honestly: recall moved outside the ±4.8pp band, so it
is a result; adjusted precision did not fall, so that gate passes; cost rose
materially, so **the trade must be argued rather than assumed — and at N=1 it does
not carry.** The informative region is between 1 and unlimited, and it is unmeasured.

**Engine caveat.** The control ran on `c11579c` and this arm on `4751277`, which
differ by the spec 27 commit itself. The partitioning default is unset and its
inertness is unit-tested (`partitionTaskForDiscovery(task, undefined)` returns the
task unchanged, full suite identical), so the arms should differ only by the arm —
but this rests on that test rather than on matching SHAs, which is exactly the
distinction the provenance guard exists to make visible. Re-running the control on
`4751277` (~$6.40) would remove the caveat.


### Spec 27 sweep — the shippable operating point (2026-08-01, $36.78 for the sweep)

Same 21 crb cases, same pinned engine, paired at expectation level against the
whole-task control. `maxFilesPerDiscoveryCall` swept.

| setting | recall | adj precision | cost | vs control |
|---|---|---|---|---|
| unlimited (control) | 35.2% | 96.2% | $6.40 | — |
| **4** | 40.8% | 93.5% | $8.18 | +5.6pp, p = 0.248 |
| **2** | **46.5%** | **97.1%** | $12.09 | **+11.3pp, CI [1.4, 21.1], p = 0.033** |
| **1** | 46.5% | 97.1% | $16.51 | +11.3pp, CI [0.0, 22.5], p = 0.059 |
| *(old proactive default)* | 43.7% | 83.8% | $7.41 | — |

**2 is the knee, and it is the default.** It matches the strongest setting exactly on
both recall and adjusted precision while costing **27% less**, and it is the **only
arm in this entire investigation to reach conventional significance** (p = 0.033,
confidence interval excluding zero, 11 expectations gained against 3 lost). Going
below 2 buys nothing at all.

Against the old proactive default it is **+2.8pp recall and +13.3pp adjusted
precision** for +63% cost.

**Cost applies where it should.** Partitioning only engages above two changed files,
so a small change is untouched. These 21 cases were selected as the *largest* in the
benchmark (137 KB – 1.2 MB of changed source); they are the worst case for cost and
the best case for the gain, because a large change is exactly what the unpartitioned
reviewer served worst.

**Adjusted precision is non-monotonic** across the sweep (96.2 → 93.5 → 97.1 → 97.1).
The dip at 4 is almost certainly noise at this sample size and should not be read as
structure.


### Stage 1 headline at shipped defaults, and the cross-file replication (2026-08-01, $4.51)

37-case real-repository corpus, pinned engine, partitioning at its shipped default of
2 files per call.

| | recall | adjusted precision | raw precision | cost |
|---|---|---|---|---|
| **defaults** | **43.7%** | **95.0%** | 73.1% | $2.31 |
| defaults + cross-file | 46.0% | 100% | 76.9% | $2.20 |

**43.7% / 95.0% at $2.31 is the current honest headline for the review stage.** It is
the first figure measured on this corpus with the shipped configuration and a pinned
engine, and it supersedes everything earlier on this page for quoting purposes.

Note it is only ~1pp above the same corpus without partitioning (42.5%). That is
expected and not a contradiction: the real-repo cases are small, so partitioning
rarely engages. Its measured value was on the 21 LARGE benchmark cases, where it is
worth +11.3pp. The two corpora answer different questions.

**Cross-file retrieval: the replication does NOT confirm the effect.** Paired,
87 expectations: **+2.3pp**, 95% CI [−4.6, 9.2], discordant 10 (gained 6, lost 4),
McNemar z 0.63, **p = 0.527**. Against the first run's +5.7pp at p = 0.096.

Two runs, both positive in direction, neither significant, the second much weaker.
The honest reading: the original **net-negative verdict is refuted** — it was
measuring silently truncated reads — but a positive effect is **not established**.
Adjusted precision reached 100% in both runs at neutral cost, so it is best described
as neutral-to-slightly-positive.

**Superseded the same day: it is now ON by default.** A third run, at the shipped
partitioning default on the 37-case corpus, again favoured it on every dimension
(recall 43.7% → 46.0%, adjusted precision 95.0% → 100%, cost $2.31 → $2.20), and the
replication is recorded below. Significance is the bar for *claiming* a benefit, not
for permitting a default that is free, harmless and directionally positive three
times. No specific improvement is claimed; if a regression appears this is the first
switch to flip.


### CURRENT HEADLINE — re-baseline at shipped defaults (2026-07-31, $2.24)

37-case real-repository corpus, engine pinned at `1152751`, 0 provider errors.
Supersedes every earlier figure on this page for quoting purposes.

| | value | previous baseline |
|---|---|---|
| recall | **46.0%** | 43.7% |
| adjusted precision | **100%** | 95.0% |
| raw precision | 80.0% | 73.1% |
| cost | **$2.24** | $2.31 |

The gain is not a new feature — it is the day's defect fixes landing: referenced
definitions had been dropped from every partition, reads were still cut at 120 KB,
the line range never reached the retriever, the security pass was unpartitioned, and
over-long findings were discarded whole.

### The out-of-diff wall — first MEASURED split, not hand-derived

| scope | expected | matched | recall |
|---|---|---|---|
| in-diff | 60 | 40 | **66.7%** |
| out-of-diff | 27 | 0 | **0.0%** |
| undetermined | 0 | 0 | n/a |

**Out-of-diff recall is exactly zero over a full denominator of 27 expectations.**
Not "low", not "unmeasured" — zero, and the nullable-rate work is what makes that
distinguishable from having no data at all (`undetermined` is genuinely n/a).

**31% of the answer key lies in code the change did not touch, and the engine finds
none of it.** The blended 46.0% is carried entirely by in-diff performance. This is
now the largest single recall opportunity in the product, it is quantified rather
than estimated, and it confirms the 2026-07-27 "attention follows the diff"
experiment at full corpus scale with a proper denominator.

Ceiling arithmetic worth stating plainly: even perfect in-diff recall caps the
blended figure at 69% while out-of-diff stays at zero.

**And it is an ATTENTION failure, not an information failure.** A free check of
where those 27 expectations live:

| out-of-diff expectation is in… | count |
|---|---|
| a CHANGED file — the reviewer was shown the whole file | **27** |
| an unchanged file — reachable only via cross-file retrieval | **0** |

Every single one sat in a file already in the reviewer's context, in full. Not one
needed retrieval, a larger context window, or any extra information. The reviewer
had the code and did not look at it.

This rules out the expensive fixes and points at the cheap one. More context, more
retrieval, and bigger models cannot address a population that was already fully
visible; what is left is how the reviewer is ASKED — the packet currently labels the
diff "review this closely" and labels the file content "for context", twice. That
framing is the measured cause, it costs nothing to change, and it now has a
27-expectation population with a hard floor of zero to be measured against.


### Prompt reframing arm — BUILT AND PRE-REGISTERED, NOT YET RUN (2026-07-31)

The arm is committed (`a5ade0b`) and its measurement is **outstanding**: the run
attempted on 2026-07-31 failed on all 37 cases with HTTP 429
`project_spend_limit_exceeded` before a single model call was made. Cost $0.00,
output 0 tokens, provider error rate 100%. Its artefact is retained as
`VOID-spend-limit-report.json` and **must not be compared against anything** — it
scores 0.0% because nothing ran, not because anything was measured.

**Why the arm exists.** Out-of-diff recall is 0 of 27 on this corpus, and all 27 of
those misses sit in files the reviewer was shown IN FULL. Distance does not explain
it: the median miss is 68 lines from a changed hunk, a quarter are within ten lines,
and the closest is **one line away, in a single-file change with its own dedicated
call**. Crowding does not explain it either, for the same reason. What remains is
framing, and the packet stated it outright — three places called the file content
"context" and one told the model to review the diff "closely", against a single
permission-shaped line eighth of twelve saying out-of-diff defects are "in scope".

**The arm** makes the diff orientation, the files the review target, scope an
obligation rather than a permission, and adds a coverage instruction (do not stop at
the first defect; no severity floor at discovery).

**Pre-registered, before any run:**

- Out-of-diff recall must rise from its floor of **0/27** to count as anything. A
  hard zero makes this a far better instrument than the blended figure.
- **Adjusted precision (100%) MUST NOT fall.**
- Report cost and output tokens: a coverage instruction that only inflates output
  without finding more is a cost regression, not a win.
- In-diff recall (66.7%) must not fall — the risk of de-emphasising the diff is that
  it trades the population that already works for the one that does not.


### Stage 2 precision diagnosed — it is mostly measuring the wrong question ($0, offline)

Diagnosed entirely from stored artefacts, no provider calls. Base: **51.5% (88/171)**
outstanding precision on the realistic corpus. Every case predates the provenance
sidecar, so this inherits the unpinned-engine caveat (scored with
`--allow-mixed-engines`, reproducing the published figure exactly).

**The 83 false positives, classified:**

| failure mode | count | share |
|---|---:|---:|
| satisfied by ABSENCE (a prohibition — nothing changed, so no line to cite) | 33 | 39.8% |
| satisfied OUTSIDE the diff (real, done by an earlier commit or existing code) | 21 | 25.3% |
| the withdrawn aptness stage flagging a CORRECT `addressed` verdict | 15 | 18.1% |
| genuine judgement error — the evidence WAS in the changed lines | 11 | 13.3% |
| unfalsifiable from any artefact (provenance/process claims) | 3 | 3.6% |

**Extraction contributes ZERO.** Fidelity is 100% (469/469) and not one false positive
has `faithful: false`. Do not spend on extraction.

**The dominant failure is not model accuracy — it is a question mismatch.** 54 of 83
(65.1%) are obligations the judgement could not settle from what it was shown. The
judgement sees ONLY the changed lines and is told to answer `unaddressed` when nothing
among them satisfies the obligation; the scorer asks whether the state holds at head,
whoever made it hold. Spec 23's own Purpose is *"report what a change has not been
shown to cover"* — so the engine is answering its question correctly and the label on
the answer is what misleads.

**Corroboration, same engine and prompts:** on the older SYNTHETIC arm, where intent
is matched to the change by construction, false-`unaddressed` is **1.3% (1/75)**. That
is the cleanest available evidence that the imprecision is intent/change scope
mismatch rather than judgement quality.

**What correlates:** bigger changes score better (r = +0.52 lines, +0.55 files — more
chance the evidence is inside the window). Obligation count does not correlate at all
(r = −0.03), so capping obligations buys no precision and the uncapped round already
showed it costs 27.6pp of recall. Post-hoc intent reproduces its known pathology: 89
obligations, 0 genuinely outstanding, 7 wrongly flagged.

**Ceiling arithmetic:** 56–58% from reporting changes alone; ~71% if absence-satisfied
obligations are handled; a hard ~86% set by 11 genuine judgement errors plus 3
unfalsifiable obligations. Treat **65–80%** as the achievable band.

**Caveat that limits all of it:** n=1 per case, no variance band, on a capability whose
extraction is measurably non-deterministic (±10% on any count). The 51.5% headline is a
single run.


## 2026-08-07 — A capability restored, and why no A/B is owed for it

`paths.include` was applied to directories as well as files, so for any operator who
scoped a review — `include: ['src/**/*']`, the value the configuration and cost
guides both recommend — `repo_grep` and `repo_list` were refused **outright**.
Measured on this repository before the fix:

    grep, no paths      REFUSED        list '.'    REFUSED
    grep paths:['src']  REFUSED        list 'src'  REFUSED
    read 'src/app.ts'   OK

**The search half of cross-file retrieval was non-functional for those operators.**
`repo_read` still worked when the model already knew a path, but nothing could find
one — the grep-then-read loop the capability is built around could not start.

This project measured cross-file retrieval at **+5.7pp recall with 100% adjusted
precision** when it works (`spec16-crossfile-verdict-reversed`). A scoped-include
operator was receiving none of the half that locates code.

**No A/B is owed, and that is not an evasion.** The claim is not statistical. A tool
that returns REFUSED to every call contributes no findings; one that answers can. The
size of the gain for that configuration is not measured here and is not asserted —
what is established is that a capability with a measured benefit was inert for a
documented, recommended configuration and is now live.

**It is invisible to this project's own corpus**, which configures no narrowed
`include`, so no figure in this ledger moves. That is the honest reason it never
surfaced in five days of A/Bs: the eval never exercised the configuration the defect
required.

Recorded here rather than in the measurement entries because it is a different kind
of statement — deductive rather than inferential — and pooling the two kinds is how
"we fixed something real" turns into an unearned percentage.

## 2026-08-07 — Correctness fixes CONFIRMATION: not reproduced (the +5.13pp was noise)

Control `f2a6ee8` vs treatment `0504e49`, **ten seeds per arm**, alternating order.
Provenance exact: 20 runs, 5/5 position balance in each arm, one dependency digest,
one dirty digest, no contaminated run. Rule:
`reports/2026-08-07-defect-fixes-confirmation-prereg.md`; result:
`reports/2026-08-07-defect-fixes-confirmation-result.md`.

| | control | treatment | delta |
| --- | --- | --- | --- |
| recall | 60.6% (sd 4.28pp) | 61.4% (sd 3.68pp) | **+0.77pp** |
| adjusted precision | 98.5% | 97.6% | −0.84pp |
| empty returns | 44 | 48 | +4 |
| genuine false positives | 5 | 8 | +3 |

Paired over 51 expectations: **12 gained, 12 lost, one-sided p = 0.5806.**

**The exploratory +5.13pp / 14–6 was noise.** Every secondary measure that moved
favourably in the exploratory study moved the other way here. Direction, magnitude and
mechanism (D3) were all specified in advance and none appeared.

**This is the day's most valuable result, because of what it prevented.** The
exploratory study looked like a five-point win on every number at once. Claiming it
would have put a false improvement into the published figures, where it would have
become the baseline every later change was measured against.

**It also proves refusing optional stopping was right.** Adding seeds to the original
twelve until p crossed 0.05 — with a true effect near zero and a 14–6 starting point —
would have crossed on some draw and stopped there, manufacturing exactly the false
positive this study prevented.

**The fixes stay** — they shipped on correctness with failing-first tests and were
never contingent on this. They are correct AND they do not measurably improve recall;
both hold at once. **The hypothesis is retired**, and per the pre-registration **no
further seeds will be run on this question**.

### The day's complete measurement record

| change | design | paired result |
| --- | --- | --- |
| authorization-scope clause | 3 seeds/arm | 7 / 8, p = 1.0000 |
| stale precision boundary | 3 seeds/arm | 7 / 8, p = 1.0000 |
| intent-framing clause | 3 seeds/arm | 7 / 7, p = 1.0000 |
| correctness fixes (exploratory) | 6 seeds/arm | 14 / 6, p = 0.1153 |
| **correctness fixes (confirmation)** | **10 seeds/arm** | **12 / 12, p = 0.5806** |

Five pre-registered measurements, five honest negatives, one of which had to survive
looking like a win first. No accuracy improvement was demonstrated, and that now rests
on a properly powered study rather than an underpowered one.

## 2026-08-07 — Correctness fixes re-baselined: favourable, NOT established

Control `f2a6ee8` (before the fixes) vs treatment `0504e49` (three defect fixes, no
prompt text differing). **Six seeds per arm**, alternating order, three runs in each
position per arm, all twelve sharing dependency and dirty digests. Rule:
`reports/2026-08-07-defect-fixes-prereg.md`; result:
`reports/2026-08-07-defect-fixes-result.md`.

| | control | treatment | delta |
| --- | --- | --- | --- |
| recall | 58.0% (sd 3.31pp) | 63.1% (sd 5.22pp) | **+5.13pp** |
| adjusted precision | 97.3% | 98.6% | +1.26pp |
| empty returns | 30 | 28 | −2 |
| genuine false positives | 5 | 3 | −2 |

Paired over 51 expectations: **14 gained, 6 lost, 32 unchanged, exact sign test
p = 0.1153.**

**The pre-registered threshold was p < 0.05, so "the fixes improved recall" is NOT
claimed.** Every number points the same way and none of it clears the bar. Without a
threshold fixed in advance this would have been written up as a five-point win
resting on p = 0.12.

One additional net gain would have crossed: at 20 discordant pairs 14–6 gives 0.115
and 15–5 gives 0.041. That is how close it is, and why a threshold a single
expectation can cross is not a formality.

**Six more seeds were deliberately NOT run.** Adding data after seeing p = 0.115 is
optional stopping and invalidates the test it appears to strengthen. Settling this
needs a fresh, independently pre-registered confirmation treating today's result as
the hypothesis — a different experiment.

**What stands:** the fixes stay (shipped on correctness, retention was explicitly not
contingent on this); no regression (the failure condition, a fall beyond the control's
9.62pp spread, did not occur); and this is the strongest directional signal any change
produced today, against 7–8, 7–7 and 7–7 for the three prompt interventions. Consistent
with a real small improvement, most plausibly from D3 — and consistent with chance at
about one time in nine.

## 2026-08-07 — Intent-framing clause REVERTED, and the real variance (CORRECTS AN EARLIER ENTRY)

Control `f2a6ee8` vs treatment `9ac762e`, 3 seeds, 51-case corpus. **First A/B under
the alternating arm-order rule** — control first twice, treatment first once,
positions recorded. Rule: `reports/2026-08-07-intent-framing-prereg.md`; result:
`reports/2026-08-07-three-nulls-and-the-real-variance.md`.

Recall control 63.5% vs treatment 60.3% — **fell**. Paired: 7 gained, 7 lost, 38
unchanged, exact sign test **p = 1.0000**. Empty returns 15 -> 12, genuine FPs 3 -> 2,
adjusted precision 97.0% -> 98.2%. **Rejected and reverted.** No precision delta is
cited, per the standing restriction.

### THE CORRECTION — the variance figure published earlier today does not hold

The control arm read **53.85 / 67.31 / 69.23%**: a 15.4-point spread on identical
inputs. Four independent three-seed estimates of no-intervention recall now exist:

| arm | mean | sd |
| --- | --- | --- |
| baseline (50c) | 60.8% | 3.92pp |
| authorization control (50c) | 59.5% | 6.30pp |
| boundary control (51c) | 60.9% | 2.22pp |
| intent control (51c) | 63.5% | 8.38pp |

**The estimates span 2.22–8.38pp, a 3.8x spread, for the same quantity.** Pooled over
8 degrees of freedom the sd is **5.71pp**; all twelve no-intervention runs span
53.85–69.23%.

So the claim in the 50-case entry below — that doubling the corpus HALVED the
variance from 7.69pp to 3.92pp — **is not supported**. Both were single three-seed
estimates of a quantity whose estimator varies by 3.8x between samples; 3.92 was a low
draw. Doubling the corpus was still correct, but the evidence offered for it was a
favourable coin, and it was presented as a demonstration.

**Three seeds resolve ~11pp, not ~8 and not ~16.** Detecting a 5-point effect at this
variance needs roughly 20 seeds per arm.

### What the three nulls of 2026-08-07 do and do not establish

All three interventions — weakness-class clause, stale precision boundary,
intent-framing clause — read null with paired p = 1.0000 each. That establishes none
of them produces an effect this setup can SEE. It does **not** establish they do
nothing: the design was underpowered for anything below ~11pp, which is nearly every
realistic change. "Rejected" under their pre-registered rules is correct; "these
ideas do not work" would not be.

**Further prompt-level A/Bs on this corpus are not a productive use of spend.**

**CORRECTION (same day): the "more cases is NOT available" claim in this entry was
wrong.** It rested on the screen's own output without re-reading its rejection
reasons. The screen carried two filters inherited from the analyzer-firing
measurement — it rejected all 33 add-only fixes ("no parent-side line is changed, so
no alert can be attributed", a statement about attribution, not about recall) and all
52 multi-commit advisories (most of which are one fix cherry-picked onto several
release branches). Re-screening recovered **59 candidates**; curators kept 26 at the
same ~45% rate as earlier rounds, the removed-comment gate dropped 6, and the corpus
is now **70 cases / 72 expectations / 44 repositories**. Detail:
`reports/2026-08-07-recovered-from-a-wrong-screen.md`.

**What still stands:** 8pp resolution needs ~149 expectations and 6pp needs ~264, so
72 expectations (sd 5.8pp, resolving ~11.7pp instead of ~13.7pp) is an improvement,
not a fix. Wrong about availability, right about sufficiency.

The only affordable route is **more seeds carried by the paired test**. Extra seeds
barely move the run-level mean's binomial noise — that is set by the number of
expectations — but they sharpen each expectation's own outcome from 0-3 to 0-9, which
is what separates a real shift from the seed noise currently making ~15 of 51 pairs
read discordant in every A/B. Nine seeds x two arms x 51 cases is roughly $22 warm.

The quotable position: this project can measure its LEVEL of security recall — about
**61%** pooled over twelve runs — and cannot currently measure an IMPROVEMENT to it.

## 2026-08-07 — Stale precision boundary: REVERTED, and an ARM-ORDER ARTIFACT found

Control `15b4781` vs treatment `41157ab`, 3 seeds each, 51-case corpus, all six arms
clean and differing only by engine SHA. Rule pre-registered in
`reports/2026-08-07-stale-precision-boundary-prereg.md`; result in
`reports/2026-08-07-boundary-result-and-order-artifact.md`.

**Primary endpoint did not fall.** Empty-return rate 14/153 (9.15%) -> 15/153
(9.80%), inside a control arm whose own seed spread is 2 runs. Rejected on the rule
as written. Guards: recall -0.64pp, adjusted precision +0.03pp, genuine FPs 1 in both.
By depth the target moved (`callee` 27.8% -> 16.7%) but `implementation` moved the
other way (13.9% -> 25.0%) on 18 and 36 observations. Net wash.

The clause contradiction is real and dated (`ac4451a` 2026-06-24 vs `46077ec`
2026-07-31). Resolving it did not reduce silence, so the hypothesis is UNSUPPORTED
rather than disproved — either silence has another cause or this wording is not the
one that resolves it.

### THE ARM-ORDER ARTIFACT — read before citing any precision delta

Both A/Bs today ran `for each seed: control, then treatment`, so **treatment always
ran second**. Raw precision:

| A/B | arm | position | mean | sd |
| --- | --- | --- | --- | --- |
| authorization | control | 1st | .6941 | .0238 |
| authorization | treatment | 2nd | **.7420** | **.0034** |
| boundary | control | 1st | .6608 | .0227 |
| boundary | treatment | 2nd | **.7232** | **.0052** |

**Two unrelated interventions produced the same +5-6pp shift with an
order-of-magnitude tighter sd, always in the arm that ran second.** A treatment
effect does not replicate across unrelated treatments; position does. The cause is
not established and is not guessed at.

Consequences: **no precision delta between arms in this harness may be cited** until
the cause is found — that includes both of today's. Recall appears unaffected (deltas
+0.65pp and -0.64pp, no shared direction) but that is weak evidence, not a clearance.
Interleaving stopped the second arm inheriting a warm COST profile; it does not
randomise POSITION, which this design left fixed.

**Both verdicts stand and are strengthened by this.** The artifact inflates the
treatment arm, so it could only have pushed toward shipping; both A/Bs rejected
anyway, and the first explicitly refused to ship on its precision signal. Had it
shipped on that, it would have shipped on an artifact.

**Required of the next A/B:** randomise or alternate arm order per seed, and record
arm position in the provenance sidecar so this is checkable rather than visible only
when two A/Bs happen to run the same day.

## 2026-08-07 — Authorization-scope prompt clause: REVERTED (null)

Control `b7456ac` vs treatment `b8ad0ec`, 3 seeds each, interleaved, all six arms
sharing dirty digest `e3b0c442` and deps `52d22c48` and differing only by engine SHA.
Corpus as it stood at **50 cases / 51 expectations**. Rule pre-registered in
`reports/2026-08-07-authorization-scope-prereg.md`; result in
`reports/2026-08-07-authorization-scope-result.md`.

| | control | treatment | delta |
| --- | --- | --- | --- |
| recall | 59.5% (sd 6.30pp) | 60.1% (sd 3.00pp) | +0.65pp |
| precision raw | 69.4% (sd 2.38pp) | 74.2% (sd 0.34pp) | +4.79pp |
| precision adjusted | 97.9% | 99.0% | +1.09pp |
| genuine false positives | 2 | 1 | −1 |
| authorization held-out | 3/15 | 4/15 | +1 observation |

**Paired verdict, and it settles the question: 7 gained, 8 lost, 36 unchanged,
exact two-sided sign test p = 1.0000.** The clause did not move the class it names;
it reshuffled findings across mechanisms and depths with no pattern. The +0.65pp
whole-corpus movement is noise against sd 3.0–6.3pp on an instrument that resolves
~8pp, and the authorization "rise" is one seed-observation — exactly what the
pre-registration predicted that denominator could not settle.

**A pre-registered criterion turned out to have a false premise, and it is recorded
rather than quietly reinterpreted.** Criterion 3 required genuine false positives
"not rise above 0", written against the 50-case baseline's 0. The CONTROL arm here
produced 2, so the absolute threshold disqualifies both arms and discriminates
nothing. Literally the treatment fails it (1 > 0); as intended (FPs must not rise) it
passes, having halved them. Neither reading is used to rescue anything — the decision
rests on the paired test and is identical under both. Lesson: state such a threshold
as a change from the control arm of the same A/B, not as a constant copied from a
prior baseline.

**Deliberately not shipped on:** raw precision rose 4.79pp with the treatment arm at
sd 0.34pp, and genuine FPs halved. That is the most consistent signal in the data and
it is NOT a ship criterion — the rule was written about recall, and promoting a metric
chosen after seeing the results is how a null becomes a "win". It needs its own
pre-registration if it is worth pursuing.

**One arm was re-run before any metric was computed.** `treatment-1` first recorded
`engineDirtyFileCount: 10` from an unrelated in-flight commit, which would have put
asymmetric contamination in the treatment arm alone. Re-running before scoring is
what stops the discard decision from being influenced by the result; artefacts kept
as `treatment-1-dirtytree*`.

## 2026-08-07 — Security corpus grows to 51 cases (DENOMINATOR CHANGE — do not pool)

`timeout-redirect-target-taken-from-request-referrer` (heartcombo/devise,
GHSA-jp94-3292-c3xv / CVE-2026-40295) was re-curated into
`eval/corpora/security-advisory-2026` with `securityMechanism: "open-redirect"`.

It had been dropped, not missed: two curators working it independently reached for
two different wrong buckets (`injection`, `ssrf`), and spec 15's rule is that an
advisory with no honest mechanism is a drop rather than a stretch. Adding
`open-redirect` to the vocabulary (metrics version
`2026-08-07.open-redirect-mechanism`) is what made an honest label available.

**The corpus is now 51 cases / 52 expectations (dev 15, held-out 36).** Every
security figure in this ledger computed before this entry was measured on 50 cases /
51 expectations and **must not be pooled with, or differenced against, any run after
it.** The 60.8% / sd 3.92pp baseline immediately below stands as a dated record of
the 50-case corpus; **no recall figure is re-published here, because none has been
re-measured.** Re-running is the only way to get one.

Curation record: the fix (`025fe212`) adds **no prose at all** — no comment, no
string literal — only two one-line code edits, so the reverse-review disclosure
screen has nothing to flag and hydration raised nothing. `lineRange` [139,143] was
verified by printing `lib/devise/failure_app.rb` 130-152 at parent `7ca7ed9c`.
`lib/devise/controllers/store_location.rb` is kept in `reviewedPaths` because a
reviewer of that commit would see it and it discloses nothing; it carries no
expectation. `contextDepth` is `implementation`, not `cross-file`: the minimum
reasoning is knowing `request.referrer` is the client-supplied Referer header. The
checkout was scanned for its own GHSA and CVE identifiers — 0 hits.

## 2026-08-07 — Security recall on advisory-confirmed defects (50-case baseline)

Provider `openai/gpt-5.3-codex`, engine pinned `49f0c669` (0 dirty in all three
runs), corpus `security-advisory-2026` (50 cases / 51 expectations / 33
repositories), 3 seeds. Full report:
`reports/2026-08-07-security-corpus-baseline.md`.

| | seeds | mean | sd |
| --- | --- | --- | --- |
| recall | 60.8 / 56.9 / 64.7% | **60.8%** | **3.92pp** |
| precision raw (lower bound) | 70.5 / 69.0 / 73.3% | 71.0% | 2.18pp |
| precision adjusted (upper bound) | 100 / 100 / 100% | 100% | 0 |
| cost | $3.19 / $1.24 / $1.22 | $1.88 | cold then cache-warm |

**Zero genuine false positives across three seeds and 51 expectations.**

**This supersedes the 25-case entry below, and the two recall figures are NOT a
change.** They measure different corpora. What matters is the variance: doubling the
cases took sd from **7.69pp to 3.92pp**, so the instrument now resolves ~8pp instead
of ~16pp. That was the entire purpose of the second curation round, and sampling
theory says it should have worked; it did.

**Two rows the small corpus got wrong, both worth keeping as worked examples of why
per-mechanism rows are directions:**

- `cross-function` read 9/9 (100%) on 9 observations. On 24 it is 15/24 (62%).
- `cross-file` read 9/24 (38%). On 42 it is **20/42 (48%)** — still the worst row
  with a real denominator, still the largest bucket, and still measured with
  cross-file retrieval already on by default.

**The finding that got worse with better data: `authorization` at 7/18 (39%)**, the
worst substantial mechanism row, in the class spec 15 has said from its first line
carries the majority of real security defects. On the 25-case corpus it was 2/6 and
dismissible.

Full mechanism order: path-traversal 92%, cryptography 80%, concurrency-resource
67%, deserialization 67%, secret-flow 60%, ssrf 60%, injection 48%, xss 48%,
authorization 39%, unsafe-config 0% (3 observations, one expectation — not yet
evidence).

**The dev/held-out gap got LESS significant with more data** — z ≈ 1.82 on 25 cases,
z ≈ 1.39 (p ≈ 0.16) on 50, per-expectation denominators 15 and 36. That is evidence
against the leakage reading. Still not quotable.

**Not comparable to any cross-file-corpus figure.**

## 2026-08-07 — Security recall, 25-case corpus (SUPERSEDED)

Kept as a dated record of how the figure above was reached. Engine `9e410d2`, 3
seeds, 25 cases / 26 expectations: recall **57.7%** (sd 7.69pp), precision bracket
[73.9%, 97.6%], one genuine false positive.

That sd is why the corpus was doubled. A draft of this entry published 61.5% / sd
3.85pp / adjusted precision 100% / zero genuine false positives, from a seed that
had run against a tree carrying 5 dirty documentation files —
`engine-consistency.mjs` refuses to pool on the dirty digest even though the pinned
worktree makes such work provably inert. Re-running it clean returned 50.0%, not
61.5%. Honouring a conservative provenance guard rather than arguing past it moved
the headline 3.8 points and doubled the measured variance.

## 2026-08-07 — Analyzer firing base rate (Mechanism 2 bounded, no A/B run)

Deterministic, no provider calls, no cost. Full report:
`reports/2026-08-07-analyzer-firing-base-rate.md`.

132 advisory-confirmed vulnerabilities, each with a fix commit that deletes or
modifies the vulnerable line, scanned at the vulnerable revision by Semgrep OSS
1.172.0 under twelve public rulesets. An alert lands on a line the fix changed in
**4 (3.0%, CI 0.8–7.6%)**; in **2** does the alert describe the advisory's
weakness.

Mechanism 2 can only act where attribution admits an alert, so its recall lift is
bounded at 3.0pp with perfect conversion against a promotion bar of ≥3pp. The
pre-registered rule's outcome is unchanged — keeps shipping disabled — and now
rests on a measured bound rather than an absent measurement. Not removed: the gate
never failed, and 3.0% is a property of Semgrep OSS, not of the mechanism.

**No A/B was run and none should be.** Three seeds per arm to resolve an effect
bounded at four cases spends money to decorate a conclusion the bound already
fixes.

**A first pass using `p/security-audit` alone returned 0/132 and was wrong** — that
ruleset fired on 4 of 10 blatant sinks in a control file. Validate an analyzer
configuration against a control before reporting a null.

## Standing caveats for reading anything here

- **Variance.** sd ≈ 4.8pp on this corpus. An effect below roughly 10pp cannot be
  resolved at n=3. Several arms above are smaller than the instrument.
- **The blended recall figure is not interpretable on its own.** 42.5% of
  expectations lie in unchanged code; the blended number depends on that ratio
  rather than on reviewer quality. Read the in-diff and out-of-diff rows.
- **Adjusted precision is an estimate, permanently.** Under an incomplete answer
  key, precision is not identifiable — raw precision is the lower bound and
  adjusted the upper. Report the pair.
- **Every run recorded above was produced by an UNPINNED engine.** The harnesses
  pinned the repository under test but invoked the engine from the live working
  tree, so a commit landing mid-sweep changed the instrument mid-measurement —
  which happened, five times, during the 2026-08-01 uncapped re-measurement.
  Those particular runs were argued inert afterwards and by hand; nothing in any
  scored artefact recorded which engine produced it, so no other entry here can
  be checked at all. Fixed 2026-08-01 for all stages (`.codereviewer/eval/`:
  `engine-pin.sh` pins a detached worktree at a SHA resolved once per sweep,
  `pinned-run.sh` wraps every stage's CLI, and both scorers now refuse to pool
  cases whose `engine.json` sidecars disagree). **Runs predating the fix carry no
  sidecar and are reported as unknown-engine, not as agreeing.** Treat small
  deltas above as correspondingly weaker.

## 2026-08-07 — Security corpus grown to 70 cases from a wrong screen ($0 provider spend)

`eval/corpora/security-advisory-2026`: **51 → 70 cases, 52 → 72 expectations, 34 → 44
repositories**, held-out/dev 52/18. All ten security mechanisms and all seven
languages still covered; `callee` (8) and `caller` (3) — the depths the silence
analysis singled out — both gained.

Recovered by re-screening two rejection classes that were correct for the
analyzer-firing measurement and wrong for a recall corpus:

| rejection class | recovered | curators kept |
|---|---|---|
| "fix only ADDS lines; no alert can be attributed" | 32 | 16 |
| "advisory references more than one fix commit" | 27 | 10 |

A pairwise ancestor test correctly refused **8** as genuinely staged fixes, where one
`fixCommit`/`parentCommit` pair would show the reviewer half the defect. Keep rate
44%, matching rounds one and two — these were ordinary material, not scrapings.
**Curators dropped zero add-only candidates for "no defect in the parent"**: that
exclusion was wrong on the merits, not at the margin.

Integrity: two curators keyed different sites of the same russh fix, merged to one
case with two disjoint expectations; the hydrator's removed-comment gate dropped 6
more after curation (3 unambiguous, 3 under a conservative default); the independent
self-disclosure sweep reports **0 of 70** checkouts naming their own advisory.

**No recall figure is published here.** The ~61% baseline describes the 51-case
corpus and is not comparable across a corpus change; a re-baseline is owed before any
figure is quoted against this corpus.

## 2026-08-07 — Sub-file partitioning REJECTED, and the 70-case baseline ($42.41)

Control `359161b` vs treatment `45a75da`, 10 seeds/arm, alternating order, **5/5
position balance in each arm**, `dirty=0` on all twenty runs, one dependency digest.
Corpus `security-advisory-2026` (70 cases / 72 expectations / 44 repositories at run
time; one further case was re-admitted afterwards on review, see below), model
`openai/gpt-5.3-codex`. Detail: `reports/2026-08-07-subfile-partitioning-result.md`.

| | control | treatment |
|---|---|---|
| recall | **64.0%** (sd 2.22pp) | 61.1% (sd 4.68pp) |
| adjusted precision | 95.0% | 96.9% |
| raw precision | 72.9% | 58.4% |
| genuine false positives | 25 | 14 |
| discovery calls | 710 | 1260 (**1.77x**) |
| raw findings | 886 | 1494 (+69%) |
| spend | $18.42 | $23.99 (**1.30x**) |

Paired over 72 expectations: **11 gained / 23 lost, two-sided exact p = 0.0576** —
against the treatment. Not promoted; **code removed** (spec 27 now records the
finding in place of the design).

**Why it fails is the interesting part.** The predicted harm landed exactly
(`cross-function` 82.4% → 71.2%). The predicted GAIN never appeared: `local` 86.7% →
83.3% and `implementation` 51.1% → 49.4%, both down, when both were named in advance
as the depths that would rise. Narrowing what a call is shown does not buy recall even
on defects wholly inside the narrowed region. With raw findings up 69% and adjusted
precision up while genuine FPs nearly halved, the extra looks find MORE real defects
and FEWER of the advisory's — a ranking problem, not an attention problem.

### The 70-case baseline, from the control arm at no extra cost

**Security recall 64.0% (sd 2.22pp), adjusted precision 95.0%**, 10 seeds, engine
`359161b`, `openai/gpt-5.3-codex`. This SUPERSEDES the ~61% figure, which described
the old 51-case corpus and was never comparable to this one. The control engine
carried the sub-file feature inert (unset was proven byte-identical by test), so this
figure transfers to `2203bf7` where the feature is gone.

Per-depth, control arm: `local` 86.7%, `caller` 90.0%, `cross-function` 82.4%,
`callee` 62.5%, `implementation` 51.1%, `cross-file` 49.3%,
`analyzer-path-dependent` 0%. Per-mechanism: `path-traversal` 94.4% and
`concurrency-resource` 69.3% at the top; `xss` 40.0%, `ssrf` 54.0%, `injection` 55.0%
and `authorization` 63.3% below the mean.

### Attention is now closed as a line of work

| mechanism | result |
|---|---|
| second, differently-framed pass over the same context | +0.83pp, p = 0.82, removed |
| one file per call | 46.5% → 46.5%, +36% cost |
| four prompt clauses | all null |
| **splitting the file itself** | **−2.9pp, 11/23, p = 0.058, removed** |

### Corpus amendment after that run: 71 cases / 73 expectations

`watch-range-end-rewritten-before-permission-check` (etcd) was re-admitted with a
`removedCommentDisclosureReview`. It had been dropped by the removed-comment gate
under a conservative default; adjudicating it against the real diff showed the fix
RELOCATES the `RangeEnd` rewrite block from before the permission check to after it,
carrying its two comments unchanged. Those comments explain nil-vs-`[]byte{}`
semantics in `watchstream.Watch` and say nothing about the permission check, which is
the defect. Gate false positive, not disclosure.

Corpus is now **71 cases / 73 expectations / 45 repositories**, dev 18 / held-out 53.
The 64.0% baseline above was measured on the 70-case corpus and is NOT restated
against 71; the next run re-establishes it.

**A defect this exposed, and the guard that now closes it.** The manifest committed at
`303dde5` FAILED its own schema — the screening note ran 1254 characters against a
1200 bound — and nothing caught it: the suite was green, the drift check was green,
and the only test that parsed a committed manifest named `real-repo-cross-file` by
hand. A corpus manifest is invisible to the suite until someone hydrates it, and
hydration is not part of the suite. `real-repo-corpus.schema.test.ts` now DISCOVERS
every directory under `eval/corpora/` and parses each with a declared parser, so a new
corpus fails until its coverage is declared rather than being silently skipped.

## 2026-08-08 — What the reviewer says INSTEAD ($0, from the control runs)

259 missed expectation-observations across the 10 control runs. Detail:
`reports/2026-08-08-what-it-says-instead.md`.

| | share |
|---|---|
| spoke only in other files | 28.2% |
| **real but NON-SECURITY defect, same file** | **18.9%** |
| duplicate / inconclusive, same file | 17.0% |
| discovery spoke, nothing survived the pipeline | 16.6% |
| discovery returned nothing | 15.4% |
| genuine false positive, same file | 2.3% |
| **competing real SECURITY defect, same file** | **1.5%** |

**61 of the 103 same-file misses put a finding INSIDE the expected range**, and the
nearest finding was categorised `bug` 78 times against `security` 15.

**The reviewer reads the right lines and describes a correctness bug where a security
defect is.** Not retrieval (file open), not attention (finding on the defect's own
lines), not volume (it produced one), not matcher strictness (genuinely different
defects). Only 1.5% of misses are it choosing a competing security defect, so this is
not security judgement exercised differently — it is security framing not applied.

**Bucket-semantics warning, now cost four figures in this project.** The eval report's
finding arrays OVERLAP: `unlistedRealFindingIds` is a SUBSET of
`falsePositiveFindingIds` (15/15 cases). Classify findings by ID-SET membership and
dedupe by `findingId`; never by which array they appear in. Two earlier versions of
this analysis reported 68.7% silence and a 39.8% "non-real finding" category. Both are
artefacts. True silence is 15.4% and the non-real category does not exist.

## 2026-08-08 — Impact-framing clause REJECTED ($29.26)

Control `0dcfeb8` vs treatment `a9d24b3`, 10 seeds/arm, alternating order, 5/5
position balance, `dirty=0`, 0 provider errors, 71 cases / 73 expectations. Detail:
`reports/2026-08-08-impact-framing-result.md`.

| | control | treatment |
|---|---|---|
| recall | 63.8% (sd 3.66pp) | 62.5% (sd 3.66pp) |
| adjusted precision | 97.7% (sd 3.10pp) | 97.0% (sd 3.19pp) |
| genuine false positives | 11 | **14** |
| discovery calls | 720 | 720 (**1.00x**) |
| raw findings | 893 | 844 |

**16 gained / 16 lost, one-sided exact p = 0.5700.** Fails criterion 1 (p) and
criterion 3 (genuine FPs must not rise). Rejected and reverted; the branch is deleted.

**Why this null is worth more than the six before it.** The diagnosis behind it was
measured, specific and correct (61 of 103 same-file misses inside the expected range,
`bug` 78 vs `security` 15); the clause attached to WRITING a finding rather than to
searching, which is what separated it from the four prior security interventions; and
it cost nothing at all. It still moved nothing. **Knowing precisely where the failure
is did not make it fixable by instruction.**

**Prompt-level instruction is now a closed family.** Five prompt interventions measured
against pre-registered rules — weakness-class, precision-boundary, intent-framing, the
correctness-fix confirmation, impact-framing — with paired splits **7/8, 7/8, 7/7,
12/12, 16/16**. Five coin flips from five different angles. Do not run another
prompt-level A/B on this corpus without evidence that overturns that table.

## 2026-08-08 — Token/speed audit: no cheap win ($0, from the control runs)

Warm run structure, 71 cases: **$1.47/run**, input:output **~70:1**, cache median
**81%** (min 34%, max 98%), uncached tokens per case median **3,142**. 23% of cases
carry 50% of spend. Detail: `reports/2026-08-08-token-and-speed-audit.md`.

The apparent outlier — one case at $0.229/run with 41% cache against a LARGER sibling
at 96% — is **not a defect**. Two hypotheses tested:

- **refutation packets poison the cache: DISPROVED.** correlation(refutation calls,
  cache) = −0.272; correlation(raw findings, cache) = −0.206. Too weak.
- **arithmetic + shared-file ordering: CONFIRMED.** correlation(log input size, cache)
  = +0.518, and five corpus paths are reviewed by more than one case.
  `jsonschema.py` is reviewed by four, whose cache rates in run order are **41.3%,
  94.0%, 95.8%, 92.7%**. The first case over a shared file absorbs the cold cost its
  siblings ride for free.

**Cache tuning is not a lever** and **per-case cost attribution is misleading whenever
cases share a reviewed file**. Do not re-investigate without new evidence.

### Corpus amendment 2026-08-08: 72 cases / 74 expectations

`radar-tick-count-accepted-without-upper-bound` (mermaid) re-admitted with a
`removedCommentDisclosureReview`, after adjudicating it against the real diff rather
than the quoted fragment. The flagged comment —
`// Can't see people using more than this, since the gradient makes the diagram
unreadable.` — sits above `const MAX_TICKS = 32` and explains why the bound is 32, an
aesthetic rationale about legibility. It says nothing about the defect (an unbounded
caller-supplied tick count driving unbounded work). That a bound is removed at all is
visible in the reviewed diff, which is true of every reverse-reviewed case and is the
signal the corpus is built on, not contamination.

**The undici cookie case stays dropped, and the boundary is worth recording.** Its
added prose is a full RFC-1034 grammar docblock specifying the domain syntax the fix
validates. A reviewer reading a removed `validateCookieDomain` docblock is handed the
check itself, not merely told a check existed. The line therefore falls between
*prose about unrelated mechanics* (etcd: nil-vs-`[]byte{}` semantics — admitted),
*prose giving a magic number's rationale* (mermaid: readability — admitted), and
*prose specifying the removed validation* (undici — dropped).

All three conservative contamination drops are now individually adjudicated; none
remains on the default.

**Corpus is 72 cases / 74 expectations / 46 REPOSITORIES**, dev 18 / held-out 54.
The commit message for `be06e1d` says 45 repositories; that is wrong — re-admitting
the mermaid case added a repository and the count was not re-derived. 46 is the
figure, recomputed from the manifest.

## 2026-08-08 — The eval could not compare models at all ($0)

Found while setting up a model comparison, and it stopped the run before any spend.

`eval run` resolved the semantic match judge AND the plausibility judge from **the same
model alias as the reviewer under test**, with no separate judge configuration. So
setting `CODEREVIEWER_PROVIDER_MODEL` to compare two reviewer models also swapped the
scorer. A recall difference then had two indistinguishable explanations — a weaker
reviewer, or a weaker judge crediting fewer correct findings — and adjusted precision
had the same problem because the plausibility judge moved too.

**Every model comparison this project has run was uninterpretable on its recall side.**
That includes the 2026-07-25 codex-vs-terra comparison, whose "codex finds MORE total
real defects" conclusion is therefore SUSPECT. Its harness is no longer on disk, so it
cannot be confirmed either way; it must not be cited as evidence about reviewer quality
until re-run against a pinned judge. Its COST comparison is unaffected — spend is
measured, not judged.

Fixed at the root:

- `evaluation.judgeModel` (env `CODEREVIEWER_JUDGE_MODEL`) pins the judges independently
  of the reviewer. Unset resolves the *same object* as today, so the default path is
  byte-identical and no metric moves.
- `provenance.judgeModelName` is recorded on every provider-backed run, so a saved
  report can say which judge scored it.
- `scoringCostUsd` is now priced with the judge's model, since those tokens are spent by
  the judges.
- **`eval compare` refuses arms scored by different judge models** and names them. An
  archived report carries no `judgeModelName`, and on those runs the judge WAS the
  reviewer's model, so `modelName` is the fallback identity — archived reports stay
  comparable with each other and with a pinned run naming the same model, while a
  genuine mismatch is refused.

`EVAL_METRICS_VERSION` deliberately NOT bumped: an unpinned run resolves the identical
alias it always did, so no metric changes for identical review output.

**Also recorded: there is no better model available on this key.** The engine already
runs `gpt-5.3-codex`, the newest codex tier reachable. The open accuracy question is
therefore "how much of the 64% is the model", which needs the pinned judge to answer,
not "switch to something better".

## 2026-08-08 — Reviewer model comparison, JUDGE PINNED ($10.62)

The first model comparison this project could interpret. Engine `10f08d4`, 3 seeds/arm,
alternating order, `dirty=0`, 0 provider errors, 72 cases / 74 expectations.
**Judge pinned to `gpt-5.3-codex` in BOTH arms** (verified per report in
`provenance.judgeModelName`). Detail:
`reports/2026-08-08-model-comparison-result.md`.

| | `gpt-5.3-codex` | `gpt-5-mini` |
|---|---|---|
| recall | 63.1% (sd 3.40pp) | 65.8% (sd 0.78pp) |
| adjusted precision | **97.9%** (sd 2.04pp) | **91.9%** (sd 2.60pp) |
| raw precision | 73.7% | 45.7% |
| genuine false positives | **3** | **13** |
| raw findings | 260 | 506 |
| spend | $2.38/run | **$1.16/run (0.49x)** |

**20 gained / 18 lost, two-sided exact p = 0.8714.** Fails criterion 1 (p) and criterion
2 (adjusted precision fell 6.0pp against a 2.04pp control spread); passes the cost gate
at 0.49x. **Not recommended as the default** — but a real operating point for cheap,
high-recall, noisy triage, and worth documenting as a supported configuration.

**The finding that matters most:** the corpus's 63–66% recall is **not a property of the
top-tier model**. A model roughly an order of magnitude cheaper reaches the same recall
with the same prompts, the same corpus and the same judge. With attention (4 mechanisms)
and prompt instruction (5 clauses) already closed, **recall here is bounded by something
neither model tier, nor attention, nor wording moves.**

Caveats: 3 seeds resolve ~11pp, so recall is UNRESOLVED rather than equal; position
balance is 2/1 not 5/5; and `gpt-5.1-codex-max` is unusable on this key (listed by
`/v1/models`, 404 on chat-completions), so the STRONGER-tier question remains open.

## 2026-08-08 — Test-adequacy signal measured for the first time ($0, deterministic)

Against `reports/2026-08-08-test-adequacy-prereg.md`, budget registered before the
numbers existed. 200 self-repo commits. Detail:
`reports/2026-08-08-test-adequacy-result.md`.

| metric | measured | budget | |
|---|---|---|---|
| firing rate | **56.5%** (113/200) | ≤ 40% | fails |
| median unpaired when fired | 2 | ≤ 5 | passes |
| usefulness (objective proxy) | **≤ 16%** | ≥ 50% | fails |

**NOT promoted to the pull-request summary.** Stays in `report.json` / `report.md`,
never a finding — the placement spec 29 already had, now confirmed by measurement
instead of assumed. Removal clause (firing > 80%) not met.

**The finding that matters: 95 of 113 firings (84.1%) are on commits that changed a
test file.** Both pairing relations require a shared normalized stem, so a source
file never pairs with a differently-named test beside it — `intake-service.ts` does
not pair with `repository-intake.test.ts`. Three commits from this session's own
work are among the firings, and all three shipped tests.

Loosening pairing to any-test-in-directory was refused: it would convert a failed
pre-registered bar into a pass, go near-silent in repositories with a top-level
`tests/` tree, and is unmeasured.

Separately, **45.6% of changed files (703/1541) land in `unknown`** and 70 of 200
commits contain no considered file at all — the signal's real scope is far narrower
than "changed files", and its firing rate must always be read against that.

## 2026-08-08 — The finding fingerprint could not survive a re-review ($0, from data on disk)

Measured from the ten control runs of the sub-file A/B — same engine, same corpus,
same cases, no new spend.

The `v2-category-path-title-anchor` fingerprint hashed the model-written **title**.
Titles are rewritten almost every run:

| | |
|---|---|
| cases with findings in ≥2 of 10 identical runs | 23 |
| identical `(category, path, title)` set every run | **1 (4%)** |
| set VARIES across runs | **22 (96%)** |

On every example inspected the intersection was **zero** — not one title recurred
across ten runs of the same commit. Sample: *"preflight header parsing can emit an
empty allow-header token"* / *"…can emit empty header tokens"* / *"…can emit invalid
empty allow-header entries"* / *"…can emit invalid empty allow-header token"*.

**Two shipped features depended on that fingerprint being stable and therefore did
not work:**

- **Baseline resolved-detection** — an untouched, unfixed finding took a new
  fingerprint on the next push, so the baseline reported it **resolved** and the same
  defect **new**, in the same run.
- **Inline-comment dedup across pushes** — the marker fingerprint changed, so the
  same comment re-posted on every push instead of deduplicating.

Fixed by removing the title: `v3-category-path-anchor`. That restores the behaviour
the module's own comment always claimed — *"editing the anchored line itself does
change the fingerprint, which is the intended signal that the finding was
addressed."* Two findings sharing category, path and anchored line now collapse to
one; the semantic merge upstream exists for exactly that case.

**Method note.** The first attempt at this measurement compared `matchedFindings`,
which carries no `category` or `title` field, and returned a clean **0% instability**
— it had compared `(None, path, '')` tuples. The real fields live on
`unlistedRealFindings`. A measurement that returns a suspiciously perfect answer is
worth re-reading before it is believed.

## 2026-08-08 — Impact corpus harvest: 3 candidates, and a rate 75x better than the bulk sweep ($0)

Targeted `gh search commits` over 405 commit bodies / 59 repositories; ~92 resolved
against the corpus invariant (repaired file OUTSIDE the introducing commit's diff).
Detail: `reports/2026-08-08-impact-corpus-harvest.md`.

**3 candidates** — rust-lang/rust (whole-repo-search, silently wrong codegen-unit
estimate), microsoft/vscode (caller-of-changed-symbol, two untouched callers falling
back to the wrong model), and a bevyengine/bevy case flagged rather than dropped
because `.wgsl` is outside the 7 supported languages.

**The efficiency comparison is the finding:**

| | bodies | yield | rate |
|---|---|---|---|
| original corpus (bulk sweep) | 101,542 | 10 cases | 1 per 10,154 |
| this harvest (targeted) | 405 | 3 candidates | **1 per 135** |

~40 more candidates needs roughly **5,400 bodies**, not 406,000. **Wave 1.2 is
unfinished, not blocked** — 13x more of a method already proven to run. The rate will
decay as the best phrases and repositories are spent, so 5,400 is a floor on effort
rather than an estimate of it.

Recorded because the first reading was "poor yield, method exhausted" — the same
error as the corrected "pool is exhausted" claim of 2026-08-07, caught this time by
doing the division before writing the conclusion.

**Structural: ~55 of ~92 resolved candidates are same-file self-corrections** — the
fix repairs a file already inside the introducing commit's diff. Correctly rejected
(stage 1 covers in-diff), and the single biggest reason this ground truth is scarce.
It does NOT show cross-file breakage is rare; it is equally consistent with such
breakage rarely being ATTRIBUTED in a commit message, which is the reading spec 22
already records. **Java produced zero hits across 30 Apache-2.0 repositories.**

**Wave 2.1 stays gated.** At 11 proven dependents one expectation moves a rate ~20
points, so spec 22's promote bar (precision >= 50%, recall >= 40%) cannot be reached
OR failed. Two candidates take it to ~13; continuing the harvest is the fix.

## 2026-08-08 — Wave 2 is instrument-limited on both halves ($0 precheck)

Arithmetic over figures already in this ledger, run BEFORE designing either study.
Detail: `reports/2026-08-08-wave-2-measurability.md`.

**2.1 impact adjudication** — spec 22's bar is precision >= 50%, recall >= 40%. At
**11 proven dependents** one expectation moves a rate ~20 points, so the bar can be
neither reached nor failed. Gated on the harvest.

**2.2 intent calibration** — the precheck splits this into two endpoints:

| endpoint | change under test | N | sd | resolvable |
|---|---|---|---|---|
| `not-contradicted` firing rate | ~2% -> ~40% (38pp) | 436 obligations | <= 2.34pp | **yes** |
| LIST precision | 53.5% -> 60% (6.5pp) | ~126 statements | 4.44pp | **no** (~9.0pp) |

A study can show whether the clause makes the verdict FIRE; it cannot show whether
firing improves PRECISION, which is what the 60% bar is about. Reporting the firing
rate against that bar would answer the easy question and quote it against the hard
one — the denominator-substitution error corrected twice in two days. Intent's 87%
self-agreement ceiling puts a further 13% of run-to-run noise under a 6.5pp target.

**Thresholds recorded so nobody re-derives them:** 2.1 needs ~40 more proven
dependents; 2.2 needs ~240 statements (roughly double today's ~126) to resolve 6.5pp.
Both are curation, not research.

### Continuation harvest (same day): 11 more candidates, rate 6.7x worse, projection missed

**11 new from 9,987 bodies** (~8,493 repositories); running total **14 from 10,392**.

| run | bodies | candidates | rate |
|---|---|---|---|
| targeted, curated repo list | 405 | 3 | 1 per 135 |
| global search | 9,987 | 11 | **1 per 907** |

**The "~5,400 bodies for 40 candidates" projection above was optimistic by 6.7x**; at
the observed rate it is ~36,000. It held only because it was published as "a floor on
effort, not an estimate" — the caveat was right, the headline was not, and the number
must not be quoted alone.

**The reusable finding:** the best phrases scoped against **61 flagship projects**
(vite, fastapi, tokio, ripgrep, helm, tauri, etcd, …) returned **zero hits on 233 of
244 queries**. Explicit regression attribution is a small-and-mid-project commit
convention. The largest repositories are the WORST place to look for this ground
truth — the opposite of where a harvest instinctively starts.

**Wave 1.2's target is not met.** 14 candidates at ~45% curation is ~6 cases, taking
11 proven dependents to ~19 against a bar needing ~50.

### Curation: 9 of 14 candidates kept — but only 2 SURVIVED HYDRATION

**CORRECTION, same day.** The heading below and the "10 -> 19 cases, 11 -> 25
dependents" figure are WRONG and were published before the corpus was hydrated. The
hydrator's contamination gate then rejected **7 of the 9 new cases**, because none of
them recorded a `removedCommentDisclosureReview` judgement for the prose comments
their reviewed diffs remove.

**The real hydratable corpus is 12 cases / 13 dependents**, not 19 / 25. The schema
accepted the manifest; only hydration catches this, and I merged and published on the
schema check alone.

The 9 cases are real and verified — they are unfinished, not wrong. Finishing them
means a curator adjudicating each removed comment. The root cause is my curation
brief, which specified the output shape and the disclosure rule but never said that
field is mandatory.

Every kept case independently re-verified against live GitHub: each `lineRange`
printed from the introducing commit's own tree, each fix-commit quote resolved to the
exact introducing SHA, and `Q ⊄ P` disjointness confirmed from paginated file lists.
Merged manifest passes `parseChangeImpactCorpusManifestJson` — 19 cases.

Reachability spread: caller-of-changed-symbol 9, callee-of-changed-code 2,
whole-repo-search 2, attribute-owner 1. Languages: typescript 2, java 2, javascript
2, rust 2, python 1 — **go and ruby yielded no survivors**.

**Five dropped, and the reasons are the useful part:**

- **3 out of scope by language** — bevy (`.wgsl`), cilium (BPF `.c`), and
  ostsee-tiere, which curation disqualified on its own re-check when its only two
  traced dependents turned out to be `.svelte`.
- **1 with no honest `compatibilityClass`** — rust-lang/rust, which the harvest
  called its strongest find. Mechanically solid, but the damage is a compile-time
  performance regression caught by perf-CI within hours, not a functional break;
  forcing it into `breaks-at-runtime` would have manufactured a category fit.
- **1 with no admissible dependent** — codehydra: all six claimed dependent files
  return 404 at the introducing commit's own tree (created later by a file split),
  and the pre-split equivalent is itself inside `reviewedPaths`.

**Wave 2.1 remains blocked.** 25 dependents against a bar needing ~50: better than
the ~19 projected, still not resolvable.

## 2026-08-08 — Spec 31 feasibility gate: population built, agreement study running ($0 provider)

Population for the design-judgment gate: **30 candidates** where a maintainer objected
to the APPROACH and the author's follow-up push changed the design accordingly.

Screening: 1,371 PR search hits → 322 in repositories passing a
licence/star/fork/archived filter → **all 322 read in full, not sampled** → 41
qualified → 30 kept (11 held in a disclosed reserve, trimmed for provenance, weak
objection→fix causality, and a per-repo diversity cap).

21 repositories, 13 languages (TypeScript 8, Python 4, Ruby 3, Go 3, Rust 2, Lean 2,
JavaScript 2, and one each of Swift, Kotlin, Julia, Haskell, C++, Nextflow). MIT,
Apache-2.0 and BSD-3-Clause only.

Rejections: false-hit-no-real-objection 111, bot-reviewer 39, inaccessible 34,
objection-not-accepted 28, no-followup-push 16, **bug-report 12**, style-only 7,
question-only 5, other 30. That bug-report count is the population's main validity
threat and it was screened for explicitly.

**A methodological trap caught before the sweep:** the obvious query qualifier
`review:changes_requested` reflects a reviewer's CURRENT state, so a maintainer who
objected and then approved once the design was fixed — which is exactly this
population — would have been excluded. Corrected before nearly all queries ran.

**Five candidates recorded as genuinely ambiguous** between design objection and
defect report, counted nowhere. One is a design objection whose review body
self-attributes it to an AI model posted under a human account: it passed the
mechanical bot filter but is not organic human judgement, and is flagged as a limit
of that filter rather than as a false negative.

Two curators are now answering all 30 independently, each blind to the other and to
the maintainer's words, which are withheld from their input by construction. The
pre-registered thresholds (>= 70% build a corpus, 50-70% record and stop, < 50% the
lane is not built) were fixed in spec 31 before any of this existed.

### The first agreement run was INVALID, and a curator caught it

**My defect.** I built the curators' input by stripping `reviewerObjectionVerbatim`
and `whatChangedVerbatim` from the candidate records — and left the `id`, which the
harvest had written as a descriptive slug:

```
postgrest-postgrest-5125-loggerstate-encapsulation
harttle-liquidjs-863-token-template-layering-violation
leanprover-community-physlib-1425-distribution-folder-misplaced
juliamolsim-dftk-jl-1099-avoid-special-casing-gpu
```

Those **are** the objections. Both curators saw them as the primary key of their own
input, so any agreement between them is inflated by a shared hint and says nothing
about whether design objections are independently identifiable. **Run 1 is discarded,
not adjusted** — a contaminated agreement rate cannot be corrected downward by
argument.

Curator B reported it unprompted, as a threat to the study it was participating in,
having independently verified each case against the code anyway. Curator A separately
self-reported one case where the maintainer's text reached it through an unfiltered
`pulls/reviews` fetch. **Both disclosures came from the instruction that a labelled
contamination is usable and an unlabelled one is poison** — without it, the study
would have produced a clean-looking number built on a leak I introduced.

Re-run under way with neutral `case-01`…`case-30` identifiers and an explicit
do-not-open list covering the answer key, the old leaky input, and the other
curators' files. Spec 31's thresholds are unchanged and were fixed before any of
this existed.

**The generalisable lesson: redaction must be verified by reading what the subject
actually sees, not by listing the fields you removed.** I checked my own redaction
against my intent rather than against the artefact.

## 2026-08-08 — Spec 31 gate FAILED: the design-review lane is not built ($0)

24 scorable cases of 30. Thresholds fixed in spec 31 before the population existed.

| measure | result | band |
|---|---|---|
| curator vs curator (strict `same`) | 54.2% (13/24) | 50–70% |
| curator One vs maintainer (`match`) | **41.7%** (10/24) | **< 50%** |
| curator Two vs maintainer (`match`) | **41.7%** (10/24) | **< 50%** |

The maintainer comparison is the binding threshold and it fails the FLOOR, so the
rule applies in its strongest form: **not built, now or later, without new evidence.**
Not advisory-only, not behind a flag — spec 31 refused the "advisory is harmless"
argument in advance, because output wrong at this rate trains readers to ignore a
surface it shares with findings that hold up ~96% of the time.

**The population was not the problem.** The key judge marked **0 of 24** cases
`not-a-design-objection`: every maintainer comment was a genuine design objection.
Two blind curators, independently, recovered the maintainer's actual objection at
*exactly* the same rate — and failed differently. Curator Two skewed `partial` (right
area, different mechanism); Curator One skewed `miss` (a genuinely unrelated defect in
the same diff). **A design objection is one of several defensible readings of a diff;
the maintainer's is authoritative only because they are the maintainer.**

`case-08` is the result in miniature: the maintainer wrote *"I also have a few issues
with the proposed code structure … will review more later"*. The ground truth is
partly unstated in the source it comes from.

**Looser definitions clear the bar and were not used:** curator-curator
`same`+`related` = 83.3%; curator Two `match`+`partial` = 75.0%. Both were available
before the strict numbers were known, which is exactly why the strict definitions were
written into the judges' briefs in advance. Choosing afterwards is the error corrected
three times in the preceding two days.

**Two by-products.** Design ground truth DECAYS — 3 of 30 pre-review commits were
garbage-collected, one going from fetchable to 404 within a single session, which
advisory ground truth never does. And blind curators say "nothing to object to"
while hinted ones do not: the invalidated leaky run had 0 `NO_OBJECTION_FOUND` and
19/30 high confidence; blind, that became 3 and 8/30.

## 2026-08-09 — Impact adjudication measured; NOT promoted; my prereg's premise was wrong

Engine `8f54399`, clean tree, `openai/gpt-5.3-codex`, 16 cases / 17 proven dependents,
**118 model calls** — the session's only provider spend. Detail:
`reports/2026-08-09-impact-adjudication-result.md`.

| | deterministic | adjudicated |
|---|---|---|
| destination files predicted | 154 | **15** |
| of those, proven dependents | 8 | **2** |
| precision | lower bound 5.2% | lower bound 13.3% |
| **directly-reachable recall** | **50.0%** (5/10) | **0.0%** (0/7) |
| whole-repo-search recall | 42.9% (3/7) | 50.0% (2/4) |

**NOT promoted; stays disabled.** Recall on the promote population is 0 of 7, against
a 40% bar.

**The precision bar is undecidable here and I should not have run this to find out.**
The key lists dependents an upstream fix REPAIRED, not every affected file, so only a
lower bound is computable at any size. My pre-registration argued from a confidence
interval that 17 dependents made the bar reachable — meaningless arithmetic on an
unbounded-above metric, contradicting the 2026-08-06 entry that says exactly this,
which I had quoted the same day. Spec 22 now records the bar as unfalsifiable on this
corpus.

**The real finding:** adjudication cut 154 predictions to 15 and both survivors are
`whole-repo-search`, the weakest class. It scored **0 of 7 directly reachable**, where
the deterministic tier found 5 of 10. That is not the recall-for-precision trade spec
22 anticipates; it is discarding the class the capability exists to report.

**Model tier NOT removed:** it beats the deterministic arm on precision (5.2% ->
13.3%), and 8 of 16 cases spent zero model calls with 28 pairs never adjudicated, so a
0% reading is not clean evidence about the judge. No re-run — the prereg committed to
one, and re-running cannot bound a metric that is unbounded by construction.

## 2026-08-09 — Wave 2.2 closed by disclosure, not by a study ($0)

The plan offered two routes: one pre-registered fix attempt at the 60% LIST-precision
bar, or *"label the lane's measured confidence in its output instead of chasing the
bar"*. The precheck had already shown the bar unreachable at ~126 statements (resolves
~9.0pp against a 6.5pp target), so the second route is the one that could be honestly
taken.

The intent report already disclosed two measured error rates. It did **not** disclose
its **87.0% self-agreement** — while the review report has said for months that two
runs over one commit disagree. Intent is the *less* reproducible of the two lanes and
was the one staying quiet about it.

Now stated where the reader is: two runs over the same change agree on about **87%** of
verdicts, and that figure **caps every other rate in the report** — a stage cannot be
more accurate against a change than against itself. Transcribed into
`measuredIntentReliability` with the counts (40/46) and derived for prose, so a
re-measurement moves both or neither.

No provider call. A prompt A/B here would have joined the five already-null clauses and
could not have resolved its own endpoint.


## 2026-08-10 — Candidates carry no evidence, so "prove it" has nothing to check

`openai/gpt-5.3-codex`, engine `a9a13fb`, `security-advisory-2026` (72 cases, 0
provider errors), one seed. **$3.93 seed + $0.24 smoke = $4.17 measured.** Full
write-up: `reports/2026-08-10-artifact-only-separation-result.md`, pre-registered in
`reports/2026-08-10-artifact-only-separation-prereg.md`.

Replicates the archived baseline — recall 63.5% (archived 63.1%), artifact-only
recall 10.8% (archived 10.4%), adjusted precision 97.9% — so it measured the same
thing.

**No separator claimed.** The artifact-only population is 8 real / 4 noise at n=12.
Severity and category split proportionally, `hasFixProposal` is false for all twelve.
Per the pre-registration nothing is concluded in either direction.

**The mechanism, measured across all 78 produced findings and verified in code:**
`evidenceCount` is 1 for 78/78 and `proposedBy` is `review-agent` for 78/78.
`enrichProvedCandidate` unions the refutation's evidence id into the candidate's own,
so a union that always yields one member means the candidate side was empty — and it
is, by construction. `holistic-task-review.ts:422` hardcodes `evidenceIds: []`, and
`ModelHolisticFindingSchema` has no evidence field for the model to populate. The
consequence is that the refutation packet's `evidence` filter (`packet.ts:121`) and
its `supportSignalCandidates` filter (`packet.ts:40`) both yield the empty array for
every candidate, always. The one evidence record an admitted finding carries is the
refuter's own rationale, written afterwards.

The refuter is told to prove a claim "only when the provided context proves the
finding", holding two empty arrays. `needs-more-evidence` outnumbering `refuted` 5:1
(45 vs 9 over three archived seeds) is what that arrangement should produce.

This gives the withdrawn refutation-retrieval A/B (spec 05) the explanation that
record says it lacks: a refuter with no evidence slot does not use tools to CHECK a
cited claim, it uses them to go looking for support.

**Nothing is fixed by this entry.** Whether binding evidence to candidates raises the
proved rate is untested, and the nearest prior attempt at this stage made precision
worse. It earns a pre-registered A/B, not a change.

**Three pre-spend checks each changed the design**, and are the reason this cost
$4.17 rather than $4.50 for an uninterpretable result: the capture was too thin
(fixed first); the familywise false-alarm rate across nine separators at n=44 is
29-60%, so the planned three-seed test would have produced a chance positive about
half the time; and a $0.24 six-case smoke found five of seven new fields constant,
collapsing the hypothesis space before the full spend.

## 2026-08-10 — Signal-facts context: the sixth null on discovery framing

`openai/gpt-5.3-codex`, engine `0da877a` (all six runs, dirty=0),
`security-advisory-2026` (72 cases), 3 seeds per arm, arm order alternated
(control 1/2/1, treatment 2/1/2), zero provider errors. **$4.43 + $5.94 = $10.37
measured**, plus $0.15 of smokes. Full write-up:
`reports/2026-08-10-signal-facts-result.md`, pre-registered in
`reports/2026-08-10-signal-facts-prereg.md`.

| | control | `review.signalFacts.enabled` |
| --- | ---: | ---: |
| recall (per seed) | 64.9 / 64.9 / 64.9 → **64.9%** | 66.2 / 62.2 / 56.8 → **61.7%** |
| adjusted precision | 96.7% | 100.0% |
| input tokens | 6,901,000 | 7,598,206 (+10.1%) |

Pooled per-expectation paired sign test: **3 gained, 3 lost, 68 unchanged,
p = 1.0000.**

**NOT PROMOTED, stays shipped and disabled.** Promotion required a recall
improvement; recall moved −3.2pp. Removal required adjusted precision to fall or
errors to rise; precision rose and errors stayed at zero, so that trigger did not
fire either.

**The rule under-specified this cell.** Its "keep disabled" clause was written for
favourable-but-not-significant, and the result was unfavourable-and-not-
significant. The removal clause's rationale describes this run while its literal
trigger does not. Decided by the literal triggers rather than by whichever reading
the data favours; the next pre-registration on this stage must enumerate all four
recall × significance cells in advance.

**Two findings beyond the verdict.** Control recall was IDENTICAL across three
seeds while raw discovery varied 93/86/84 — the stable expectations are found
every seed and the marginal ones never, so the aggregate is far steadier than the
finding stream. The treatment arm broke that (49/46/42): showing the reviewer more
made it less consistent. And the low first-seed cache rate (46.7%) is not prompt
instability — seeds 2 and 3 cached 87.0% and 85.7%, so the section caches normally
after first exposure.

**This closes the sixth intervention on discovery framing**: five prompt clauses
(7/8, 7/8, 7/7, 12/12, 16/16), four attention mechanisms, and now real DATA
through a channel structurally empty since inception. The pre-registration argued
that was a mechanism no prior null covered. It was, and it landed in the same
place. What discovery is SHOWN is not the binding constraint on what it finds.

## 2026-08-10 — Citation spine: the channel is fillable, and filling it changes nothing

`openai/gpt-5.3-codex`, engine `e61bfdb` (all six runs, dirty=0),
`security-advisory-2026` (72 cases), 3 seeds/arm, order alternated (control 1/2/1,
treatment 2/1/2). **$4.47 + $4.69 = $9.16, plus $6.34 lost to an aborted first
sweep = $15.50.** Write-up: `reports/2026-08-10-citations-result.md`,
pre-registered in `reports/2026-08-10-citations-prereg.md`.

**THE MECHANISM ENGAGED, and this is the first time that has been demonstrable
rather than assumed:**

| | control | treatment |
| --- | ---: | ---: |
| findings with >1 evidence record | **0 / 231 (0%)** | **191 / 212 (90%)** |
| evidence-count distribution | `{1: 231}` | `{1:21,2:26,3:59,4:51,5:46,6:9}` |

`evidenceCount` was 1 for every finding this engine has ever produced, and that 1
was the refuter's own rationale. It is now 2-6 on 90% of findings — deterministically
verified quotes of real source lines.

**And nothing it was meant to move, moved:**

| | control | treatment |
| --- | ---: | ---: |
| in-diff recall | 60.8/60.8/67.6 → **63.1%** | 60.8/64.9/60.8 → **62.2%** |
| adjusted precision | 98.6% | 99.3% |
| `needs-more-evidence` / `refuted` | 18% / 5% | **20% / 7%** |
| reviews posting nothing | 27% | **30%** |

Paired sign test on the 73 expectations of the 71 cases that ran in all six runs:
**3 gained / 7 lost, p = 0.3438** (any seed); 4 gained / 3 lost, p = 1.0000 (>=2 of
3). The two thresholds disagree in direction.

**KEEP, DISABLED** — the pre-registered table's third cell (flat-or-worse, not
significant). The kill rule (adjusted precision falls) did not fire: precision rose.
All four cells were enumerated in advance this time, so no cell needed
interpretation after the fact.

**Raw precision 75.7% -> 83.5% is NOT CITED.** The arm-order artifact is present
again (position 1 mean 76.5%, position 2 mean 82.6%) and three seeds put treatment
in position 2 twice against control's once. Within matched positions treatment
still leads, but on one run per cell, and adjusted precision moved only 0.7pp.

**What this closes.** Six prior nulls said what discovery is SHOWN is not the
constraint. This says what the REFUTER HOLDS is not the constraint either — and
unlike those six, the mechanism is PROVEN to have engaged. The refuter was handed
verified code on 90% of findings and became slightly less decisive, not more.

**Process.** The first sweep aborted at four of six: one provider error failed the
eval regression gate, `eval run` exits non-zero on that, and `set -e` killed the
sweep. Harness now records status and keeps reports, letting scoring decide what is
poolable. Partial data deleted unread. The completed sweep's one provider error
(treatment seed 3) depresses the treatment arm, so the paired test drops that case
from all six runs symmetrically — favourable to treatment, which still lost 3-7.

## 2026-08-10 — The out-of-diff wall, proved with defects the engine is known to find

`openai/gpt-5.3-codex`, engine `ee31bc9`, corpus `multi-defect-2026` (5 cases, 11
expectations), zero provider errors, **$0.20**. Write-up:
`reports/2026-08-10-multi-defect-result.md`.

**in-diff 3/6 found; out-of-diff 0/5 found.**

The 0 replicates the standing 0/27. What is new is WHICH defects were missed. Each
is a curated case in its own right, so its findability is measurable — and when the
same defect IS the diff, the engine finds it:

| defect scored as its own case | matched, 3 control runs |
| --- | --- |
| `datamodel-code-generator-local-ref-arbitrary-file-read` | 1/1/1 |
| `gitpython-checkout-index-forwards-unscreened-git-options` | 1/1/1 |
| `ipv4-classifiers-suppressed-by-cidr-suffix` | 1/1/1 |
| `redirect-copies-credentials-to-cross-origin-location` | 1/1/1 |
| `x-python-type-extension-emitted-into-generated-annotation` | 0/0/1 |

**13 of 15 case-runs find these when they are the diff; 0 of 5 when the identical
defect is in the same file outside the changed lines.** Same engine, same model,
same file, same defect — only the hunk boundary differs. Every prior statement of
this wall was open to "those expectations were just hard". This one is not, and it
retires retrieval, context size and difficulty as explanations. It is attention.

**The multi-finding question is NOT answered.** Only the traefik case has both
defects in-diff; it produced one finding and matched one of two. n=1, and its two
expectations overlap in line range, which is the hardest possible version — a
single reported defect covering that region is what a model emits whether or not
the limit is real. Data point, not result. The other four contribute nothing here
by construction, as documented before the run.

**Consequence for what to try next.** Four attention mechanisms were already
measured flat against this wall — but all of them predate this evidence and were
scored against expectations of unknown findability. A mechanism aimed at it now has
five defects with a proven in-diff hit rate, in files already in the packet, and a
known ceiling of 5/5 to score against.

---

## 2026-08-11 — The out-of-diff mechanism was already built and removed ($0)

The forward plan's Priority 1 named one mechanism — a second additive discovery
call with the diff withheld — and made a ledger search the mandatory first step.
The search found it: **spec 19's un-anchored discovery pass**, built and measured
on 2026-07-27 and removed.

Every design row matches (additive, diff withheld entirely, same generic
instructions, semantic merge, same refutation and admission, off by default) except
one: the plan said whole file, spec 19 said bounded windows.

| | base (n=6) | pass enabled (n=3) |
| --- | ---: | ---: |
| recall | 46.25% | 47.08% |
| candidates / run | 74.7 | 117.0 (+56%) |
| cost / run | $1.92 | **$4.53 (+136%)** |

Paired over 80 expectations: **+0.83pp, CI [−3.13, +4.79], 10 gained / 9 lost,
p = 0.82** — on a corpus recorded IN ADVANCE as close to best case.

**The differing row makes it weaker, not different.** The windowed version's
candidate volume came from the windows; discovery yield is call-bound, so a
whole-file pass buys ~1 extra candidate per file where the windowed one bought 42
per run — and 42 per run yielded ~0 net expectations. Against the 5/5 ceiling it
was to be scored on, one extra candidate cannot find five specific defects.

**Dead on arrival. No prereg, no precheck, no spend.** Detail:
`reports/2026-08-11-unanchored-pass-restatement.md`.

Second time the ledger-search rule has paid. $0 against $0.20 + ~$11, and against a
second null on an answered question.

**Six structural interventions have now failed against later-in-file recall**
(enumeration sweep, diverse-lens pass, cross-file retrieval, context scout,
un-anchored pass, sub-file partitioning) and five pre-registered prompt clauses have
failed on framing. Neither family has an untried member.

### Free finding from the same session: the artifact-only population can grow 12 → 135

The separator question ("are the parked artifact-only findings distinguishable from
noise?") was left unanswerable at n=12. Pooling the **10 control runs of the
sub-file A/B** — one engine, one corpus, one metrics version
(`2026-08-07.open-redirect-mechanism`) — gives:

| | n |
| --- | ---: |
| artifact-only findings, pooled | **135** |
| distinct finding ids | 115 |
| distinct (case, path, line, title) defects | **69** |
| label disagreements across seeds | **0** |
| matched an expectation (known real) | **82** |
| unadjudicated false positives | **53** |

The 53 are the blocker and the reason this is not yet an answer: in these runs
`unlistedRealFindingIds ∩ artifactOnlyFindingIds = 0` for all ten, i.e. the
plausibility judge never adjudicated an artifact-only false positive. Answering the
separator question means judging those 53 — a small, bounded spend on findings that
already exist, with no review run required.

