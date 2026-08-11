# Pre-registration: is the parked artifact-only population separable?

Written 2026-08-11, **before any adjudicated data exists**. The instrument that
produces the labels landed in `7daa692` and has never been run against a provider.

## The question and why it is worth money

Artifact-only findings are admitted findings the engine will not post inline. They
are parked. Roughly **60.7%** of them match an expectation outright (82 of 135
pooled across the ten sub-file control runs), and the forward plan values the
population at **~10.3pp of recall** if it could be released.

It cannot be released wholesale: that takes genuine false positives from 3 to 24
per 216 reviews. The only route is a **separator** — a property that ranks the real
ones above the noise — and the 2026-08-10 study could not look for one, because at
that time five of the seven groundedness fields were CONSTANT across all 78 produced
findings (`proposedBy`, `evidenceCount`, `relatedLocationCount`, `dataFlowCount`,
`cweCount`), and the two that varied (severity, category) split proportionally.

**What changed, and it is the only reason to re-ask:** the citation spine shipped
enabled this session. `evidenceCount` was 1 for 78/78 findings; with citations on it
is **2–6 on 90% of findings**, each one a deterministically verified quote of a real
source line. A groundedness feature that did not exist now varies.

This is a measurement of an existing property, not an intervention. There is no
treatment arm and nothing ships from a positive result without a second, separate
decision.

## Population and unit of analysis

**AMENDED 2026-08-11, before any data exists**, after a free precheck against the
ten archived runs. Two numbers in the first draft were wrong and the corpus is now
restricted. Both changes are recorded here rather than silently applied.

- Corpus `security-advisory-2026`, engine pinned to one SHA for all seeds, judge
  model pinned via `evaluation.judgeModel` and recorded in `provenance`.
- Reviewer model `openai/gpt-5.3-codex`. Every rate below is a property of that
  model and must be published with it.
- **Seed 1 runs the full 70 cases. Seeds 2-10 run only the 31 cases that have ever
  produced an artifact-only finding.** Over ten archived runs those 31 cases
  produced **135 of 135** artifact-only findings; the other 39 produced none, and a
  case that produces none contributes nothing to this question at full price.
  - Seed 1 is deliberately unrestricted: the engine has changed since the archive
    (citations are on), so the producing set could have moved. Seed 1 both tests
    that and contributes population. **If seed 1 finds artifact-only findings in
    cases outside the 31, the restriction is void** and the remaining seeds run the
    full corpus at full price.
  - Selection-bias check, run before deciding this: matched-rate is **59%** in
    high-yield cases and **62%** in low-yield ones. Restricting by yield does not
    select for realness.

### The unit is the distinct code location, and the first draft got this wrong

**Primary unit: `(caseId, path, line)`. Expected n ≈ 49 at ten seeds.**

The first draft said n ≈ 69 from a key of `(caseId, path, line, title)`. That was a
**keying bug in the counting script**, not a design choice: a matched artifact-only
finding is recorded as a MATCH record carrying `producedPath`/`producedStartLine`,
not a finding summary carrying `path`/`title`, so all 82 matched rows collapsed into
a handful of degenerate `(case, None, None, None)` keys. Corrected counts over the
same ten runs:

| unit | n | label conflicts |
| --- | ---: | ---: |
| finding instances | 135 | — |
| distinct finding ids | 115 | 0 |
| **distinct `(caseId, path, line)`** | **49** | 3 |

`(caseId, path, line)` is chosen as primary because it is the **conservative** one.
A finding id is content-derived, so the same defect described with a different title
in a different seed gets a different id — 115 over-counts distinct defects, and an
AUC built on it would be inflated by repeated measurement of the same code location.

- **Sensitivity analysis, reported alongside and labelled anti-conservative:** the
  same AUC over distinct finding ids (n ≈ 115). If the two disagree about which cell
  the result falls in, the conservative one governs and the disagreement is reported
  as the headline.
- The 3 locations whose label conflicts across seeds are **excluded**, and exclusions
  are reported. Exclusions above 10% of units void the primary analysis.

### Power, stated before the run rather than discovered after

n ≈ 49 is thin. At roughly 30 real / 19 noise the standard error on AUC is about
0.085, so a true AUC of 0.70 yields a 95% CI of roughly [0.53, 0.87] — it clears the
"excludes 0.50" bar, but only just. **Cell 2 below exists for exactly this**, and
landing in it is an acceptable outcome, not a failure to be argued around.

More seeds do not fix it cheaply. The rarefaction over distinct locations saturates:

| seeds | 1 | 3 | 5 | 7 | 10 |
| --- | ---: | ---: | ---: | ---: | ---: |
| distinct locations | 13.5 | 26.2 | 34.5 | 41.6 | 49.0 |

