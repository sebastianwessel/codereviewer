# Un-anchored discovery pass A/B: the mechanism works, the payoff is not there

Date: 2026-07-27
Corpus: real-repo-cross-file, 36 cases / 80 expectations
Arms: base n=6, un-anchored pass enabled n=3
Verdict: **does not clear the bar. Recommend removal per spec 19's decision rule.**

---

## Headline

| | base (n=6) | pass enabled (n=3) |
|---|---:|---:|
| Recall | 46.25% | **47.08%** |
| Adjusted precision | 0.804 | 0.792 |
| Raw precision | 0.682 | 0.579 |
| Genuine false positives / run | 9.7 | 11.0 |
| Candidates / run | 74.7 | **117.0** |
| Refutation kill rate | 1.3% | **16.0%** |
| Merge collapses / run | 1.7 | **19.3** |
| **Cost / run** | **$1.92** | **$4.53** |

Paired finding-level test (`eval-significance.ts`, 80 paired expectations):

- delta **+0.83pp**, 95% CI **[−3.13, +4.79]**
- **10 gained, 9 lost**, 19 discordant
- **z = 0.229, p = 0.82**

**+0.83pp for +136% cost, at p = 0.82.** Ten expectations gained and nine lost is
a coin flip, not an improvement.

---

## Every mechanism did exactly what it was built to do

This is not a broken implementation, and that matters for what we conclude.

- **The pass generated.** Candidates rose 74.7 → 117 per run (+56%), and input
  tokens 1.13M → 2.58M. It read code the diff-anchored pass never looks at.
- **The gate filtered.** Refutation's kill rate rose **1.3% → 16.0%**, which was
  the pre-committed falsifier: had it stayed flat, the speculative candidates
  would have been landing in reports and precision would have collapsed. It
  didn't. The refuter absorbed them, exactly as §5.1 predicted it had capacity to.
- **The merge collapsed.** 1.7 → 19.3 merges per run. The semantic merge is
  clearly load-bearing under decomposed discovery — without it, ~19 restatements
  per run would have reached the reader.
- **Adjusted precision held**: 0.804 → 0.792. Raw precision fell (0.682 → 0.579)
  because there are more speculative candidates, which is the expected shape.

So the architecture behaves as designed under load. The defect is in the
hypothesis, not the build.

---

## Why this is a removal and not a "keep it disabled"

Spec 19 recorded, before the run, that this corpus is **close to the best case**
for the change: median 7 changed lines per case, median 2 hunks, 17 of 36 cases
single-hunk. A small diff is where the anchor pulls hardest and therefore where
removing the anchor has the most to add. The spec's own words: *"a pass that does
not help here will not help anywhere."*

It did not help here. Committing that criterion in advance is what makes this
conclusion cheap to accept now rather than something to argue about.

The decision rule from spec 19, applied literally:

- *Ship enabled* — requires significance, intact precision, **and** defensible
  cost per additional matched expectation. Fails on two of three.
- *Ship disabled but retained* — requires recall to rise. 10 gained against 9
  lost is not a rise.
- *Remove entirely* — **this one.**

---

## What was actually learned, which is not nothing

1. **The diff-anchoring diagnosis stands, but removing the anchor is not the
   lever.** The capability test proved the model *can* find later-in-file defects
   when the anchor is gone. This A/B proves that at corpus scale, what it finds
   in that mode is mostly not what the answer key lists — 42 extra candidates per
   run yielded ~0 net expectations.
2. **The refutation stage has real, usable headroom.** Kill rate moved 1.3% →
   16.0% under a 56% candidate increase without adjusted precision degrading.
   Any future "generate wider" experiment can lean on that.
3. **The semantic merge is validated under the only conditions that test it.**
   At 19.3 collapses per run it did its job, and the paired test shows no
   systematic loss (9 lost vs 10 gained is symmetric noise, not the one-sided
   deletion a defective merge would produce). It stays.
4. **The 4.7% later-in-file recall gap remains unexplained by any lever we have
   tried.** Five structural interventions have now failed: enumeration sweep,
   diverse-lens pass, cross-file retrieval, context scout, un-anchored pass.

---

## Process failure worth recording

The first A/B (6 runs, ~$11.50) measured **base against base**. The config flag
was passed through a shell variable, and zsh — unlike bash — does not word-split
unquoted parameters, so `--config <path>` arrived as a single argument and was
ignored.

The tells were present in the data and were caught before any conclusion was
drawn: identical token volumes across arms (1.14M vs 1.13M), zero truncation
warnings, and the "enabled" arm costing *less* than base. The re-run added an
explicit token-volume guard that fails loudly if the pass did not run.

Those six runs were not wasted — they are the post-change baseline reported
above, at n=6 rather than n=3.

Total spend: ~$25.

---

## Recommendation

Remove the un-anchored pass: the code, the config keys, spec 19, and its docs.
Keep the semantic finding merge, which is independently justified and validated.

Retain in the record: the capability-test evidence, the refutation-headroom
finding, and this result — so the next person who proposes decomposed discovery
finds the measurement rather than repeating it.
