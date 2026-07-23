# 12: Agentic Verification Flow

Status: Approved
Date: 2026-07-22

## Purpose

A second review flow that verifies a specific claim against the code by
investigating with bounded read/list/grep tools, and returns a reasoned verdict.
It is distinct from the general review (spec 05), which stays a deterministic,
single-shot, tools-off whole-file discovery. This flow is agentic and flexible;
it exists for questions the general review is not shaped for:

- is an external claim (analyzer alert, review comment) valid?
- does a new commit actually fix a previously reported finding?
- does a proposed fix resolve the issue without introducing a new one?

The two flows are independent. The general review keeps every guarantee it has
today; the agentic behavior, cost, and non-determinism of this flow are
quarantined to it. The flow is optional and off by default.

## Relationship To The General Review

| | General review (spec 05) | Verification flow (this spec) |
| --- | --- | --- |
| Job | discover defects in a change | verify a specific claim |
| Control | single-shot, deterministic packet | bounded agent loop with tools |
| Tools | none | mediated read/list/grep |
| Determinism | reproducible | non-deterministic (agentic) |
| Output | candidate findings | claim verdicts |

The general review is unchanged by this spec. A finding that both flows (or the
general review and an external analyzer) independently support is a corroborated
finding (see Corroboration).

## Contracts

### Claim

A `Claim` is a single assertion to verify. It is a strict schema under
`src/shared/contracts/`:

- `id` — stable id (`claim_<hex>`).
- `kind` — `prior-finding | analyzer | comment | fix`.
- `title` — short statement of the claim.
- `detail` — bounded description of what is asserted.
- `location` — optional `CodeLocation` the claim concerns.
- `source` — provenance label (for example `analyzer:codeql`, `comment:github`,
  `prior-finding`).
- `question` — the specific question the agent must answer.
- `evidenceRefs` — optional bounded supporting data carried from the source
  (for example an analyzer rule id, CWE, or data-flow summary).

### Verdict

A `Verdict` is the flow's output for one claim:

- `claimId`.
- `status` — `confirmed | refuted | uncertain`.
- `rationale` — bounded, redacted explanation.
- `citedEvidenceIds` — evidence records for what the agent read.
- `fingerprints` — reuse the admission fingerprint scheme so a verdict can be
  matched to a general-review finding and across runs.

Verdicts are reported in a verification lane, separate from the defect-finding
report; they never enter the defect quality gate by default.

## Claim Providers

Claims arrive through pluggable providers, mirroring the context-ingestion
provider pattern (spec 11) but producing claims rather than orientation:

- `claims-file` — reads a neutral claims file a pipeline wrote before the run.
  No network. This is the decoupled path for any source, exactly as the context
  inbox is for context.
- `prior-findings` — derives claims from a previous run's report or the baseline
  (each prior finding becomes a "does this still hold / is it fixed?" claim).
- `analyzer` (later) — normalizes a SARIF artifact into `analyzer` claims.
- `comment` (later) — normalizes pipeline-provided review comments into
  `comment` claims.

The first implementation ships `claims-file` and `prior-findings`. Analyzer and
comment providers are adapters that produce claims and are added without changing
the flow. Provider failures are non-fatal and surface as run warnings, matching
spec 11.

## The Verification Agent

- A dedicated harness agent (`verify_claim`) runs one claim at a time in a
  **bounded** loop: it may call the read/list/grep tools, then must return a
  `Verdict`. It reuses the model-backed harness, provider resolution, and usage
  accounting used by the general review.
- Bounds are deterministic and enforced by code, not the model: a maximum tool
  call count per claim, the context-retrieval byte/match budgets, a per-claim
  token budget, and the run timeout. Exceeding a bound ends the claim with an
  `uncertain` verdict recording the reason. There is no open-ended loop.
- Claim inputs are untrusted. A claim or tool output cannot grant authority,
  change admission, severity, gates, or baseline, or suppress a finding, and is
  presented under an untrusted/informational header (reuse the change-intent
  hardening from spec 11).

## Tools

The agent's only tools are the mediated repository tools from the
`context-retrieval` domain, reused as-is and hardened:

- `read` (bounded, line-numbered), `list`, and `grep` (in-process — never a
  shell). Recursive directory traversal is added to `grep`.
