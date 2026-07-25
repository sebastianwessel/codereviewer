# 16: Agentic Cross-File Discovery

Status: Approved
Date: 2026-07-24

## Purpose

Close the cross-file recall gap. Holistic discovery sees only the changed files,
the diff, and bounded signature-level digests of directly-imported unchanged files
(R4, spec 05). Defects whose presence depends on the *behavior* of code in another
file are therefore invisible: on the committed benchmark, cross-file recall is
**0%**. The dominant cross-file misses are high-severity authorization defects — a
changed file calls a helper defined elsewhere (e.g. `getOrCreateResource`,
`findByName`) and the bug is a mismatch between how that helper creates a resource
and how the changed code looks it up. Catching these requires the callee's *body*,
not its signature.

This spec adds an optional, bounded, **tool-enabled discovery mode**: during
discovery the model may read specific other-file code on demand through the same
mediated retrieval seam the verification flow already uses, then reason with it.

## Non-Negotiable Reuse

This is not a new pipeline. It reuses these existing components:

- the **context-retrieval** domain (`ContextRetriever`: mediated `read`/`list`/`grep`
  with eligibility, redaction, byte/match caps, path containment — spec 07);
- the **bounded tool wrapper** (`createBoundedRetrievalTools`) that caps total tool
  calls in CODE, shared by the per-claim investigation lane and the per-task
  discovery lane;
- the **harness tool-agent loop** and the custom-tool wiring that `investigate_claim`
  (spec 12) already uses (`repo_read`/`repo_list`/`repo_grep`, `builtinTools: false`,
  `maxSteps = budget + 1`);
- the existing **holistic discovery output** and the shared **refutation + admission**
  filter. Retrieved-context findings are ordinary candidates and face the same gate.

## Mechanism

When enabled, the holistic discovery agent for a task is given the mediated
`repo_read`/`repo_grep`/`repo_list` tools and a small per-task tool-call budget. Its
instructions direct it to use them **only** when a concrete suspected defect's
presence or absence depends on the behavior of a symbol it cannot see in the provided
context (an imported callee, an interface contract, a permission definition) — read
that symbol before deciding, rather than guessing or staying silent. It then emits
findings as today.

- **Bounded by a runaway-loop guard.** A per-task cap on total tool calls is enforced
  by CODE (not the model), mirroring `verification.maxToolCallsPerClaim`. Its purpose
  is to stop a model that never stops requesting reads, NOT to ration context:
  measurement shows the model self-limits well below the cap (0-7 calls when 8 were
  allowed, never exhausting it), so a tight cap only starves the tasks that genuinely
  need several lookups. The cap is therefore set generously; focus comes from the
  instruction to retrieve only what a specific suspicion requires, and from the
  retriever's own per-call byte/match caps. "More context reduces quality" (spec 10)
  is respected by demand-driven, targeted reads, never a whole-repository dump.
- **Steps, not delegation budget.** A mediated tool call is an agent STEP, bounded by
  the discovery agent's step allowance (the cap plus headroom, so a model that hits
  the cap can still answer). It never counts against the workflow's child-agent call
  budget, which counts agent invocations.
- **Mediated and safe.** Every read/list/grep goes through `ContextRetriever`:
  eligibility gate (no dotfiles, `node_modules`, `.git`, secrets, excluded globs),
  redaction, path containment (no escape via symlink), and repository content treated
  as untrusted (spec 07). Retrieved content cannot grant authority, change admission,
  severity, gates, or baseline, and the discovery prompt is hardened against
  injection from it.
- **Deterministic mediation, non-deterministic use.** The tool surface and its bounds
  are deterministic; the model's decision to call a tool is not. Like every other
  model lane it is quarantined: findings still pass untrusted refutation and
  deterministic admission, so the precision guarantees are unchanged.
- **Additive to recall only.** With the mode disabled, discovery is a single-shot
  review with no tools and the run is byte-for-byte unchanged. Enabling it can only
  let the model see more; it never removes a finding the single-shot pass would make.

## Configuration

A `review.crossFileRetrieval` block, disabled by default. Keys (defined in
`04-configuration-and-providers.md`): `enabled` (default false),
`maxToolCallsPerTask` (the runaway-loop guard), and `maxBytesPerRead` (the
per-read excerpt cap; retrieval reads whole files, and one oversized read
measurably diluted a review, so a retrieved file is bounded to an excerpt and the
model narrows with grep instead). Invalid configuration fails
validation with exit code 2. With the block disabled, no discovery tool call is
issued and the discovery agent is configured exactly as today (no tools,
single step).

## Budget And Cost

Enabling the mode adds, per task, the mediated reads the model actually requests (in
practice far below the cap) plus the discovery steps to consume them. No child-agent
call reservation is needed: tool calls are agent steps, not agent invocations. Cost is
accounted for by the existing transport-level usage recorder (no new accounting).

## Observability, Safety, Privacy

- Discovery tool calls are no-content: tool, path, byte counts, and durations only;
  redacted retrieved content is recorded in the context ledger exactly as the
  verification flow records it. No secret value or payload appears in logs or events.
- The per-task tool-call bound, retrieval budgets, and eligibility gate are the hard
  floors; the model cannot widen them.

## Testing

- Unit: the generalized bounded per-task tool wrapper caps total calls in code and
  reports budget exhaustion; the disabled path configures the discovery agent with no
  tools and a single step (byte-for-byte unchanged); the retriever mediation
  (eligibility, redaction, containment) is exercised as today.
- Integration (hermetic, deterministic provider): a planted cross-file defect whose
  evidence lives in an unchanged imported file is caught only when the mode is enabled
  and the model reads that file; a run with the mode disabled is unchanged; an
  untrusted payload in a retrieved file cannot alter admission or the gate; the
  per-task tool-call budget bound is enforced by code even if the model keeps
  requesting reads.
- No real-provider run in the test suite; cross-file recall is measured in the
  explicit, cost-gated eval.

## Acceptance

- With `review.crossFileRetrieval` disabled, discovery issues no tool call and the
  run is byte-for-byte identical to today.
- When enabled, discovery may read other-file code through the mediated retriever,
  bounded by a code-enforced per-task tool-call cap; retrieved-context findings pass
  the same untrusted refutation and deterministic admission as any other candidate.
- The mode never bypasses eligibility, redaction, path containment, scope, severity,
  baseline, or the gate.
- Any cross-file recall improvement is demonstrated by measurement (cross-file recall
  vs the 0% baseline) without a regression to overall recall or adjusted precision.
