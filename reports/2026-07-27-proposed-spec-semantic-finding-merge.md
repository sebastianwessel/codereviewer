# Proposed spec change: semantic finding merge

Date: 2026-07-27
Status: **PROPOSAL — awaiting human approval.** Nothing has been written to
`specs/`. `specs/_provenance.yaml` records `human_approval: approved`, and it
would be dishonest to extend an approved spec without approval, so the intended
text is reproduced here in full for review.

Target: `specs/05-review-workflow-and-runtime.md`, new section after the
admission gate.

---

## 1. Why this is needed now

### 1.1 What exists today

Candidate merging in `holistic-task-review.ts` is two mechanisms, both positional
or identity-based:

- Candidates are **deduplicated by model-assigned `id`**.
- The dedicated security pass merges **additively at locations the general call
  did not already flag** — spec 15's `(path, line)` rule.

Neither asks whether two findings *describe the same defect*.

### 1.2 The measured failure

Nine archived runs, 164 unlisted-real findings: **89 (54.3%) sit within three
lines of a finding already matched in the same file**, and 63 repeat a
`path:line` already credited in the same run. In `traefik` the engine emits six
findings per file — three phrasings of line 592, three of line 593 — for a single
nil dereference. Raw precision halved in those runs (0.80 → 0.50).

The eval-side half of this was fixed on 2026-07-27 (`EVAL_METRICS_VERSION`
`2026-07-27.plausibility-restatement-collapse`). **The product-side half is
untouched: the human reading the review still gets six comments for one bug.**

### 1.3 Why it blocks the enumeration work

The planned bounded-window discovery reviews a file as overlapping windows and
unions the candidates. **That produces duplicate findings by construction** —
the overlap regions are precisely where one defect is described twice from two
windows, at two different anchor lines, by two independent calls that never see
each other's output.

Merging by id cannot help: the ids come from different calls. Merging by
`(path, line)` cannot help: the anchors differ.

So a recall gain and triplicated findings would be **indistinguishable** in the
measurement. The merge must land first, or the windowing experiment is
uninterpretable.

---

## 2. Proposed spec text

> ### Semantic Finding Merge
>
> Discovery may produce several candidates that describe one underlying defect.
> This happens whenever more than one call examines overlapping code — the
> additive security pass, and any future decomposition of a file into multiple
> review units — and it also happens within a single call, which may restate one
> defect at neighbouring lines.
>
> Before admission, candidates for the same file MUST be grouped by whether they
> describe the **same underlying defect**, and each group MUST be reduced to one
> admitted finding.
>
> **Positional identity is not sufficient and MUST NOT be the test.** Two
> findings one line apart are frequently one defect; two findings on the same
> line are frequently two defects — a missing null check and a wrong comparison
> operator on one expression are distinct problems a reviewer needs both of.
> A line-distance threshold fails in both directions, and it fails silently in
> the direction that loses a real defect.
>
> The grouping decision is therefore semantic and is made by a model call that
> reads the candidate descriptions. That call:
>
> - Receives the candidates for one file, together with the file, and returns
>   **groups**. It MUST NOT be asked which candidate to discard.
> - MUST treat proximity as no evidence at all. Two candidates are the same
>   defect only when they share a root cause *and* a code element. Distinct
>   defects that happen to sit near each other are separate.
> - MUST default to NOT grouping when uncertain. The costs are asymmetric: a
>   wrong merge silently removes a real defect from the review, while a missed
>   merge produces a redundant comment. The visible failure is the acceptable
>   one.
> - MUST remain generic and language-neutral, per the Non-Negotiable in spec 15.
>
> Selection of the representative candidate from a group is **deterministic and
> made in code**, not by the model: highest severity first, then the most
> specific location, then the lowest candidate index. Non-representative members
> of a group are recorded, not silently dropped, so the merge is auditable and
> its rate observable.
>
> This stage MUST be a separate model call from refutation. Refutation asks
> whether a finding is true; merging asks whether two findings are one. Combining
> unrelated judgements into one call is a documented cause of degraded
> refutation quality.
>
> The evaluation's own duplicate detection MUST remain independent of this
> mechanism. If scoring reused the product's merge, a defective merge would
> conceal itself.

---

## 3. Rationale for the design choices

**Cluster, don't filter.** Asking a model which finding to drop invites it to
drop a real one. Asking it which findings are the same defect, then choosing the
representative in code, keeps the irreversible decision deterministic. This is
the shape Cursor's v1 pipeline used — bucket similar bugs, then merge each bucket
into one description — and Ellipsis makes deduplication the first stage of its
filter pipeline for the same reason: its parallel generators overlap by design.

**Conservative bias, stated as a rule rather than a hope.** A wrong merge is
invisible in every metric we have — the finding simply never appears. A missed
merge shows up immediately as a redundant comment. Given we cannot measure the
first, the instruction must be explicit about which way to err.

**Separate call.** Folding merging into the existing batched refutation call
would be nearly free — that call already carries every candidate for the task
plus the file. It is tempting and it is the wrong trade. Requiring a verdict
*plus* an explanation *plus* a fix in a single call has been measured to drive
spurious rejection from 26–36% to 73–88%. Refutation is the stage our precision
depends on and it is not worth risking to save one call.

**Independent eval-side detection.** Stated because the alternative is a real
trap: a merge that wrongly collapses two defects would, if reused in scoring,
make both look like one expectation and hide its own error.

---

## 4. Ordering and measurement

Land in this order:

1. Semantic merge (this proposal).
2. Confirm on the current corpus that recall is **unchanged** and
   `duplicateFindingCount` / restatement counts **fall**. A recall drop here
   means the merge is collapsing distinct defects — that is the failure mode to
   watch for, and it is why step 2 exists at all.
3. Only then, bounded-window discovery.

Metrics that prove it works, all already recorded: `duplicateFindingCount`,
`genuineFalsePositiveCount`, raw `precision`, and `recall` held flat. The
traefik case is the natural canary — six findings per file for one defect should
become one.

Merge-rate telemetry (groups formed, group sizes) should be recorded from the
start; without it, "the merge is not firing" and "there was nothing to merge"
look identical.

---

## 5. Open question for the approver

A line-overlapping duplicate currently lands in `duplicateFindingCount` and is
**excluded** from false positives, while a semantic restatement at a
non-overlapping line now counts as a **genuine false positive**. Same phenomenon,
two buckets, split by whether line ranges happen to touch.

The stricter treatment is defensible — Google's Tricorder counts any finding a
developer takes no action on as an effective false positive, and the third
restatement of a bug is exactly that. But the split should be a decision rather
than an accident. Either bucket is arguable; the current inconsistency is not.
