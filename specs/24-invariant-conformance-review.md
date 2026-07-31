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

**Caveat, added 2026-08-01:** these counts predate the `declarationSpanAt` span fix,
so they were produced by a detector that could only see declarations whose signature
fitted on one line. The ledger's void notice names the firing rates specifically and
not these counts, so they are not voided — but the ratios below are drawn from a
biased sample of declarations and MUST NOT be quoted as a measurement of the
precondition's effect. The argument the precondition rests on is structural, and does
not depend on them.

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

### Refined Diagnosis: Traits Carry No Structural Position

Closer reading of the same case sharpens this, and the sharper version is the one
to design against. All three parsers contain the symbol, but not in the same
place:

| declaration | where the symbol appears |
|---|---|
| `parseNumericDate` | after the switch, **terminal statement** |
| `parseString` | after the switch, **terminal statement** |
| `parseClaimsString` | **inside a nested loop**; the fall-through returns no error |

Two return the error on the exit path and one does not. That is a genuine
conformance divergence, and it is invisible because **a trait is a set-membership
fact rather than a structural one**: *"returns it on the fall-through"* and
*"mentions it inside a nested loop"* are the same trait.

## Positional Traits

A trait MUST carry its **structural position** within the declaration, not only
its presence. Two dimensions, both derivable from indentation the implementation
already computes:

- **depth** — nesting relative to the declaration's base indentation.
- **terminality** — whether the trait sits on the declaration's exit path or
  inside a nested block.

Two declarations that hold the same symbol at materially different positions MUST
NOT be treated as holding the same trait.

The case above then yields the correct finding: *"2 of 3 sibling parsers return
this as their terminal statement; this one does not."*

**Why position rather than branch segmentation.** Segmenting a declaration into
sibling branches was considered and is the larger change: it needs a model of
which constructs open a branch, which is closer to parsing than to lexing.
Position reuses machinery that exists, adds no per-language work, and generalises
to the same shapes — a lock acquired and released only on the happy path, a value
validated in one path and not another.

**The accepted cost, recorded rather than assumed away.** More trait dimensions
means more candidate divergences and therefore more noise. That is what
adjudication exists to absorb, and it has demonstrated on live calls that it
rejects library idioms while keeping role-based conventions. The firing-rate gate
still applies and MUST be re-measured after this change.

### Positional Traits As Implemented

What follows records resolved facts; it adds no requirement.

**The position, and why the buckets are this coarse.** A trait's key carries a
`depth` band and a `terminality`, both read from the indentation of the blanked
code lines the span already produces. Indentation *columns* are ranked into
*levels* within each declaration, so a tab-indented Go body and a two-space
TypeScript body of the same shape compare equal.

| dimension | values | rule |
|---|---|---|
| depth | `surface` | the header line and levels 1-2 |
| | `nested` | level 3 and deeper |
| terminality | `exit` | nothing more than one level shallower follows inside the declaration |
| | `interior` | the declaration returns to a materially shallower level afterwards |

**Indentation cannot distinguish a nested block from a wrapped expression**, and
that single fact sets both widths. A fluent chain split across lines, a call whose
arguments do not fit, a multi-line literal — each adds a level that is formatting.
So the band absorbs one wrap (level 2 is still `surface`), and terminality ignores a
one-level dedent and the closing-bracket lines that a brace-scoped language emits on
the way out. A finer model reports code style as divergence, which was measured:
treating the header line as a band of its own produced, over forty commits of this
repository, **only** divergences of the form "these peers write `z.strictObject({` on
the declaration line and this one writes `z` then `.strictObject({`", and raised the
firing rate from 0.90 to 1.375 reports per commit. It was dropped.

**Terminality is constant over the `surface` band, structurally.** A span ends at
the first line that returns to the header's column, so nothing inside a declaration
is ever shallower than level 1 and a surface trait cannot be followed by anything
materially shallower. Terminality therefore discriminates only within `nested` — a
nested block that ends the declaration against one it continues past, which is
exactly the shape the case below turns on. The two dimensions are stored separately
regardless, because that constancy is a property of how a span is bounded rather
than a claim about positions.

