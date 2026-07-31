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
| Degraded review | Review run whose context ledger records a `skipped`, `truncated`, or `summarized` decision instead of `included`. Intake caps (`review.maxFiles`, `review.maxFileBytes`) and an explicitly configured retrieval cap are the causes; no byte budget degrades a review by default. |
| Fingerprint | Stable hash used for finding de-duplication and baseline matching. |
| SARIF export | Local SARIF 2.1.0 artifact rendered from the canonical report model. |
