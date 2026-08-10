# Result: no separator claimed — but the "could not prove it" mechanism is now measured

Ran 2026-08-10 against `reports/2026-08-10-artifact-only-separation-prereg.md`.
Engine `a9a13fb`, corpus `security-advisory-2026` (72 cases, 0 provider errors),
`openai/gpt-5.3-codex`. **Cost as measured: $3.93 for the seed, plus $0.24 for the
six-case smoke that reshaped the design. $4.17 total.**

The run replicates the archived baseline, which is the check that it measured the
same thing: recall **63.5%** (archived three-seed mean 63.1%), artifact-only recall
**10.8%** (archived 10.4%), adjusted precision 97.9%.

## The pre-registered answer: nothing claimed

The artifact-only population in this seed is **8 real / 4 noise, n = 12**. Severity
and category split roughly in proportion, and `hasFixProposal` is `false` for all
twelve. No separator is visible and, per the pre-registration, none is claimed —
in either direction. n = 12 cannot resolve a 52/48 split.

## What the run does establish, and it is the useful part

Five of the seven groundedness fields are **constant across all 78 produced
findings**, not merely across the smoke's eight:

| field | value | n |
| --- | --- | --- |
| `proposedBy` | `review-agent` | 78/78 |
| `evidenceCount` | **1** | 78/78 |
| `relatedLocationCount` | 0 | 78/78 |
| `dataFlowCount` | 0 | 78/78 |
| `cweCount` | 0 | 78/78 |
| `securitySeverity` | absent | 78/78 |

`evidenceCount == 1` looked at first like a contradiction, because
`enrichProvedCandidate` UNIONS the refutation's evidence id into the candidate's
own. A union that always yields exactly one member means the other side was empty.
It is, and the code says so directly rather than by inference:

- **`holistic-task-review.ts:422` constructs every candidate with `evidenceIds: []`,
  hardcoded**, and `proposedBy: 'review-agent'` on the next line.
- **`ModelHolisticFindingSchema` has no evidence field at all.** The discovery model
  is never asked which record supports its claim, so the empty array is not dropped
  data — there is no data to drop.
- **`packet.ts:121`** builds the refuter's evidence as
  `reviewEvidence.filter(e => candidateEvidenceIds.has(e.id))`. With an empty
  candidate set that filter yields **the empty array, for every candidate**.
- **`supportSignalCandidates`** requires `proposedBy !== 'review-agent'`
  (`packet.ts:40`), which the measurement shows is never true. **Always empty too.**

So the single evidence record every admitted finding carries is **the refuter's own
rationale**, written after the fact. Nothing binds a candidate to the code it came
from at any point in the pipeline.

## What this means for the stage

The refuter's instruction is *"Return verdict `proved` only when the provided
context proves the finding and its impact."* It is asked to prove a claim while
holding an empty evidence array and an empty corroboration array, working from
`reviewContext` alone. `needs-more-evidence` outnumbering `refuted` by 5:1 is what
that arrangement should be expected to produce.

This also gives the withdrawn refutation-retrieval A/B (spec 05) a candidate
explanation it explicitly lacked. That record notes the interesting part was
"a better-informed refuter proving MORE wrong candidates" and calls it unexplained.
A refuter with no evidence slot to fill does not use tools to *check* a claim
against cited evidence — there is none — it uses them to go looking for support,
which is a different and more credulous activity.

## What is NOT claimed

**That binding evidence to candidates would raise the proved rate.** It is
untested. The nearest prior attempt at this stage made things worse, and a
mechanism being real is not the same as a fix working. It earns a pre-registered
A/B, not a change.

**That the constants are wrong.** Analyzer-derived emptiness is consistent with
the 3.0% analyzer firing base rate already in the ledger; on this corpus those
fields having nothing to say is expected, not broken.

## What would decide the open question

The separator question stays open and is now correctly priced. At ~12 artifact-only
findings per seed and a familywise false-alarm rate of 29–60% across the plausible
separator set, resolving it needs roughly 8–10 seeds, not three — and the smoke
showed the surviving separators are weak enough that the spend is hard to justify
before the mechanism above is addressed.
