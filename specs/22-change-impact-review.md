# 22: Change-Impact Review

Status: Approved
Date: 2026-07-27

## Purpose

Tell a human reviewer what a change puts at risk **outside the lines it touches**,
with the evidence to judge it — not a verdict on whether the change is allowed.

Numbering skips 19–21; those specs were withdrawn after measurement and their
numbers are not reused, so the git history of the withdrawals stays readable.

## Why This Is A Separate Capability

The diff reviewer (spec 05) reviews changed code and is measured at **64.4%**
recall on defects inside the diff and **0.0%** on defects outside it — 0 of 81,
replicated across two independent answer keys. That is not a weakness to patch; it
is what a diff-scoped reviewer does.

Change-impact review asks a different question. Not *"is there a bug in this
untouched file"* — an open-ended hunt that has failed here five times — but
**"this change altered a contract; which dependents relied on it?"** That question
is directional, anchored on the diff, and has a definite starting point. It is a
different task from the one those five interventions attempted, and its results
must not be pooled with theirs.

## Command Surface

A **separate command**, not a flag on `review`.

Three capabilities behind one command producing one report would blend three
different jobs into one score. Blending is precisely the measurement error that
made this project's headline recall uninterpretable for months: 42.5% of the
answer key was silently asking a different question. Separate commands give
separate reports, separate evaluations, and separate decision rules.

Shared machinery — repository intake, provider resolution, configuration, path
service, admission, reporting — MUST be reused. Only the analysis is new.

## Design

1. **Contract delta.** From the diff, identify what each changed symbol's contract
   now is versus what it was: nullability, return shape, thrown or returned
   errors, ordering, mutation, concurrency, resource ownership, visibility.
2. **Dependent discovery.** Find code that depends on the changed symbols, using
   the existing `context-retrieval` domain. This is a **bounded, directed** lookup
   from named symbols, not open-ended repository search.
3. **Impact adjudication.** For each dependent, decide whether it relies on the
   part of the contract that changed, and what goes wrong if it does.
4. **Report as evidence.** Emit the dependent, the line, the specific reliance,
   and the consequence.

## Implementation Status, 2026-08-01

Measured against the 27 out-of-diff expectations of the stage-1 corpus — the
population this capability exists for, and the one `review` scores 0 on by design:

| | |
| --- | ---: |
| defect inside a symbol the report flagged as changed | **20 / 27 (74.1%)** |
| excluding languages the engine does not support | 20 / 25 (80%) |
| defect landed on by a listed reference | **0 / 27** |

That second row is not a failure and must not be read as one. References point at
DEPENDENTS ELSEWHERE, and these 27 defects sit inside the changed file itself, so
it is the wrong instrument for this population. It is the right instrument for
"caller breaks because a callee's contract moved", which this corpus does not
contain — a separate corpus is needed before that number means anything.

**74.1% is COVERAGE, not detection, and is not comparable to the review stage's
recall.** It says the defect fell inside the scope the report enumerates: a
necessary condition for the report being useful, nowhere near a sufficient one. The
stage still reports risk and never claims a defect.

### The gap between coverage and value

Every other stage here runs evidence → judgement → an artifact a human reads where
they already look. As recorded 2026-08-01, `impact check` stopped at evidence: JSON
on stdout, no rendered report, no artifact, no ranking beyond "references in files
the change also touched come first", and no statement of WHAT changed about a
symbol.

So a reviewer receives "`scheme` was modified, here are 49 places that mention it".
That is a bounded, deduplicated, comment-free `grep` — real work, and not yet a
feature. Two things close the gap, in this order:

1. **The contract delta (item 1 of Design, still unbuilt).** The difference between
   "`scheme` changed, here are 49 references" and "`scheme` may now return nil where
   it previously could not, and these 6 callers dereference it". This is the item
   that makes the reference list mean something, and it is what item 1 above already
   specifies: nullability, return shape, thrown or returned errors, ordering,
   mutation, resource ownership, visibility — diffed between base and head for each
   changed symbol. Without it the references cannot be ranked by anything better
   than "did this file also change", because nothing knows which references are
   exposed to which change.

2. **A rendered artifact.** The report must land beside `report.md` in the run
   directory, not only on stdout, or it is not in the workflow a reviewer actually
   uses.

**Both are now built.** (1) shipped as the deterministic contract delta recorded in
the audit table below. (2) shipped as `impact-report.md` and `impact-report.json`,
written into an `impact-<uuid>` run directory under `paths.artifactDir` — the same
place `review` writes `report.md` — with the Markdown path printed to stderr so
stdout stays exactly one JSON document. A disabled run writes nothing, because a
capability an operator has switched off must not accumulate empty run directories
in a repository whose owner asked for nothing, and impact runs are deliberately
absent from the run index, which feeds baseline resolution and expects a review
report. (The capability is on by default since 2026-08-11; when `review` runs the
lane in-process it writes `impact-report.json` beside the review's own artifacts
instead of into a directory of its own.)

The 74.1% remains a scope measurement quoted in this spec and NOT a capability
claim in user-facing documentation.

## Requirements

- The command MUST reuse repository intake, provider resolution, configuration,
  path service, and reporting. It MUST NOT reimplement them.
- The command MUST NOT extend the diff reviewer's admission gate. That gate
  requires a finding to sit inside the reviewed paths, and a change-impact finding
  is outside them by construction; admitting one there would either loosen the
  diff reviewer's scope guard or add a mode flag, which is the same thing named.
  Impact findings pass their own gate, composed from the shared primitives.
- The command MUST reach repository content only through `context-retrieval` and
  `repository-intake`. It MUST NOT open files directly. Spec 01 records
  consolidating repository reads as an unmet goal; this capability must not add a
  new divergent read site.
- Dependent discovery MUST be bounded and MUST start from symbols named in the
  diff. Unbounded repository search is forbidden: added context measured
  net-negative here twice, and the failure mode is well documented externally.
- Findings MUST carry the dependent's path and line, the contract element relied
  upon, and the consequence. **A finding without a named dependent is not a
  change-impact finding** and MUST be rejected.
- The command MUST be able to report **no impact** and MUST NOT manufacture
  findings to fill a report.
- The lane is **non-blocking**, and MUST NOT be configurable to block. There is
  nothing to block on until an impact finding is admitted, so a `blocking` key would
  be a switch that changes nothing — worse than absent, because an operator could set
  it and believe the build was gated. The config object is strict, so setting one is
  a configuration error rather than a silent no-op. A breaking change is
  frequently intentional; the tool's job is to surface the dependents, not to
  decide whether breaking them is acceptable.
- Instructions MUST remain generic and language-neutral, per spec 15's
  Non-Negotiable.
- Failure MUST be recoverable: a failed impact review does not fail the pipeline
  or the diff review.
- **On by default since 2026-08-11**, as a product decision about which questions a
  review answers — not as a measurement result. What made it defensible is that
  with `adjudication` off this lane makes **no provider call**: it is deterministic
  reference traversal, and it feeds nothing back into discovery, so it can neither
  help nor hurt review recall. `changeImpact.adjudication` remains **disabled**,
  measured and rejected on 2026-08-09 (0/7 against a pre-registered 40% bar).
  An operator can switch the lane off, and a run with it off is byte-identical to
  one from before the flip.

## The Precision Bar Is Unfalsifiable On This Corpus

Measured twice, 2026-08-06 and 2026-08-09, and it is a property of the answer key
rather than of its size:

**The key lists the dependents an upstream fix REPAIRED, not every file a change
affected.** A predicted file absent from the key is therefore not wrong — it may be a
real dependent nobody had to repair. Only a **lower bound** on precision is
computable; the upper bound is not measurable at any corpus size.

So the `precision >= 50%` promote criterion **cannot be confirmed or refused here**.
It is not a hard bar; it is an undecidable one, and no amount of harvesting changes
that. A confidence interval computed on it is meaningless — that mistake was made in
`reports/2026-08-09-impact-adjudication-prereg.md`, which argued from sample size that
the bar had become reachable, and cost 118 model calls to disprove against a ledger
entry that already said so.

**What remains decidable:** recall against the proven dependents (a real rate, since
the key enumerates them), and whether the model tier beats the deterministic arm.
Those two carry every adjudication decision until a corpus exists whose key
enumerates *every* affected file per change — a different and far more expensive
curation problem.

## Zero References Has Two Causes And They Must Be Told Apart

A run can end at `referenceCount: 0` two ways, and they call for opposite work:

- **Nothing was seeded.** No changed line fell inside a symbol this engine can
  name, or the files are in a language the extractors do not cover. The lane did
  not look. This is a defect to fix.
- **Symbols were seeded and nothing references them.** The lane looked and the
  dependent is linked by a relation no name-based search can follow — an attribute
  owner, a dynamic dispatch. This is the reachability ceiling this spec already
  documents, not a defect.

The report MUST distinguish them. Both produce identical counts, so a reader with
only the counts cannot tell a limit from a defect — and did not: this project's own
ledger recorded **three** corpus cases as seeding defects when only **one** was.
The other two seeded correctly (`_combinator_query`; `build_lookup`/`build_filter`)
and were unreachable by construction, which is a different and much weaker claim
than the one that was published. That misdiagnosis then framed "seeding is the
binding constraint" as the lane's headline problem for two days.

Neither warning may assert a cause it did not check. The seeded-nothing wording
already carries that scar — it once asserted "a language the extractors do not
cover" whenever zero symbols were seeded, sending an investigation after Ruby and
TypeScript files that were fully covered.

## Output Is Evidence, Not Verdict

