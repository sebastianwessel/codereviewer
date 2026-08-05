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
capability that is off by default must not accumulate empty run directories in a
repository whose owner never asked for it, and impact runs are deliberately absent
from the run index, which feeds baseline resolution and expects a review report.

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
- The capability is **disabled by default** until measured.

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
- **The classification runs after the per-symbol cap**, not inside the search, so
  the mediated filesystem seam keeps no policy hook and the withheld counts are
  exact. The cost is that a heavily-referenced symbol can spend its cap on
  non-source matches; `referencesTruncated` is what tells the reader that
  happened.

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

## What Is Built, And What This Spec Still Asks For

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
| *Design* step 3 — impact adjudication | **Implemented, 2026-08-05, and UNMEASURED.** Deterministic wherever the category admits it; one model call for the residue only. See "Impact Adjudication" above for the split, the compatibility-class mapping and the pre-registered decision rule. Disabled by default, and separately from the command. |
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
   header above the first declaration — seeds nothing.
5. A symbol's span ends at the next declaration, so a change between two methods of
   a class is attributed to the earlier method rather than to the class.
6. `changeImpact.maxChangedSymbols` bounds the population; `changedSymbolsTruncated`
   is the only signal.

**Which dependents are found**

7. References are matched as text, not resolved as bindings. Verified: an aliased
   import lists the import line and NOT the `loadUser(...)` call sites; a call
   through a variable lists the assignment and NOT the `f(...)` call.
8. Only direct references. There is no transitive closure and no configurable depth.
9. Whole-line comments are dropped, so a reference inside a block comment or a
   docstring goes with them.
10. Non-source destinations are counted, never listed.
11. The per-symbol cap is spent before the destination split, so a heavily
    referenced symbol can spend its budget on prose.
12. `paths.exclude` applies to reference destinations by design.

**What the report claims**

13. The reference lists are NOT adjudicated. Only `impactFindings` is, and only
    when `changeImpact.adjudication.enabled` is set. A file in `impactedFiles` is
    a file that USES a changed symbol; published rates for this task put such a
    list near 90% irrelevant. With adjudication off, nothing at all is triaged.
14. The contract delta reads six text-visible dimensions. Verified silent: an arity
    or parameter-list change, a type change, a default-value change, a visibility
    change. Ordering, resource ownership and serialised values are not covered
    either.
15. A rename in place is reported as a removal plus an addition; the pairing
    predicate is the name.
16. A symbol moved into a file in a language the registry does not cover is reported
    as a removal with `match: "none"`, because no readable declaration exists to
    pair against. This is why that outcome is worded "in any file this engine can
    read" rather than "anywhere".
17. No severity, no verdict, no gate. A finding rates COMPATIBILITY and nothing
    can fail a build.
18. **Adjudication is unmeasured.** No accuracy number exists for it, here or
    anywhere. The published prior art for this task reaches 28.2% precision, which
    is what a first measurement should be read against.
19. **Absence from `impactFindings` is not a statement that a dependent is
    unaffected.** Four different situations produce it: adjudication off, no model
    available, a call that failed or could not decide, and the call cap. The
    summary's `unadjudicatedPairCount` and `adjudicationStatus` are what tell them
    apart, and they are reported for exactly that reason.
20. The residue question is asked over the LOCATED SITES of one file, not over the
    file's whole text. A dependent whose reliance is visible only in code the
    search did not match is not adjudicated as relying.
21. `no-impact` from the model tier is one call's answer on one pair. It is a
    statement that nothing was shown, not that nothing is there.

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
| Reference sites obey the configured include/exclude rules | unit test driving `paths.exclude` through discovery, plus an end-to-end test |
| Non-source destinations are excluded, and reported rather than dropped | unit test over prose, fixture data and a snapshot; classifier test generated from the language registry |
| Test call sites are reported separately rather than mixed in or lost | unit test, plus a CLI test over a real repository |
| Findings are reported per destination file, with sites nested beneath | `impacted-files.test.ts` (grouping, ordering, two same-named symbols kept distinct), plus `impact-run` and CLI tests over a real repository |
| A removal is paired against the declarations the change adds before it is reported | `removal-pairing.test.ts` (pairs a move, refuses a rename and a cross-language name, refuses self-pairing), `changed-symbols.test.ts` (pairing runs before the seed cap), `impact-run.test.ts` (a renamed file reports `moved`) |
| An unverifiable removal is not presented as a verified one | `removal-pairing.test.ts` and `impact-run.test.ts` (`inconclusive` when a changed file could not be read), Markdown test asserting the two are worded differently |
| The rendered report lands where a reviewer already looks | CLI test asserting `impact-<uuid>/impact-report.md` and `impact-report.json` under `paths.artifactDir`, plus a test that an unwritable artifact directory still reports and still exits 0 |
| A finding without a named dependent is rejected | `impact-admission.test.ts` (no path, no reliance, a dependent never located, a line never located, a symbol that does not reach the dependent, missing element or consequence) |
| A finding carries the dependent's path and line, the contract element and the consequence | `impact-admission.test.ts`, `adjudication.test.ts`, `impact-run.test.ts`, and a Markdown test asserting all four render on one line |
| Deterministic adjudication needs no model | `adjudication.test.ts` (every deterministic case is driven with a judge that throws on any call), plus `impact-run.test.ts` running with no agents at all and a CLI test asserting exactly one call for two changed symbols |
| The model is spent on the residue only, and never writes prose | `reliance-judgement.test.ts` (the output schema's field set), `adjudication.test.ts` (the packet and the composed consequence) |
| Findings carry a compatibility class, not a severity | `impact-run.test.ts` schema-shape test; `impact-report.ts` excludes `no-impact` from a finding by construction |
| A dependent judged `no-impact` is not reported | `adjudication.test.ts` (deterministic and model paths), `impact-run.test.ts` |
| Reports no impact rather than manufacturing findings | `impact-run.test.ts` (`adjudicationStatus: "completed"` with an empty finding list and a non-zero `noImpactPairCount`), Markdown test asserting the three kinds of empty are worded apart |
| Non-blocking, and not configurable to block | config schema test (asserts the absence of a `blocking` key on the block and on `adjudication`) |
| Failure leaves the diff review unaffected | import-boundary test (no shared code path with `review-workflow`), `adjudication.test.ts` and `impact-run.test.ts` (a throwing provider costs one pair), CLI test (an unresolvable provider still reports and exits 0) |
| Instructions stay generic and language-neutral | `instructions.test.ts` — the shared prompt genericity guard, plus a test that the guard can still fail this prompt |
