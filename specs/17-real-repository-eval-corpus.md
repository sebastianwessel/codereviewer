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
- Composition today: **29 single-file and 8 multi-file cases** (2, 2, 2, 2, 3, 5,
  6 and 6 reviewed files), 57 reviewed files in total. Two of the multi-file cases
  carry the same defect in every file they touch, so a review that reports the
  first file and stops is visibly distinguishable from one that works the diff.
  Recomputed from the manifest on 2026-07-27 after the convergence cases landed;
  it is a count of committed data, not a measurement.

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

## Diff Scope Of An Expectation

Each expectation MUST be classified as **in-diff** or **out-of-diff**, and recall
MUST be reported separately for the two populations. A single blended recall
figure is not interpretable: its value depends on the ratio of the two
populations in the fixture set rather than on reviewer quality.

The classification is derived deterministically from the reviewed diff and MUST be
stored with the case so it is auditable and cannot drift. It MUST NOT be
hand-assigned.

**The storage half of that requirement is unmet.** No expectation or case field
carries the classification, and no metric is keyed on it: the split exists only as
ad-hoc analysis re-derived per report. That is exactly the drift the storage
requirement was written to prevent, and it is why the figures below have to be
dated and superseded by hand instead of recomputed.

**The rule is hunk span, not added lines.** An expectation is in-diff when its
`lineRange` intersects the head-coordinate span of any hunk, taken from the hunk
header `@@ -a,b +c,d @@` as `[c, c+d-1]`. Hunks that are pure deletions in the
reversed diff count: a fix that only *adds* a guard reverses into a deletion, and
the reviewer is still shown that hunk with its surrounding context, so the region
is genuinely under review.

An added-lines-only rule was used initially and was wrong. Measured on the same
runs: it reported in-diff 73.9% against out-of-diff 8.8%, while the hunk-span rule
reports **in-diff 69.8% against out-of-diff 0.0%**. The apparent 8.8% was entirely
regions the stricter rule had misclassified as unreviewed. **The engine finds
nothing whatsoever outside a hunk** — 0 of 81 — which is a cleaner statement of the
boundary than the earlier figure suggested, and it removes the basis for calling
that boundary soft.

### Why This Section Exists

Measured 2026-07-27 over 18 archived runs
(`reports/2026-07-27-in-diff-vs-out-of-diff-recall.md`), **against the pre-cleanup
answer key**:

| population | recall |
|---|---:|
| in-diff | **69.8%** |
| out-of-diff | **0.0%** (0 of 81) |
| blended, as previously reported | 46.3% |

**Superseded for quoting purposes.** The answer key moved twice on 2026-07-27, and
the current baseline on the clean 37-case / 87-expectation corpus (results ledger,
marked CURRENT) reads **in-diff 64.4% (116/180), out-of-diff 0.0% (0/81), blended
44.4%**, with the expectation mix at 60 in-diff to 27 out-of-diff — **31%**
out-of-diff, down from the 42.5% below. In-diff recall *fell*, and that is the
cleanup working: the five cases removed for answer-key disclosure had been scoring
83.3%, and the six added are multi-defect by construction. The figures above are
retained because the argument they establish — that the two populations must never
be blended, and that the hunk-span rule beats an added-lines rule — does not depend
on the key.

**42.5% of expectations (34 of 80) lie in unchanged code.** The corpus reviews
`base = fixCommit`, `head = parentCommit`, so a defect the upstream fix commit did
not touch is byte-identical in base and head and never enters the diff. It is
pre-existing code the reviewer was never asked about.

This also dissolves an earlier diagnosis. First-in-file recall (72.8%) and
later-in-file recall (4.7%) were read as an enumeration defect; in-diff and
out-of-diff recall are the same two numbers over nearly the same populations,
because 30 of the 33 later-in-file expectations are out-of-diff. There is no
separate enumeration failure to explain.

Reporting the two populations separately is required precisely so that neither
can be quietly favoured: it would be equally dishonest to headline 72.8% and drop
the harder population as it was to blend them without saying so. Whether
out-of-diff defects are in scope is a product decision, and this spec's job is to
make that decision visible rather than to make it.