The useful output is *"this function has six callers; two rely on the return value
you changed from nullable to non-null; here they are"* — **not** *"you broke it"*.

This is what the strongest published systems converged on, and it is also the
honest shape given that this capability will be less accurate than the diff
reviewer. A human deciding with six named call sites in front of them is better
served than one handed a confident verdict that may be wrong.

## Evaluation

Change-impact review CANNOT be measured by the existing corpus, and MUST NOT be
scored against it. That corpus reviews a reversed diff with every expectation
inside it; this capability's expectations are outside the diff by construction.

A separate corpus is required, with the inverse shape:

- `base = introducingCommit^`, `head = introducingCommit` — **not reversed**; a
  real change reviewed as it was made.
- Reviewed paths **P** are the files the change touches.
- Expectations live in **Q**, where `Q ⊄ P` — outside the diff.
- The change MUST be **locally plausible**: if the diff alone reveals the problem,
  the case belongs in the spec 17 corpus instead.

**Evidence bar for a case.** The breakage MUST be proven by upstream history — a
later commit fixing the dependent and referencing the change, a revert, or an
issue naming the caller-side symptom. **A curator's inference that something
*might* break is not admissible.** This corpus's entire value is that the damage
actually happened.

Each case MUST record a **reachability label**: whether the dependent imports the
changed file, calls the changed symbol directly, or is linked only by a relation
no local lookup would surface. Recall MUST be reported per reachability class,
because a capability that finds direct callers and misses indirect ones is useful
and should not be scored as if those were the same problem.

Decision rule, fixed before the first measurement:

- **Ship enabled by default** only if recall on directly-reachable dependents is
  high enough to be worth reading and false-positive rate is low enough that a
  human is not trained to ignore it.
- **Ship disabled** if it finds real dependents but too noisily to default on.
- **Remove** if it cannot beat naming the changed symbols and letting the human
  grep.

That last bar is deliberately concrete. A deterministic caller list is cheap; this
capability must earn its cost against that, not against nothing.

### The Corpus, As Built

Built 2026-08-06 at `eval/corpora/change-impact-dependents/manifest.json`,
hydrated by `npm run eval:impact-corpus:hydrate`. **It is data, not a
measurement**: nothing has been scored against it, and no number below is a
result.

Ten cases carrying **eleven proven-broken dependents**, from two upstream
projects: django (9 cases, BSD-3-Clause) and grpc-go (1, Apache-2.0). Every case
was accepted only after the introducing change, the upstream repair and the
dependent's own code were read at the introducing commit.

| Reachability class | Dependents |
| --- | ---: |
| `caller-of-changed-symbol` | 3 |
| `callee-of-changed-code` | 2 |
| `attribute-owner` | 1 |
| `whole-repo-search` | **5** |

The first three are the **directly reachable** population — a reference lookup
seeded from a symbol the diff names lands on them, so they are the population the
promote-to-default bar is scored on. The five `whole-repo-search` dependents share
no import edge, no call and no identifier with their change; they are retained
because this section requires the class to be REPORTED rather than dropped, and an
engine that scores zero on them is behaving as designed.

**Contamination split: 2 held-out, 8 dev.** Held-out requires the introducing
commit to postdate the declared cutoff (`2026-01-01`), and the evidence lands
3–12 months later still, so the window is as narrow as this spec predicted. Both
populations are non-empty by design — a split nobody can report is a field, not a
control — and results MUST be reported split rather than pooled. **Eight of ten
cases are old enough that the model has very likely seen both the change and its
upstream fix.**

**Enforced, not trusted.** The manifest has its own schema
(`change-impact-corpus.schema.ts`), a sibling of spec 17's rather than a mode flag
on it, because spec 17's central invariant is the exact negation of this one and a
schema whose central rule is conditional enforces nothing. It refuses: an
expectation inside the reviewed paths; a case with no `evidenceOfBreakage`; an
evidence entry that repairs no expected dependent (this is how "a curator's
inference is not admissible" becomes enforceable rather than a rule someone is
trusted to have followed); evidence dated before the change it claims to prove
broke something; a missing reachability label; a non-permissive license; a
held-out case predating the cutoff; and two expectations on one destination file,
because the destination file is the scoring unit. Hydration additionally verifies
against the real checkout that the declared parent is the upstream parent, that
the diff touches nothing undeclared, and that **every expected dependent exists
and has the lines the answer key points at** — a range that fell off the end of a
file would score a correct prediction as wrong forever, silently.

**What this corpus can measure:** whether a predicted destination file is a
dependent upstream had to repair, per reachability class and per contamination
split; whether the deterministic reference list alone already contains that file,
which is the remove-criterion's baseline arm; and what adjudication removes
relative to that list.

### The Scorer, As Built

Built 2026-08-06 as `eval impact`, in
`src/domains/evaluation/change-impact-eval/`. **It is an instrument, not a
result**: no number has been produced by it, and nothing in this repository or in
`docs/` quotes one.

That subfolder holds the whole family — corpus schema, hydration, scoring,
report, rendering, metrics versions — deliberately apart from the diff
reviewer's equivalents, which are grouped by role one level up. The two are
scored against different corpora with different answer keys and must never be
pooled or given each other's `--slice-root`/`--manifest`; filing them side by
side by technical role would invite exactly that.

The unit is the destination FILE, per the pre-registered decision rule and the
file-granularity result recorded under Prior Art. It scores THREE ARMS, and emits
them together because the comparison between them is what the removal criterion is
stated against:

1. the deterministic reference list — `impactedFiles` ∪ `impactedTestFiles`;
2. the adjudicated list — `impactFindings`;
3. the difference: what adjudication removed **per tier**, of which the removals
   that dropped a proven dependent are counted as **provably wrong**. There is
   deliberately NO "correct removals" count, because a removed file absent from
   the answer key might have been noise or a dependent nobody listed, and this
   corpus cannot tell those apart. Crediting them would convert the answer key's
   incompleteness into evidence for the layer under test. And since 2026-08-06
   there is deliberately no POOLED total either: a case that spent no model call
   is reported apart from one that did, because adding the two produced the figure
   the voided first measurement was misread from.

Five bindings, each of which is a way this measurement could otherwise lie:

- **Recall is split, never pooled.** Per reachability class, per contamination
  split, and per the directly-reachable / whole-repo-search halves. The scorer
  publishes no blended recall figure at all, so there is none to quote.
- **Precision is a bracket whose upper bound is permanently absent.** The lower
  bound is raw precision; the upper bound reports *not measurable on this corpus*
  and no judge can change that, because the answer key is not an enumeration.
  Unlike the diff reviewer's bracket this is a property of the corpus, not of
  whether a judge ran.
- **The decision rule's denominator is the reference list**, not the whole answer
  key: adjudication cannot report a file discovery never found, and scoring it
  against files discovery missed would charge it for discovery's misses.
- **Absence is never zero.** A case that did not hydrate, a checkout whose commits
  or answer key disagree with the manifest, an engine error, a `disabled` run, an
  arm no run answered, and a dimension with no expectations all render as
  not-measured. A `0.0%` cell means the engine looked and missed.
- **A completed adjudication is not an exhaustive one.** Two of the four
  situations the known-not-reported list names — a failed call, and the `maxCalls`
  cap — occur inside a run that completed. Where any pair is left unadjudicated a
  reported dependent still counts as found (a hit is unambiguous) but an
  unreported one is UNDETERMINED rather than a miss, and the case contributes
  nothing to arm 3, because "removed" cannot be told from "never checked". The
  unadjudicated pair count and the truncated-case count are reported so a low
  arm-2 figure produced by the cap is visible as such.
- **A completed adjudication is not a model that ran, either.** The scorer reports
  the model calls each case spent, the number of adjudicated cases that spent
  none, and the `relies` / `does-not-rely` / `undetermined` distribution the model
  returned. Arm 3 is split by tier on that count and publishes no combined total.
  Added 2026-08-06 after the first measurement was voided; see "The instrument
  gap, closed" below for why the treatment is attribution rather than exclusion.
- **It cannot be pooled with the spec 17 corpus.** A separate metrics-version
  history, a `reportKind` literal the two report contracts reject each other on,
  separate artefact names under `.codereviewer/eval/change-impact/`, and no
  `--slice-root` option — the flag that selects spec 17's corpus is unknown to this
  command and a typo exits 2. There is still no combined hydrate-and-run npm
  script.

Provenance carries the engine commit, whether its working tree was clean, the
provider and model, the config hash and an answer-key digest per case. A rate is a
property of a build and a model; this repository has already had to void figures
that could name neither.

**What it cannot measure:** precision in any trustworthy sense. Eleven dependents
across ten changes is not an enumeration of everything each change broke, so an
unlisted prediction is not thereby wrong, and raw precision on this corpus is a
lower bound in the same way spec 17's is. It also cannot see `breaks-on-build`:
every accepted case is `breaks-at-runtime`, because a change that deletes a
declaration outright is rarely merged without its callers, and the mining
convention that makes the evidence link resolvable does not surface the ones that
are. Nor can it settle anything on its own — this spec already binds that a single
run decides nothing, and eleven dependents make that bind harder, not softer.

**Yield, and why the corpus is this small.** 101,542 commit bodies were screened
across 27 repositories over two passes, 166 candidates cleared the mechanical
filters, and 10 survived adjudication. The binding constraint is exactly the one
this spec records: the link is resolvable only where a project writes the causing
commit's full object name, and django's mandated `Regression in <sha>.` line
produced 9 of the 10. The rejection reasons are recorded in the manifest's
`screening.rejections` so nobody re-derives them. **A larger corpus is not
available at this cost, and padding it with inferred breakage would destroy the
only property it has.**

