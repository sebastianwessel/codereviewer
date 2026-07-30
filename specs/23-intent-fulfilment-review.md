# 23: Intent-Fulfilment Review

Status: Approved
Date: 2026-07-27
Amended: 2026-07-30 — a citation may name a removed line (see *Amendment* below)

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
