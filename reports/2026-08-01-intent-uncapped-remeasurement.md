# Intent-fulfilment review (spec 23) re-measured with an obligation cap that cannot bind

Date: 2026-08-01
Capability: `intent check` at `76cfe3b` — off by default, cannot gate, reports
`outstandingCount` and never certifies completion.
Corpus: `.codereviewer/eval/intent-corpus-realistic/` — **unchanged** from the
2026-08-01 round except for one field.
Baseline: `reports/2026-08-01-intent-realistic-corpus-measurement.md`.

## Why this round exists

That round reported **52.9% end-to-end outstanding recall** and diagnosed
extraction breadth as the bottleneck. An inspection of its run artefacts then found
that **24 of its 28 runs returned exactly their configured `maxObligations` cap**.
The per-case caps were 8–12, set when the corpus was built, against a product
default of 20. `obligationsTruncated` reported `false` in all 28 runs and hid it;
commit `76cfe3b` fixed that flag.

So an unknown part of 52.9% was **a binding cap, not an extraction weakness**. This
round separates the two by re-running all 28 cases with a cap that cannot bind and
changing nothing else.

*(placeholder — results follow)*