### The severity tension is dissolved, not merely resolved

*What Mining The First Fixtures Established* records four of seven mined
expectations rated `low` against a `medium` actionable threshold, and requires
that to be settled before the first measurement. **The compatibility class settles
it, and the mechanism is worth stating precisely, because "we changed the label"
would not settle anything.**

The tension was never about severity values. It existed because a `low`
expectation could only be matched by a candidate that had cleared
`aiReview.actionableSeverityThreshold`, and **impact findings do not pass that
gate at all.** They pass the gate in `change-impact`, which imports nothing from
the diff reviewer's `admission` domain and applies no severity threshold; they
carry a compatibility class and no severity; and the class ranks a reader's
attention rather than deciding admission. There is therefore no filter for a `low`
expectation to fall through, and the corpus's severity skew costs nothing.

Two consequences bind the corpus:

- **Severity is descriptive metadata here and is not a scoring input.** The
  manifest records it and its rationale so a reader can compare this corpus with
  spec 17's, and nothing may be relabelled to move a number. Relabelling fixtures
  to fit a gate remains forbidden, and it is now also pointless.
- **The corpus asserts a compatibility class per dependent**, restricted to the
  three a finding can carry. `no-impact` is inexpressible by construction: this
  corpus holds only damage that actually happened. A test pins the corpus's
  vocabulary to the reportable subset of the implemented one, so the answer key
  and the lane cannot drift apart while nobody is looking.

## What Mining The First Fixtures Established

A first pass screened **66,685 commit bodies across 27 repositories** and yielded
**5 usable candidates with 7 expectations**. Three facts from that pass should
shape how this corpus is built, and all three are cheaper to accept now than to
rediscover later.

### The binding constraint is commit-message convention, not defect rarity

The evidence bar requires linking a later fix to the change that caused it. That
link is only mechanically resolvable when a project writes the causing commit's
**full sha** in the fix. Django mandates a literal `Regression in <sha>.` line and
produced **4 of the 5** accepted candidates. Everywhere else the link is a pull
request number, which resolves locally only for squash-merge repositories and is
far noisier.

Measured yield: roughly **1 usable case per 13,000 commits overall**, but about
**1 per 1,000 in a repository with a sha-reference convention** and near zero
without one.

Consequence for curation: further mining SHOULD target projects with that
discipline rather than pushing harder on the existing manifest. Any such project
must clear the permissive-license allowlist before use, which the current
manifest's repositories already have and new ones will not.

### Severity skews low, and that collides with the admission threshold

Change-impact damage usually surfaces as a **loud** failure — a crash, an
exception, a broken build. Spec 05's severity rubric rates a signalled failure
below a silent one, correctly, because a loud failure is detectable. **Four of the
first seven expectations are therefore `low`**, and the default actionable
severity threshold is `medium`.

A `low` expectation can only be matched by a candidate the engine itself rated
`medium` or above — a severity the answer key says is wrong. This is an unresolved
tension between the rubric and this capability, **not** a licence to inflate
severities in the corpus. It MUST be settled before the first measurement, and the
resolution MUST NOT be to relabel fixtures to fit the gate.

### The held-out window is structurally narrow

A case is only contamination-safe when the **introducing** commit is after the
training cutoff — but the **evidence** commit must be later still, and the
observed fix-lag is 3–12 months. That lag eats most of any post-cutoff window, and
will keep doing so. Only 2 of the first 5 candidates cleared it.

Consequence: this corpus will lean on `dev`-split cases longer than spec 17's did,
and results MUST be reported split by contamination risk rather than pooled.

### Rejection patterns worth reusing

Automated integration merges and dependency bumps quote unrelated pull-request
bodies and are structurally worthless. Revert commits reference the merge base
rather than the reverted commit. Apparent file-set disjointness is frequently a
directory rename. "Follow-up" usually means extending the same hardening to a
sibling, not repairing damage.

## First Deterministic Run — What It Showed

The deterministic core shipped 2026-07-27 and was run against this repository's own
branch: 361 changed files, 28 deleted, 50 changed symbols (seed cap reached), 46
symbols referenced elsewhere, **231 reference sites**, seconds of wall clock, zero
provider cost.

It works, and it is not yet good enough to enable. Bucketed by the kind of file a
reference landed in:

| destination | share |
|---|---:|
| source | **68.4%** |
| tests | 13.0% |
| documentation and specs | 10.0% |
| evaluation fixture data | 7.4% |
| other | 1.3% |

**Roughly a third of reference sites are not dependents in any useful sense.** A
symbol name appearing inside a JSON fixture, a specification paragraph, or a
snapshot is textual coincidence, not a dependency. Identifier-boundary matching
removed substring noise; it cannot distinguish code from prose that happens to
contain the identifier.

### Requirement added as a result

Dependent discovery MUST restrict reference sites to files eligible for review
under the configured include/exclude rules, and MUST exclude non-source
destinations. A reference list a reader has to filter by hand fails this
capability's own bar — beating a plain `grep` — because filtering by hand is what
`grep` already makes them do.

This is recorded from a real run rather than anticipated, and it is the kind of
defect only running the thing surfaces.

### How that requirement is met

Two filters, deliberately kept distinct because they answer different questions.

**May this file be looked at?** The configured `paths.include`/`paths.exclude`
rules, applied by `context-retrieval`'s existing eligibility gate during
traversal. Nothing about "eligible file" is restated in this capability; a second
definition of the reviewable surface would be a defect of its own.

**Can this file hold a dependent?** A destination is a candidate only when a
supported language covers it. That set is the deterministic language-support
registry — the same registry that decides which files can seed a changed symbol —
so the two ends of the lookup agree by construction, and adding language support
widens both at once. A fixed extension list is forbidden by spec 15's
Non-Negotiable and would rot; there is none.

Three consequences, each a deliberate choice rather than a side effect:

- **Test call sites are listed, in their own bucket.** A test that calls a changed
  symbol is a real dependent and will break, so dropping it would lose signal.
  It breaks in CI rather than in production, and on a large change test sites can
  outnumber the production ones, so it does not share the production list either.
  Test files are recognised by each language's own convention, reusing the same
  predicate the test-mapping discovery uses.
- **Withheld sites are counted, not hidden.** Non-source matches are reported per
  symbol and in the summary. A report that silently dropped them would look
  cleaner than the search actually was.
- **The classification runs after the search**, not inside it, so the mediated
  filesystem seam keeps no policy hook and the withheld counts are exact. It runs
  BEFORE the reporting cap, so the cap is never spent on a match the
  classification discards — see "The Cap Selects, It Does Not Truncate" below for
  what that ordering was until 2026-08-06 and what it cost.

### Second Deterministic Run — After The Fix

Both columns below are a fresh `main…HEAD` run on this repository, bucketed the
same way — the "before" column re-measures the defect rather than reusing the
first run's table above, whose range and cap-limited seed were different. Before,
every site the reader saw was in one list:

| destination | before | after |
|---|---:|---:|
| source (production) | 116 (70.3%) | 119 — **100%** of the primary list |
| tests | 28 (17.0%) | 26 — listed in their own bucket |
| documentation and specs | 4 (2.4%) | 0 — withheld and counted |
| evaluation fixture data | 17 (10.3%) | 0 — withheld and counted |

165 sites in one undifferentiated list became 119 production sites, 26 test sites
beside them, and 21 withheld as non-source and reported as a count. The small
movement inside the source and test buckets is this change's own diff moving the
seed; the shape of the defect, and its removal, do not depend on it.

## Prior Art, And What It Changes

Researched 2026-07-29. Full notes in the scratchpad research files; the
decision-relevant findings are recorded here because several change the design.

### Report at file granularity, not per site

RIPPLE (Yadavally & Nguyen, *From Seed to Scope*, ICSE 2026,
DOI 10.1145/3744916.3773265) is this spec's task done academically. Scoring the
**identical predictions** at file granularity rather than method granularity moves
precision **28.2% → 60.9%** and F1 **25.0 → 54.6**. This is free and it is the
highest evidence-to-cost item found. Findings MUST therefore be reported per
destination **file**, with the individual sites nested beneath. Built 2026-08-05
as report schema `2.0`.

### Calibrate expectations: ~28%, not ~87%

RIPPLE's deterministic dependence baseline — the direct analogue of our reference
list — scores **7.6% precision / 64.7% recall**. Its full LLM layer reaches
**28.2% precision at the cost of 44% of the recall**.

**If our first measurement lands near 28% precision that is a normal result for
this task, not a broken implementation.** The diff reviewer's adjusted precision
is not the comparison; this is a harder problem with a far weaker published
ceiling. (The heading's ~87% was the diff reviewer's figure when this was written;
it is ~99% today, which only widens the gap and changes nothing about the point.)

### Adjudication is the entire precision lever

Across 119,879 Maven upgrades and 293,817 clients, only **7.9% of clients are
affected** by a breaking change (Ochoa et al., EMSE 2022, arXiv:2110.07889);
Xavier et al. (SANER 2017) put client impact at **2.54%**. **Without step 3 the
report is roughly 90% noise by construction.** The first run's prose-and-fixture
noise was the shallow version of this problem; this is the deep one.

### Most of the taxonomy needs no model at all

Breaking-change tooling has already enumerated and validated the contract
categories — japicmp publishes **63** compatibility constants each carrying
`(binaryCompatible, sourceCompatible, semverLevel)`; Revapi ~90; `cargo-semver-checks`
253 lints. Distilled to a language-neutral form this is roughly **8 axes and ~40
categories**, of which **about 24 have a deterministic reliance predicate**.

