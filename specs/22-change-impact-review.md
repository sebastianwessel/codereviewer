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
- Blocking is **configurable and defaults to non-blocking**. A breaking change is
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

## Verification Matrix

| Requirement | Test |
| --- | --- |
| Reuses intake, provider resolution, configuration, reporting, and reaches repository content only through `context-retrieval` | import-boundary test: the domain imports the shared entrypoints and contains no `node:fs`, `node:fs/promises`, or `node:child_process` |
| Dependent discovery is bounded and diff-seeded | unit test |
| Reference sites obey the configured include/exclude rules | unit test driving `paths.exclude` through discovery, plus an end-to-end test |
| Non-source destinations are excluded, and reported rather than dropped | unit test over prose, fixture data and a snapshot; classifier test generated from the language registry |
| Test call sites are reported separately rather than mixed in or lost | unit test, plus a CLI test over a real repository |
| A finding without a named dependent is rejected | admission test |
| Reports no impact rather than manufacturing findings | unit test |
| Non-blocking by default | config schema test |
| Failure leaves the diff review unaffected | integration test |
| Instructions stay generic and language-neutral | prompt genericity guard |