## Convergence: Rounds To Clean

A pull-request reviewer is used iteratively — review, fix, push, re-review — so
single-pass exhaustiveness is not the only measure of its value. The corpus MUST
therefore support a **round mapping**: for a case whose diff contains more than
one defect, the order in which defects are expected to surface across successive
review rounds, and the fix applied between rounds.

Requirements:

- A round's fix MUST be human-authored — the upstream maintainer's own fix, or a
  patch reviewed by a human. It MUST NOT be generated from engine output, which
  would convert the metric into similarity to the engine.
- A fix MUST be confined to the defect it repairs and MUST NOT touch another
  expectation's lines.
- **Rounds to clean** — the number of review rounds after which no expectation for
  a case remains unfound — is reported alongside single-pass recall, never instead
  of it.

**None of this is implemented.** The corpus contract carries no round or
between-round-fix field, and nothing computes rounds-to-clean. The 2026-07-27
convergence pilot cited below was therefore run outside the corpus contract, and is
not reproducible from committed data — which is the reason the requirement exists.

### What The Corpus Can Support Today, And What It Cannot

Convergence is only meaningful for defects **inside the diff**: an out-of-diff
defect is absent from every round's diff, so no amount of fixing brings it into
scope. Measured against the current fixtures:

Recomputed from the committed manifest and the hydrated diffs on 2026-07-27,
under this spec's own hunk-span rule. These are deterministic counts of committed
data, not measurements — no provider call is involved.

| | cases |
|---|---:|
| ≥2 in-diff expectations anywhere | **15 of 37** |
| ≥2 in-diff expectations in the **same file** | **10 of 37** |
| ≥2 in-diff expectations across **different files** | 5 of 37 |

The figures this table previously carried — 6 and 2 "of 36" — were computed under
the **added-lines** rule that *Diff Scope Of An Expectation* has since replaced,
and their denominator was already stale. Recomputing the added-lines rule over the
thirty-one-case corpus reproduces 6 and 2 exactly, which confirms both the rule
that produced them and that none of the five cases dropped for disclosure had
contributed to either count. Under the hunk-span rule the same thirty-one cases
give **9** and **5**; the eleven-case convergence capture of 2026-07-27 (six of
which survived adjudication) took them to 15 and 10.

**Ten same-file cases support a measurement of the kind this section describes,
where two did not.** A round-one hit rate still MUST be re-measured against the
same build as the later rounds, and the diff-narrowing control below is still
required: neither requirement is relaxed by the larger denominator.

### Required Control Arm

A convergence measurement MUST include a **diff-narrowing control**: the same
round-2 diff with the first defect **left unrepaired**, merely removed from the
reviewed scope. Without it, the measurement cannot distinguish repair from scope
change.

This is not hypothetical. The 2026-07-27 pilot measured a second defect at 0/9 in
round 1, 6/6 after the first was repaired, and **5/6 with the first defect still
present and only its file removed from the diff**. Round two and the control were
indistinguishable: the reviewer reports roughly one defect per reviewed diff and
re-aims when the diff changes, rather than being blocked by the first defect.

A fixture set without this control would report the full effect as convergence
and overstate what the iterative loop delivers.

### Round-One Rates Must Be Re-Measured, Not Read From Archives

A round-one hit rate used as a convergence denominator MUST come from runs made
against the same build as the later rounds. In the pilot, three archived runs gave
0/3 for an expectation that six fresh round-one runs found twice; using the
archive alone would have produced a false positive.

### Measured Outcome, 2026-07-27

The measurement was run on ten same-file multi-defect cases, three arms, twelve
runs each, with round one re-measured on the current build. **The catch rate does
not rise materially across rounds, and the rise that exists is scope narrowing
rather than repair.** Round two gained +3.5pp per defect over round one (p=0.60),
while the diff-narrowing control gained **+11.9pp** and beat round two on three of
four cases, tying the fourth.

Three of the ten cases are **structurally not convergeable**: repairing the found
defect removes the remaining target from every later diff, because the fix hunk
spans the sibling defect's lines or empties the reviewed diff. No number of rounds
reaches them.