Those beat a grep with no model involved. **The model's job collapses to roughly
ten named yes/no questions**, concentrated in nullability, ordering, error
behaviour, mutation, and serialised values. Contract-delta detection MUST
therefore be deterministic wherever the category admits it, and the model MUST be
reserved for the residue.

Calibration for that residue: japicmp scores **F1 0.86** and Revapi **F1 0.91**
(Roseau, arXiv:2507.17369) — bytecode-complete, Java-specific, decade-old tools
still misclassify 10–14% of the taxonomy they themselves define. A
language-neutral layer will sit below that.

### Behavioural changes are the majority, and they are visible in the hunk

In npm, **68.1% of 1,519 breaking-change commits are behavioural rather than
signature** (arXiv:2408.14431), ordered: option handling (231), defaults (203),
return shape (79), error handling (42). All four are visible **inside the diff
hunk** and need no repository context — which is fortunate, because everything
that detects them reliably today either runs the test suite or uses symbolic
execution.

### Removals must be paired with additions before reporting

A naive symbol diff reports a move, rename, extract, inline, push-down or pull-up
as a **removal** — the most severe category — when the symbol is present under a
new name. Refactoring-aware pairing of removals against additions is required
before a removal may be reported. Built 2026-08-05; see "Removal pairing" below
for the predicate and for what it does and does not catch.

### Publish a known-not-reported list

Go's `apidiff` documents the five breakages it deliberately does not detect. A
documented list of what this capability knowingly misses is what stops a
low-recall tool from reading as a broken one, and it is required. Published
2026-08-05; see "What this capability knowingly does not report" below.

### There is no LLM prior art to beat

A 2026 systematic review covering 43 breaking-change detection techniques reports
**no LLM-based technique in the literature at all**. So this spec's removal bar —
beat naming the changed symbols and letting the human grep — is not a modest
target chosen for humility. **It is the only available baseline.**

## Resolved: Compatibility Class Instead Of Severity

**Decided 2026-08-05. Change-impact findings carry a compatibility class, not spec
05's severity.** This section previously proposed the change for human decision;
it now records the resolution and the reasoning, because the reasoning is the part
a future reader will need.

The recorded tension — four of seven mined expectations are `low` while the
actionable threshold is `medium` — was a **category error, not a severity error**.

