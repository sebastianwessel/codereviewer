# Glossary

The vocabulary used across these docs, the CLI output, and the JSON artifacts.
Terms are grouped by where you meet them: the review pipeline, the report, and
the evaluation harness.

---

## Review pipeline

| Term | Definition |
| --- | --- |
| **Run** | One execution of the CLI against a repository and configuration. Produces one run directory under `paths.artifactDir` (default `.codereviewer/runs/<run-id>/`). |
| **Review task** | The unit of work the review is split into: a bounded packet scoped to specific files, their evidence, and a byte budget. One file for `fast` depth; dependency/context clusters for `balanced`; clusters plus bounded semantic-risk tasks for `thorough`. |
| **Holistic discovery** | The recall-first whole-file review performed per task. The model reads the task's unified-diff segment plus the full line-numbered content of the changed files and emits candidate findings directly. |
| **Candidate (candidate finding)** | A potential issue emitted by holistic discovery, *before* refutation and admission. A candidate is untrusted: it is not a finding, is not user-facing as actionable output, and cannot influence later review tasks until it passes the safe-digest boundary. |
| **Refutation** | The independent per-candidate verification step. It tries to prove or disprove each candidate using only the supplied candidate, reviewed diff ranges, evidence, review context, support signals, instructions, skill metadata, shared digest, and provenance. Returns `proved`, `refuted`, or `needs-more-evidence`; only `proved` continues. Batched per task — one call, one verdict per candidate. |
| **Admission (admission gate)** | The deterministic policy that decides whether a refutation-passed candidate becomes an admitted finding. Checks schema validity, location, `proved` verdict, evidence presence, scope, duplication, deterministic contradiction, static-analysis overlap, severity, redaction, and reporter eligibility. Model-generated confidence scores are not accepted as evidence and are not a report field. |
| **Deterministic signal** | A repository, diff, symbol, diagnostic, line-anchor, scope, de-duplication, or contradiction fact produced without model judgment. Support evidence and gate input — not the primary detection surface. |
| **Evidence record** | A structured, redacted evidence item a finding references: a diff location, AST fact, diagnostic, model rationale, refutation record, and so on. Findings cite evidence by ID. |
| **Finding** | A user-visible issue *after* admission. Language-neutral and reporter-neutral. |
| **Severity floor** | `aiReview.actionableSeverityThreshold` (default `medium`). Model-origin candidates below it are rejected as `below-threshold` instead of becoming actionable. Trusted deterministic-rule candidates are exempt. |
| **Promotion policy** | `promotionPolicy.modelWeakOrRefuted` — what happens to a `needs-more-evidence` candidate. Default `artifact-only`; alternative `rejected`. |
| **Shared context** | The append-only, run-local store of task events, deterministic signals, candidates, refutation results, admission decisions, admitted findings, and rejected findings. Persisted as `shared-context.json`. |
| **Context ledger** | The redacted audit record of every context item considered for model context, with the decision (`included`, `skipped`, `truncated`, `summarized`), byte counts, and a content hash — never the content itself. Persisted as `context-ledger.json`. |
| **Coverage certificate** | The `coverage` object in `report.json` proving which reviewable files and bytes were actually reviewed. A completed report requires `status: complete`. |
| **Portable path** | The forward-slash, repository-relative path form used in every report, artifact, and JSON field. |

---

## Report