**A divergence now has two shapes, and they are never phrased alike.** If the
declaration does not hold the pattern's symbol anywhere, the statement is unchanged:
*"3 of 3 sibling declarations call `requireAuth`; `ExportUsers` does not."* If it
holds the symbol at a different position, the statement says so instead: *"7 of 12
sibling declarations call `string` on the declaration's exit path; `ReviewReportSchema`
does so inside a nested block."* Telling a reader a declaration "does not" do
something it plainly does is how a reader stops reading. One divergence is emitted
per trait subject, so a symbol that is a majority pattern at two positions at once
cannot report one absence twice.

### The Case It Was Written For: Necessary, Not Sufficient

`golang-jwt-zero-exp-parsed-as-absent-claim`, reconstructed as a hermetic fixture
from `map_claims.go` at the defective commit, verbatim.

The requirement is met. The three parsers no longer hold one trait:

| declaration | positioned trait |
|---|---|
| `parseNumericDate` | `call:newError@surface/exit` |
| `parseString` | `call:newError@surface/exit` |
| `parseClaimsString` | `call:newError@nested/interior` |

**And the case still reports nothing.** Two peers hold the exit-path trait, and this
spec requires at least three cited peers. Its own note on this case predicted
exactly that — *"leaving two — below this spec's three-cited-peer floor"* — and the
prediction is now measured rather than inferred. A second, independent bar sits
behind it: Go puts every method of a file at the same indentation column, so the six
one-line accessors in that file are peers too, and a pattern would need five of the
eight peers where the parsers are three.

So positional traits are **necessary and not sufficient** for this case. What
remains is not a position problem, and no bucket width fixes it: the file does not
contain three declarations that uphold the pattern. Reaching it would mean relaxing
the citation floor, which is a MUST above and is not relaxed here.

### Firing Rate, Re-Measured — VOID, AND SUPERSEDED

**Every number in this subsection is void.** `declarationSpanAt` bounded a
declaration by indentation alone, so a declaration whose signature spanned more than
one line had its span end at the closing parenthesis of its parameter list. The body
was excluded, the declaration extracted no traits, and a trait-less declaration is
dropped before it reaches this capability. Measured on this repository's own
`src/cli/args.ts`, **nine of ten exported declarations extracted zero traits**. So
these rates are not measurements of spec 24; they are measurements of a detector that
could only see declarations whose signature fitted on one line — which is also why
they appeared to originate in schema-heavy modules, since a single-line
`z.strictObject({...})` chain was one of the few shapes that detector could see.

**Re-measured immediately after the span fix** (results ledger, 2026-07-30): 20
consecutive commits, adjudication enabled, $0.0509 total. The detector now sees four
times as many declarations — **79, 3.95 per commit** — and reports **0.000 per
commit**, change-attributed and pre-existing alike. Against a gate of roughly 0.5 per
commit: **the gate is not blown; it is not approached.** The conclusion below that
"the gate is nonetheless blown" is withdrawn along with the numbers that produced it.

This does not rehabilitate the capability. It means the case against it was never
properly made either: the design was never run on most declarations. Both directions
are open, and the re-measurement is itself one repository, one 20-commit window, in a
codebase with unusually uniform style.

The subsection is kept rather than deleted because the reasoning it records — that
splitting a trait by position also splits a majority, and that the failure was
dominated by `pre-existing` reports rather than change-attributed ones — is what a
future re-measurement has to re-test, and because this project keeps its mistakes
visible.

Deterministic arm, no adjudication, no spend. `conformance check` run per commit
over two windows of this repository, each 40 non-merge commits, with the same code
in both arms except for whether a trait key carries its position.