**None of the established tools rates breaking changes by severity at all.**
japicmp, Revapi and `cargo-semver-checks` each rate on a **compatibility axis** and
leave the consequence to the consumer. Revapi's third value, `Potentially
Breaking`, means precisely "a human must look" — this spec's stated output shape,
already validated in production tooling.

**And spec 05's rubric answers a different question.** It rates "how bad is this
defect", calibrated so a signalled failure rates below a silent one, correctly,
because a loud failure is detectable. Change-impact damage is loud almost by
definition — a crash, an exception, a broken build — so routing it through that
rubric systematically produced `low`, against a `medium` gate. Spec 05's rubric is
not wrong; it is the wrong instrument. Both stay intact by separating them.

The class is **mechanism, not judgement**:

| Class | What it states |
| --- | --- |
| `breaks-on-build` | The declaration the dependent names is gone. How the dependent uses it does not matter; the reference cannot resolve. |
| `breaks-at-runtime` | The declaration survives under the same name, so a build sees nothing. What moved is behaviour, and this dependent was shown to rely on the part that moved. |
| `may-break` | The mechanism is known and the outcome is not — a relocation, or a removal this run could not verify. Revapi's third value: a human must look. |
| `no-impact` | This engine has no evidence that the dependent relies on a changed part of the contract. **Never "safe"**: a statement about what was shown. |

`no-impact` is an adjudication outcome and is **never reported as a finding** —
the admission gate refuses it. Reporting one would be manufacturing a finding to
fill a page, which this spec forbids.

There is **no gate on the class**. The lane is non-blocking and MUST NOT be
configurable to block, so the class ranks findings for a reader and decides
nothing. **This is not a licence to relabel fixtures to fit a gate**, which
remains forbidden.

## Impact Adjudication — Design Step 3

Built 2026-08-05. **Unmeasured**; see the calibration and decision rule below
before reading any result from it.

### Deterministic first, model only for the residue

The prior-art section above records that of roughly 40 contract categories about
24 have a deterministic reliance predicate and "beat a grep with no model
involved", and that the model's job "collapses to roughly ten named yes/no
questions". The split implemented here follows exactly that line, and the line is
**structural versus behavioural**, not a heuristic about cost:

- A **structural** change — the declaration is gone, relocated, or newly added —
  has a reliance predicate that is *already answered*. Discovery established that
  this file names the symbol, and what changed is whether the name resolves at all.
  There is no second question about how the dependent uses it. Sending one to a
  model would pay for an answer already in hand and add a way to get it wrong.
- A **behavioural** change — the declaration survives under the same name and what
  moved is what it does — has the reliance predicate "does this use touch the part
  that moved", which is a reading question about the call site. **That is the
  residue, and it is the only thing that costs a call.**

| Situation | Adjudicated by | Class |
| --- | --- | --- |
| Removed, pairing `none` | code | `breaks-on-build` |
| Removed, pairing `inconclusive` | code | `may-break` |
| Moved (paired `same-name`) | code | `may-break` |
| New | code | `no-impact` |
| Modified, no contract change detected | code | `no-impact` |
| Modified with a contract change, model says it relies | model | `breaks-at-runtime` |
| Modified with a contract change, model says it does not | model | `no-impact` |
| Anything the model could not settle, or that no model saw | — | **unadjudicated: counted, never reported** |

The last row is load-bearing. An unadjudicated dependent — no provider, a failed
call, an answer that could not decide, or one past the call cap — is **counted in
the summary and reported nowhere as a finding**. Reporting the residue as a maybe
would restate exactly the ~90% noise adjudication exists to remove while looking
like triage.

### The model call writes no prose

The one model call answers `relies` / `does-not-rely` / `undetermined` and gives a
line. Its output schema has **no free-text field**, and the consequence sentence
every finding carries is composed **in code** from the contract dimension. This is
spec 23's measured constraint applied here: spurious rejection of model
requirement-conformance judgement runs at 26–36% and rises to **73–88% when the
same call is also asked to explain its verdict**. A cited line that is not one the
search located is discarded, which turns the answer into `undetermined`.

### Granularity

Adjudication runs per **(destination file, changed symbol) pair** and findings are
grouped per **destination file** — one finding per dependent, several reliances
under it. Per-site adjudication is not reintroduced: the file-granularity result
above (precision 28.2% → 60.9%) is why the report is file-granular, and a finding
per site would rebuild the per-method scoring by another name.

### Its own admission gate

Impact findings pass a gate in `change-impact`, composed from shared primitives
(the redactor, field-bound truncation, hashing) and importing nothing from the
diff reviewer's `admission` domain. The two policies are opposites: that gate
admits a finding **inside** the reviewed paths, and an impact finding is outside
them by construction. The gate rejects a candidate that names no dependent, names
a dependent this run never located, points at a line the search never found, names
a symbol that does not reach that dependent, omits the contract element or the
consequence, carries `no-impact`, or duplicates an already-admitted dependent.

### Separately disabled

`changeImpact.adjudication.enabled` defaults to `false`, **independently of
`changeImpact.enabled`**. Everything else the command does is deterministic and
free; adjudication is the only part that can reach a provider, and turning the
command on must not silently start billing an operator who asked for the reference
list. `changeImpact.adjudication.maxCalls` bounds model calls only.

## Calibration — What A First Measurement Should Look Like

Recorded **before** any measurement exists, so nobody reads the first number as a
failure.

- The published deterministic baseline for this exact task scores **7.6% precision
  / 64.7% recall**. Adding an LLM layer reaches **28.2% precision at the cost of
  44% of the recall**.
- **If the first measurement lands near 28% precision that is a normal result for
  this task, not a broken implementation.** The diff reviewer's ~99% adjusted
  precision is *not* the comparison; that is a different question with a far
  stronger instrument behind it.
- **Adjudication is expected to REDUCE recall relative to the raw reference list,
  and that is the intended trade.** The reference list is roughly 90% noise by
  construction; a layer that removes noise removes some signal with it. A run that
  loses no recall has almost certainly adjudicated nothing.
- Language-neutral text reading will sit **below** japicmp's F1 0.86 and Revapi's
  F1 0.91, which are bytecode-complete, single-language and decade-old.

**No performance number for adjudication exists.** None may be invented,
estimated or extrapolated in this spec, in `docs/`, or in the report. Every
user-facing statement about it says it is unmeasured.

## Pre-Registered Decision Rule For Adjudication

Fixed **before** the first measurement, per this spec's Evaluation section, and
scored on the corpus that section specifies (`Q ⊄ P`, breakage proven by upstream
history, recall reported per reachability class).

The unit is a **destination file**. A predicted file counts as correct when the
corpus's proven-broken dependent is that file.

- **Promote to enabled by default** only if all four hold on the
  directly-reachable class: precision **≥ 50%**; recall **≥ 40%** of the
  dependents the reference list itself contains; the deterministic tier alone does
  not already match it (adjudication must earn its call cost); and no admitted
  finding in the corpus names a dependent that is provably unaffected. Adjudication
  enabled by default still leaves the lane non-blocking.
- **Keep disabled, and keep shipping it** if it finds real dependents but misses
  the bar above — precision ≥ 25% with recall ≥ 25% is the "real but noisy" band,
  and it is the band the published prior art sits in. This is the expected first
  outcome.
- **Remove** if either: precision falls below 25%, so a reader is being trained to
  ignore it; or the model tier does not beat the deterministic tier on the same
  corpus, in which case the calls buy nothing and the deterministic tier stays on
  its own.

Two rules that bind regardless of the numbers:

- A single run does not decide anything. This engine's measured run-to-run band is
  several points wide on much larger denominators, and this corpus will be small.
- **Fixture-fitted prompt or predicate changes are forbidden**, as everywhere else
  in this project. A change to the adjudication prompt or to the deterministic
  predicate must be justified from public knowledge about breaking changes, never
  from a case it failed.

## First Adjudication Measurement, 2026-08-06 — DIAGNOSED AND VOID

Adjudication was scored for the first time against the corpus above, on engine
`fd5fc18`, `openai/gpt-5.3-codex`, `--max-adjudication-calls 60`, $0.075.
**The run is VOID. It measured a defect in the contract delta, not the layer under
test, and it must be re-run before any figure from it is quoted.** The removal
criterion is NOT satisfied by it and MUST NOT be acted on from it.

What it reported: 67 destination files from the reference list containing 5 proven
dependents (directly-reachable recall 50%, 3/6); 3 files after adjudication
containing 0; and, over the six cases adjudication completed exhaustively, 15
reference files in and **0** out, of which **3 removals dropped a dependent
upstream actually had to repair**.

**Retaining zero of fifteen is a defect signature, and it was one.** This spec
records the precedent: spec 16's cross-file retrieval was carried as "measured net
negative" for months, and the verdict turned out to be measuring a silent read
truncation rather than the feature. The same reading error was available here and
is written down so nobody makes it: *adjudication removed everything* was not what
happened.

### What the diagnosis found

**The model was never called on any of it.** In all six exhaustively adjudicated
cases the model tier ran **zero** times. Every one of the 15 removals came from
the deterministic tier's `no-impact` branch, which is reached when a modified
symbol carries an EMPTY contract delta — the row this spec's own adjudication
table already specifies. The 55 calls the run did make were spent on the four
cases that were NOT exhaustive, so arm 3 — the arm that reads "adjudication
removed everything" — contains no model verdict at all.

**And two of the three provably wrong removals were caused by a defect in the
contract delta**, fixed 2026-08-06: `describeContractDelta` matched its dimension
markers against raw diff text, **including comment lines**. The failing shape is
the ordinary one — a deprecation shim carrying its eventual replacement in a
comment, completed by deleting the comment and writing the construct for real:

```
-                # raise ValueError(                     <- a comment
-                warnings.warn(...)
+                raise ValueError(...)                   <- the real change
```

The `failure` dimension saw `raise` on both sides, called itself symmetric, and
reported that the symbol changed nothing observable. From there the deterministic
tier settles every dependent as `no-impact` in code, spends no call, and reports
nothing — silently, because an empty delta is the ordinary outcome and there is
nothing on the page to say a real one was cancelled by a comment. This is the
repository's recorded silent-optimism class: a missing input producing a plausible
answer instead of an error.

The fix is the smallest one and is justified from the mechanism rather than from
the case it failed: **a commented-out construct is not something a caller can
observe, so it can neither create a contract change nor cancel one.** Discovery
already dropped whole-line comments for the same reason; the predicate is now one
definition (`comment-lines.ts`) shared by both, so the two cannot disagree about
what code is.

The third wrong removal is NOT a defect. It is a URI query parameter added inside
a connection string, which carries no marker on either side — the documented limit
of reading six text-visible dimensions, entry 14 of the known-not-reported list.

### Each hypothesis, and what ruled it out

| Hypothesis | Verdict |
| --- | --- |
| The model answers `does-not-rely` to ~everything | **Ruled out.** 12 recorded packets replayed live returned 10 `does-not-rely`, 2 `undetermined`, 0 `relies` — but every one of those packets was genuine noise (a search for `__init__` matches every constructor in the repository), so `does-not-rely` was the correct answer. The run's own `django-aggregate-source-expressions` case admitted 3 findings, which only the model tier can produce for a `modified` symbol. |
| The packet shows the model too little | **Ruled out as a defect.** The packet carries the changed symbol's name, the contract-change statements, the dependent's path and every located site with its text — exactly what this spec specifies, and only behavioural changes reach it by design. |
| The verdict is mapped wrongly, or the `no-impact` exclusion is inverted | **Ruled out.** `relies` → `breaks-at-runtime` finding, `does-not-rely` → `no-impact` → never reported, anything else → unadjudicated → never reported. Verified end to end: a replay of the repaired iterator case produced 4 `relies` answers that became findings. |
| The cited-line rule discards real answers | **Ruled out.** It never fired in 18 live calls. Every `relies` answer cited a line from the list it was given (222, 74, 150, 137). |
| The `changedSymbolKey` identity bug is back | **Ruled out end to end on real cases.** Packets were built with non-empty `contractChanges` on four cases, which is only possible if the lookup `runAdjudication` performs finds what `collectContractChanges` stored. The delta was empty where the delta was genuinely empty, not where the key missed. |

### What the re-run is owed, and one instrument gap it must close

The measurement must be re-run on a pinned engine that contains the comment fix,
and nothing from the voided run may be pooled with it. Diagnosis established that
the repaired path reaches the model on the iterator case and that the model cites
both proven dependents; **that is a diagnostic observation on one case and is not
a result** — this spec already binds that a single run decides nothing.

**The report could not distinguish a deterministic `no-impact` from a model
`no-impact`.** `noImpactPairCount` pooled both, and that pooling is what let a run
in which the model never fired read as a run in which the model rejected
everything. A reader of arm 3 needs to know how many calls the run actually spent.

### The instrument gap, closed 2026-08-06

Built before the re-run, and it changes no adjudication behaviour whatsoever — it
makes the behaviour legible. Four changes:

1. **The pooled `no-impact` counter is gone.** The report carries
   `deterministicNoImpactPairCount` (settled in code, no call spent) and, in
   `modelVerdictCounts`, the model's own `does-not-rely` count. **There is no
   pooled field at all**; the sum is derived where it is shown and labelled as a
   sum. The pair counters still partition every pair exactly once.
2. **The calls are counted.** `summary.adjudicationCallCount` and
   `failedAdjudicationCallCount` are reported per run, and per case and in
   aggregate by the scorer. Zero is never printed as a bare `0`: it renders as
   *"none — the model tier was never called"*, because zero is the value that
   changes what every other adjudication number means.
3. **The verdict distribution is published.** `modelVerdictCounts` carries
   `relies` / `does-not-rely` / `undetermined` over the calls that returned. The
   degenerate distribution this spec had to rule out by replaying 12 recorded
   packets is now visible on the page.
4. **Arm 3 is split by TIER and publishes no combined total.** A fully adjudicated
   case that spent zero calls contributes to `deterministicTierOnly`; one that
   spent at least one contributes to `modelInvolved`. When the second group is
   empty the document states outright that no fully adjudicated case spent a
   model call, and that nothing in the arm is evidence about the judge.

**Why arm 3 labels rather than excludes.** Excluding zero-call cases was the other
option, and it is the treatment this scorer already applies to non-exhaustive
cases — but for a different reason. A partially adjudicated case cannot tell
"removed" from "never checked", so its removals are genuinely unknowable and there
is nothing to report. A zero-call case hides nothing: the removals happened, they
are correctly counted, and the corpus can still prove some of them wrong — the
three provably wrong removals of the voided run were real and were diagnostic.
Only *who removed them* was missing. Deleting sound data to prevent a misreading
costs more than attributing it, so the data stays and carries its tier. No
attribution finer than the case is available: the report is file-granular and a
file's pairs can be settled by either tier, so a case that spent calls is reported
as mixed rather than split by a guess.

This bumps the change-impact metrics version to
`2026-08-06.adjudication-tier-attribution`, affecting `adjudicationDelta` only:
recall and precision are computed from the same predictions and are unaffected,
but a pre-bump removal figure is the sum of the two new groups and may not be
compared against either.

## Spans Are Read, Not Guessed — 2026-08-06

The 2026-08-06 adjudication measurement recorded that **five of ten cases spent
zero model calls**, and named seeding as the next constraint. Investigating that
found a defect in seeding, but not the one expected, and the honest result is
recorded here in full because two thirds of the expectation was wrong.

### What the three zero-reference cases actually were

Only ONE of the three enumerates nothing because seeding failed:
`django-messages-package-import-pulls-in-level-tag-initialisation` changes a file
whose entire content is import statements. It declares nothing, so no span exists
to touch. That is entry 4 above, it is the shape that raises the warning, and
widening the seed to imports would invert this capability's direction.

The other two seed correctly and enumerate nothing for a DIFFERENT reason.
`django-union-default-ordering` seeds `_combinator_query`, a private helper whose
only references are inside its own file; `django-relation-transform-guards` seeds
`build_lookup` and its neighbours, whose only outside reference is a test the
manifest excludes. Discovery excluded the definition file, correctly, and there
was nothing else. **Seeding was not the limit on either.**

### The defect that was there

A symbol's span was GUESSED — from its declaration line to the line before the
next declaration in the file — because a support-signal fact carried only a start
line. That rule is wrong in both directions on the same file:

- it ended a type at its FIRST member, so a class-body line between two methods was
  attributed to the method above it; and
- it ran the LAST member of a type past the type's own closing line, so a
  module-level edit below a class was reported as a contract change to that member.

Both are CONFIDENT FALSE STATEMENTS about a named symbol, which is worse than a
missing one, and neither had a test. Measured on the corpus: the whole 7-file
reference list of `django-mark-safe-keeps-lazy-strings-lazy` was the references of
`_safety_decorator`, a symbol the change never touched — the decorator line above
`mark_safe` had been credited to the declaration above it.

The fix is to READ the extent instead: every `SupportSignalFact` now carries
`endLine` from the AST node's own range, required rather than optional, for all
seven languages at once. It is one field in the shared fact contract and one
`spanFor` helper in the shared extractor; no consumer branches on a language and
nothing about the change is Python-shaped. Python decorators are the one adapter
detail: that grammar puts them in a wrapper node instead of inside the definition,
where Java's grammar already nests annotations, so the adapter reads the wrapper
and the two languages come to mean the same thing.

Spans then nest, and the seed rule is stated rather than implied: **the most
specific declaration whose own lines the change touched**, resolved per hunk by
line coverage, so a hunk spanning a class attribute and a method names both.

### The widening that was built, measured and rejected

Seeding EVERY enclosing declaration was the other reading of nested spans, and it
was built first. Scored on this corpus with default limits it took the reference
list from 67 files to 100, left the proven dependents found at 5, and dropped the
precision lower bound from 7.5% to 5.0%. It is not in the engine.

It failed for a reason worth recording, because it is about a different limit:
with `changeImpact.maxReferencesPerSymbol` raised to 400 the same widening reaches
**8 of 11 proven dependents instead of 5** — including the `attribute-owner` case
that motivated it — at 424 predicted files and a 1.9% precision lower bound. So
the type's reference list does contain the dependents; the per-symbol cap is spent
on whatever the traversal reached first. **The next lever on this corpus is
reference selection under the cap, not seeding.** The cap is NOT changed here: a
default moved to make corpus cases score is fixture-fitting, and a 424-file arm 1
is not a report. That lever was taken up on 2026-08-06; see "The Cap Selects, It
Does Not Truncate" below, including what it did and did not move.

### Measured, on `openai/gpt-5.3-codex`

Both runs are `eval impact --adjudication on --max-adjudication-calls 60`, 10
cases, $0.083 each. The engine is pinned by commit in each report; the AFTER run
records `workingTreeClean: false` and must be re-run on a committed tree before it
is quoted as a baseline.

| | before | after |
| --- | ---: | ---: |
| arm 1 predicted files | 67 | **59** |
| arm 1 proven dependents found | 5 | 5 |
| arm 1 precision lower bound | 7.5% | **8.5%** |
| arm 2 adjudicated files | 9 | 11 |
| arm 2 proven dependents found | 2 | 2 |
| arm 2 precision lower bound | 22.2% | 18.2% |
| adjudicated recall within the reference list | 2/4 | 2/4 |
| `coverage.noAdjudicationCallCaseCount` | 5 | **5** |
| `coverage.adjudicationCallCount` | 61 | 61 |
| `deterministicNoImpactPairCount` | 38 | 30 |
| model verdicts `relies` / `does-not-rely` / `undetermined` | 10 / 37 / 14 | 12 / 36 / 13 |

**The counter this work was aimed at did not move.** Five cases still spend no
model call, and they are the same five. Recall did not move in any reachability
class. What moved is noise and correctness: eight fewer reference files for the
same five dependents, and a whole reference list that had been attached to the
wrong symbol now attached to the right one.

No metrics-version entry is owed. No figure changed meaning: recall and precision
are computed from the same predictions by the same definitions, and what changed is
the engine that produced them, which provenance already carries as a commit.

## The Cap Selects, It Does Not Truncate — 2026-08-06

The section above names reference selection under the cap as the next lever. This
is that work. **It is a correctness fix first and a recall lever second**, and the
measurement below is reported whichever way it came out.

### The defect

`changeImpact.maxReferencesPerSymbol` was handed to the SEARCH. The search
therefore stopped at the first 25 matches in **traversal order**, and only
afterwards did discovery remove the matches that cannot be dependents — whole-line
comments, the symbol's own file, non-source destinations — and rank what survived
by "did this change also touch that file". So the ranking sorted a set that had
already thrown its best candidates away, and which sites a reviewer saw was
decided by directory names.

Measured on this corpus before the fix: **18.1% of the matches the cap admitted
(65 of 359) were discarded immediately afterwards**, and 11 of 41 seeded symbols
reported the search cut short. The two worst were not marginal — `__init__` spent
20 of 25 on comment lines and reported 5 dependents; grpc-go's `match` spent 21 of
25 on comments and prose and reported 4 — and both were symbols the search said
had more matches it had not returned. `referencesInDefinitionFile` was **zero on
every symbol in the corpus**, which is not the good news it looks like: the
defining file simply sorted after the cap ran out.

### The fix, and why `context-retrieval` did not have to change

**Two bounds, because there were always two questions.**
`maxReferenceCandidatesPerSymbol` bounds what the search COLLECTS — a cost bound
on traversal and memory, necessarily spent in traversal order because a search
cannot classify what it has not read. `maxReferencesPerSymbol` bounds what the
report LISTS, and it now applies AFTER the destination policy, so it selects among
matches that could actually be dependents.

The retrieval layer keeps its mechanism unchanged: no comparator, no scoring hook,
no policy predicate reaches the mediated seam, and the collect-then-select shape
is exactly what preserves the "the withheld counts are exact" property recorded
above — the counts now describe the whole candidate set rather than a prefix of it.
The only edit there is a rename: `lookupSymbolReferences` takes
`maxMatchesPerSymbol`, which is what the parameter always was. Naming it after a
caller's reporting cap is how the two got conflated in the first place.

**The cap's purpose is intact and its default is unchanged at 25.** A symbol still
occupies at most 25 sites of the page. What changed is that those 25 are 25
candidate dependents instead of 25 raw matches. The corresponding measurement with
the cap raised to 400 is recorded above and is NOT acted on here: a default moved
to make corpus cases score is fixture-fitting, and this spec forbids it.

### What the cap ranks on, and what it refuses to rank on

Two keys, in this order, and both are stated as mechanism:

1. **A production site before a test site.** Both are real dependents and both
   break; they break in different places, and this spec already presents the
   production list as the primary one and the test list as beside it. A shared cap
   has to choose, and without a stated precedence a symbol whose test sites
   outnumber its callers loses its primary list entirely to CI breakage.
2. **A site in a file this change also touched before one elsewhere.** Unchanged;
   this is the signal the previous ranking already used, now applied to a set that
   still contains its best candidates.

Everything else keeps search order. **Deliberately refused**: ranking by reference
count, by directory distance, and by whether the matched line "looks like a call" —
the last is a punctuation list masquerading as an analysis, and this spec rejects
syntax lists for exactly the reason it rejects a decorator marker.

### Truncation is now two claims, reported apart

`referencesTruncated` says more dependent sites were found than are listed, over a
set this run examined in full. `referenceSearchTruncated` says the search stopped
collecting before it ran out, so matches exist that were never classified, ranked
or counted anywhere. The second is the worse claim — "there are places I did not
look" rather than "there is more of what you can see" — and one boolean covering
both would let a reader discount it as the milder one. This is the same
distinction `context-retrieval` already draws between its match cap and its depth
bound.

### Measured, on the change-impact corpus

Both runs are `eval impact --adjudication off`, 10 cases, **zero cost and no model
call**, on a clean working tree at the commit each report pins. With adjudication
off arm 1 is fully deterministic, so the two columns are an exact comparison rather
than two samples — there is no run-to-run band to read across. That makes the
comparison sharp; it does not make one corpus of eleven dependents decisive, and
this spec's rule that a single run decides nothing still binds.

| | before `bcd2de9` | after `5c91257` |
| --- | ---: | ---: |
| arm 1 predicted files | 59 | **77** |
| arm 1 proven dependents found | 5 | **6** |
| arm 1 precision lower bound | 8.5% | **7.8%** |
| `caller-of-changed-symbol` | 100.0% (3/3) | 100.0% (3/3) |
| `callee-of-changed-code` | 0.0% (0/2) | **50.0% (1/2)** |
| `attribute-owner` | 0.0% (0/1) | 0.0% (0/1) |
| `whole-repo-search` | 40.0% (2/5) | 40.0% (2/5) |
| **directly reachable** | 50.0% (3/6) | **66.7% (4/6)** |
| dev split | 44.4% (4/9) | **55.6% (5/9)** |
| held-out split | 50.0% (1/2) | 50.0% (1/2) |

**The dependent that was gained is `django/db/models/base.py`**, in
`django-constraint-validate-stops-absorbing-fielderror`, class
`callee-of-changed-code`. Its seeded symbol `validate` had spent 5 of its 25 slots
on comment lines; the sites that replaced them reach the file upstream repaired.
Nothing was lost: every dependent found before is still found.

**`attribute-owner` did not move, and selection cannot move it.**
`django-union-default-ordering-not-cleared-for-combined-queries` enumerates ZERO
reference files before and after — its seeds are a private helper and its
neighbours, whose only references sit inside the defining file — so the cap never
binds on it and there is nothing for the cap to select. Reaching that case needs
SEEDING, specifically the enclosing-declaration widening measured and rejected in
the section above, and the earlier 8-of-11 figure required that widening as well as
the raised cap. This work never had a mechanism to reach it, and it is recorded
here so nobody re-derives that.

**The precision lower bound fell, and that is stated rather than explained away.**
18 more predicted files bought one more proven dependent. On a corpus whose answer
key lists the dependents upstream repaired rather than every affected file, an
unlisted prediction is not thereby wrong, so a falling lower bound is weak evidence
in either direction — but it is a real direction and it is the cost side of this
trade.

**Cost.** The reference search over the whole corpus takes **11% longer** at the
new default (6.5s versus 5.8s, replicated) while collecting **7.4×** the matches
(3,217 versus 434). The widening is that small because the batched traversal only
stops early when EVERY query is satisfied, and most symbols never reach their
bound, so nearly every eligible file was already being read. The widening is also
named, bounded and configurable rather than silent.

### The default stays at 25, and the argument for moving it is not made here

`maxReferencesPerSymbol` keeps its default. The cap now buys 25 candidate
dependents where it used to buy 25 raw matches, which makes a different default
more defensible on mechanism than it was — but that is a separate argument, it
would have to be made on its own, and bundling it with this change would make it
impossible to tell which half moved the number. A default moved to make corpus
cases score remains forbidden.

Recorded 2026-08-01 by an alignment audit. **These are unmet requirements, not
amendments.** Everything above stands as written; this section exists so the gap is
visible rather than silent, and so the verification matrix below is not read as a
description of what exists.

Built: design step 2 (bounded, diff-seeded dependent discovery through
`context-retrieval`), and step 4 as a **reference report** — production and test
destination files with the changed symbols reaching them and their sites nested
beneath, plus a symbol-side table carrying the contract delta, the removal pairing
and the withheld / truncated counts. `impact check` exits 0 whatever it reports,
and `status: "disabled"` is emitted when the capability is off.

**Amended 2026-08-05:** step 3 is now built too, and with it the command is no
longer provider-free — but only when `changeImpact.adjudication.enabled` is set,
which it is not by default. With adjudication off the command is exactly what this
section described: deterministic, free and reproducible.

| Requirement | State of the implementation |
| --- | --- |
| *Design* step 1 — contract delta | **Partly implemented, 2026-08-01.** Deterministic and text-derived, over six language-neutral dimensions: absence, failure, return shape, guard, mutation, concurrency. Derived from the diff lines inside a symbol's span rather than from a second parse of the base revision — intake already carries the unified diff, so re-parsing every changed file would buy nothing the diff does not already hold. A dimension is reported only when ASYMMETRIC between the added and removed sides, so a body that already threw and still throws says nothing. It reads TEXT: a signal-strength claim ("a caller can observe this"), never a proof, and never a type-system conclusion. Empty means "changed, but not in a way this engine can show reaches a caller" — never "safe". |
| *Design* step 3 — impact adjudication | **Implemented, 2026-08-05. Measured once on 2026-08-06 and that measurement is VOID** — see "First Adjudication Measurement" above; it scored a contract-delta defect, not this layer, and a re-run is owed. Deterministic wherever the category admits it; one model call for the residue only. See "Impact Adjudication" above for the split, the compatibility-class mapping and the pre-registered decision rule. Disabled by default, and separately from the command. |
| *Requirements*: findings carry the dependent's path and line, the contract element relied upon, and the consequence; a finding without a named dependent is rejected | **Implemented, 2026-08-05.** `impactFindings` carries one entry per dependent FILE, each reliance naming the changed symbol, the line in the dependent, the contract element and the consequence. Findings carry a compatibility class and no severity. The gate lives in `change-impact` and imports nothing from the diff reviewer's `admission` domain. |
| *Report at file granularity, not per site* | **Implemented, 2026-08-05.** `impactedFiles` and `impactedTestFiles` are the report's primary lists, one entry per destination file, with the changed symbols reaching it named on it and their sites nested beneath. `changedSymbols` remains as the symbol-side table — what changed, and how far the search could see — and carries no sites. Schema `2.0`; breaking, with no compatibility layer. |
| *Removals must be paired with additions before reporting* | **Implemented, 2026-08-05.** See "Removal pairing" below. |
| *Publish a known-not-reported list* | **Published, 2026-08-05**, in "What this capability knowingly does not report" below and in `docs/06-reference/cli.md`. The entry this row previously named is RETRACTED — see that section's note on the JavaScript extractor. |

## Removal Pairing

Built 2026-08-05, against the "Removals must be paired with additions before
reporting" requirement above.

**The predicate is the smallest sound one: same name, same language, in a file this
change adds or modifies.** Signature shape and body similarity are available and
deliberately unused. The asymmetry is the reason: reporting a move as a deletion
overstates severity on a refactoring, while a FALSE pairing hides a real deletion —
and there is no recovery from that, because the report is the only thing telling
the reader the symbol is gone. Body similarity would reach renames at the cost of
pairing two unrelated symbols that share boilerplate, so the cheap sound half is
taken and the remainder is published rather than guessed at.

The searched population is the change itself, never the repository. A move writes
its destination, so the destination is in the diff by construction; widening the
search would both cost an unbounded lookup — forbidden above — and pair a removal
with an unrelated same-named symbol that was always there. Pairing runs over the
whole candidate set BEFORE the seed cap, so a bound can never turn a move into a
deletion.

Three outcomes, and they are three different claims:

| `removalPairing.match` | Statement | Reported `changeKind` |
| --- | --- | --- |
| `same-name` | This change adds a declaration of the same name, in the same language, elsewhere; its path and line are carried. | `moved` |
| `none` | Every declaration this change adds, in every file the engine could read, was searched and none carries this name. | `deleted` |
| `inconclusive` | Some changed file could not be read, so the added declarations were not all searched. Absence of a match is absence of evidence. | `deleted` |

The third outcome exists because of this repository's documented recurring defect
class: a missing input producing a plausible confident answer instead of an error.
"We searched and found no replacement" and "we could not search" are different
statements, and a reader must be able to tell a verified removal from an unverified
one. `deleted` is still the reported kind — the safe direction — but the claim
attached to it is the honest one. The schema refuses to hold a `changeKind` and a
`removalPairing` that disagree.

## What This Capability Knowingly Does Not Report

Required by "Publish a known-not-reported list" above; published here and in
`docs/06-reference/cli.md`. Every entry below was verified against the
implementation on 2026-08-05, not assumed. None of them produces an error — they
produce silence, which is exactly why they are written down.

**Which changed symbols are seeded**

1. Only languages the deterministic registry covers seed anything.
2. A declaration removed from a file that still exists is invisible: symbols are
   extracted from the head side, so only a removal that takes the whole file with
   it is reported.
3. Constructs the extractor does not treat as declarations are not seeded.
   Verified: an ECMAScript method assigned onto a prototype
   (`Router.prototype.route = function route () {}`) and an export installed via
   `Object.defineProperty` yield no fact.
4. A change touching no symbol's span — imports, top-level configuration, a file
   header above the first declaration — seeds nothing. A module whose whole
   content is import or re-export statements therefore seeds nothing at all, and
   it is the only shape that raises the "no changed symbols were seeded" warning.
   Verified 2026-08-06 against a package `__init__` of pure re-exports: the change
   added an import, the file declares nothing, and the report is empty. Widening
   the seed to import facts would invert the direction this capability is defined
   in — an import names a symbol this file CONSUMES — so it is not done.
5. A symbol's span is the AST node's own range, so declarations NEST and the symbol
   reported is the most specific one whose OWN lines the change touched: the member
   for a body line, the type for a class-body line between two members, and both
   when one hunk covers both. Rewritten 2026-08-06; see "Spans Are Read, Not
   Guessed" below for what the previous rule got wrong.
5a. A declaration's own modifiers are part of its span only where the grammar nests
   them inside the declaration. Java annotations do, and Python decorators are read
   from their wrapper node so they do too. A Rust `#[attribute]` and an ECMAScript
   decorator on an exported class are SIBLING nodes, so a change confined to either
   touches no symbol's span and falls under entry 4.
