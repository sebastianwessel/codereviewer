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
| Evidence first | Admission requires at least one non-model evidence record. | `05-review-workflow-and-runtime.md` |
| Baselines | Track new/existing/resolved findings with stable fingerprints. | `03-contracts/finding-evidence-report.md`, `04-configuration-and-providers.md`, `05-review-workflow-and-runtime.md` |
| Context transparency | Record a context ledger for every include, skip, truncation, and summary decision. | `05-review-workflow-and-runtime.md` |
| Provider isolation | Dynamically import only the configured provider adapter. | `04-configuration-and-providers.md` |
| Prompt injection posture | Treat prompt injection as a risk to contain, not a problem that can be eliminated. | `07-security-privacy-operations.md` |
| No-content telemetry | Capture IDs, counts, timings, and redacted errors only in R1. | `07-security-privacy-operations.md` |
| Evaluation | Measure precision, recall, actionability, line accuracy, severity accuracy, cost, latency, and noise. | `06-evaluation-and-quality-gates.md` |
| CI/CD security | Separate review generation from publishing permissions and avoid privileged execution of untrusted code. | `07-security-privacy-operations.md` |
| Supply chain | Target pinned release workflows, provenance, Scorecard, vulnerability scanning, and SBOM. | `08-dependencies-and-release.md` |
| Multi-language AST analysis | Use AST-backed language analyzers for TypeScript, JavaScript, Python, Go, Rust, and Java; prefer ast-grep for generic syntax facts and native toolchains only when they add material deterministic evidence. | `05-review-workflow-and-runtime.md`, `08-dependencies-and-release.md` |

## Review Quality Model

The review engine must separate these stages:

1. repository intake and context planning;
2. deterministic facts from language analyzers;
3. model-backed candidate generation when configured;
4. deterministic admission, de-duplication, and baseline matching;
5. deterministic reporting and quality gates.

This separation allows the product to improve model behavior while keeping
publishing, failure decisions, and sensitive-data handling under deterministic
control.

## External Practice Inputs

Research on current review systems and public documentation shows recurring
patterns worth adopting:

- PR/MR review assistants default to advisory comments and summaries,
  with humans retaining merge authority.
- Repository or path-scoped instructions improve relevance, but they are
  untrusted inputs and must be hashed, scoped, and excluded from logs.
- Large changes need complete coverage accounting. Budget pressure should split
  work into more analyzer/model tasks; completed reviews must not silently skip
  or truncate required source.
- Inline comments are capped and severity-filtered to avoid review noise.
- Review results support machine-readable artifacts for CI/security
  tools and human-readable summaries for developers.

## Public Benchmark Posture

Public code-review benchmarks are useful for smoke testing and comparability,
but they are not sufficient release gates. The implementation must maintain a
fresh project-owned evaluation set with:

- positive cases for expected findings;
- negative/control cases where no finding is expected;
- severity and location expectations;
- noise metrics such as comments per KLOC and comments per diff hunk;
- cost, latency, incomplete coverage, and context mutation metrics.

## Language Analysis Posture

First-class language support means the product can produce useful deterministic
facts for TypeScript, JavaScript, Python, Go, Rust, and Java without changing
the core finding/report contracts. The generic analysis layer must be AST-based
and offline. Regex-only extraction is allowed only as a fallback for
non-semantic labels after an AST parser has identified the relevant node.

The preferred generic layer is ast-grep because it exposes Tree-sitter-backed
structural analysis with a JavaScript API and broad language support. Native
language tooling is allowed as an additive analyzer when it improves
deterministic evidence, especially TypeScript compiler diagnostics and
language-specific test discovery. Semgrep and SCIP are optional ingestion
targets, not core runtime dependencies in the first language-analysis
implementation.

The ast-grep prompting and MCP guidance is useful for developer-time rule
authoring and debugging, but R1 must not make normal review quality depend on
LLM-generated rules at runtime. Any rule or traversal produced with AI
assistance must be checked into the analyzer implementation with fixtures before
it affects product review behavior. Runtime prompts receive compact normalized
facts, not ast-grep manuals, raw AST dumps, or iterative rule traces.

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

All links were retrieved or verified on 2026-06-20:

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
- Tree-sitter: <https://tree-sitter.github.io/>
- Node Tree-sitter bindings: <https://github.com/tree-sitter/node-tree-sitter>
- ast-grep: <https://ast-grep.github.io/>
- ast-grep JavaScript API: <https://ast-grep.github.io/guide/api-usage/js-api.html>
- ast-grep prompting guide: <https://ast-grep.github.io/advanced/prompting.html>
- ast-grep supported languages: <https://ast-grep.github.io/reference/languages.html>
- Semgrep supported languages: <https://docs.semgrep.dev/supported-languages>
- SCIP Code Intelligence Protocol: <https://scip-code.org/>
