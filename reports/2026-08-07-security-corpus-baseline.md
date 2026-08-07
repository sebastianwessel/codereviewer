# Security recall on advisory-confirmed defects — first baseline

Measured 2026-08-07. Provider `openai/gpt-5.3-codex`. Engine pinned at
`9e410d2469924fca1212777faa54ae9a2fae0137`, dependency digest
`52d22c4858028742`, **0 dirty files in all three runs**. Corpus
`eval/corpora/security-advisory-2026` — 25 cases, 26 expected findings. Three
seeds.

Every rate below is a property of that model on that corpus. It is not a property
of the engine.

## A correction, and what caused it

An earlier draft of this report published **61.5% recall, sd 3.85pp, adjusted
precision 100%, zero genuine false positives**. Those figures are wrong and are
superseded by the table below.

The cause is worth recording because it nearly stood. The third seed originally ran
while documentation was being edited in the main working tree, so its provenance
sidecar recorded 5 dirty files against the other two seeds' 0.
`engine-consistency.mjs` keys on `engineSha + engineDirtyDigest + deps` and would
have refused to pool the three. The dirty work provably could not have
participated — `engine-pin.sh` runs the engine from a detached `git worktree` at the
SHA — so the temptation was to argue the guard was over-strict and pool anyway.

Re-running it clean instead returned **50.0%**, not 61.5%. Same engine, same
corpus, same everything the guard was worried about: the difference is ordinary
run-to-run variance. Honouring a conservative guard turned out to correct a headline
by 3.8 percentage points and to double the measured variance — which is the whole
argument for not arguing around one by hand.

The discarded run scored 61.5%, so across four executions at this engine the
observed spread is **50.0% – 65.4%**. That fourth run is named here and excluded
from every figure below, because the rule is the rule.

## Headline

| | seeds | mean | sd |
| --- | --- | --- | --- |
| recall | 65.4 / 57.7 / 50.0% | **57.7%** | 7.69pp |
| precision, raw (lower bound) | 73.9 / 75.0 / 65.0% | **71.3%** | 5.49pp |
| precision, adjusted (upper bound) | 100 / 100 / 92.9% | **97.6%** | 4.12pp |
| cost per run | $1.34 / $0.53 / $0.65 | $0.84 | — |

**Genuine false positives across all three seeds: 1.** Nearly every finding that did
not match an expectation was judged a real defect the advisory simply did not name —
which is what an advisory-derived answer key predicts, since an advisory names one
defect and the file may contain others. Precision is a bracket **[71.3%, 97.6%]**,
not a number, and this corpus cannot narrow it: under an incomplete key precision is
not identifiable.

The first run cost $1.34 and the later two $0.53 and $0.65. That is the prompt cache
warming, not a change in behaviour.

## sd 7.69pp is the most consequential number here

At three seeds this instrument cannot resolve a difference below roughly **16
percentage points**. That is worse than the cross-file corpus (sd ≈ 4.8pp) and much
worse than the 3.85pp the discarded draft reported.

Everything downstream inherits it. A per-mechanism row, a per-depth row, an A/B on a
prompt or a token reduction — none of them can be settled here unless the effect is
enormous. Growing the corpus is the fix; more seeds on 26 expectations is not.

## What this overturns anyway

The previous security measurement recorded **xss, ssrf and cryptography at 0%** and
cross-file at 0%. On material selected for those classes rather than incidentally
containing them, none of that holds — and the two strongest rows are unchanged by
the correction above:

| mechanism | pooled | | mechanism | pooled |
| --- | --- | --- | --- | --- |
| path-traversal | **9/9** | | authorization | 2/6 |
| cryptography | **12/12** | | concurrency-resource | 3/9 |
| deserialization | 3/3 | | injection | 1/3 |
| ssrf | 5/9 | | unsafe-config | **0/3** |
| xss | 6/12 | | secret-flow | 4/12 |

**Read these as directions, not numbers.** The denominator is three seeds over one
to four expectations, so a row carries at most four independent observations however
large the fraction looks. Repeating a run triples the denominator without adding
information. `path-traversal` and `cryptography` were found by every seed;
`unsafe-config` by none. Everything between moved seed to seed, and the correction
moved several rows by a third of their denominator.

## The wall is cross-file, and it did not move

| context depth | pooled | |
| --- | --- | --- |
| cross-function | 9/9 | 100% |
| local | 13/18 | 72% |
| implementation | 10/18 | 56% |
| callee | 4/9 | 44% |
| **cross-file** | **9/24** | **38%** |

**Cross-file came out at exactly 9/24 both before and after the correction.** It is
the largest bucket in the corpus, the worst served, and the only row that did not
move when a seed was replaced. That makes it the one claim here strong enough to act
on.

It matters more than it looks, because **cross-file retrieval is already on by
default** (since 2026-08-01). 38% is what the reviewer achieves *with* the mediated
read/list/grep tools available to it, not without. The lever that was supposed to
address this class has been pulled, and the class is still the gap. That is
consistent with the independent finding that cross-file navigation in the
verification stage was the single largest factor in a published review benchmark,
and with this project's own record that the out-of-diff wall is attention rather
than retrieval.

## The dev/held-out gap grew, and still should not be quoted

Pooled, dev scores 24/30 and held-out 21/48 — 80.0% against 43.8%. The correction
widened it.

Still do not quote it. The three seeds are repeated measures on the same 26
expectations, so the real denominators are 10 and 16, not 30 and 48. On those, a
two-proportion test gives z ≈ 1.82, **p ≈ 0.07**. Suggestive, not established. It is
a hypothesis worth re-testing when the corpus grows — and given sd 7.69pp, "when the
corpus grows" is doing the load-bearing work in that sentence.

## What this measurement does not establish

- **It is not comparable to the cross-file corpus's in-diff recall.** Different
  corpus, different question, different answer-key construction. No figure here may
  be differenced against a figure from there.
- **It is recall against advisory-named defects**, not against every defect in the
  reviewed diff. That is the right target for security, and it is also why the
  unmatched findings are nearly all real.
- **It is a dev-and-held-out baseline taken before any A/B was decided on this
  corpus.** The moment an intervention is chosen on the dev half, the dev half has
  absorbed the iteration and only the held-out half backs an acceptance claim.

## The one thing to do next — corrected

Cross-file at 38% is the largest deficit here that noise does not explain, and it is
the only row that survived a seed being replaced unchanged. But the lever it implies
is **not** "reach further into other files", and a companion analysis of the same
three runs says why: `reports/2026-08-07-why-cross-file-misses.md`.

On the cross-file expectations it missed, the reviewer made **more** discovery calls
(1.20 vs 1.00) and produced **more** findings (1.47 vs 1.11) than on the ones it
found, and **none of the 15 cross-file misses was silent**. It looked, it reported —
it reported something else.

The binding constraint is that the engine emits **1.17 candidates per case-run**
against an answer key naming **1.04 defects per case**, and 19.3% of what it emits is
a real defect the advisory does not list. Recall here is largely *did the one thing
it reported match the one thing the advisory named*, and cross-file loses that
selection contest more often than local does.

That rules out the two obvious levers — more calls is contradicted by the data above
and was already measured and rejected in July; more retrieval is already on by
default. What is left is findings-per-call, and it comes with a trap: raising it
would lift recall on a single-defect key almost mechanically, improvement or not. Any
intervention there must be pre-registered against **precision at the same time**.

And acting on any of it needs a bigger corpus first. At sd 7.69pp an intervention
would have to move cross-file recall by more than half its current value before this
instrument could see it. 91 screened candidates from the same harvest were never
curated; that is where the next cases come from.