Consequence for this spec: **rounds-to-clean remains worth reporting, but it must
not be presented as a recall figure that supersedes the single-pass one.** The
single-pass measurement is the honest headline. Detail in
`reports/eval-results-ledger.md`.

Closing that gap requires new cases in which **one diff introduces several
defects**. Upstream fix commits that repair more than one defect at once are the
natural source: reversed, they present as a change introducing several defects,
all in-diff.

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
  already entered the corpus. The scan MUST run on the diff a measurement will
  actually score, including one reused from an existing checkout: a stored slice
  does not carry the case's disclosure resolution, so nothing about a cached case
  invalidates it, and a case hydrated before a rule existed would otherwise be
  served from cache indefinitely.
- **Removed comments are the second route in, and advisory vocabulary cannot find
  them.** The advisory pattern matches `CVE-…`, `GHSA-…`, NVD links, and the words
  advisory, vulnerability and exploit. An engineer explaining a defect in a code
  comment writes none of those. Because a case reviews `base = fixCommit`,
  `head = parentCommit`, a comment the upstream fix **added** appears in the
  reviewed diff as a **removed** line, so the reviewer is shown a deleted comment
  that names the defect before it reads any code. The requirement and its evidence
  are below.
- **Dedup.** A token-normalized diff fingerprint is computed per case during
  hydration and compared across the corpus, so exact and near-duplicate captures are
  rejected at capture time. It is not persisted in the manifest — the check runs
  against the hydrated trees rather than against a stored value that could go stale.
- **Provenance.** License, source, and capture date are required per case; a case
  whose license is not on the permissive allowlist is rejected.

### The Removed-Comment Disclosure Warning

Hydration MUST additionally flag **removed comment lines carrying prose**: a
removed line whose content starts with a comment marker (`//`, `#`, `*`, `/*`,
`--`, `<!--`) and holds at least five word-like tokens. Only line-initial markers
count, because `//` and `#` also occur inside string literals and URLs and a rule
that split on them would flag ordinary code; a disclosure appended to a code line
is therefore **not** detected, and that limit is deliberate.

This rule is fuzzy and MUST NOT hard-fail. Of the eight cases it flags on the
thirty-six-case corpus, three are benign — a licence header whose copyright year
the fix bumped, an unrelated comment displaced by re-indentation, and a doc
comment for the fix's own helper that names nothing about the defect. A fuzzy rule
wired to a hard failure would reject those and invite whoever hit it to weaken the
rule until the corpus passed again. The advisory scan keeps its hard failure
precisely because it is specific.

The flag is instead **resolved per case and per comment in the manifest**, under
`removedCommentDisclosureReview`: the review date, the verdict, a rationale, and
the exact flagged comment texts. Requirements:

- An unresolved flagged comment **fails hydration**, so an unreviewed case cannot
  run silently.
- Acknowledgement is per comment text, not per case, so a re-capture that changes
  or adds a comment fails until that comment is judged.
- An acknowledgement the reviewed diff no longer removes also fails: a resolution
  that outlives its comment is a blanket approval waiting to cover whatever
  appears next.
- The verdict has exactly one value, `non-disclosing`. A disclosing comment has no
  resolution other than dropping the case, so the field cannot record "disclosing"
  and keep running.

#### Why This Requirement Exists

Measured 2026-07-27 over the committed corpus and the then-current baseline runs:
three cases leaked by this route, the worst carrying a comment that stated its
expectation almost verbatim. **Those cases scored 83.3% recall (10 of 12) against
44.3% (101 of 228) for the rest of the corpus**, and excluding them moved the
headline from 46.3% to 42.1%. Correlation is not proof that the comment caused
each hit, but the mechanism is direct and the gap is large.

Adjudicating all eight flagged cases against their own expectations found **five
disclosing**, and those were removed from the manifest:
`undici-coerced-header-value-skips-validation`,
`netty-gzip-extra-field-length-never-applied`,
`apisix-attach-consumer-label-leaves-client-headers`,
`nats-server-no-auth-user-skips-connection-restrictions` and
`nestjs-middleware-overlap-filter-uses-stateful-regex`. The last two were not
among the three measured leakers and were caught by reading the flagged text: one
stated in English the cross-file contract its expectation rests on, the other
restated its whole expectation. The three benign cases carry a recorded
resolution instead.

