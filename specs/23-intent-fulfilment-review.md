# 23: Intent-Fulfilment Review

Status: Approved
Date: 2026-07-27
Amended: 2026-07-30 — a citation may name a removed line (see *Amendment* below)
Second Amendment: 2026-07-31 — proposed, implemented, **measured and WITHDRAWN**

## Second Amendment — WITHDRAWN on measurement (2026-07-31)

**The aptness check described below was built, measured over the full 34-case
corpus, and removed the same day. It is recorded here rather than deleted, because
the reason it failed is the useful part.**

| | before | after |
|---|---:|---:|
| false-satisfied (synthetic) | 4 | 3 — **only 1 attributable to the check** |
| **false downgrades** | 0 | **5 of 8 downgrades** |
| unaddressed detection | 90.0% | 92.5% (no regression) |
| deletion-heavy behavioural taken | 3 / 52 | 2 / 52 |

It **failed its own pre-registered exchange rate** (`2 × removed ≥ produced`) by
more than double: it suppressed **five correct verdicts to remove one wrong one**.

**And it missed the case it was written for.** `s17/obl_13` — *"make runs that
request the withdrawn context kind by name fail intake with exit code 2"*, the
exact verdict this amendment existed to catch — came back `addressed` on the same
removed lines, with `inaptCitationCount: 0`. The aptness call read that citation
and declined to call it inapt.

### Why, and this generalises

A 68-pair direct probe found the check is **correctly calibrated** — 2.0%
false-inapt on hand-verified apt evidence — and **pointed at a rare event**.
Roughly **92% of `addressed` verdicts are already aptly cited**, so:

- 2% of ~200 apt citations ≈ **4 wrong downgrades**
- 14% of ~18 inapt citations ≈ **2.5 right ones**
- expected downgrade precision ≈ **38%**, which is what the live runs produced

**Making the check stricter makes it worse**, because the false-positive term grows
with the large population and the true-positive term with the small one. This is
the base-rate collapse this project has already recorded once, in the
vulnerability-introducing-commit literature: a well-calibrated classifier aimed at
a rare event produces mostly false alarms. It was not recognised as the same shape
before building.

Two directions remain untried and neither is implemented: **narrow the scope** (run
only on behavioural obligations cited exclusively to removed lines, where the base
rate is far higher), or **annotate rather than demote** (flag the citation as weak
and leave the verdict alone).

One thing that must **not** be claimed as its benefit: the deletion-heavy inapt
rate falling 33.3% → 0.0%. The check cannot improve a citation, only reject it.

### Consequence for the capability

The false-satisfied route documented below is **open again and unmitigated**.
`intent check` remains **off by default** with a measured, named failure mode —
which is a better state than a mitigation that costs five good verdicts per bad one
caught.

---

## Second Amendment as proposed (retained for the record)

The 2026-07-30 amendment closed the deletion blind spot and, as predicted, opened a
new route to the one error this spec calls the costly one. Measured over 34 cases:

- **4 false-satisfied verdicts**, against 0 before;
- **52 deletion-heavy behavioural opportunities, 3 taken (5.8%)**;
- **33.3% of behavioural citations in deletion-heavy changes were inapt**.

The decisive case, a planted behavioural obligation:

> *"Make runs that request the withdrawn guarded-region context kind by name fail
> intake with exit code 2."*

Reported **addressed**, citing two **removed** lines — an enum member and a
comparison against it — from a commit that removes the kind and adds no intake
check and no exit path.

**Every structural guard passed.** `unevidencedAddressedCount` and
`uncitedObligationCount` were zero in all 34 runs. Both citations were real lines
the change really touched. The existing check asks *"is this a line the change
touched?"* and cannot ask *"is this line evidence for THIS claim?"* — and the
failure lives entirely in the gap between those two questions.

The measurement also shows the fix is reachable rather than speculative: on the one
obligation judged four times, three runs cited deleted schema keys and one cited
the added sentence *"now fails validation with exit code 2"*. **The apt citation
was in scope every time.** The model can find it; nothing asked it to prefer it.

### What this amendment requires

- An `addressed` verdict MUST additionally survive an **aptness check**: given the
  obligation and the already-verified citations, does the cited material *evidence
  that obligation*, or is it merely a line the change happened to touch?
