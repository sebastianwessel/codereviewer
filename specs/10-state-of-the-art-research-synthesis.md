# 10: State-Of-The-Art Research Synthesis

Status: Approved
Date: 2026-06-20

## Purpose

This specification records research-backed product decisions that cut across
architecture, review quality, reporting, security, evaluation, and release.
It is tracked because these decisions constrain implementation. Raw research
notes and exploratory ideas remain outside git.

## Research Principle

The product must optimize for useful, trustworthy review outcomes instead of
comment volume. A finding is valuable only when it is grounded in evidence,
located precisely, explainable to a developer, safe to publish, and measurable
in regression tests.

## Adopted Decisions

| Topic | Decision | Spec Location |
| --- | --- | --- |
| Canonical findings | Use an internal finding/evidence model and export SARIF/Markdown/JSON from it. | `03-contracts/finding-evidence-report.md` |
| Refutation first | Actionable model-origin findings require a `proved` refutation verdict and source-backed evidence. Refuted or needs-more-evidence model output remains artifact-only or rejected. | `05-review-workflow-and-runtime.md` |
| Baselines | Track new/existing/resolved findings with stable fingerprints. | `03-contracts/finding-evidence-report.md`, `04-configuration-and-providers.md`, `05-review-workflow-and-runtime.md` |
| Context transparency | Record a context ledger for every include, skip, truncation, and summary decision. | `05-review-workflow-and-runtime.md` |
| Provider isolation | Dynamically import only the configured provider adapter. | `04-configuration-and-providers.md` |
| Prompt injection posture | Treat prompt injection as a risk to contain, not a problem that can be eliminated. | `07-security-privacy-operations.md` |
| No-content telemetry | Capture IDs, counts, timings, and redacted errors only in R1. | `07-security-privacy-operations.md` |
| Evaluation | Measure actionable precision/recall, refutation correctness, actionability, line accuracy, severity accuracy, cost, latency, provider issues, and noise. | `06-evaluation-and-quality-gates.md` |
| CI/CD security | Separate review generation from publishing permissions and avoid privileged execution of untrusted code. | `07-security-privacy-operations.md` |
| Supply chain | Target pinned release workflows, provenance, Scorecard, vulnerability scanning, and SBOM. | `08-dependencies-and-release.md` |
| Deterministic support signals | Use local structural parsing and diff/scope checks as support signals for context selection, anchoring, contradictions, and de-duplication. Keep generic signals out of primary issue discovery, but allow narrow trusted rules to seed actionable deterministic candidates. | `05-review-workflow-and-runtime.md`, `08-dependencies-and-release.md` |

## Review Quality Model

The review engine must separate these stages:

1. repository intake and context planning;
2. deterministic support signals for anchors, context hints, contradictions,
   and de-duplication;
3. holistic whole-file review producing candidate findings;
4. per-candidate refutation;
5. deterministic promotion/admission, de-duplication, and baseline matching;
6. deterministic reporting and quality gates.

This separation allows the product to improve model behavior while keeping
context access, publishing, failure decisions, and sensitive-data handling under
deterministic control. R1 uses mediated model-requested context rather than
direct repository tools in the model loop; direct tool-calling agents require a
future capability update because they change provider capability, budget,
logging, and compatibility requirements.

## External Practice Inputs

Research on current review systems and public documentation shows recurring
patterns worth adopting:

- PR/MR review assistants default to advisory comments and summaries,
  with humans retaining merge authority.
- Current public code-review-agent research separates static-analysis tools
  from AI review agents and emphasizes repository-level context, actionable
  findings, and objective oracles over textual similarity.
- Test-based review benchmarks are a better fit than comment-similarity
  metrics when the goal is to measure whether an agent found the underlying
  issue rather than whether it phrased feedback like a human reviewer.
- Repository or path-scoped instructions improve relevance, but they are
  untrusted inputs and must be hashed, scoped, and excluded from logs.
- Large changes need complete coverage accounting. Budget pressure should split
  work into more signal/model tasks; completed reviews must not
  silently skip or truncate required source.
- Inline comments are capped and severity-filtered to avoid review noise.
- Review results support machine-readable artifacts for CI/security
  tools and human-readable summaries for developers.
- Hybrid static-analysis/AI products use deterministic analysis for precise
  patterns, triage, and noise reduction while applying AI to surrounding
  context and false-positive filtering. CodeReviewer adopts this as support
  signals plus refutation rather than duplicating production CodeQL,
  linter, formatter, unit-test, or build pipelines.

## Public Benchmark Posture

Public code-review benchmarks are useful for smoke testing and comparability,
but they are not sufficient release gates. The implementation must maintain a
fresh project-owned evaluation set with:

- positive cases for expected findings;
- negative/control cases where no finding is expected;
- severity and location expectations;
- noise metrics such as comments per KLOC and comments per diff hunk;
- refutation correctness, provider issue,
  cost, latency, incomplete coverage, and context mutation metrics.

## Deterministic Signal Posture