| window | before | after | change-attributed, both arms |
|---|---:|---:|---:|
| 40 most recent commits | 1.00 / commit | **0.90 / commit** | 0.00 / commit |
| the 40 before those | 0.50 / commit | **0.50 / commit** | 0.025 / commit |
| combined | 0.75 / commit | **0.70 / commit** | 0.0125 / commit |

**Positional traits did not raise the firing rate; they lowered it slightly.** The
predicted extra noise did not appear, and the reason is visible in the diff between
the two arms: splitting a trait by position also splits a *majority*, so patterns
that were majorities only when two positions were pooled stop being reported. On
the recent window that removed five divergences and added one, and the one it added
is the intended shape.

**The gate is nonetheless blown, and was blown before this change.** The criterion
is roughly one report per two benign changes — 0.5 — and the measured rate is 0.70
combined. This is a fact about the capability, not about positional traits.

Three things qualify it, none of which rescues it:

- **Every report is `pre-existing`.** Change-attributed divergences run at 0.0125
  per commit across both windows and both arms, comfortably inside the gate. The
  gate is failed entirely by the odd-one-out findings this spec deliberately permits
  outside the diff, which are labelled and counted apart.
- **The rate is dominated by one module.** All 36 reports on the recent window come
  from two schema-heavy TypeScript files whose peer sets run to forty sibling
  declarations, and they are the same three or four divergences re-reported on every
  commit that touches those files.
- **It is strongly range-dependent**, 0.5 against 1.0 across two adjacent windows of
  the same repository. The **0.075 per commit** recorded earlier is therefore not
  comparable to these numbers and must not be read as a regression: the pre-change
  code measures 1.00 on the recent window and 0.50 on the older one, so that figure
  came from a different range, a different arm, or both.

Whether the capability survives is a decision about the gate, not about this change.

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

## Divergence Population Across 37 Real Repositories

Deterministic, offline, zero provider spend (results ledger, 2026-07-30): 37 hydrated
slices, 4 974 source files, 10 languages, **every declaration marked changed** — so
this is the total divergence *population*, not a firing rate.

| | |
|---|---:|
| declarations | 21 498 |
| peer sets | 21 339 |
| **divergences** | **849 (3.9%)** |
| repositories yielding ≥1 | **18 / 37** |

Two things follow, and the second is the serious one.

**The capability is not gated into silence.** On real code outside this repository it
does fire, at a rate that naively scaled by ~4 changed declarations per commit lands
around 0.16 per commit — inside the ≈0.5 criterion. That is an **estimate from a
population rate, not a measurement**: it assumes changed declarations diverge at the
same rate as all declarations, which is exactly what a real firing-rate run would
test.

**Yield is strongly language-dependent, which is a problem for a capability whose
selling point is language-neutrality:** rust 17.0%, typescript 14.2%, python 3.2%,
ruby 2.8%, go 0.7%. A 24× spread between Rust and Go is either a real property of
those ecosystems or an artefact of how indentation and lexical traits behave per
language, and this measurement **cannot separate them**. It MUST be settled before
the capability is recommended anywhere.

**And the seed can be blind.** Peer derivation rests on the deterministic
language-support registry. The JavaScript extractor recognises ESM exports and
nothing else — across four real JavaScript repositories (1 046 `.js` files) it
produced **6 declarations in total** — so `conformance check` reports "nothing to
say" on a JavaScript repository when the truthful answer is "cannot see". A zero from
this capability is only as meaningful as the extractor behind it.

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
| A trait carries its structural position, and the same symbol at materially different positions is not the same trait | unit test over both dimensions, plus the hermetic `map_claims.go` fixture asserting the three parsers' positioned traits |
| Position is derived from indentation alone, with no parser and no per-language table | unit test asserting a tab-indented and a space-indented body of the same shape yield identical positions |
| A wrap is not a position | unit tests: a chained call wrapped onto the next line, and a call on the header line against the same call wrapped, are one position |
| A pattern the declaration holds elsewhere is stated as displaced, never as absent | divergence unit test asserting the statement |
| A symbol that is a majority pattern at two positions is one divergence | divergence unit test |
