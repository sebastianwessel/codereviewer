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

## Verification Matrix

| Requirement | Test |
| --- | --- |
| Reuses intake, provider resolution, configuration, reporting, and reaches repository content only through `context-retrieval` | import-boundary test: the domain imports the shared entrypoints and contains no `node:fs`, `node:fs/promises`, or `node:child_process` |
| Dependent discovery is bounded and diff-seeded | unit test |
| A finding without a named dependent is rejected | admission test |
| Reports no impact rather than manufacturing findings | unit test |
| Non-blocking by default | config schema test |
| Failure leaves the diff review unaffected | integration test |
| Instructions stay generic and language-neutral | prompt genericity guard |