6. `changeImpact.maxChangedSymbols` bounds the population; `changedSymbolsTruncated`
   is the only signal.

**Which dependents are found**

7. References are matched as text, not resolved as bindings. Verified: an aliased
   import lists the import line and NOT the `loadUser(...)` call sites; a call
   through a variable lists the assignment and NOT the `f(...)` call.
8. Only direct references. There is no transitive closure and no configurable depth.
9. Whole-line comments are dropped, so a reference inside a block comment or a
   docstring goes with them.
10. Non-source destinations are counted, never listed. The counts are exact over
    every match the SEARCH collected, which is the whole search unless
    `referenceSearchTruncated` says otherwise.
11. The SEARCH bound (`changeImpact.maxReferenceCandidatesPerSymbol`) is spent in
    traversal order, ahead of the destination split — a search cannot classify
    what it has not read. So a symbol whose first N matches are all prose still
    reports few dependents, and `referenceSearchTruncated` is the only signal that
    the search stopped early; nothing beyond that bound is counted anywhere.
    Rewritten 2026-08-06: the REPORTING cap is no longer what is spent there, and
    it no longer lands on prose at all. See "The Cap Selects, It Does Not
    Truncate" below.
12. `paths.exclude` applies to reference destinations by design.

**What the report claims**

13. The reference lists are NOT adjudicated. Only `impactFindings` is, and only
    when `changeImpact.adjudication.enabled` is set. A file in `impactedFiles` is
    a file that USES a changed symbol; published rates for this task put such a
    list near 90% irrelevant. With adjudication off, nothing at all is triaged.
