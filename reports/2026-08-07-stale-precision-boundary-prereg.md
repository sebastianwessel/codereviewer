# Pre-registration: the stale precision boundary

**Written before the code change and before any run, and not edited after one is
taken.**

## The defect

`modelHolisticReviewerInstructions` ends its precision clause with:

> do NOT speculate about callers, configuration, tests, or behavior **not present in
> reviewText**.

`crossFileRetrievalInstructions`, appended whenever retrieval is enabled, says for
the same situation:

> the defect depends on how that definition actually behaves. In that situation,
> **read the definition before deciding, instead of guessing or staying silent**.

For a `callee` or `implementation` defect the required behaviour is *by definition*
not present in reviewText. One clause forbids reasoning about it; the other requires
going to get it. The two contradict.

**This is provenance, not interpretation.** The "not present in reviewText" boundary
is in the tree at `ac4451a` (2026-06-24). Cross-file retrieval became default at
`46077ec` (2026-07-31) — five weeks later. The clause was written for a reviewer
with no tools, and its boundary went stale when tools were added and turned on. It
has been contradicting the retrieval instructions ever since.

## The measured consequence

From 300 case-runs (`reports/2026-08-07-where-recall-is-lost.md`), discovery returns
an **empty findings array** in 9.0% of case-runs, and the silence is concentrated
exactly where the clauses disagree:

| context depth | empty-return rate |
| --- | --- |
| analyzer-path-dependent | 50.0% (6/12) |
| callee | 25.0% (9/36) |
| implementation | 15.2% (10/66) |
| cross-function | 2.1% |
| cross-file | 1.2% |
| local, caller | 0% |

`callee` and `implementation` are the depths whose defects turn on behaviour that is
not in reviewText. `cross-file` — where the file is absent but the *behaviour* is
often visible once read — is 1.2%.

## The intervention

The boundary is moved from *where the text came from* to *whether it was
established*:

> …and do NOT speculate about callers, configuration, tests, or behavior you have
> not established from something you actually read.

Nothing else changes. This is deliberately configuration-neutral: with retrieval
disabled "something you actually read" is exactly reviewText, so the meaning is
unchanged; with retrieval enabled it correctly includes what the tools returned. One
wording is correct in both configurations, which is what the original clause failed
to be.

## The design, and why the primary endpoint is not recall

Control vs treatment, three seeds each, interleaved, over the 51-case corpus.

**Primary endpoint: the empty-return rate**, `rawFindingCount == 0`, over
**306 case-runs** — not recall over 52 expectations. That is the mechanism the change
targets, and it is the only endpoint here with a denominator large enough to resolve
the effect. Recall on this corpus resolves ~8 points and the entire silence budget is
9 points, so recall alone cannot settle this and saying so afterwards would be an
excuse.

## The decision rule

**Ships** only if all three hold:

1. the empty-return rate falls, and the fall is larger than the control arm's own
   seed-to-seed spread;
2. recall does not fall at all — a converted silence that produces a *wrong* finding
   is not a win, and recall is the guard against exactly that;
3. genuine false positives do not rise above the control arm's count, and adjusted
   precision does not fall.

Criterion 3 is stated **as a change from this A/B's own control arm**, not as an
absolute copied from a prior baseline. That is the lesson from today's earlier
pre-registration, whose absolute "no genuine false positives" threshold turned out
to disqualify its own control arm and discriminate nothing.

**Is rejected** if recall falls, if genuine false positives rise, or if the
empty-return rate does not fall.

**Is recorded as inconclusive and reverted** if the empty-return rate falls but
recall does not move: that means silence was converted into findings that are not
the ones the advisories name, which is motion without value and not worth the
cache invalidation.

## Stated in advance

A recall gain, if any, is **bounded at about 9 points** by the total silence budget
and will most likely be smaller. Any recall movement under ~8 points is *consistent
with* this fix and is not proof of it; the empty-return rate is what carries the
claim. If the empty-return rate falls and recall moves 2 points, the honest sentence
is "the mechanism moved, the recall effect is within noise" — not "recall improved".
