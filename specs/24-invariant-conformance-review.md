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
2. **Membership test — deterministic.** A declaration is compared against a peer
   set only when it **holds at least one trait a majority of those peers also
   hold**. A declaration that shares nothing with its structural neighbours is not
   an odd member of their group; it is not a member of it, and it yields nothing.
3. **Pattern extraction — deterministic.** For each peer set, compute the calls,
   guards and argument shapes that a **majority** of peers share and the changed
   declaration does not. A peer set with no majority pattern yields nothing.
4. **Conformance adjudication — one model call per divergence.** Given the changed
   declaration, the named peers, and the specific divergence, decide whether the
   shared pattern is a **convention the change should follow** or an artefact of
   similarity. It MUST be able to answer *undetermined*.
5. **Report the divergence and its peers.** Never a verdict on exploitability.

## Requirements

- Peer derivation and pattern extraction MUST be deterministic. The model MUST
  receive a divergence to judge, never a repository to search. Unbounded search is
  forbidden — it measured net-negative here twice.
- A finding MUST cite **at least three peer sites by path and line**. Below that
  threshold there is no pattern, only a coincidence, and the finding MUST be
  rejected. This is the analogue of spec 22's named-dependent rule.
- A declaration MUST NOT be reported for lacking a majority pattern unless it
  **shares at least one trait with a majority of its peers**. This is an
  additional precondition and MUST NOT relax either gate above: the majority rule
  and the three-cited-peer floor still apply to every divergence that survives it.
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

## Adjudication As Implemented

Design step 4 is implemented as one tool-free model call per divergence, wired so
that **every unclear outcome makes the report shorter rather than longer**. What
follows records the resolved facts; it adds no requirement.

**The three verdicts, and the one-way valve.** The adjudicator answers
`convention`, `incidental` or `undetermined`, plus a short reason. Only
`convention` is reported, and it must be stated exactly and with a reason:
a synonym, a sentence containing the word, a missing field, a malformed response,
a call that throws, and a divergence beyond the call bound all resolve to
"not reported". `undetermined` is the absorbing state, so the layer's failure
modes fail towards silence — the direction this spec's firing-rate-before-recall
order already chose.

**`undetermined` cannot be read as a violation, structurally.** The verdict a
reported divergence carries is typed as the literal `convention`, so `incidental`
and `undetermined` have no representation in a divergence entry at all: a caller
that skipped the filter gets a schema failure, not a mislabelled divergence. The
other two verdicts exist in the report only as integer counts, where there is
nothing for a consumer to mistake for a finding. The normalized verdict is
additionally a discriminated union in which only the `convention` member carries a
reason, so the code that attaches an adjudication cannot compile without having
narrowed to it first. Three mechanisms, none of which relies on a downstream check.

**What the model receives.** A packet built entirely from the already-extracted
divergence: the language, the declaration kind, the peer scope, the peer counts,
the divergent trait as a phrase, **what else a majority of the peers do**, the
cited peers by path and line, the declaration's own traits, and the statement and
question. No tool is attached, `builtinTools` is off, and the agent has one step,
so there is no turn in which a search could be requested. The peers' other
majority traits are the load-bearing addition: "these peers all build a schema" and
"these peers all respond to a request" is the distinction being asked about, and it
is invisible from the divergent trait alone.

**Packet field order.** Stable, low-cardinality fields first; the statement and
question last; no identifier anywhere. A run identifier is deliberately absent —
in this repository a fresh UUID at the front of a packet cut the shared prefix to
roughly thirty tokens against a 1024-token cache minimum and bought a guaranteed
miss.

**Why the report is short is always visible.** `summary.adjudication` carries
`mode` (`deterministic` or `model`), `requestedCount`, `conventionCount`,
`incidentalCount`, `undeterminedCount`, `failedCount` and `unadjudicatedCount`.
`requestedCount` equals the four verdict counts summed, and
`requestedCount + unadjudicatedCount` is every divergence the deterministic core
produced within its caps. Without those counts an empty report reads identically
whether the peers agreed with the change, the adjudicator called every pattern
incidental, or the bound ran out before it looked.

**Bounds and configuration.** `invariantConformance.adjudication.enabled` is off by
default and off *independently* of `invariantConformance.enabled`, so enabling the
deterministic arm can never start a provider call.
`invariantConformance.adjudication.maxAdjudications` (default 25) caps calls per
run; change-attributed divergences are submitted first. Adjudication with no
configured or resolvable provider degrades to the deterministic arm with a warning,
and the command still exits 0.

### The Two Control Tests

