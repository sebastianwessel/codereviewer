# 00: Scope And Glossary

Status: Approved
Date: 2026-07-31

## Product Goal

Build an LLM-centric semantic code review engine that runs locally, in CI/CD, on
pull requests, and against full repositories. The engine must produce
high-signal, auditable findings from a holistic whole-file review that discovers
candidate defects, then filters each candidate through an independent refutation
pass before admission. Deterministic logic exists to provide repository facts,
line-anchor validation, scope checks, de-duplication, safety policy, and
corroborating or contradicting signals. It is not the primary issue-discovery
surface in production, where CodeQL, linters, formatters, tests, and build
checks are assumed to run in adjacent pipelines.

## First Release Scope

`R1` is the first implementation release. It includes:

- local CLI review of a checked-out git repository;
- base/head diff intake and explicit file-list intake;
- lightweight deterministic signal extraction for changed files and referenced
  context, used as support evidence and gating input rather than as a parallel
  static-analysis product;
- language-neutral contracts for findings, evidence, reports, configuration,
  run summaries, and errors;
- provider resolution for OpenAI/OpenAI-compatible, AWS Bedrock, and Azure
  model adapters through optional packages;
- harness-based holistic discovery and refutation workflow with hermetic
  provider fixtures in tests;
- JSON, Markdown, and SARIF 2.1.0 local reports;
- platform-neutral local review-comment artifact rendering for admitted inline
  findings, plus a rendered artifact for the resolved platform (`github`,
  `gitlab`, `bitbucket`, or `generic`);
- evaluation runner with golden fixtures and quality metrics;
- a reference GitHub Actions integration (`scripts/github/` plus
  `.github/workflows/code-review.yml`) that publishes one pull-request summary
  comment and inline review comments over the GitHub API; it is not part of
  the published npm package, and the engine itself (`src/`) still makes no
  network call and holds no forge credentials;
- no automatic code modification and no CI-native check annotations in `R1`.

## Review scope: pull-request review, not repository audit

`review` answers one question: does this change introduce a defect? Its
attention is scoped to the reviewed diff — the unified diff plus the full
content of every changed file — by design, and the measured numbers below
confirm that scoping holds rather than merely describing an aspiration.

On the 37-case real-repository corpus (`openai/gpt-5.3-codex`, engine
pinned), `review` has measured roughly two in three of the defects sitting
inside the reviewed diff across several recorded runs, and **0%** on the
defects sitting elsewhere in a changed file — 0 of 27 on one measured
denominator, replicated as 0 of 81 against an independently labeled answer
key. **This document deliberately restates no in-diff rate of its own.** That
figure has one owner — the newest `reports/eval-results-ledger.md` entry for
this corpus and population, mirrored in
`docs/05-quality/current-results.md` — and this page cites it rather than
carrying a fourth copy to go stale; the rule and its reasons are in
`05-review-workflow-and-runtime.md` under *The Published Rate Has One Owner*.
The out-of-diff zero is restated here because it is what the scope boundary
below rests on, it is a count over a full denominator rather than a rate, and
it has not moved in any recorded run. Every one of those
misses was in a file the reviewer had been shown in full: none needed
retrieval or a larger context window, so this is not a context or retrieval
limitation, and giving the reviewer more of either does not close it.

**"Nor a bigger model" was struck on 2026-08-14, because it was never
measured.** Retrieval and context size are established — the 2026-08-10
multi-defect entry scores the same defect in the same file as its own case and
finds it 13 of 15 times in-diff against 0 of 5 out-of-diff, *"only the hunk
boundary differs"*, which *"retires retrieval, context size and difficulty as
explanations"*. Model tier is not established in the same way: the only
recorded model comparison measured a *cheaper* model matching recall, and the
2026-08-07 entry records that *"`gpt-5.1-codex-max` is unusable on this key
(listed by `/v1/models`, 404 on chat-completions), so the STRONGER-tier
question remains open."* The supported statement is that **eleven structural
and prompt interventions have failed against this population and no stronger
tier has been testable** — which carries the scope decision below on its own,
without asserting the population is unreachable by any model.

