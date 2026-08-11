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

- Corpus `security-advisory-2026`, engine pinned to one SHA for all seeds, judge
  model pinned via `evaluation.judgeModel` and recorded in `provenance`.
- Reviewer model `openai/gpt-5.3-codex`. Every rate below is a property of that
  model and must be published with it.
- **10 seeds.** Fewer is not defensible: the pooled archive gives ~13.5 artifact-only
  findings per run, and the unit below collapses that further.
- **The unit of analysis is the DISTINCT DEFECT, not the finding instance.**
  `(caseId, path, line, title)`. The archive shows the same defect recurring in up
  to 7 of 10 seeds; counting instances would pseudo-replicate and inflate n roughly
  2×. Expected n ≈ **69**.
  - Justification that this is safe: across the ten archived runs, the number of
    distinct defects whose label DISAGREES between seeds is **0**. A defect's label
    is stable, so collapsing instances loses nothing.
  - A defect whose label does disagree across seeds in the new data is **excluded**
    and the count of exclusions is reported. If exclusions exceed 10% of distinct
    defects, the primary analysis is void and reported as void.

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

## Cost, from a real measurement not an estimate

The sub-file A/B's control arm was **10 seeds of this exact corpus at $18.42**. The
new artifact-only judge pass adds roughly 5 judge calls per run (~50 total), each
re-sending up to 64 KB of file body. **Budget ~$20.** This is disclosed before the
spend, and it is 20× my earlier "~$1" figure — that estimate assumed the archived
findings could be re-adjudicated from disk, and they cannot: the eval never stored
the descriptions.

## What is NOT being done

- No promotion of anything. A separator, if found, buys a second pre-registration.
- No treatment arm, so the measured arm-order precision artifact does not apply and
  no precision delta is claimed from this run.
- No mining of these findings into corpus answer keys, however convenient.