14. The contract delta reads six text-visible dimensions, over the CODE lines of a
    hunk — whole-line comments are excluded from both sides since 2026-08-06, so a
    commented-out construct neither creates a change nor cancels one. Verified
    silent: an arity or parameter-list change, a type change, a default-value
    change, a visibility change, and a value carried inside a string such as a URI
    query parameter. Ordering, resource ownership and serialised values are not
    covered either.
14a. A DECORATOR OR ANNOTATION applied to a declaration is silent for the same
    reason, and it is the loudest instance of entry 14 because the construct
    replaces what every caller of that name receives. Verified 2026-08-06 on
    `@keep_lazy(SafeString)` added to `mark_safe`: the symbol is seeded and its
    references are found, the delta is empty, and the deterministic tier settles
    every dependent as `no-impact` without spending a call. The fix is NOT to add a
    seventh dimension keyed on `@` or `#[`: the six dimensions are language-neutral
    constructs, a decorator marker is a syntax list, and adding one because a corpus
    case needs it is the fixture-fitting this spec forbids. A real fix reads what
    the wrapper DOES, which is a resolution problem this engine does not have.
15. A rename in place is reported as a removal plus an addition; the pairing
    predicate is the name.
16. A symbol moved into a file in a language the registry does not cover is reported
    as a removal with `match: "none"`, because no readable declaration exists to
    pair against. This is why that outcome is worded "in any file this engine can
    read" rather than "anywhere".