- The aptness check MUST be a **separate model call over an already-frozen
  judgement**, exactly as explanation is. It MUST NOT be folded into the judgement
  call, because the measured over-rejection (26–36% rising to 73–88%) comes from a
  model justifying a verdict in the same breath as reaching it.
- Its output schema MUST carry **no free-text field** — enum and identifiers only,
  for the same reason the judgement schema does.
- An obligation whose citations are judged inapt MUST be **downgraded to
  `undetermined`**, never to `unaddressed`: inaptness of the evidence is not
  evidence that nothing addresses the obligation. It MUST be counted, so the rate
  is visible rather than absorbed.
- The check MUST be able to answer *undetermined* itself, and an undetermined
  aptness answer MUST leave the `addressed` verdict standing. The check exists to
  catch a specific, demonstrated failure, not to become a second gate that
  suppresses correct verdicts — which is how a capability with 90% unaddressed
  detection would be turned into one that reports nothing.

The safety direction is unchanged and is the whole point: this can only make an
`addressed` verdict weaker, never stronger, and can never turn `unaddressed` into
`addressed`.

## Amendment (2026-07-30): a removed line is evidence

The original requirement said an addressed obligation must cite "path and line".
Implemented literally against the added side, **that made deletions unprovable**:
a deletion creates no line to point at, so *"remove the old caching layer"* could
never be judged addressed no matter how completely it was done.

Measured on this repository's own revert commit `52ff75d`, using its commit
message as the stated intent:

| obligation shape | count | result |
|---|---:|---|
| *"Remove X"* | 9 | **7 unaddressed, 2 undetermined — all wrong** |
| *"Keep X"* / *"Make X"* | 6 | **6 addressed — all correct** |

Every removal failed; every addition succeeded. On a revert, refactor or cleanup
change — a large share of real work — the command told a reviewer that most of the
change had not been made.

The requirement's purpose is *"never claim something is done without showing me
where"*. A removed line satisfies that purpose exactly: it is an exact address a
reader can confirm in the diff. The rule was written with additions in mind, not
with a judgement that deletions should not count.

The amendment therefore widens what a citation may name and adds an obligation to
disclose the side, so the safety property is unchanged: an addressed obligation
still cannot survive without a verified, human-checkable address.

Recorded date: 2026-07-30. This is the first amendment to an approved spec in this
project made after implementation; the measurement that forced it is in
`reports/eval-results-ledger.md`.

## Purpose

Report how a change relates to its stated intent — the pull-request description, a
linked ticket, a commit body — so a human can see at a glance what the change
covers and what it does not.

## Why This Is Advisory By Design, Not By Preference

Two independent reasons, and the second is the stronger one.

**Product.** A pull request need not fully implement a ticket. Partial work,
follow-ups, and deliberately deferred scope are normal. A hard gate on
ticket completeness would block correct work routinely.

**Technical, and this is the binding constraint.** Published measurement of models
judging requirement conformance reports **systematic over-rejection**: spurious
rejection rates of 26–36% rising to **73–88%** when the same call is also asked to
explain its judgement or propose a fix. A hard-blocking fulfilment check built on
a single model call would therefore be wrong most of the time it fired.

The mitigation in the literature is validating a proposed change against tests
rather than arguing about conformance in prose. Until this capability has
something equivalent, its output is **advisory only**.

Google's operational definition applies here too: a finding a developer takes no
action on is an *effective false positive*, whatever its technical merit. A
fulfilment check that blocks merges would generate those at scale and train
reviewers to dismiss the tool.

## Command Surface

A **separate command**, for the same reason as spec 22: three capabilities behind
one report blend three different jobs into one score, which is the measurement
error this project already made once.

The change-intent input already exists. Spec 11 ingests external context from
bounded providers, redacts it, and injects it as a context-only `change-intent`
document. **That ingestion MUST be reused, not reimplemented.**

## Design

1. **Extract obligations.** From the stated intent, derive discrete, checkable
   obligations. Prose becomes a list.
2. **Map each obligation to evidence in the change** — or to nothing.
3. **Report the mapping**, not a verdict.

## Requirements

- The command MUST reuse spec 11's change-intent ingestion, plus intake, provider
  resolution, configuration, and reporting.
- Output MUST be **advisory**. The command MUST NOT be able to fail a pipeline on
  fulfilment grounds. This is not configurable, and the reason is recorded above:
  the underlying judgement is not accurate enough to gate on.