This is a scope boundary, stated deliberately rather than left implicit:
**pull-request review** ("does this change introduce a defect?") and
**repository audit** ("does this codebase contain a defect, changed or
not?") are different jobs. `R1` builds the first. A latent, pre-existing
defect in the untouched part of a changed file is a real defect a reader may
still want surfaced, and it is out of scope today. This document makes no
commitment to build a repository-audit mode.

## Later Scope

The following capabilities are specified as future extension points and must not
be implemented in `R1` unless a later spec changes scope:

- CI-native check annotations;
- full-codebase trend dashboards;
- automatic fix application;
- product-owned replacements for external static analysis, formatting, build,
  or unit-test pipelines;
- remote service or hosted UI.

Network pull-request comment publishing is implemented — see "First Release
Scope" above — through the optional GitHub Actions integration, not the
engine itself.

## Actors And Consumers

| ID | Actor/Consumer | Scope |
| --- | --- | --- |
| ACT-DEV | Developer | Runs local CLI, reads reports, tunes config. |
| ACT-CI | CI runner | Executes CLI non-interactively and stores artifacts. |
| ACT-REVIEWER | Human reviewer | Consumes admitted findings and evidence. |
| ACT-AGENT | Implementation agent | Implements specs without inventing behavior. |
| ACT-OPS | Maintainer | Reviews logs, failures, releases, dependency drift. |
| ACT-MODEL | Model provider adapter | Performs holistic discovery of candidate findings and writes refutation output through harness. |

## Glossary

| Term | Definition |
| --- | --- |
| Admission gate | Deterministic policy that decides whether a refutation-passed candidate can become an admitted finding. Model-generated confidence scores are not part of the review artifact contract; a model-origin finding may admit only when its refutation verdict is `proved` and it passes deterministic safety checks and the severity floor. |
| Candidate finding | A potential user-visible issue emitted directly by holistic discovery, before refutation and admission. Candidate findings can be admitted, rejected, or marked `needs-more-evidence` only after refutation and the admission gate. |
| Deterministic signal | Repository fact, diff fact, symbol fact, diagnostic, line-anchor check, scope check, de-duplication key, or contradiction produced without model judgment. Signals are support evidence and gate input, not the main production detection strategy, and they cannot replace refutation for model-origin findings. |
| Evidence record | Structured evidence item referenced by a finding, such as diff location, AST fact, command summary, diagnostic, or model rationale. |
| Finding | User-visible issue after admission. Findings are language-neutral and reporter-neutral. |
| Holistic discovery | A recall-first whole-file review that reads the unified diff plus the full line-numbered changed files and emits candidate findings directly. A task's review targets are partitioned across calls of at most `aiReview.maxFilesPerDiscoveryCall` changed files (spec 27) and the candidates are unioned; each call still sees the whole of every file it is given. |
| Discovery partition | The subset of a task's changed files one discovery call reviews. Every partition receives the same shared context the undivided task would have, and a finding stays restricted to the files its own call was shown. |
| Reactive task split | A halving of a task triggered only by the provider's normalised `context_length_exceeded` failure (spec 26). Assembly never splits on a byte budget; splitting is bounded on recursion depth and an indivisible refused unit fails loudly rather than being truncated. |
| Semantic finding merge | A model call, separate from refutation, that groups a file's candidates by whether they describe the same underlying defect. It is asked for groups, never for a discard; the surviving representative of each group is chosen deterministically in code, and non-representative members are recorded as `duplicate` rejections rather than dropped. |
| Model provider adapter | Optional package loaded at runtime to connect harness model aliases to a concrete provider. |
| Portable path | Forward-slash path used in reports, git paths, SARIF-like artifact locations, and JSON artifacts. |
| Refutation | Independent per-candidate verification step that tries to prove or disprove each candidate finding using the provided candidate, reviewed diff ranges, evidence, review context, support signals, instructions, skills metadata, and provenance. It returns `proved`, `refuted`, `needs-more-evidence`, or `provider-error`; only `proved` candidates continue to actionable admission. |
| Repository path | Filesystem path resolved inside the reviewed repository root. |
| Review task | Unit of work generated by clustering, scoped to files, dependencies, and evidence. At `fast` depth one task covers one changed file; at `balanced` and `thorough` a task covers a dependency cluster. No byte budget sizes a task. |
| Run | One execution of the CLI against a repository and configuration. |
| Shared context | Run-local store of safe repository facts, candidate findings, refutation summaries, admitted findings, rejected internal candidates, provider issues, and evidence references. |

## Global Invariants

| ID | Requirement | Verification |
| --- | --- | --- |
| INV-ESM-001 | First-party source is ESM-only. No CommonJS files, `require`, `module.exports`, `__dirname`, or `__filename`. | Static grep and typecheck. |
| INV-OS-001 | Filesystem behavior supports Linux and Windows paths. | Unit tests with POSIX and Windows path fixtures. |
| INV-LANG-001 | Core contracts are language-neutral. Language-specific data remains inside deterministic signal extractors, repository context tools, or provider prompts and is normalized before reaching findings, reports, admission, or evaluation. | Contract tests and schema review. |
| INV-PROV-001 | Base install does not include provider SDKs except `@purista/harness`. | `package.json` and lockfile inspection. |
| INV-SEC-001 | Logs, traces, reports, and errors do not include prompt text, source snippets, tokens, or raw tool output by default, and every secret shape on the redactor's pattern list plus every operator-configured exact value is removed from them. Coverage of secret shapes OUTSIDE that list is not claimed; see `07-security-privacy-operations.md`, *What The Mechanism Supports, And What It Does Not*. | Redaction tests and artifact snapshot tests over known tokens. |
| INV-PUB-001 | No model-only merge approval, merge blocking, or publication decision. Model-origin findings may surface in review output, but merge and publishing authority remains deterministic and local-artifact only. | Admission and quality-gate tests. |
| INV-STRUCT-001 | Code is grouped by domain/topic with colocated tests and shared helpers for repeated behavior. | Structure lint/review checklist. |

## Explicit Non-Goals For R1

- No remote API server.
- No browser UI.
- No authentication system.
- No database.
- No long-lived daemon.
- No automatic code modification.
- No CI-native check annotations.
- No repository-wide defect audit. `review` is scoped to the reviewed diff —
  see "Review scope" above.
- No model candidate or model-generated confidence score published as
  actionable. Model-origin output requires refutation and admission.
- No provider SDKs in base dependencies.
- No public documentation for behavior that is not implemented.
- No replacement implementation for CodeQL, linters, formatters, unit tests, or
  build checks that production pipelines already run.
