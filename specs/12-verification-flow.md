# 12: Agentic Investigation, Verification, and Fix Flow

Status: Approved
Date: 2026-07-23

## Purpose

A second review flow that investigates a claim against the real code with bounded
`read`/`list`/`grep` tools and returns a reasoned outcome. It is distinct from the
general review (spec 05), which stays a deterministic, single-shot, tools-off
whole-file discovery. One agent serves two jobs:

1. **Verification** — validate an external or prior claim: is an analyzer alert
   or review comment valid, does a new commit fix a previously reported finding,
   does a proposed fix resolve the issue without introducing a new one?
2. **Finding investigation and fix** — for this run's admitted findings, judge
   real vs false positive against the real file, and, when real, propose a
   precise, apply-checked fix.

Both jobs run through the same bounded agent, tools, and bounds; only the prompt
and which output fields are populated differ.

**The design hypothesis, stated as one:** because this agent reads the actual files
instead of relying on the single-shot review packet, its false-positive judgment
should be better grounded than the deterministic review can be, so the flow should
raise precision as well as producing apply-ready fixes.

**That hypothesis is UNTESTED, and this section previously asserted it as fact.**
As of 2026-08-11 no run has scored the fix lane on a real corpus. The eval wires it
deliberately (`eval-case-runner.ts` runs it per case, gated on `fix.enabled`) and
`fixLaneCaseTallies` scores it, but the flag has been off in every recorded run;
the only outcomes on disk are two 2026-07-23 smoke runs of a single judged finding
each — one agreeing with ground truth and one disagreeing — against fixtures that
no longer exist. Nothing about this flow's effect on precision is established, in
either direction, and no document may claim otherwise until a measurement exists.

The flow is optional and off by default. **The reason is containment, not a failed
measurement**: its agentic behavior, cost, and non-determinism are quarantined to
it, and the general review keeps every guarantee it has today. Those are different
claims and were previously easy to confuse.

## Relationship To The General Review

| | General review (spec 05) | This flow |
| --- | --- | --- |
| Job | discover defects in a change | verify claims; investigate + fix findings |
| Input | changed files + diff | claims, and this run's admitted findings |
| Control | single-shot, deterministic packet | bounded agent loop with tools |
| Tools | none | mediated read/list/grep |
| Determinism | reproducible | non-deterministic (agentic) |
| Output | candidate findings | verdicts, finding judgments, fixes |

The general review is unchanged by this spec, including its deterministic,
single-shot pre-admission refutation. This flow is the only place a finding is
re-examined against real file content, and it runs after admission. A finding
that this flow and the general review independently support is a corroborated
finding (see Corroboration).

## Contracts

### Claim

A `Claim` is a single assertion to investigate. Strict schema under
`src/shared/contracts/`:

- `id` — stable id (`claim_<hex>`).
- `kind` — `prior-finding | analyzer | comment | fix | current-finding`.
- `title` — short statement of the claim.
- `detail` — bounded description of what is asserted.
- `location` — optional `CodeLocation` the claim concerns.
- `source` — provenance label (for example `analyzer:codeql`, `comment:github`,
  `prior-finding`, `current-finding`).
- `question` — the specific question the agent must answer.
- `evidenceRefs` — optional bounded supporting data carried from the source (for
  example an analyzer rule id, CWE, a data-flow summary, or a finding id).

### Outcome

The agent's output for one claim, implemented as `Verdict` (`VerdictSchema`), with
a separate looser `ModelVerdictSchema` for what the model returns before code
finalizes it:

- `claimId`.
- `status` — `confirmed | refuted | uncertain`. The verification verdict for the
  claim as posed.
- `findingJudgment` — `real | false-positive`, populated only for
  `current-finding` claims, and **absent** when the agent cannot establish either
  from the code it read. Absence means "no signal", not a guess. There is no
  numeric confidence field: an LLM-authored score is not reproducible and is
  treated as noise.
- `fixEdits` — an optional apply-ready edit set (reuses the `FixEdit` contract),
  populated only when the finding is `real` and the agent produced a concrete,
  scoped fix.
- `rationale` — bounded, redacted explanation.
- `citedEvidenceIds` — evidence records for what the agent read.
- `fingerprints` — reuse the admission fingerprint scheme so an outcome matches a
  general-review finding and across runs.

Outcomes are reported in this flow's lane, separate from the defect-finding
report; they never enter the defect quality gate by default.

## Claim Sources

