# Security recall on advisory-confirmed defects — baseline

Measured 2026-08-07 on the **50-case** corpus. Provider `openai/gpt-5.3-codex`.
Engine pinned `49f0c6697179`, dependency digest `52d22c4858028742`, **0 dirty files
in all three runs**. Corpus `eval/corpora/security-advisory-2026` — 50 cases, 51
expected findings, 33 repositories. Three seeds.

Every rate below is a property of that model on that corpus. It is not a property
of the engine.

## Headline

| | seeds | mean | sd |
| --- | --- | --- | --- |
| recall | 60.8 / 56.9 / 64.7% | **60.8%** | 3.92pp (see correction below) |
| precision, raw (lower bound) | 70.5 / 69.0 / 73.3% | **71.0%** | 2.18pp |
| precision, adjusted (upper bound) | 100 / 100 / 100% | **100%** | 0 |
| cost per run | $3.19 / $1.24 / $1.22 | $1.88 | cold, then cache-warm |

**Genuine false positives: 0, across all three seeds and 51 expectations.** Every
finding that did not match an expectation was judged a real defect the advisory did
not name — which is what an advisory-derived key predicts, since an advisory names
one defect and the file may contain others. Precision is a bracket **[71.0%,
100%]** and this corpus cannot narrow it: under an incomplete key precision is not
identifiable.

## CORRECTION 2026-08-07: the variance claim below does not hold

> This section originally reported that doubling the corpus halved the standard
> deviation from 7.69pp to 3.92pp. **That is not supported.** Four independent
> three-seed estimates of no-intervention recall on this corpus have since been
> taken and they span **2.22 to 8.38pp — a 3.8x spread**. Pooled over 8 degrees of
> freedom the standard deviation is **5.71pp**, and the 3.92pp above was a low
> draw. Three seeds resolve about **11 percentage points**, not 8. Doubling the
> corpus was still right; the evidence offered for it was a favourable coin.
> See `reports/2026-08-07-three-nulls-and-the-real-variance.md`.

## Why the corpus was doubled, and what that did and did not buy

| | 25-case corpus | 50-case corpus |
| --- | --- | --- |
| expectations | 26 | 51 |
| recall | 57.7% | 60.8% |
| sd, one three-seed estimate | 7.69pp | 3.92pp |
| sd, pooled over four three-seed arms (8 df) | — | **5.71pp** |
| resolves a difference of | — | **~11pp** |

The second round of curation happened because the first baseline's own variance said
26 expectations could not settle any intervention worth making. That reasoning was
sound and more cases genuinely do reduce sampling variance.

**What cannot be claimed is that it halved the variance.** The 3.92pp was one
three-seed estimate, and three further estimates of the same quantity have since come
in at 6.30, 2.22 and 8.38pp. The estimator varies by 3.8× between samples; 3.92 was a
low draw. Pooled, the standard deviation is 5.71pp and three seeds resolve about
eleven percentage points.

**The two recall figures are not a change and must not be read as one.** They are
two measurements of different corpora. 60.8% is this corpus's figure; pooled over all
twelve no-intervention runs since, the level is about **61%**.

## By mechanism

Pooled over three seeds. Denominator is 3 × expectations.

| mechanism | pooled | | mechanism | pooled |
| --- | --- | --- | --- | --- |
| path-traversal | 22/24 (92%) | | ssrf | 9/15 (60%) |
| cryptography | 12/15 (80%) | | injection | 10/21 (48%) |
| concurrency-resource | 12/18 (67%) | | xss | 10/21 (48%) |
| deserialization | 2/3 (67%) | | **authorization** | **7/18 (39%)** |
| secret-flow | 9/15 (60%) | | unsafe-config | 0/3 (0%) |

Still directions rather than numbers — three seeds over one to eight expectations —
but the denominators are now large enough that the ordering is worth something.

**`authorization` at 39% is the finding that changed.** On the 25-case corpus it
was 2/6 and dismissible as noise. On 18 observations it is the worst substantial
row, and it is the class this spec has said since its first line is where the
majority of real security findings live. That is a worse result than the small
corpus suggested, not a better one.

`unsafe-config` remains 0, on 3 observations from a single expectation. It is not
yet evidence of anything.

## By context depth

| context depth | pooled | |
| --- | --- | --- |
| local | 18/21 | 86% |
| caller | 5/6 | 83% |
| callee | 12/18 | 67% |
| cross-function | 15/24 | 62% |
| implementation | 22/36 | 61% |
| **cross-file** | **20/42** | **48%** |
| analyzer-path-dependent | 1/6 | 17% |

**Cross-file is 48%, not the 38% the small corpus reported** — measured on 42
observations instead of 24. It is still the worst row with a real denominator, and
it is still the largest bucket in the corpus. Cross-file retrieval has been on by
default since 2026-08-01, so this is what the reviewer achieves *with* the mediated
read/list/grep tools in hand.

Two corrections to what the small corpus appeared to show:

- **`cross-function` was 9/9 (100%) and is now 15/24 (62%).** A perfect row on nine
  observations was a small-sample artifact. This is what "read them as directions"
  was protecting against, and it is worth keeping as a worked example.
- **`local` is 86%, not 72%.** Also moved, also on a bigger denominator.

`analyzer-path-dependent` at 1/6 comes from two expectations and means nothing yet.

## The dev/held-out gap got *less* significant with more data

| | pooled | per-expectation |
| --- | --- | --- |
| dev | 34/45 (75.6%) | 15 expectations |
| held-out | 59/108 (54.6%) | 36 expectations |

On the honest per-expectation denominators, z ≈ 1.39, **p ≈ 0.16**. On the 25-case
corpus the same comparison gave z ≈ 1.82. Adding data moved it *away* from
significance, which is evidence against the leakage reading rather than for it.

Do not quote this gap.

## What this measurement does not establish

- **It is not comparable to the cross-file corpus's in-diff recall.** Different
  corpus, different question, different answer-key construction.
- **It is recall against advisory-named defects**, not against every defect in the
  reviewed diff. That is the right target for security, and it is why the unmatched
  findings are all real.
- **It is a baseline taken before any A/B was decided on this corpus.** The moment
  an intervention is chosen on the dev half, the dev half has absorbed the iteration
  and only the held-out half backs an acceptance claim.
- **Zero genuine false positives is a property of this key**, not a licence to claim
  100% precision. The upper bound is what an incomplete key permits, not what was
  measured.

## What to do next — and it is NOT decidable by an A/B at this size

At a pooled sd of 5.71pp, three seeds resolve about **eleven** percentage points, and
no plausible prompt-level intervention is that large. Three were pre-registered,
measured and rejected on 2026-08-07; all three read null, and the paired sign test
returned p = 1.0000 each time. See
`reports/2026-08-07-three-nulls-and-the-real-variance.md`.

Two rows remain the largest deficits and are worth targeting once the instrument can
see a change:

- **`authorization` at 39%** over 18 observations, in the class this spec identifies
  as carrying the majority of real security defects.
- **`cross-file` at 48%** over 42 observations, the largest bucket, with the lever
  intended for it already pulled.

`reports/2026-08-07-why-cross-file-misses.md` argues from the previous run set that
the cross-file constraint is selection rather than reach — the reviewer looked and
reported, it reported something else. That analysis was made on 25 cases and should
be re-run against these three, because the population it described has doubled.
