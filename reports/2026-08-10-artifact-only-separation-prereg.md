# Pre-registration: can the "could not prove it" population be separated?

**Written before the scoring run.** Engine `a9a13fb`, corpus
`security-advisory-2026` (72 cases), `openai/gpt-5.3-codex`.

## The question

Refutation returns `needs-more-evidence` far more often than `refuted` — 45 versus
9 of 246 candidates over three archived seeds. Those 45 are admitted **artifact-only**:
kept in the report file, never posted as a comment. 23 of 44 scored artifact-only
findings matched a real vulnerability, worth 10.3 points of recall (63.1% → 73.4%),
and 21 did not.

Promoting the population wholesale is a bad trade — genuine false positives would go
from 3 to 24 per 216 reviews. So the question is whether any signal separates the
real ones from the noise.

## What the pre-spend checks changed, twice

**First check — the capture was too thin.** `producedFindings` recorded severity,
category, path, line and title. All describe what a finding CLAIMS; none describes
what it brought to SUPPORT the claim, which is the axis this population varies
along. Seven groundedness scalars were added before any spend (`a9a13fb`).

**Second check — the arithmetic.** With nine candidate separators and roughly
twelve subset tests at n ≈ 44, the familywise false-alarm rate at a "subset is
≥80% real" bar is **29–60%**. A hit would have arrived by chance about half the
time. Three seeds bought at that design would have produced an uninterpretable
positive.

**Third check — a 6-case, $0.24 smoke.** Five of the seven new fields are
CONSTANT: `proposedBy` is `review-agent` for every finding, `evidenceCount` is
exactly 1 for every finding, and `relatedLocationCount`, `dataFlowCount`,
`cweCount` are 0 with `securitySeverity` absent throughout. Only severity,
category and `hasFixProposal` vary — and two of those three describe the claim,
not its grounding.

## What this run is, and what it is NOT

**It is a descriptive structural measurement.** One seed of the full corpus,
establishing the distribution of the groundedness fields over roughly 85 produced
findings rather than 8.

**It is NOT a separator hypothesis test, and no separator will be claimed from
it.** The hypothesis space collapsed to three weak fields, and at ~15
artifact-only findings per seed the familywise arithmetic above cannot resolve
them. Running three seeds to test them anyway would be buying a lottery ticket
with a pre-registered decision rule stapled to it.

## Committed in advance

- **One seed.** Not three. The study the three seeds were for no longer exists in
  a form worth running.
- **The primary claim under test is mechanical, not statistical**: that
  `evidenceCount == 1` and `proposedBy == 'review-agent'` hold across the
  population, not merely across the eight findings the smoke produced. A single
  counterexample falsifies the "always" and the claim will be restated as a rate.
- **Severity, category and `hasFixProposal` will be reported as a descriptive
  cross-tab against matched/unmatched, explicitly labelled as underpowered and
  hypothesis-generating.** No promote decision will be taken from them, in either
  direction, and a favourable-looking split is not a licence to run more seeds.
- **Cost reported as measured**, alongside the $0.24 already spent on the smoke.