| Term | Definition |
| --- | --- |
| **Actionable finding** | An admitted finding whose reporter eligibility is not `artifact-only`. These are what the report leads with and what the quality gate counts. |
| **Artifact-only finding** | An admitted finding marked `reporterEligibility: "artifact-only"` — recorded and rendered for a human, but excluded from the quality gate, from inline comments, and from SARIF results. In `report.md` these appear under **"Unresolved - Needs Human Decision"**, with the reason they stayed unresolved (usually a `needs-more-evidence` verdict). |
| **Reporter eligibility** | How a finding may be surfaced: `inline` (eligible to become an inline comment), `summary-only`, or `artifact-only`. Computed deterministically from severity (`review.inlineSeverityThreshold`, default `high`), side, and diff-hunk overlap. |
| **Rejected candidate** | A candidate that did not make it through the gate, recorded with a stable reason: `schema-invalid`, `location-invalid`, `not-in-scope`, `insufficient-evidence`, `duplicate`, `below-threshold`, `unsafe-content`, `provider-error`, `refuted`, `deterministic-contradiction`, `weak-evidence`, `static-analysis-duplicate`. |
| **Fingerprint** | A stable hash used for de-duplication and baseline matching. Baseline files store fingerprints verbatim; they are never recomputed against a different source state. |
| **Baseline** | A committed file (`baseline.path`, default `.codereviewer/baseline.json`) listing the fingerprints of findings you have accepted. Produced by `baseline write` from a completed report — the `review` command never writes it, so a review cannot suppress its own findings. |
| **Baseline status** | Per-finding classification against the baseline: `new`, `existing`, `resolved`, or `unknown`. `qualityGate.failOnNewOnly` (default true) fails only on `new`. |
| **Quality gate** | The deterministic pass/fail computed from severity thresholds (`maxCritical`, `maxHigh`, `maxMedium`), `failOnProviderError`, and `failOnNewOnly`. A failed gate is exit code `1` — a quality signal, not a crash. Distinct from the eval regression gate, which thresholds corpus metrics that a review run does not compute. |
| **Provider issue** | A normalized, redacted record of provider trouble (timeout, rate limit, error), with a stage and a `recovered` flag. Recovered issues stay visible; they are not hidden by a successful run. |
| **Drift finding** | A deterministic preflight result about documentation/spec/implementation/generated-artifact/security drift or ambiguity. Generated-artifact and security drift are hard errors by default; the rest are warnings. |

---

## Evaluation

| Term | Definition |
| --- | --- |
| **Expected finding** | A ground-truth defect declared by an eval case, with category, severity, optional path/line range, a semantic summary, and a match mode (`path-line`, `path-semantic`, `semantic-only`). |
| **Tier** | The intent class of an expected finding: `runtime-critical`, `security`, `logic`, or `nit`. Carried explicitly or derived from category and severity. Lets product-critical recall be read separately from nits. |
| **Product recall** | The headline recall metric: recall over the product tiers (`runtime-critical` + `security` + `logic`), **excluding** `nit`. A raw aggregate recall would penalize the engine for correctly ignoring nits, which is exactly what it is designed to do. `nitRecall` is reported separately for visibility. |
| **Semantic judge** | The model call that decides whether an admitted finding and an expected finding denote the *same* defect. It is the only semantic matcher — there is no lexical or token-similarity scoring. It sees only the expected summary and the finding's title/description, never source or paths. |
| **Judge agreement** | The fraction of a committed human-labeled calibration set the judge got right this run. Below `evaluation.minJudgeAgreement` (default `0.9`), the run reports `scoring.judgeTrustworthy: false` and its metrics are untrustworthy. |
| **Inconclusive match** | A judge call that could not be completed. The pair is excluded from *both* the recall and the precision denominator and surfaced as a warning — never recorded as "no match", which would fabricate both a miss and a false positive. |
| **Plausibility judge** | A second, independent judge that decides whether an *unmatched* admitted finding is a genuine defect in the actual code, given the finding and its new-side file content. Fails closed: an unjudged finding counts as a false positive. |
| **Unlisted-real finding** | An admitted finding that matched no expected finding but which the plausibility judge deemed a genuine defect — a real bug the fixture's answer key simply did not list. Counted as `unlistedRealFindingCount`; not credited to recall. |
| **Genuine false positive** | An unmatched admitted finding the plausibility judge deemed spurious, plus any whose judgment could not be completed. The trustworthy noise count (`genuineFalsePositiveCount`). |
| **Adjusted precision** | Matched findings divided by matched plus genuine false positives — precision that does not punish the engine for finding real defects the fixture omitted. The trustworthy precision figure. Raw `precision` counts every unmatched finding as wrong and therefore measures fixture completeness as much as reviewer quality. |
| **No-finding zone** | A region (path, optionally a line range) an eval case declares should produce **no** finding, with a stated reason. A finding inside one counts as a false positive unless it matches a declared expected finding. Negative/control cases like these are required in regression datasets. |
| **Slice** | A self-contained eval case: metadata plus a minimal `repo/` tree preserving the paths and context needed to reproduce a real review decision. |
| **Hydration** | Materializing real PR source into a metadata-only benchmark pack before scoring. An un-hydrated positive slice aborts the run rather than silently scoring zero recall. |

---

## See also

- [What it is](what-it-is.md)
- [Why precision first](why-precision-first.md)
- [Concepts: review lifecycle](../03-concepts/review-lifecycle.md)
- [Quality and evaluation](../05-quality/)