Claims arrive through pluggable providers, mirroring the context-ingestion
provider pattern (spec 11) but producing claims rather than orientation:

- `claims-file` — reads a neutral claims file a pipeline wrote before the run. No
  network. The decoupled path for any source, as the context inbox is for context.
- `prior-findings` — derives claims from a previous run's report or the baseline
  (each prior finding becomes a "does this still hold / is it fixed?" claim).
- `current-findings` — turns this run's admitted findings at or above the
  configured severity into `current-finding` claims for investigation and fix.

`analyzer` and `comment` claims are planned adapters that normalize a SARIF
artifact or pipeline-provided review comments into claims; they add a source
without changing the flow. Provider failures are non-fatal and surface as run
warnings, matching spec 11.

## The Investigation Agent

- One bounded harness agent (`investigate_claim`) runs a single claim at a time
  in a **single pass**: it may call the read/list/grep tools, then returns its
  outcome. The conceptual phases for a finding — investigate, propose a fix,
  re-evaluate — are phases of one prompt and one output, not separate model
  calls. Reading the file once and emitting judgment plus fix together avoids
  redundant tool spend and skips fix work for a finding judged a false positive.
- The agent reuses the model-backed harness and provider resolution used by the
  general review. Because this lane runs after the review's run cost is finalized,
  its own token usage and cost are accounted in this flow's report (`usage`)
  rather than the run summary, so the spend is never dropped.
- Bounds are deterministic and enforced by code, not the model: a maximum
  tool-call count per claim and the context-retrieval byte/match budgets. Exceeding a
  bound ends the claim with an `uncertain` status (and no
  `findingJudgment`/`fixEdits`), recording the reason. There is no open-ended loop.
- **No whole-run deadline, deliberately.** The bounds above are the ones that make
  a runaway loop impossible; a wall-clock timer over the run is a limit this
  project would impose on itself, and firing it destroys work that was
  progressing. A single network call is bounded by `provider.timeoutMs`. The flow
  additionally honours a caller-supplied `AbortSignal` and ends the claim
  `uncertain` with bound reason `aborted` — that reason means *the caller
  cancelled*, and no production caller supplies a signal today, so it is the
  library-embedding path rather than a deadline the CLI arms. This matches
  `docs/01-overview/status-and-limitations.md`, which states the same absence.
- **Code, not the model, is authoritative on a bound.** A claim whose tool-call
  budget was exhausted ends `uncertain` even when the agent, having received the
  recoverable budget error, still returned a conclusive verdict. The same `uncertain`
  outcome, each with its own recorded reason, covers a model verdict that fails
  schema validation (`invalid-verdict`), an agent error (`agent-error`), and an
  aborted run (`aborted`).
- Claim and tool inputs are untrusted. A claim, finding, fix, or tool output
  cannot grant authority, change admission, severity, gates, or baseline, or
  suppress a finding, and is presented under an untrusted/informational header
  (reuse the change-intent hardening from spec 11).

## Tools

The agent's only tools are the mediated repository tools from the
`context-retrieval` domain, reused as-is and hardened:

- `read` (bounded, line-numbered), `list`, and `grep` (in-process — never a
  shell), with recursive directory traversal on `grep`.
- Every call resolves through `path-service` under the repository root, respects
  the configured include/exclude eligibility so secret and ignored files (for
  example `.env`, `node_modules`, excluded paths) are never read, redacts output,
  records a context-ledger entry and an evidence record, and decrements a bounded
  budget.
- No shell, network, filesystem write, or environment access is available to the
  agent.

### Cross-Model Robustness

- Tool-call formatting differences between providers are handled by the harness;
  the tool contracts are defined once.
- Tool implementations are liberal in what they accept: paths are normalized
  through `path-service` (leading `./`, separators, case), and an expected
  condition (path not found, path not eligible, read or search budget exhausted,
  per-claim tool-call budget exhausted) comes back as a recoverable, actionable
  **tool result naming that reason** rather than an opaque error. This lane uses
  the same shared disclosure as tool-enabled discovery, so a refusal reads
  identically in both — spec 16's *Refusals Must Be Disclosed* owns the shape, the
  closed set, and the rule that every other failure (a containment violation above
  all) stays a fault and propagates.
- Tool output is deterministic and bounded (line-numbered, byte-capped) so every
  provider receives consistent context.
- Integration tests run against more than one provider adapter shape so per-model
  quirks are caught.