The rule was exercised again the same day, on the eleven candidate cases captured
to make convergence measurable. It flagged **eight of the eleven**, and
adjudication found **five disclosing**, all dropped before they entered a
measurement: `nats-server-gateway-pinned-certs-reload-check-inverted`,
`undici-cookie-serialization-skips-domain-and-attribute-validation`,
`netty-sni-handler-defaults-omit-clienthello-limit-and-timeout`,
`ktor-digest-auth-challenge-selection-and-header-handling` and
`traefik-consul-connect-peer-uri-check-drops-trust-domain`. Each carried a comment
the upstream fix **added** that states, in English, the intended behaviour its
expectation says is missing — a default buffer limit that is "small enough to not
allocate to much memory", a doc asserting the certificate must contain the
specified URI in its SANs, and so on. The three benign ones are all of the class
this section already names: prose the fix merely **displaced**, present unchanged
on the new side of the same hunk, so it carries nothing the checkout does not.
That eight-of-eleven flag rate, and the five-of-eight disclosure rate, is why the
rule cannot be a curation checklist.

**The corpus is therefore thirty-seven cases and eighty-seven findings from
2026-07-27, and every recall figure published before that date — including every
figure in this spec and in `docs/` — was measured against a different answer
key.** Both dropping and adding cases change the key, so those figures are not
comparable to a run on today's corpus, and the comparison tooling refuses such a
comparison outright.

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
  the removed-comment disclosure rule — that it fires on a comment explaining the
  defect, that it also flags a licence header and that hydration is quiet only
  once a curator has resolved it, that an unresolved flag fails hydration, and
  that a reused checkout is re-checked rather than trusted;
  case selection and filtering; the diff fingerprint; the repair and
  interrupted-hydration rebuild paths, exercised through a scripted git that
  reproduces which git operations are idempotent and which are not; and the pure
  helpers that build the git argument vectors and check checkout integrity.
- No test performs a network fetch, and no test runs a provider call. Hydration
  against upstream is an explicit, operator-run step.

## Measured Baseline

The baseline below was measured on the **thirty-case, forty-two-finding** corpus.
The corpus has since changed four times — first to thirty-six cases and
fifty-eight findings with the multi-file cases described above, then to thirty-six
cases and eighty findings by curating expectations per case (see *Expectations Per
Case* below), then down to thirty-one cases and seventy-four findings when
five cases were dropped for removed-comment disclosure (see *Anti-Contamination*),
and finally up to **thirty-seven cases and eighty-seven findings** with the
convergence capture of 2026-07-27.
A run on today's corpus is therefore not comparable to these numbers
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

Composition today: **eighty-seven expected findings across thirty-seven cases** —
7 cases with one expectation, 16 with two, 10 with three, 3 with four, and 1 with
six. Recomputed from the manifest on 2026-07-27; it is a count of committed data,
not a measurement. Ten of the added expectations are high-severity and sit at rank
two or later, which the baseline decomposition above could not previously observe
at all: every high in the old key was first-listed.

A `low`-severity expectation is a **deliberately hard** entry in this key, and the
corpus carries twelve of them. The eval scores against **admitted** findings, and
admission applies `aiReview.actionableSeverityThreshold` (default `medium`) to
every model-origin candidate, so a `low` expectation can only be matched by a
candidate the engine itself rated `medium` or above — that is, by a severity the
answer key says is wrong. Such an expectation is not unmatchable, but it is
matchable only against the grain of the severity rubric, and it depresses recall
and severity accuracy in opposite directions. That is a corpus-wide property, not
a defect of any one case; it is recorded here so nobody re-derives it from a
disappointing run.

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
- A case whose reviewed diff removes a prose comment cannot be measured until a
  curator has resolved every flagged comment in the manifest, whether the diff was
  freshly generated or reused from an existing checkout.
- Cross-file recall reported on this corpus is a property of the engine: the
  evidence for every cross-file expected finding is present in the checkout.
