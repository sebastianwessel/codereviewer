# Extra Discovery Passes (Removed)

Two additional discovery passes once existed as opt-in capabilities. **Both were
removed** — code, configuration keys, and the spec requirement. This page is the
record of what they were and what measuring them established, so the same shape is
not rebuilt without new evidence.

There is nothing to configure here. Both keys were deleted from the configuration
schema, which is strict: a config file that still sets either one now fails
validation with exit code `2`. Remove the block.

## What they were

| | Enumeration sweep | Diverse-lens pass |
| --- | --- | --- |
| Asked | the **same** question again, minus what was already reported | a **different** question: concurrency, asynchrony, error paths, resource lifetime, contracts, edge cases |
| Calls added | up to 4 per task, stopping early once a round added nothing | 1 per task, serial |
| Merge | additive — could only add candidates at locations no earlier pass claimed | same |

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

## What was measured

30-case / 42-finding real-repository corpus, **3 seeds per arm**.

| Arm | Recall (3 seeds) | Mean | Cost |
| --- | --- | ---: | ---: |
| Baseline | 50.0 / 54.8 / 59.5 | **54.8%** | — |
| + enumeration sweep | 50.0 / 52.4 / 61.9 | **54.8%** | ≈ +40% |
| + diverse-lens pass | 57.1 / 52.4 / 52.4 | **54.0%** | ≈ +47% |

Baseline seed-to-seed standard deviation: **4.8pp**.

## Why they were removed

Neither is a measurable improvement, so both were removed rather than kept as
unproven, expensive switches. An option nobody can justify enabling is a
maintenance and documentation cost with no counterpart.

Two qualifications belong with that verdict:

- **Unproven, not disproven.** At 3 seeds with a 4.8pp deviation the resolution is
  roughly **±5.5pp**. A small real effect would be invisible at this n. The removal
  says the passes did not earn their cost on the evidence available, not that they
  do nothing.
- **One signal ran the other way.** The lens pass surfaced more
  plausibility-confirmed defects the answer key never listed — **7.3 per run against
  5.3**, at 100% adjusted precision. That is a real-world gain the corpus's recall
  metric cannot see, and it is also inside the noise band. Pursuing it needs a
  targeted experiment, not a retained switch.

## If you revisit this

Bring a design that is *not* "issue the same whole-file review again with different
wording" — that shape has been measured twice and cleared the noise band neither
time. Bring more seeds too: at ±5.5pp resolution, 3 seeds cannot answer the
question that the unlisted-defect signal raises.

`specs/05-review-workflow-and-runtime.md` previously required a second serial
diverse-lens pass; that requirement has been withdrawn. Discovery is officially
**one** recall-first whole-file review per task, plus the optional
[dedicated security pass](dedicated-security-pass.md) when enabled.

## Related

- [Holistic discovery](../pipeline/04-holistic-discovery.md) — what discovery does today
- [Current results](../../05-quality/current-results.md) — the measurement in context
- [Optional capabilities](README.md) — what actually ships as a switch