## Deterministic Apply-Check

Before a produced `fixEdits` set is attached to a finding, code (not the model)
applies it to the current file bytes. An edit that does not apply cleanly is
dropped, and the fix is recorded as not produced. This rejects hallucinated line
numbers and stale-location edits without a model call. Fixes are always
`safety: manual-review`; the flow never applies an edit to the working tree.

**This lane uses the check; it no longer owns it.** The function is
`applyFixEdits` in `src/shared/text/apply-fix-edits.ts` — pure, deterministic and
model-free, so it needs neither an agent nor a provider. Spec 13's comment layer
calls the same function to gate every ` ```suggestion ` block it offers, which is
what stopped a one-click apply from being unchecked whenever this lane was off
(2026-08-11). Two implementations of "does this edit still fit the file" would be
strictly worse than one, so a change to the semantics here changes both surfaces
and must be considered against both.

### A Fix Stays In The Finding's Own File, And Says When It Did Not

A fix set whose edits touch any file other than the finding's own `location.path`
is refused **whole**, before the apply-check runs, and never half-applied.

The restriction is deliberate. The apply-check is defined against one file's
current bytes; the enriched `fixProposal` may cite only the finding's own evidence
records, and there are none for another file; the inline comment the proposal
flows into (spec 13) is anchored to the finding's lines, so an edit elsewhere
could never be represented there. Widening this would mean carrying a
model-authored edit for a path this run never reviewed, never gathered evidence
about, and never eligibility-checked.

What was wrong was the **silence**. The refusal was recorded as `not-attempted`,
which is what a finding with no proposed fix records — so "the agent proposed
nothing" and "the agent proposed something this lane will not carry" were the same
record, and they are opposite situations for whoever reads it.

The fix outcome and the per-claim observation therefore carry
`fixDeclinedReason: 'edits-outside-finding-file'`, present ONLY when a proposed fix
was refused. `applyCheck` stays `not-attempted`, because the check genuinely did
not run and a fourth outcome value would say it did; the reason field is what
separates the two cases, and its absence means there was nothing to refuse.

## Effect On Findings, Severity, And The Gate

The flow is **advisory**: it improves fix guidance and adds a precision signal,
but it never changes which defects are reported, their severity, admission, or the
quality gate. Two distinct outputs:

- **Fix enrichment.** When the finding is `real` and the apply-check passes, the
  lane adds or replaces the finding's `fixProposal` with its apply-checked edit —
  `safety: manual-review` guidance that flows to every reporter (Markdown, SARIF,
  and the review comments of spec 13), so the better, real-file-grounded fix is
  the one users see. This changes only advisory fix metadata; category, severity,
  admission, and the gate are untouched. The lane's output is non-deterministic
  and is reached only when `fix.enabled`, so the deterministic defect set and gate
  are unaffected.
- **False-positive signal.** The `findingJudgment` is a separate boolean signal on
  the finding, mirroring the corroboration confidence pattern below — advisory
  only. It never removes a finding from the gate or changes severity in the
  default mode. A future opt-in mode may let a `false-positive` judgment filter the
  reported findings, gated on eval evidence that the judgment is trustworthy; that
  is out of scope here and off until measured.

## Corroboration

- After the general review and this flow complete, each `confirmed` verdict is
  matched against the general-review admitted findings. A match is a shared
  fingerprint or a fuzzy match: the claim location and the finding location cover
  the same file with overlapping line ranges.
- Each matched finding yields a `FindingCorroboration` — the finding id, a
  `confidence: corroborated` signal, the match kinds, and the witnessing claim
  ids. This is a separate structure; the admitted finding contract is untouched.
- Corroboration raises confidence only; it never raises severity.
- Corroborations are surfaced on BOTH this flow's report and the review report
  (`corroborations` on each, one shared record shape), and the Markdown report
  states them on the finding itself, naming whether the match was the same defect
  or only an overlap — an overlap is weaker evidence and must not read as an
  identity. Surfacing them only on this flow's own JSON artifact put the one signal
  this section exists to produce where the reader deciding what to act on does not
  look. The field is ABSENT on a review report when the flow did not run, which is
  a different claim from a flow that ran and confirmed nothing.
- Only `confirmed` verdicts corroborate; `refuted` and `uncertain` verdicts never
  raise confidence.

## Platform Neutrality

The flow reads neutral files and writes neutral artifacts. Fetching analyzer
output or review comments, and posting any response or resolution, are performed
by pipeline steps or thin platform integrations outside the core, so no platform
API code or credential enters the product. Publishing remains out of scope
(spec 07 / `CAP-PR-001`).

## Configuration

Keys are defined in `04-configuration-and-providers.md`:

- `verification` — the claim-verification job, disabled by default: `enabled`,
  claim `providers` (a discriminated union on `type`; implemented types are
  `claims-file` and `prior-findings`), and the bounds `maxToolCallsPerClaim`
  (1–50, default 12), `maxBytesPerRead` (1 000–4 000 000, **unset by default**),
  and `maxMatches` (default 20). Invalid configuration fails validation with exit
  code `2`.

  `maxBytesPerRead` is unset for the reason spec 28 gives for the general
  review's equivalent: a per-read byte cap chosen in advance cuts a file
  mid-read, and a claim resolved against the first N bytes of a file is not a
  claim resolved against the file. It defaulted to 20 000 under a comment saying
  it mirrored the context-retrieval defaults, which stopped being true when spec
  28 removed those. Setting it remains a deliberate operator choice, still binds,
  and the resulting cut is disclosed in the tool output the investigator reads.

  What replaces it is a limit that ANNOUNCES itself. When the provider refuses
  the investigation as exceeding its context length, the read budget is narrowed
  and the claim is retried — reads first, because the overflow came from what a
  tool returned. Each retry is logged and continues to spend the same per-claim
  tool-call budget rather than being granted a fresh one, and the number of
  narrowing attempts is bounded because every attempt is a paid model call. A
  claim that still does not fit ends `uncertain` with bound reason
  `context-length-exceeded` and a rationale naming the cause and the remedy —
  never as a generic agent error, and never by truncating the context to force it
  through.
- `fix` — the finding investigation-and-fix job, disabled by default. `enabled`
  is the single switch for the whole single pass (judgment and fix together).
  `minSeverity` is optional and resolved at run time to
  `aiReview.actionableSeverityThreshold` (itself default `medium`) when unset, so out
  of the box the lane runs on exactly the findings that can block the pipeline, not
  on nits — set `info` to cover every finding, or `critical` for blockers only. The
  per-claim bounds are shared with `verification`. Token usage is **accounted after
  the fact, never bounded** — there is no per-claim token budget, deliberately: the
  bound that matters is tool calls, which is what actually runs away, and a token cap
  would cut an investigation mid-reasoning rather than refusing it cleanly.

## Observability And Errors

- Each claim records a no-content step: claim kind, source label, tool-call count,
  bytes read, status, `findingJudgment` (or absent), whether a fix was produced,
  apply-check outcome, `fixDeclinedReason` when a proposed fix was refused, and
  duration. No source, claim/finding text, fix text, or tool output appears in
  logs, traces, or events.
- A claim provider that fails at run time is non-fatal and surfaces as a run
  warning; the flow proceeds without that provider's claims.
- A claim provider bounded by the per-provider claim cap is non-fatal and surfaces
  as a run warning naming the provider and how many claims it withheld. The
  report's `claimCount` counts the claims that were investigated, so without this
  warning a run that judged 200 of 900 admitted findings is indistinguishable from
  one that judged all the findings it had.
- A run that reaches no claim source produces an empty report and does not fail.

## Testing

- Unit tests: `Claim`/`Outcome` schemas; the hardened tools (recursive grep,
  eligibility rejection of excluded/secret files, budget enforcement, path
  normalization); each claim source, including `current-findings` and its
  `minSeverity` gating (default tracks `actionableSeverityThreshold`); the
  deterministic apply-check (a non-applying edit is dropped, a clean edit is kept);
  corroboration matching.
- Integration tests use a deterministic harness provider (a `modelAlias.provider`
  whose `object`/`text` return a canned tool-call sequence then an outcome, the
  hermetic pattern the general review's tests use). They drive the
  `investigate_claim` agent through a bounded loop against a fixture repository and
  assert: the returned verdict; a `false-positive` judgment on a planted
  non-defect and a `real` judgment plus an apply-checked fix on a genuine one;
  that only eligible files were read; that a refused read reaches the investigator
  as a tool result naming the reason and stating it is not evidence about the code;
  that the ledger records every read; that budget/loop bounds are enforced; and that
  an untrusted claim or finding cannot change the gate, severity, or the outcome of
  an unrelated finding.

## Acceptance

- With `verification` and `fix` disabled, no flow runs and the general review and
  gate are byte-for-byte unchanged.
- The verification and fix jobs share one agent, tool set, and bounds; there is no
  second agent loop.
- The agent cannot read an excluded or secret file, execute a shell, write, or
  reach the network; a test proves each.
- Every tool call is bounded and ledgered; exceeding a bound yields an `uncertain`
  status rather than an unbounded loop.
- A deterministic-provider integration test verifies a "fixed" and a "not-fixed"
  prior-finding claim and asserts the correct verdicts.
- One model pass per finding yields both the boolean judgment and, when the
  finding is real, an apply-checked fix; there is no numeric confidence.
- An edit that does not apply to current file bytes is dropped by code.
- A real finding's apply-checked fix enriches its `fixProposal` and flows to the
  Markdown, SARIF, and review-comment reporters; category, severity, admission,
  and the gate are unchanged.
- A `false-positive` judgment never removes a finding from the gate or changes
  severity in the default (advisory) mode.
- A corroborated finding raises confidence, never severity.
- Claim and finding inputs are untrusted and cannot alter admission, severity,
  gates, or baseline.

## Measurement Plan

This spec had no measurement plan until 2026-08-11, which is why it could carry an
unverified precision claim for as long as it did. A capability whose spec asserts an
effect and names no way to test it will stay unverified by default.

**The fix lane can be measured today and has not been.** The eval already runs it
per case (`eval-case-runner.ts`, gated on `fix.enabled`) and `fixLaneCaseTallies`
scores it. What is missing is a run: an arm with `fix.enabled` true against a
corpus whose findings have known real/false-positive ground truth. The endpoints
already exist as metrics — `fixJudgmentAccuracy`, `fixFalsePositiveDetectionRate`,
`fixProduceRate`, `fixApplyFailureRate` — and the pre-registration must fix a bar
for the first of those BEFORE the run, because "the lane's judgement is better
grounded" is the claim this spec was making.

**Verification cannot be measured by `eval run` at all, and that is a corpus gap
rather than a wiring bug.** `runVerificationForReview` is on the `review` command's
lane, but wiring it into the eval would score nothing: this flow adjudicates
external CLAIMS, and an eval case carries none. It needs its own corpus and its own
entry point, the way change-impact has `eval impact` with
`eval/corpora/change-impact-dependents` and intent-fulfilment has `eval intent`
with `eval/corpora/intent-fulfilment`. That corpus is claims paired with ground-truth verdicts, and
it does not exist.

Until each exists, the honest statement is that neither half of this flow has a
measured effect, and no document may imply otherwise.

## Known Divergences From This Spec

None. Both entries recorded on 2026-08-01 were resolved on 2026-08-06, in opposite
directions:

- *The run timeout* was a claim in this spec with no code behind it. The **spec was
  wrong**: the engine has no whole-run deadline by design, and
  `docs/01-overview/status-and-limitations.md` said so while this spec implied
  otherwise. *The Investigation Agent* now states the absence and what stands in
  its place, so the two documents agree.
- *A fix touching another file was dropped silently.* The **implementation was
  wrong** — not in refusing the fix, which is right for the reasons now recorded
  under *Deterministic Apply-Check*, but in leaving the refusal indistinguishable
  from "no fix was proposed". It carries `fixDeclinedReason` now.

  Note for the evaluation lane, which mirrors `FixOutcome` in its own contract
  rather than importing it: that mirror carries `applyCheck` and not the new
  reason, so an eval artifact still cannot tell a refused fix from an unproposed
  one. The mirror is owned there, and widening it is that lane's call.

## A False-Positive Judgement Must Reach The Reader

The fix lane forms a `findingJudgment` per finding and declines to write a fix when
it is `false-positive`. Until 2026-08-11 that judgement reached `fix-report.json`
and nothing else — no report, no markdown, no pull-request comment — so a human
read a finding presented as real while a second stage of this engine had disagreed
with it in writing, and no surface said so.

- Every finding the fix lane judges `false-positive` MUST be named on the review
  report as a run warning.
- The finding MUST remain admitted. The fix lane is advisory and does not decide
  admission; letting it silently withdraw findings would hand an advisory stage the
  authority this spec denies it. The reader is given both claims and decides.
- An ABSENT judgement MUST NOT be read as `false-positive`. A judgement the lane
  never formed is not a disagreement, and treating absence as a verdict is the
  silent-optimism inversion this project keeps finding.