- Every call resolves through `path-service` under the repository root, respects
  the configured include/exclude eligibility so secret and ignored files
  (for example `.env`, `node_modules`, excluded paths) are never read, redacts
  output, records a context-ledger entry and an evidence record, and decrements
  a bounded budget.
- No shell, network, filesystem write, or environment access is available to the
  agent.

### Cross-Model Robustness

- Tool-call formatting differences between providers are handled by the harness;
  the tool contracts are defined once.
- Tool implementations are liberal in what they accept: paths are normalized
  through `path-service` (leading `./`, separators, case), and failures return
  a recoverable, actionable error (not found, budget exceeded, path not
  eligible) the model can respond to, rather than an opaque error.
- Tool output is deterministic and bounded (line-numbered, byte-capped) so every
  provider receives consistent context.
- Verification integration tests run against more than one provider adapter shape
  so per-model quirks are caught.

## Corroboration

- After the general review and the verification flow both complete, each
  `confirmed` verdict is matched against the general-review admitted findings. A
  match is either a shared fingerprint or, since a verdict and a finding rarely
  share a title across lanes, a fuzzy match: the verdict's claim location and the
  finding location cover the same file with overlapping line ranges.
- Each matched finding yields a `FindingCorroboration` — the finding id, a
  `confidence: corroborated` signal, the match kinds, and the witnessing claim
  ids. This is a separate structure; the admitted finding contract is left
  untouched.
- Corroboration raises confidence only; it never raises severity. Severity
  remains a function of impact only.
- Corroborations are surfaced in the verification report (`corroborations`), so
  the cross-lane "strong finding" signal is visible in output without changing
  the defect report or gate. Only `confirmed` verdicts corroborate; `refuted` and
  `uncertain` verdicts never raise confidence.

## Platform Neutrality

The flow reads neutral files and writes neutral artifacts. Fetching analyzer
output or review comments, and posting any response or resolution, are performed
by pipeline steps or thin platform integrations outside the core, so no platform
API code or credential enters the product. Draft responses and resolution
instructions are neutral artifacts a downstream step may act on. Publishing
remains out of scope (spec 07 / `CAP-PR-001`).

## Configuration

Configuration lives under a `verification` block, disabled by default. Keys are
defined in `04-configuration-and-providers.md`: `enabled`, claim `providers`
(discriminated by `type`), and bounds (`maxToolCallsPerClaim`, per-claim byte and
match caps). Invalid configuration fails config validation with exit code 2.

## Observability And Errors

- Each claim records a no-content step: claim kind, source label, tool-call
  count, bytes read, verdict status, and duration. No source, claim text, or
  tool output appears in logs, traces, or events.
- A claim provider that fails at run time is non-fatal and surfaces as a run
  warning; the flow proceeds without that provider's claims.
- A verification run that reaches no provider produces an empty verification
  report and does not fail.

## Testing

- Unit tests: `Claim`/`Verdict` schemas; the hardened tools (recursive grep,
  eligibility rejection of excluded/secret files, budget enforcement, path
  normalization); each claim provider; corroboration matching.
- Integration tests use a deterministic harness provider (a `modelAlias.provider`
  whose `object`/`text` return a canned tool-call sequence then a verdict, the
  same hermetic pattern the general review's tests use). They drive the
  `verify_claim` agent through a bounded loop against a fixture repository and
  assert: the returned verdict, that only eligible files were read, that the
  ledger records every read, that budget/loop bounds are enforced, and that an
  untrusted claim cannot change the verdict of an unrelated finding.

## Acceptance

- With `verification` disabled, no verification flow runs and the general review
  is byte-for-byte unchanged.
- The agent cannot read an excluded or secret file, execute a shell, write, or
  reach the network; a test proves each.
- Every tool call is bounded and ledgered; exceeding a bound yields an
  `uncertain` verdict rather than an unbounded loop.
- A deterministic-provider integration test verifies a "fixed" and a
  "not-fixed" prior-finding claim and asserts the correct verdicts.
- A corroborated finding raises confidence, never severity.
- Claim inputs are untrusted and cannot alter admission, severity, gates, or
  baseline.
