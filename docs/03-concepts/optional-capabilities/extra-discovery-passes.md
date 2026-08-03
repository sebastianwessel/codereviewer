# Extra Discovery Passes (Removed)

Three additional discovery passes once existed as opt-in capabilities. **All three
were removed** — code, configuration keys, and the spec requirement. This page is
the record of what they were and what measuring them established, so the same
shape is not rebuilt without new evidence.

There is nothing to configure here. Every one of those keys was deleted from the
configuration schema, which is strict: a config file that still sets one now fails
validation with exit code `2`. Remove the block.

## What they were

| | Enumeration sweep | Diverse-lens pass | Un-anchored pass |
| --- | --- | --- | --- |
| Asked | the **same** question again, minus what was already reported | a **different** question: concurrency, asynchrony, error paths, resource lifetime, contracts, edge cases | the **same** question, unchanged — the variable was the packet, not the prompt |
| Was shown | the whole task packet | the whole task packet | one bounded unit of one file, **with the diff withheld** |
| Calls added | up to 4 per task, stopping early once a round added nothing | 1 per task, serial | 1 per reviewed unit, bounded per file and per run |
| Merge | additive — could only add candidates at locations no earlier pass claimed | same | same |

## The problem they addressed — still open

A single discovery pass reports roughly **one defect per file**. On the 30-case /
42-finding real-repository corpus:

| Cases carrying… | Recall |
| --- | --- |
| one expected finding | 16 / 24 |
| two expected findings | 7 / 18 |

In **7 of those 9** two-finding cases the review found exactly one of the two and
never both. Instrumentation put the mechanism in generation rather than in the
pipeline: every task produced one finding, kept one candidate, dropped none.
Nothing was losing findings; there simply was one.

**This limitation remains open.** What the measurement settled is only that neither
re-asking the same question nor asking a differently-framed one recovers the missed
defect.

## What was measured — the first two

30-case / 42-finding real-repository corpus, **3 seeds per arm**. Every recall,
precision and cost figure on this page was measured on `openai/gpt-5.3-codex`;
all three passes were prompt-level interventions, so their verdicts belong to
that model and not to the idea.

| Arm | Recall (3 seeds) | Mean | Cost |
| --- | --- | ---: | ---: |
| Baseline | 50.0 / 54.8 / 59.5 | **54.8%** | — |
| + enumeration sweep | 50.0 / 52.4 / 61.9 | **54.8%** | ≈ +40% |
| + diverse-lens pass | 57.1 / 52.4 / 52.4 | **54.0%** | ≈ +47% |

Baseline seed-to-seed standard deviation: **4.8pp**.

## What was measured — the un-anchored pass

Built after those two, on measured evidence that the reviewer *answers the diff*:
in a controlled experiment only 16 of 76 candidates (21%) from a diff-bearing arm
pointed at a line inside the unit they were shown, while the diff-withheld arm
placed 50 of 50 inside their own unit. Taking the diff away demonstrably made the
reviewer read the code it was handed.

That did not turn into findings anyone was looking for. On the 36-case /
80-expectation real-repository corpus (base n=6, enabled n=3):

| | Base | Un-anchored pass enabled |
| --- | ---: | ---: |
| Recall | 46.25% | 47.08% |
| Adjusted precision | 0.804 | 0.792 |
| Candidates per run | 74.7 | 117.0 |
| Cost per run | $1.92 | $4.53 |

Paired over 80 expectations: **+0.83pp, 95% CI [−3.13, +4.79], 10 gained and 9
lost, p = 0.82** — for **+136% cost**. Ten gained against nine lost is a coin flip.

Two results from that run outlived the pass:

- **The refutation gate has headroom.** Its kill rate rose 1.3% → 16.0% under a
  56% increase in candidates, and adjusted precision held. A future "generate
  wider" experiment can lean on that.
- **The semantic finding merge is load-bearing under decomposition.** Collapses
  rose 1.7 → 19.3 per run, so about nineteen restatements per run would otherwise
  have reached the reader — with no one-sided loss. It stays.

## Why they were removed

None of the three is a measurable improvement, so all three were removed rather
than kept as unproven, expensive switches. An option nobody can justify enabling
is a maintenance and documentation cost with no counterpart.

Two qualifications belong with that verdict for the first two passes:

- **Unproven, not disproven.** At 3 seeds with a 4.8pp deviation the resolution is
  roughly **±5.5pp**. A small real effect would be invisible at this n. The removal
  says the passes did not earn their cost on the evidence available, not that they
  do nothing.
- **One signal ran the other way.** The lens pass surfaced more
  plausibility-confirmed defects the answer key never listed — **7.3 per run against
  5.3**, at 100% adjusted precision. That is a real-world gain the corpus's recall
  metric cannot see, and it is also inside the noise band. Pursuing it needs a
  targeted experiment, not a retained switch.

The un-anchored pass carries a stronger verdict, because its corpus was recorded
in advance as close to its best case — median 7 changed lines per case, median 2
hunks, 17 of 36 cases single-hunk, which is where removing the diff anchor has the
most to add. A pass that does not help there is not expected to help elsewhere.

## If you revisit this

Bring a design that is *not* "issue the same whole-file review again with different
wording" — that shape has been measured twice and cleared the noise band neither
time — and not "the same review at a different unit size with the diff removed",
which has now been measured too. Bring more seeds as well: at ±5.5pp resolution,
3 seeds cannot answer the question that the unlisted-defect signal raises.

`specs/05-review-workflow-and-runtime.md` previously required a second serial
diverse-lens pass; that requirement has been withdrawn. Discovery is officially
**one** recall-first whole-file review per task, plus the optional
[dedicated security pass](dedicated-security-pass.md) when enabled.

## Related

- [What limits recall](../../05-quality/what-limits-recall.md) — the enumeration gap
  these three were built against, why attention follows the diff, and every
  intervention measured against it
- [Holistic discovery](../pipeline/04-holistic-discovery.md) — what discovery does today
- [Current results](../../05-quality/current-results.md) — the measurement in context
- [Optional capabilities](README.md) — what actually ships as a switch