- Every reported obligation MUST cite **where in the stated intent it came from**.
  An obligation the reviewer inferred rather than read is not an obligation.
- An obligation judged addressed MUST cite the change that addresses it — path and
  line. Unevidenced satisfaction claims are worse than silence, because they
  invite a reviewer to stop checking.
- **A cited line MAY be one the change REMOVED, identified by its line number on
  the pre-change side.** A removed line is evidence of the same kind as an added
  one: it names an exact address a reader can confirm in the diff. The report MUST
  state which side a citation is on, so *"done — this deleted line 42"* can never
  be misread as *"done — this added line 42"*.
- **Extra scope is reported neutrally.** A change doing more than the ticket asked
  is a normal and often desirable event, not a defect.
- The command MUST handle **absent or unusable intent** by reporting that plainly
  and exiting successfully. Most changes will have thin descriptions.
- Judgement, explanation, and any suggested follow-up MUST NOT share one model
  call. The measured over-rejection above is specifically what happens when they
  do.
- The judgement call's output schema MUST carry **no free-text field**. Two calls
  where the first still returns a rationale string satisfy the letter of the rule
  and reproduce the mechanism it exists to prevent: the over-rejection is caused
  by a model justifying a verdict in the same breath as reaching it, not by the
  call count. Explanation reads an already-frozen judgement.
- Obligations MUST be extracted from the redacted change-intent **fragments**, not
  from the summarised brief. The brief is a paraphrase, and a citation into a
  paraphrase does not identify where in the stated intent an obligation came
  from.
- Instructions MUST remain generic and language-neutral, per spec 15's
  Non-Negotiable.
- The capability is **disabled by default** until measured.

## The Failure Mode To Watch

The dangerous output is not "missed an obligation". It is **confidently asserting
an obligation is satisfied when it is not**, because that stops a human looking.

Evaluation MUST therefore treat a false *satisfied* claim as more costly than a
false *unaddressed* claim, and report the two separately rather than in one
accuracy figure.

## Evaluation

This capability cannot be measured by any existing corpus. The spec 17 corpus is
built from upstream fix commits, which carry no pull-request description and no
ticket. Its `reviewIntent` field states the *correct* intent, so it can measure
nothing about mismatch.

A separate corpus is required, and it is **harder to build than the change-impact
one**: a pull request whose description genuinely disagrees with its change is
rare and is almost never labelled as such. Candidate sources:

- Pull requests whose review discussion identifies missing scope.
- Changes later amended with "also needed X" where X was in the original ticket.
- Reverts citing unimplemented requirements.

**Synthetic mismatches are permitted here, unlike elsewhere, but MUST be marked.**
A truthful description with one obligation removed is a valid negative fixture and
is far cheaper to produce than mining real mismatches. Synthetic and real cases
MUST be reported separately, because a synthetic mismatch is likely easier than a
real one and pooling them would overstate the capability.

Metrics, reported separately and never blended:

- **Obligation extraction** — do the obligations match what a human reads in the
  intent?
- **Unaddressed detection** — of obligations genuinely not addressed, how many are
  reported?
- **False-satisfied rate** — of obligations reported as addressed, how many are
  not? Per the failure mode above, this is the metric that decides whether the
  capability is safe to show anyone.

Decision rule, fixed before the first measurement: **ship only if the
false-satisfied rate is low.** A capability that misses unaddressed obligations is
merely incomplete; one that wrongly certifies them is harmful, and no amount of
recall compensates.

## Verification Matrix

| Requirement | Test |
| --- | --- |
| Reuses spec 11 change-intent ingestion | integration test asserting no second ingestion path |
| Cannot fail a pipeline on fulfilment grounds | exit-code test |
| Every obligation cites its source in the stated intent | unit test |
| Every satisfied obligation cites path and line | unit test |
| Absent intent reports plainly and exits successfully | integration test |
| Judgement and explanation do not share a model call, and the judgement schema carries no free text | harness test asserting distinct agents and distinct output schemas, plus a schema-shape assertion that the mapping output has no string field other than identifiers and enums |
| Extra scope is reported without a defect severity | unit test |
| Disabled by default | config schema test |
| Instructions stay generic and language-neutral | prompt genericity guard |