Deterministic support signals help the model focus and help admission reject
weak or contradicted output. They are not a product-owned replacement for
CodeQL, linters, formatters, build checks, or unit tests that production
pipelines already run. A small trusted-rule allowlist may bypass model refutation
when the finding is local, deterministic, evidence-backed, and fix-directed.

The preferred generic local parsing layer is ast-grep when it materially
improves anchors, symbol spans, import/reference hints, or contradiction checks.
Regex-only extraction is allowed only for non-semantic labels or as a fallback
when parser coverage is unavailable. Native language tooling is optional and
must not require project code execution in default review runs. Semgrep, SCIP,
CodeQL, linter, test, and build outputs are optional ingestion or adjacent
pipeline signals, not core issue-discovery dependencies in R1.

The ast-grep prompting and MCP guidance is useful for developer-time rule
authoring and debugging, but R1 must not make normal review quality depend on
LLM-generated rules at runtime. Any rule or traversal produced with AI
assistance must be checked into deterministic signal extraction with fixtures
before it affects product review behavior. Runtime prompts receive compact
normalized signals, not ast-grep manuals, raw AST dumps, or iterative rule
traces.

## SARIF Posture

SARIF is required because it is the common interchange format for static
analysis and code-scanning ecosystems. It must remain an export target rather
than the internal model because the product needs fields and workflow state
that are not portable across SARIF consumers.

R1 writes local SARIF only. Uploading SARIF, managing alerts, or creating PR
annotations requires a future publishing spec.

## Security Posture

The implementation must assume:

- repository content can be malicious;
- instructions and skills can be malicious;
- provider responses can be malicious or malformed;
- generated reports can be rendered by other systems and must be sanitized;
- CI environments can contain secrets and must not expose them to untrusted
  pull-request code.

This leads to the R1 defaults: no shell tool, no broad network access, no PR
publishing, no fix application, no content telemetry, and no writes outside the
run artifact directory.

## Source Index

Links were retrieved or verified on 2026-06-20 unless a later date is noted:

- OASIS SARIF 2.1.0: <https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html>
- GitHub SARIF support for code scanning: <https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support>
- GitHub SARIF upload workflow: <https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/integrate-with-existing-tools/upload-sarif-file>
- OpenAI Codex GitHub integration: <https://developers.openai.com/codex/integrations/github>
- Anthropic Claude Code review: <https://code.claude.com/docs/en/code-review>
- GitHub Copilot code review: <https://docs.github.com/en/copilot/concepts/agents/code-review>
- GitLab Duo Code Review Flow: <https://docs.gitlab.com/user/duo_agent_platform/flows/foundational_flows/code_review/>
- OWASP Top 10 for LLM Applications 2025: <https://genai.owasp.org/llm-top-10/>
- OWASP LLM01 Prompt Injection: <https://genai.owasp.org/llmrisk/llm01-prompt-injection/>
- NIST SP 800-218 Secure Software Development Framework: <https://csrc.nist.gov/pubs/sp/800/218/final>
- SLSA v1.2 specification: <https://slsa.dev/specs/v1.2/>
- OpenSSF Scorecard: <https://scorecard.dev/>
- OpenTelemetry sensitive-data guidance: <https://opentelemetry.io/docs/security/handling-sensitive-data/>
- OpenAI structured outputs: <https://developers.openai.com/api/docs/guides/structured-outputs>
- AWS Bedrock Converse API: <https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html>
- Azure OpenAI structured outputs: <https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs>
- Code Review Benchmark: <https://github.com/withmartian/code-review-benchmark>
- Code Review Agent Benchmark / c-CRAB, retrieved 2026-06-22:
  <https://arxiv.org/html/2603.23448v2>
- SWE-bench leaderboard and dataset variants, retrieved 2026-06-22:
  <https://www.swebench.com/>
- OpenAI SWE-bench Verified announcement, retrieved 2026-06-22:
  <https://openai.com/index/introducing-swe-bench-verified/>
- CodeQL overview and variant-analysis positioning, retrieved 2026-06-22:
  <https://codeql.github.com/docs/codeql-overview/about-codeql/>
- Semgrep Assistant AI triage discussion, retrieved 2026-06-22:
  <https://semgrep.dev/blog/2025/building-an-appsec-ai-that-security-researchers-agree-with-96-of-the-time/>
- Semgrep Multimodal hybrid static-analysis/AI positioning, retrieved
  2026-06-22: <https://semgrep.dev/products/semgrep-multimodal/>
- Tree-sitter: <https://tree-sitter.github.io/>
- Node Tree-sitter bindings: <https://github.com/tree-sitter/node-tree-sitter>
- ast-grep: <https://ast-grep.github.io/>
- ast-grep JavaScript API: <https://ast-grep.github.io/guide/api-usage/js-api.html>
- ast-grep prompting guide: <https://ast-grep.github.io/advanced/prompting.html>
- ast-grep supported languages: <https://ast-grep.github.io/reference/languages.html>
- Semgrep supported languages: <https://docs.semgrep.dev/supported-languages>
- SCIP Code Intelligence Protocol: <https://scip-code.org/>
