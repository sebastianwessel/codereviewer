# Glossary

Status: Approved
Date: 2026-07-31

The canonical product glossary is [00-scope-and-glossary.md](00-scope-and-glossary.md).

Additional readiness terms:

| Term | Definition |
| --- | --- |
| Baseline status | Classification of an admitted finding as `new`, `existing`, `resolved`, or `unknown`. |
| Context ledger | Redacted run artifact that records every include, skip, truncate, and summarize decision for model context. |
| Contract-first clean implementation | Implementation strategy where source contracts and generated artifacts are created before handwritten service logic. |
| Degraded review | Review run that reviewed less than it was asked to: a run whose context ledger records a `skipped`, `truncated`, or `summarized` decision **caused by a cap** — the intake caps (`review.maxFiles`, `review.maxFileBytes`), an explicitly configured retrieval or context byte cap, or a provider-driven omission. No byte budget degrades a review by default. A DELIBERATE scope exclusion is not degradation and must not be counted as one, even though it is recorded with the same `skipped` decision: an instruction withheld from a task because `instructions.files[].scope` does not cover its files (reason `instruction-scope-excluded`) is the configured behaviour working, on a run that reviewed everything it was asked to. The decision alone therefore does not classify a run; the reason it was taken does. |
| Fingerprint | Stable hash used for finding de-duplication and baseline matching. |
| SARIF export | Local SARIF 2.1.0 artifact rendered from the canonical report model. |
