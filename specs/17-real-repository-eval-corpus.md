# 17: Real-Repository Evaluation Corpus

Status: Approved
Date: 2026-07-25

## Purpose

Make cross-file review quality measurable. The `code-review-bench-style` slices
capture only the files a change touched, so a defect whose evidence lives in an
unchanged file cannot be found by any reviewer, however good — the evidence is not
on disk. Cross-file recall measured against those slices is therefore not a property
of the engine, and cross-file retrieval (`16-agentic-cross-file-discovery.md`) cannot
be evaluated on them at all.

This spec defines a second corpus whose cases are **real upstream repositories
checked out in full** at the commit immediately before an upstream fix landed. The
reviewer sees the repository as a developer would, so a finding that depends on a
callee body, an interface, or a constructor in an unchanged file is reachable.

## Shape

- A **manifest** is committed; **checkouts are not**. The manifest carries the case
  definitions; working trees are produced on demand into the artifact directory,
  which is git-ignored. A corpus of full repositories is orders of magnitude larger
  than this repository and never enters its history.
- Each case pins an upstream repository, the **fix commit** and its **parent**. The
  parent is checked out as the working tree (the pre-fix state, which still contains
  the defect) and the fix commit supplies the reviewed diff.
- Hydration is **idempotent and integrity-checked**: an already-hydrated case whose
  checkout matches its pinned commit is reused; a mismatched checkout is repaired
  rather than silently accepted; and a checkout whose case the manifest no longer
  defines is pruned and reported. An evaluation loads a slice root by directory, so
  a leftover checkout from a dropped case would otherwise re-enter the next
  measurement as a case nobody curates. A case is always built from an empty
  directory, because a case left behind by an interrupted hydration has neither a
  resolvable HEAD nor a slice and so reads as absent rather than mismatched, while
  still holding a git directory and a configured remote; building over it fails on
  git operations that are not idempotent, and any partial fetch it holds cannot be
  trusted to describe the commit it claims. Pruning is skipped when case filters are in
  effect, because the unselected cases are legitimately absent from that run. Fetches are depth-limited to the pinned commit so a
  case costs one commit, not a repository history.
- Hydrated cases are consumed through the existing evaluation fixture contract, so
  the matcher, judges, and metrics apply unchanged.

## Diff Shape

A real pull request is rarely one file. A corpus of single-file cases therefore
cannot see task clustering, context packing, per-task budget on a wide diff, or
any dilution of attention across files: those behaviours are not weak in such a
run, they are **not exercised at all**, and every number the corpus has published
is silent about them. The corpus therefore curates **diff shape** as a property,
alongside language, defect class, and expected findings per case.

- A case is **multi-file** when its reviewed diff carries new-side content in more
  than one file. Since the diff is restricted to `reviewedPaths`, that is a
  curation decision: a fix touching several files is captured with those files
  declared, not narrowed to the one that carries the defect.
- The defect itself **need not span files**. A realistic multi-file change with
  one locatable defect already exercises planning, packing, and budget, which is
  what this property measures. A genuinely cross-file defect is a bonus, and is
  measured separately by `contextDepth`.
- Composition today: **29 single-file and 7 multi-file cases** (2, 2, 2, 3, 5, 6
  and 6 reviewed files), 55 reviewed files in total. Two of the multi-file cases
  carry the same defect in every file they touch, so a review that reports the
  first file and stops is visibly distinguishable from one that works the diff.

## Case Definition

Each case records: a stable id, language, upstream owner/repository and clone URL,
license, capture date, source, fix commit, fix commit date, parent commit, the
reviewed paths, the review intent, expected findings, and free-form tags and notes.

Expected findings reuse the evaluation fixture's expected-finding contract,
including the security mechanism and context-depth labels, so a real-repository case
reports through the same per-mechanism and per-context-depth metrics as any other.

## No-Finding Zones And Clean Cases

Every case in this corpus contains a known defect, so `noFindingZoneFalsePositiveCount`
was structurally pinned at zero: the corpus that decides releases could not say
whether the engine flags code that is fine. A case may therefore declare
`expectedNoFindingZones` over regions of its reviewed files that are clean at the
parent commit.

A zone is an assertion, and a wrong one manufactures false positives instead of
measuring them, so two properties are validated rather than trusted: a zone must
name a **reviewed path** — the reviewer was never asked to look anywhere else —
and it must carry a **line range that does not overlap any expected finding in the
same file**, or a correct finding would be scored as a false alarm. A whole-file
zone is rejected for the same reason: it would flag every unmatched finding in the
file, including one aimed at a real defect nobody listed. Curation additionally
excludes any region that the plausibility judge has credited as an unlisted-real
finding in an archived run.

