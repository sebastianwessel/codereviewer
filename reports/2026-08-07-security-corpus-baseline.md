# Security recall on advisory-confirmed defects — first baseline

Measured 2026-08-07. Provider `openai/gpt-5.3-codex`. Engine pinned at
`9e410d2469924fca1212777faa54ae9a2fae0137`, 0 dirty files. Corpus
`eval/corpora/security-advisory-2026` — 25 cases, 26 expected findings. Three
seeds.

Every rate below is a property of that model on that corpus. It is not a property
of the engine.

## Headline

| | seeds | mean | sd |
| --- | --- | --- | --- |
| recall | 65.4 / 57.7 / 61.5% | **61.5%** | 3.85pp |
| precision, raw (lower bound) | 73.9 / 75.0 / 72.7% | **73.9%** | 1.14pp |
| precision, adjusted (upper bound) | 100 / 100 / 100% | **100%** | 0 |
| cost per run | $1.34 / $0.53 / $0.71 | $0.86 | — |

**Genuine false positives across all three seeds: 0.** Every finding that did not
match an expectation was judged a real defect the advisory simply did not name —
which is what an advisory-derived answer key predicts, since an advisory names one
defect and the file may contain others. Precision is therefore a bracket
**[73.9%, 100%]**, not a number, and this corpus cannot narrow it: under an
incomplete key precision is not identifiable.

The first run cost $1.34 and the later two $0.53 and $0.71. That is the prompt
cache warming, not a change in behaviour.

## What this overturns

The previous security measurement recorded **xss, ssrf and cryptography at 0%**
and cross-file at 0%. On material selected for those classes rather than
incidentally containing them, none of that holds:

| mechanism | pooled | | mechanism | pooled |
| --- | --- | --- | --- | --- |
| path-traversal | **9/9** | | authorization | 3/6 |
| cryptography | **12/12** | | xss | 6/12 |
| deserialization | 2/3 | | concurrency-resource | 3/9 |
| secret-flow | 7/12 | | injection | 1/3 |
| ssrf | 5/9 | | unsafe-config | 0/3 |

**Read these as directions, not numbers.** The denominator is three seeds over one
to four expectations, so a mechanism's row carries at most four independent
observations however large the fraction looks. Repeating a run triples the
denominator without adding information. `path-traversal` and `cryptography` were
found by every seed; `unsafe-config` by none; everything between moved seed to
seed.

## The wall is cross-file, and it is the same wall as before

| context depth | pooled | |
| --- | --- | --- |
| cross-function | 8/9 | 89% |
| local | 14/18 | 78% |
| implementation | 12/18 | 67% |
| callee | 5/9 | 56% |
| **cross-file** | **9/24** | **38%** |

Cross-file is the largest bucket in the corpus and the worst-served. Five of the
nine distinct misses in the first seed were cross-file, and the ordering above was
stable across all three.

This matters more than it looks, because **cross-file retrieval is already on by
default** (since 2026-08-01). 38% is what the reviewer achieves *with* the
mediated read/list/grep tools available to it, not without. The lever that was
supposed to address this class has been pulled, and the class is still the gap.
That is consistent with the independent finding that cross-file navigation in the
verification stage was the single largest factor in a published review benchmark,
and with this project's own record that the out-of-diff wall is attention rather
than retrieval.

## The dev/held-out gap is not significant, and should not be quoted

Pooled, dev scores 22/30 and held-out 26/48 — 73.3% against 54.2%. It is tempting
to read that as leakage into the older half.

Do not. The three seeds are repeated measures on the same 26 expectations, so the
real denominators are 10 and 16, not 30 and 48. Even treating the pooled counts as
independent — which overstates the evidence — a two-proportion test gives z ≈ 1.69,
p ≈ 0.09. On the honest denominators it is weaker still. The gap is a hypothesis
worth re-testing when the corpus grows, and nothing more.

## What this measurement does not establish

- **It is not comparable to the cross-file corpus's in-diff recall.** Different
  corpus, different question, different answer-key construction. No figure here
  may be differenced against a figure from there.
- **It is recall against advisory-named defects**, not against every defect in the
  reviewed diff. That is the right target for security, and it is also why the
  unmatched findings are mostly real.
- **It is a dev-and-held-out baseline taken before any A/B was decided on this
  corpus.** The moment an intervention is chosen on the dev half, the dev half has
  absorbed the iteration and only the held-out half backs an acceptance claim.
- **sd 3.85pp over three seeds** means this instrument cannot resolve a difference
  below roughly 8 percentage points at n=3. Any intervention smaller than that
  needs more seeds or a bigger corpus, not a louder claim.

## The one thing to do next

Cross-file at 38%, with retrieval already enabled, is the largest measured deficit
this project has that is not explained by instrument noise. It is worth more than
any remaining token or prompt optimisation, and it is the class most of these
advisories fall into.