The tenth seed buys 2.2 units. Doubling to twenty seeds would buy perhaps eleven
more for another $8. That trade is **not** taken now; if the result lands in cell 2,
this table is what the decision to extend must be argued from.

## Labels

- **real** — the finding matched an expectation, OR the plausibility judge returned
  `plausible: true, restatesAlreadyCounted: false` (`artifactOnlyUnlistedRealFindingIds`).
- **noise** — `artifactOnlyGenuineFalsePositiveFindingIds`.
- A fail-closed judge verdict counts as **noise**, which is the direction that
  cannot manufacture a positive result. Fail-closed counts are reported separately.

## Primary endpoint, fixed now

**AUC of `evidenceCount` for discriminating real from noise**, over distinct
defects, with a 95% CI from 2000-resample bootstrap over defects.

Chosen because it is threshold-free: a promotion rule needs a *ranking*, and picking
a threshold after seeing the data is the exact move this file exists to prevent.

### The four cells, all enumerated in advance

| AUC | 95% CI | Conclusion | What happens next |
| --- | --- | --- | --- |
| **≥ 0.70** | lower bound **> 0.50** | **Separator exists** | Design a promotion rule in a SEPARATE pre-registration, scored on precision, not recall |
| ≥ 0.70 | includes 0.50 | Underpowered, nothing claimed | Report the n required to resolve it; do not run more seeds on this question without that number justifying it |
| < 0.70 | lower bound > 0.50 | Real but too weak to promote | Record and stop. A signal that cannot carry a threshold is not a lever |
| < 0.70 | includes 0.50 | **No separator** | Close the question. The artifact-only population is not separable by groundedness, and the ~10.3pp is not reachable this way |

0.70 is the bar because a ranker below it cannot support a threshold that adds real
findings without dragging noise in at a rate that breaks the precision-first
posture. It is set here, before the number exists, and will not be renegotiated
afterwards.

## Secondary, and explicitly exploratory

`severity`, `category`, `hasFixProposal`, and description length are reported as
descriptive splits **only**. No claim may be made from any of them, in either
direction, and no combined/multivariate rule may be fitted after the fact. They
exist so that a future pre-registration has a hypothesis to start from — that is
their entire purpose.

If the primary fails and a secondary looks striking, the correct output is a new
pre-registration, not a rescue of this one. This is the same discipline applied on
2026-07-27 to the un-anchored pass's unlisted-real movement and on 2026-08-05 to the
investigative arm's precision movement.

## Sanity checks that must pass or the run is void

1. **Base rate replicates.** The share of artifact-only findings that match an
   expectation must land near the archived **60.7%**. A wide miss means this is not
   measuring the same population and no conclusion may be drawn.
2. **`evidenceCount` actually varies.** If citations did not engage, the primary
   feature is constant and the whole run measures nothing — the failure mode the
   citation A/B was built to detect. Report the distribution before the AUC.
3. **Zero provider errors**, or the errored cases are excluded and named.
4. `dirty=0` on every run; one engine SHA; one judge model; one metrics version.

## What invalidates this entry afterwards

A change to the corpus answer key, the engine, the judge model, or
`EVAL_METRICS_VERSION`. Results across any of those boundaries do not pool.

## Cost, from real per-case measurements

Per-case costs are the mean over the ten archived runs, so this is measured
arithmetic rather than a scaling guess.

| plan | $/seed | 10 seeds |
| --- | ---: | ---: |
| full 70-case corpus | $1.84 | $18.42 |
| 31 producing cases | $0.80 | $8.02 |
| **seed 1 full + seeds 2-10 restricted** | — | **~$9.04** |

**Budget ~$9**, down from the ~$20 first registered, at no loss of population.

### Two other levers, measured and rejected

- **Reordering the plausibility judge's prompt so the 64 KB file body comes first**
  (it currently comes last, behind fields that mutate per call, so it prefix-caches
  nothing). `reports/2026-08-07-token-levers-remaining.md` calls this "a large share
  of the ~22% judge spend". **For this workload it is not:** across 700 archived
  case-runs, 125 judge a single finding per file, 19 judge two, and 2 judge four. A
  prefix cache has almost nothing to share, and reordering a prompt can move the
  verdicts of the very instrument this study depends on. Not taken.
- **A cheaper judge model.** It would change the instrument mid-question, and the
  base-rate sanity check compares against an archived figure the current judge
  produced. Not worth ~20% of $9.
- The fix lane was checked and is already off: `fixOutcomes` is empty across all
  700 archived case-runs. No saving available.

## What is NOT being done

- No promotion of anything. A separator, if found, buys a second pre-registration.
- No treatment arm, so the measured arm-order precision artifact does not apply and
  no precision delta is claimed from this run.
- No mining of these findings into corpus answer keys, however convenient.
