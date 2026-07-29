# 24: Invariant-Conformance Review

Status: Approved
Date: 2026-07-29

## Purpose

Report where a change **stops upholding a protective pattern the surrounding
codebase already upholds** — with the peer sites as evidence, so a human can judge
whether the deviation is deliberate.

## The Question This Answers, And The One It Does Not

Not *"is this code vulnerable"*. That framing is measured to be a false-positive
machine: across 14,910 queries, frontier models correctly cleared already-patched
clean files only **3.2–11.8%** of the time, and **58–71%** of their "correct"
detections cited an unrelated issue.

The question is narrower and answerable: **"fourteen sibling call sites do X
before Y; this one does not — was that intended?"** The codebase's own peers are
the specification. The output is evidence by construction, because the peers can
be listed.

## Why This Shape, And Not The One First Designed

The capability began as a *protection-removal* detector keyed on deletion hunks.
Probing the 87 committed expectations by the shape of the consequence — rather
than by defect category — showed that framing was too narrow:

| consequence shape | expectations |
|---|---:|
| widened scope — wildcard, broader catch, weaker role | **41** |
| changed shared or default state that unchanged code reads | **26** |
| weakened in place — value, operator or regex loosened | **24** |
| new code missing a check its peers uphold | **17** |
| made reachable or newly exposed | 2 |

**Removal is not the dominant shape, and weakening in place deletes nothing.** An
anchor dropped from a regex, a timeout raised, a role check loosened from
`isAdmin` to `isAuthenticated` — a deletion trigger sees none of it.

What unifies the top four is not *deletion*. It is **divergence from a pattern the
codebase holds elsewhere**. That is the invariant this spec keys on, and it covers
both the change that removes a guard and the change that never added one.

## Why The Peer Comparison Is Sound Here

Missing-check detection (Chucky CCS 2013, Crix USENIX Sec 2019, IPPO CCS 2021)
compares peer functions **within a single version** rather than across two, and
was initially dismissed here as "not differential".

For a pull-request reviewer that is a **feature, not a disqualification**:

- The peer set is **deterministically derivable** — no model needed to find it.
- The finding is **evidence by construction** — the peers are listed, and the
  reader judges.
- It needs **no pre-change state**, so it applies equally to added code, which the
  removal framing could not reach.

IPPO's measured cost is a **63.5% false-positive rate** on kernel code with no
human in the loop. That number is the reason for the firing-rate gate below, not
a reason to abandon the approach: our output is advisory and carries its peers.

## Design

1. **Peer-set derivation — deterministic.** For each declaration the diff adds or
   modifies, derive its peer set from the repository: sibling declarations of the
   same kind in the same file, directory, or type. No model.
2. **Pattern extraction — deterministic.** For each peer set, compute the calls,
   guards and argument shapes that a **majority** of peers share and the changed
   declaration does not. A peer set with no majority pattern yields nothing.
3. **Conformance adjudication — one model call per divergence.** Given the changed
   declaration, the named peers, and the specific divergence, decide whether the
   shared pattern is a **convention the change should follow** or an artefact of
   similarity. It MUST be able to answer *undetermined*.
4. **Report the divergence and its peers.** Never a verdict on exploitability.

## Requirements

- Peer derivation and pattern extraction MUST be deterministic. The model MUST
  receive a divergence to judge, never a repository to search. Unbounded search is
  forbidden — it measured net-negative here twice.
- A finding MUST cite **at least three peer sites by path and line**. Below that
  threshold there is no pattern, only a coincidence, and the finding MUST be
  rejected. This is the analogue of spec 22's named-dependent rule.
- The model call MUST NOT be asked whether the code is vulnerable, exploitable, or
  insecure. It is asked whether the peers constitute a convention. The distinction
  is the difference between an answerable question and the false-positive machine
  described above.
- Output MUST be **a substantiated fact plus a question**, not a verdict:
  *"these fourteen call `requireAuth` first; this one does not"*. We can prove the
  divergence. We cannot prove the consequence.
- The command MUST be able to report **no divergence**, and MUST NOT manufacture
  findings to fill a report.
- It MUST reuse intake, provider resolution, configuration, path service and
  reporting, and MUST reach repository content only through `context-retrieval`
  and `repository-intake`.
- It MUST NOT extend the diff reviewer's admission gate, share its report schema,
  or contribute to its metrics.
- **Advisory only.** It MUST NOT be able to fail a pipeline. A deviation from a
  convention is frequently deliberate, and the tool has no way to know which.
- Instructions MUST remain generic and language-neutral, per spec 15's
  Non-Negotiable.
- Failure MUST be recoverable and MUST NOT affect the diff review.
- Disabled by default until measured.

## Findings Outside The Diff Are Permitted, Deliberately

Unlike every other capability here, this one MAY report a divergence the change
did not cause — a peer set where the odd one out is untouched code.

That is acceptable **because the output is advisory and carries its evidence**,
and because the alternative is worse: suppressing a genuine "this handler is the
only one without an auth check" finding purely because the change did not create
it would hide the most useful thing the analysis can produce.

Such findings MUST be **labelled as pre-existing** and reported separately, so
they never inflate a change-attributed count.

## Evaluation — Firing Rate Before Recall

**This inverts the usual order, deliberately.**

A corpus built by reversing upstream fix commits is **100% positives** and
therefore structurally incapable of measuring false alarms. Measuring recall first
would produce an encouraging number that means nothing, and the base rate of
genuine convention violations is low enough that a plausible-looking recall figure
is compatible with an unusable tool.

**Step 1 — firing rate.** Run over ordinary pull requests that are known-benign
refactors, particularly deletion-heavy and rename-heavy ones. Count reports.

> **Kill criterion, fixed before the run: more than roughly one report per two
> benign pull requests and the capability is unviable at any cost**, and is
> removed rather than tuned.

**Step 2 — recall**, only if step 1 passes. Fixtures where an upstream fix added
the missing check that peers already had; reversed, the change is the code without
it. IPPO established this construction at a top-tier venue: 40 functions, 10
deleted release calls, 10 deleted return-value checks, 10 deleted refcount
decrements, 10 deleted unlocks → **77.5% recall on injected removals**.

**Step 3 — the deterministic baseline arm.** Report what the peer-set divergence
alone yields, with no model call. Per spec 22's precedent, the model layer must
beat listing the divergences and letting the human read them.

Metrics reported separately and never blended: firing rate on benign changes;
recall on seeded fixtures; change-attributed versus pre-existing findings.

## Verification Matrix

| Requirement | Test |
| --- | --- |
| Peer derivation and pattern extraction are deterministic and model-free | unit test |
| A finding with fewer than three cited peers is rejected | admission test |
| The model is never asked whether code is vulnerable or exploitable | instruction unit test asserting the absence of that framing |
| Reports no divergence rather than manufacturing findings | unit test |
| Pre-existing divergences are labelled and counted separately | report contract test |
| Cannot fail a pipeline | exit-code test over every report shape |
| Reaches repository content only through the mediated seams | import-boundary test forbidding `node:fs` and `review-workflow` |
| Disabled by default | config schema test |
| Instructions stay generic and language-neutral | prompt genericity guard |