Zones are a control over *regions*, not over changes. A **whole clean case** — an
upstream pull request that introduces no defect — is a stronger negative control
and is **not expressible here**, for three independent reasons:

- The case schema requires at least one expected finding.
- A case is a fix commit and its parent: the parent is checked out and the diff is
  read backwards. A change that fixes nothing has no such pair, and reversing a
  pure refactor produces a de-refactor, which is legitimately worth commenting on.
  A clean case needs a forward-diff mode (check out the commit, diff parent to
  commit) that the hydration contract does not have.
- Ground truth is far harder to establish. A defect case is evidenced by the
  upstream fix; "nothing here is worth reporting anywhere in this diff" has no
  upstream evidence, and post-cutoff commits are too recent for the absence of a
  later fix to mean anything. The answer-key guard also rejects the diffs most
  likely to be clean by construction — dependency bumps whose changelogs carry
  advisory wording.

Adding clean cases is therefore a spec change (forward-diff cases with an empty
answer key), not a curation task. The generic negative control remains the default
fixture pack, whose seven cases are all clean by construction.

## Anti-Contamination

The corpus encodes the policy in `06-evaluation-and-quality-gates.md` as validated
manifest data, so a violation fails loading instead of silently inflating a score:

- **Temporal cutoff.** The manifest declares the evaluated model's training cutoff.
  A `held-out` case whose fix commit predates that cutoff is rejected. The cutoff is
  an operator setting, re-set each model generation; re-setting it invalidates
  held-out cases captured before it, which is the intended effect.
- **Chronological split.** Cases are labelled `dev` or `held-out`. Improvements are
  decided on `held-out`; `dev` is for iteration.
- **Answer-key exclusion.** No field that reaches the reviewed input may carry the
  CVE id, advisory text, or fix commit message. Review intent and expected findings
  describe the pre-fix code, never the fix.
- **Answer-key exclusion covers the generated diff, not only the manifest.** The
  reviewed diff is produced from upstream and is what the model actually reads. An
  upstream fix that also added an advisory reference or a comment naming the defect
  puts the answer inside the model's input when that fix is read backwards, and such
  a case measures nothing while silently inflating recall. Hydration therefore scans
  the generated diff for answer-key wording and fails the case, reporting the leaked
  text so a curator can drop the case or choose reviewed paths that exclude the
  disclosure. Curation found this pattern in five candidate cases, one of which had
  already entered the corpus.
- **Dedup.** A token-normalized diff fingerprint is recorded per case so exact and
  near-duplicate captures are detectable.
- **Provenance.** License, source, and capture date are required per case; a case
  whose license is not on the permissive allowlist is rejected.

## Cost And Safety

- Hydration performs git fetches only. It runs no model call, so refreshing or
  extending the corpus costs no provider spend.
- Only the pinned commit is fetched, and only for the cases selected.
- Checked-out repository content is untrusted input like any other reviewed source
  (spec 07); it is reviewed, never executed, and the eligibility gate and redaction
  apply to it as they do to any repository.

## Testing

- Unit: the committed manifest's no-finding zones, asserting that each names a
  reviewed path, carries a line range, and does not overlap an expected finding;
  and the zone path end to end — manifest through `buildRealRepoSlice`, the written
  slice, the fixture loader, and the matcher — so that a finding landing inside a
  declared zone is counted and one outside it is not. No provider is involved.
- Unit: manifest schema validation, including each anti-contamination rule (cutoff
  violation, non-permissive license, answer-key leakage, malformed commit sha);
  case selection and filtering; the diff fingerprint; the repair and
  interrupted-hydration rebuild paths, exercised through a scripted git that
  reproduces which git operations are idempotent and which are not; and the pure
  helpers that build the git argument vectors and check checkout integrity.
- No test performs a network fetch, and no test runs a provider call. Hydration
  against upstream is an explicit, operator-run step.

## Measured Baseline

The baseline below was measured on the **thirty-case, forty-two-finding** corpus.
The corpus has since grown twice — first to thirty-six cases and fifty-eight
findings with the multi-file cases described above, then to **thirty-six cases and
eighty findings** by curating expectations per case (see *Expectations Per Case*
below). A run on today's corpus is therefore not comparable to these numbers
case-for-case, and the comparison tooling enforces that: it refuses to compare two
runs whose shared cases carry different answer-key digests. Re-measure before
quoting a recall figure against the current corpus.