The acceptance bar for this layer is a **matched pair**, because a layer that
rejects everything passes a rejection-rate check perfectly and is worthless.

- **Negative control** — the two divergences this repository actually produces
  ("4 of 7 sibling declarations call `string`; `ContextRetrievalBudgetSchema` does
  not", and the same shape for `min` and `RepoToolOutputSchema`). Both are rejected
  and absent from the report. They are the survivors this spec's measurement
  section calls "the honest residue of the majority rule": genuine members of their
  peer set diverging on a trait that is how a schema library is written rather than
  a practice.
- **Positive control** — three sibling handlers that guard plus an added fourth that
  does not while sharing the group's other trait. It survives and is reported.

Both are hermetic and cost nothing: the provider is scripted. Neither is vacuous,
and that is asserted rather than assumed — with the layer bypassed all three
divergences are present, with a reject-everything adjudicator the positive control
disappears, and with an always-undetermined adjudicator nothing is reported.

**What the control tests do not establish.** The scripted adjudicator decides from
one generic feature of the packet and never sees which fixture it is judging, so the
pair proves that the packet carries enough for a case-blind rule to separate a check
from a construction call, and that the wiring reports exactly the `convention`
verdicts. Whether a real model answers this way is a model property and is not
measured here. The evaluation below — firing rate first — remains unrun.

## Structural Grouping Is Not Membership

A peer set is derived from **structure** — same declaration kind, same language,
same nesting depth — because that is the only grouping available without a
per-language semantic model. Structure is a proxy for *sibling*, and the proxy has
a failure mode that the majority rule alone cannot see.

**The majority rule requires the peers to agree with each other. It never asks
whether the member belongs to the group they form.** Where a language puts every
module-level declaration at the same nesting depth, one peer set holds every kind
of declaration a module exports. The majority is then computed over one kind and
charged against another, and the report says a declaration "does not" do something
it was never in a position to do.

The precondition follows from what *peer* means, and is stated in one sentence:

> Report a member as lacking a majority pattern only if that member shares at
> least one trait with a majority of its peers.

**The quantifier is `majority of peers`, not `any peer`.** A pattern is already
defined as what a majority holds; membership asks whether the member holds one of
the traits that make the set a set, and re-using one definition keeps "what this
group is about" from meaning two different things in the two halves of the same
comparison. A single incidental overlap with one sibling is exactly the
coincidence the three-cited-peer floor already refuses to treat as evidence. The
cost is accepted and named: where a member belongs to a large sub-group rather
than to the majority, this suppresses a divergence that `any peer` would report.
The error is toward silence, which is the direction this spec's
firing-rate-before-recall order already chose.

### The measurement that motivated it

Run over a real branch of a TypeScript repository, the deterministic arm produced
**9 change-attributed and 4 pre-existing divergences, and every one was this
shape** — an error class and a type alias grouped with schema builders and
reported for not calling a schema builder, and a synchronous parser grouped with
asynchronous functions. None shared a single trait with its peers. A control in
another language — three sibling HTTP handlers that guard, plus an added fourth
that does not but shares the group's other trait — produced the intended finding.

With the precondition: **9 → 2 change-attributed, 4 → 0 pre-existing**, and the
control unchanged. The two survivors are genuine members of their peer set
diverging on a low-salience trait; they are the honest residue of the majority
rule, not of the grouping, and trait salience is a separate question.

**The measurement did not discriminate between the candidate quantifiers.** All
of `any peer`, `three peers` and `majority of peers` produced identical counts,
because the members being removed shared *zero* traits with their peers. The
quantifier is therefore chosen on the argument above, not on this evidence, and
the choice is recorded here so a future measurement that does discriminate is
recognised as new information rather than as a contradiction.

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

## Fixture Minability — Measured, And Worse Than Predicted

Attempted 2026-07-30 by scripted search over 191 non-merge commits of a real Go
repository. **No usable fixture was produced, and the reason matters more than the
count.**

The signature searched for was the one this spec's own detector looks for: a commit
that adds a call to exactly one declaration where at least three sibling
declarations already hold it at the parent commit. It was predicted to be **cheap
to mine because it is structural** — derivable from the diff plus the parent tree,
with no dependence on commit-message convention, unlike the change-impact corpus
which cost 66,685 commits screened for five cases.

**That prediction was wrong.** 191 commits produced 97 raw matches. Excluding test
files and peer sets large enough to be utilities rather than conventions left 12
distinct candidates, and none of them is a conformance case. What the signature
actually finds is *a symbol was added once and other functions also call it*, which
describes the majority of commits in any codebase: assertion helpers in tests,
reflection utilities, a getter shared by 57 functions, and calls appearing inside
documentation commits.

### Why this is evidence about the capability, not only about mining

**The mining script failed in exactly the way the detector fails.** Its problem was
telling a protective convention from a common utility. That is the same problem,
in the same shape, as telling `requireAuth` from `min` — the trait-salience question
adjudication exists to answer.

A structural signature cannot isolate these fixtures for the same reason a
structural peer set cannot isolate a real divergence: **frequency does not
distinguish a practice from an idiom.** The difficulty is not a tuning shortfall in
either place; it is intrinsic to the question.

### Consequence for the measurement plan

Fixture mining for this capability **requires judgement per candidate** — a reader
deciding whether a peer set is a convention — and therefore cannot be scripted. It
is closer in cost to the change-impact curation than to a mechanical sweep, which
is the opposite of what was assumed when this measurement was planned.

Until such fixtures exist, the capability's status is unchanged and must be
described as it is: **wiring verified, both live control arms passing, and recall
on real code unmeasured**, with the sole positive case synthetic.

## Scope Limit: Declarations, Not Branches

Tested 2026-07-30 against a real curated case rather than a synthetic control:
`golang-jwt-zero-exp-parsed-as-absent-claim`, whose answer key states the defect in
peer terms — *"every sibling parser here reports ErrInvalidType"*. Reconstructed as
a two-commit repository presenting exactly the diff the corpus presents.

**Result: no divergence reported.** One changed declaration, one peer set, zero
findings, zero cost. The diagnosis is not a tuning shortfall:

All three sibling parsers in that file — `parseNumericDate`, `parseClaimsString`,
`parseString` — return `ErrInvalidType`, and so does the changed one. At
**declaration** granularity the trait is present and there is nothing to report.
The defect is that a single **branch** inside a type switch falls through without
it.

**This capability compares whole declarations. A declaration that upholds a pattern
in three branches and abandons it in a fourth holds the trait, and is invisible.**

That is a scope limit rather than a defect, but it was never stated and it is
material: branch asymmetry is one of the larger defect shapes in the committed
corpus. Two consequences follow.

- **Recall on peer-shaped answer keys will be lower than their phrasing suggests.**
  An expectation worded *"the sibling parsers do X"* is not necessarily a
  declaration-level divergence, and must not be assumed to be one when a corpus is
  assembled.
- **Extending to branch granularity is a different capability**, not a parameter.
  It would need intra-declaration control-flow structure, which the deterministic
  layer does not have and cannot obtain language-neutrally from lexical traits.

Note also that this case carries only three peers *including* the changed
declaration, leaving two — below this spec's three-cited-peer floor. It would have
been rejected on that ground regardless.

## Verification Matrix

| Requirement | Test |
| --- | --- |
| Peer derivation and pattern extraction are deterministic and model-free | unit test |
| A finding with fewer than three cited peers is rejected | admission test |
| A member sharing no majority trait with its peers is not compared | regression test per grouping shape: a class among schema builders, a type alias among schema builders, a synchronous function among asynchronous ones |
| A member that does share the group's trait is still reported for the missing pattern | control test in a second language |
| The precondition does not relax the majority or citation gates | unit test asserting both still refuse a member that passes membership |
| The model is never asked whether code is vulnerable or exploitable | instruction unit test asserting the absence of that framing |
| The model receives a divergence, never a repository to search | agent test asserting no tool is offered, with `builtinTools` off and a single step |
| An `undetermined` verdict is never reported as a divergence | schema test (the verdict literal), normalization test (every unusable answer resolves to `undetermined`), and end-to-end test with an always-undetermined adjudicator |
| Only `convention` verdicts are reported, and the rest are counted | filter unit test asserting the count identities, plus the two control tests |
| The two control tests, and that neither is vacuous | hermetic end-to-end pair: negative control rejected, positive control reported, plus a bypassed arm, a reject-everything arm and an always-undetermined arm |
| Adjudication cannot add, relabel or alter a divergence | filter unit test |
| A failed or unbounded adjudication degrades rather than failing | filter unit test and CLI test with no provider configured |
| Adjudication is disabled independently of the capability | config schema test |
| Reports no divergence rather than manufacturing findings | unit test |
| Pre-existing divergences are labelled and counted separately | report contract test |
| Cannot fail a pipeline | exit-code test over every report shape |
| Reaches repository content only through the mediated seams | import-boundary test forbidding `node:fs` and `review-workflow` |
| Disabled by default | config schema test |
| Instructions stay generic and language-neutral | prompt genericity guard |