17. No severity, no verdict, no gate. A finding rates COMPATIBILITY and nothing
    can fail a build.
18. **Adjudication has no valid accuracy number.** The one measurement that exists
    is void — see "First Adjudication Measurement" above — so no rate for it may be
    quoted here, in `docs/`, or in the report. The published prior art for this
    task reaches 28.2% precision, which is what the re-run should be read against.
19. **Absence from `impactFindings` is not a statement that a dependent is
    unaffected.** Four different situations produce it: adjudication off, no model
    available, a call that failed or could not decide, and the call cap. The
    summary's `unadjudicatedPairCount`, `adjudicationCallCount` and
    `adjudicationStatus` are what tell them apart, and they are reported for
    exactly that reason.
20. The residue question is asked over the LOCATED SITES of one file, not over the
    file's whole text. A dependent whose reliance is visible only in code the
    search did not match is not adjudicated as relying.
21. `no-impact` from the model tier is one call's answer on one pair. It is a
    statement that nothing was shown, not that nothing is there.
22. **A `completed` adjudication status does not mean the model ran.** It means
    both tiers were EQUIPPED to run. A change whose symbols carry no detected
    contract change produces a completed run in which the deterministic tier
    settles every dependent and no call is spent;
    `summary.adjudicationCallCount` is the only field that says so, and a zero
    there means no count in the report is a model's judgement. This entry exists
    because that exact shape was misread once, and the misreading nearly deleted
    the capability.

**Retraction: the JavaScript blind spot.** The audit table previously named "the
JavaScript extractor produced 6 declarations across 1 046 `.js` files (results
ledger, 2026-07-30)" as a known entry. **That measurement predates the single AST
engine consolidation of 2026-07-31 and no longer holds.** Re-verified 2026-08-05
against the current extractor: a plain `function` declaration, a `class`, an arrow
bound to a `const`, `module.exports = x`, `exports.x = …` and ESM exports all yield
facts, in `.js` as in `.ts`. What remains missing is narrower and is entry 3 above.
The ledger entry stands as a record of what was true that day; it must not be
quoted as a current limitation.

**Provenance of the two deterministic runs above.** Both were run against this
repository's own branch and are recorded only here — neither appears in
`reports/eval-results-ledger.md`. They are deterministic counts over a working tree
rather than scored measurements, so nothing about them is poolable; they should not
be quoted as corpus results.

## Verification Matrix

Every row below names a test that exists. A row is added only when the behaviour
it describes is built.

| Requirement | Test |
| --- | --- |
| Reuses intake, provider resolution, configuration, reporting, and reaches repository content only through `context-retrieval` | import-boundary test: the domain imports the shared entrypoints and contains no `node:fs`, `node:fs/promises`, or `node:child_process` |
| Dependent discovery is bounded and diff-seeded | unit test |
| A symbol's span is read from the parse and nests, so no change is attributed to a symbol that does not own it | `polyglot-signal-extractor.test.ts` (every fact carries `endLine`; a nested declaration's range is contained by its parent's, over three grammars), `changed-symbols.test.ts` (a body line names the member, a class-body line names the type, one hunk covering both names both, a module-level line below a type names nothing) |
| Reference sites obey the configured include/exclude rules | unit test driving `paths.exclude` through discovery, plus an end-to-end test |
| Non-source destinations are excluded, and reported rather than dropped | unit test over prose, fixture data and a snapshot; classifier test generated from the language registry |
| The reporting cap SELECTS among candidate dependents rather than truncating raw matches in traversal order | `dependent-discovery.test.ts` — a call site behind enough prose to have filled the cap is still listed; both assertions fail when the search bound is set equal to the reporting cap, which is the pre-2026-08-06 behaviour |
| A production site outranks a test site when the cap can hold only one | `dependent-discovery.test.ts` |
| A shortened list and an unfinished search are two claims, never one | `dependent-discovery.test.ts` (the two booleans move independently), `impact-markdown.test.ts` (the two caveats are worded apart) |
| The search bound and the reporting cap are separately configurable | `config.schema.test.ts` (defaults, independent override, both range ends) |
| Test call sites are reported separately rather than mixed in or lost | unit test, plus a CLI test over a real repository |
| Findings are reported per destination file, with sites nested beneath | `impacted-files.test.ts` (grouping, ordering, two same-named symbols kept distinct), plus `impact-run` and CLI tests over a real repository |
| A removal is paired against the declarations the change adds before it is reported | `removal-pairing.test.ts` (pairs a move, refuses a rename and a cross-language name, refuses self-pairing), `changed-symbols.test.ts` (pairing runs before the seed cap), `impact-run.test.ts` (a renamed file reports `moved`) |
| An unverifiable removal is not presented as a verified one | `removal-pairing.test.ts` and `impact-run.test.ts` (`inconclusive` when a changed file could not be read), Markdown test asserting the two are worded differently |
| The rendered report lands where a reviewer already looks | CLI test asserting `impact-<uuid>/impact-report.md` and `impact-report.json` under `paths.artifactDir`, plus a test that an unwritable artifact directory still reports and still exits 0 |
| A finding without a named dependent is rejected | `impact-admission.test.ts` (no path, no reliance, a dependent never located, a line never located, a symbol that does not reach the dependent, missing element or consequence) |
| A finding carries the dependent's path and line, the contract element and the consequence | `impact-admission.test.ts`, `adjudication.test.ts`, `impact-run.test.ts`, and a Markdown test asserting all four render on one line |
| Deterministic adjudication needs no model | `adjudication.test.ts` (every deterministic case is driven with a judge that throws on any call), plus `impact-run.test.ts` running with no agents at all and a CLI test asserting exactly one call for two changed symbols |
| The model is spent on the residue only, and never writes prose | `reliance-judgement.test.ts` (the output schema's field set), `adjudication.test.ts` (the packet and the composed consequence) |
| A commented-out construct neither creates a contract change nor cancels the real one beside it | `comment-lines.test.ts` (the shared predicate), `contract-changes.test.ts` (end to end over a deprecation shim whose comment carried the construct the change then wrote for real) |
| Findings carry a compatibility class, not a severity | `impact-run.test.ts` schema-shape test; `impact-report.ts` excludes `no-impact` from a finding by construction |
| A dependent judged `no-impact` is not reported | `adjudication.test.ts` (deterministic and model paths), `impact-run.test.ts` |
| Reports no impact rather than manufacturing findings | `impact-run.test.ts` (`adjudicationStatus: "completed"` with an empty finding list and a non-zero model `does-not-rely` count), Markdown test asserting the three kinds of empty are worded apart |
| A deterministic `no-impact` is never reported as a model one | `adjudication.test.ts` (a swept run reports zero calls and no verdicts; a `does-not-rely` answer counts against the model tier and not the deterministic one; the pooled counter is gone), `impact-run.test.ts` end to end over an empty contract delta |
| The report says whether the judge ran, and what it answered | `adjudication.test.ts` (the verdict distribution, including a `relies` answer discarded by verification), Markdown tests (`none — the model tier was never called`, the two tier lines, the disabled wording) |
| A run in which the judge never fired cannot be read as adjudication removing anything | `change-impact-scoring.test.ts` — the voided run's shape rebuilt: exhaustive cases, everything removed, zero calls; every removal lands in `deterministicTierOnly`, `modelInvolved` stays empty, and there is no pooled removal figure to quote. `change-impact-eval-rendering.test.ts` asserts the rendered arm 3 states it outright |
| Non-blocking, and not configurable to block | config schema test (asserts the absence of a `blocking` key on the block and on `adjudication`) |
| Failure leaves the diff review unaffected | import-boundary test (no shared code path with `review-workflow`), `adjudication.test.ts` and `impact-run.test.ts` (a throwing provider costs one pair), CLI test (an unresolvable provider still reports and exits 0) |
| Instructions stay generic and language-neutral | `instructions.test.ts` — the shared prompt genericity guard, plus a test that the guard can still fail this prompt |

## How The Lane Is Invoked

The lane runs in **one of two places**, and the guarantees above hold identically
in both.

`review` runs it in-process after the review when `changeImpact.enabled` is true,
over the same run context — so one push issues one set of git subprocesses and
reads each changed file once, instead of once per stage, and the lane's report is
written into the REVIEW's own run directory rather than an unlinked directory of
its own. A reader holding a run id can find every stage's answer for that push.

`impact check` still runs it alone, for anyone who wants this question answered
without a review.

Running beside a stage that CAN fail the command is exactly where the
non-blocking guarantee would be lost by accident, so it is enforced structurally
in `src/cli/advisory-lanes.ts`: a throw from this lane becomes a warning on the
review report and an absent stage report, never a non-zero exit and never a lost
review. A disabled lane still runs nothing at all — being invoked from `review`
does not turn a stage on.