Measured 2026-07-26 on the thirty-case, forty-two-finding corpus: recall 54.8%,
adjusted precision 95.8%, one genuine false positive, five plausibility-confirmed
unlisted-real findings, severity accuracy 43.5%, no provider errors, $1.20. Recall
by tier is 100% runtime-critical, 57.9% logic, 50.0% security, 100% nit.

The first attempt at this measurement reported 78.8% and was void: it scored
against thirty-three findings, because nine cases gained a second expected finding
after their slices were hydrated and the cache did not treat an answer-key change
as invalidating. That is the reason hydration now compares a stored slice against
the definition it would be built from today.

The corrected key exposes the corpus's most useful signal. The corpus holds 19
single-expectation cases, 10 double and 1 triple. Pooled over three baseline seeds,
single-expectation cases score 39 of 57 (68.4%) and multi-expectation cases 30 of 69
(43.5%); by rank, a case's first-listed expectation is found 64 of 90 times (71.1%)
and every later expectation only 5 of 36 (13.9%). Both decompositions reconcile to
the published 54.8%. No later expectation is high-severity — all fourteen highs are
first-listed. Since per-case detection is comparable across the two groups, the
shortfall is a stopping behaviour rather than a discovery gap — the review reports
the most salient defect
in a file and moves on. A corpus of one-finding cases cannot see this at all,
which is why expected findings per case is itself a property worth curating.

## Expectations Per Case

Minimum detectable effect falls with the square root of (cases × findings) while
provider cost rises with cases, so an expectation added to a checkout that is
already hydrated buys statistical power for nothing. That makes expectations per
case the cheapest lever the corpus has, and it is curated deliberately rather than
left at whatever the capture happened to notice.

Composition today: **eighty expected findings across thirty-six cases** — 11 cases
with one expectation, 12 with two, 9 with three, 3 with four, and 1 with six. Ten
of the added expectations are high-severity and sit at rank two or later, which the
baseline decomposition above could not previously observe at all: every high in the
old key was first-listed.

Two rules bound the curation, and both exist because a wrong expectation is worse
than a missing one — it is a permanent wrong answer that silently depresses every
future recall figure:

- **Every expectation is justified from the code at the parent commit.** An
  expectation must never be promoted from a finding the engine produced, including
  the `unlistedRealFindings` recorded in archived runs. Doing so converts recall
  into similarity-to-the-engine-that-wrote-it and destroys the corpus's
  independence. Checking after the fact whether an independently justified
  expectation happens to coincide with an engine finding is fine; sourcing it from
  there is not.
- **An expectation states the concrete failure and the input or sequence that
  triggers it**, describes the pre-fix code rather than the fix, sits in a
  `reviewedPath`, and carries a severity assigned by the rubric in
  `05-review-workflow-and-runtime.md` rather than a default.

The success criterion is not the count. It is that added expectations are
**discriminative** — sometimes found and sometimes missed — because an expectation
nobody can ever find is as useless to a measurement as one everybody finds. That
property is only observable in a provider-backed run, so it is a prediction at
curation time and a fact only after the next re-measurement.

`lineAccuracy` read 0.0% on this corpus, and the reason recorded here first — an
empty denominator — was wrong. Every expected finding declares a `lineRange`, so
all matched ones entered the denominator; the numerator was unreachable because
the matcher credits a line overlap only for `path-line` matching, and every
expectation here is `path-semantic`. The metric could not pass, and was displayed
as though it had failed. Both sides are now gated on `path-line`, so the corpus
reports `n/a (0 checked)`. The consequence to remember is that **line placement on
real code is unmeasured here**, in either direction.

## Acceptance

- A hydrated case yields a working tree containing the repository's unchanged files,
  not only the reviewed paths, so a cross-file defect is reachable from the review.
- Re-running hydration for an already-hydrated, integral case performs no refetch;
  a checkout that does not match its pinned commit is repaired, and a case left
  behind by an interrupted hydration is rebuilt rather than aborting the run.
- Manifest data that violates the temporal cutoff, the license allowlist, or the
  answer-key exclusion fails validation with a configuration error.
- Cross-file recall reported on this corpus is a property of the engine: the
  evidence for every cross-file expected finding is present in the checkout.
