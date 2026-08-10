# End-to-end flow audit: what is wired, what is dead, what lies

Run 2026-08-10 before the citation-spine measurement, on the premise that this
codebase has a repeated defect class — **a field or channel that is wired, typed,
tested, and structurally unreachable in production**. Three instances were already
confirmed this session (candidate `evidenceIds` hardcoded `[]`; the
`supportSignalCandidates` filter; signal facts never rendered into discovery).

Three parallel read-only audits covered discovery→refutation→admission, context
assembly→prompt, and config→runtime→output. Every finding acted on below was
re-verified by hand at the cited line; findings not acted on are recorded here so
nobody has to rediscover them.

## Fixed in this pass

**1. The reviewed diff reached the model UNREDACTED.** Every changed file's
content goes through `redactText` before it can enter a packet
(`run/context/context.ts:250`). `reviewedDiffText` did not — it flowed intake →
workflow input → discovery packet verbatim. A credential committed inside a
changed hunk was therefore sent to the provider in the "What this change modified"
section, while the identical string in the surrounding file body came out
`[REDACTED]`. Fixed at the single point the diff enters a run
(`run/intake/repository-input.ts`), which also keeps the context ledger honest,
since the ledger measures that same string. Regression test asserts the secret is
gone and the hunk survives.

**2. Two model-output fields were parsed and read by nothing.**
`contextRequests` and `requestedContext` on `ModelHolisticFindingSchema` were
preprocessed, schema-validated and capped for their whole life, with zero
consumers anywhere — a model asking for more context was answered by silence.
Removed, along with the now-orphaned `ContextRequestSchema` and its
`normalizeModelStringArray` helper. Spec 15's "Bounded Agentic Evidence" section
referenced the field as the route for a future follow-up; it now records that a
follow-up must be a TOOL the reviewer calls (which spec 16's cross-file retrieval
already is), not a field it fills and hopes someone reads.

**3. Three copies of two artifact filenames.** `run-artifacts.ts` has exported
`IMPACT_JSON_ARTIFACT_NAME` / `INTENT_JSON_ARTIFACT_NAME` all along; the standalone
check commands use them, but `commands/review.ts` re-typed both strings and
`scripts/github/pipeline.ts` re-typed them a third time on the READ side. All three
agreed, so nothing was broken — and a drift in any one would have shown an empty
Impact/Intent section in every future pull-request comment, silently and forever.
All three now route through the one constant.

## Verified sound (no action needed)

- **The citation flow is connected at every hop**, config → `ReviewWorkflowInput`
  → `candidateFromFinding` → `TaskReviewResult.evidenceRecords` → `handler.ts:240`
  → the refutation packet's `evidence` filter. Proved independently of the unit
  tests: an exact quote and a whitespace-loose quote each mint one record, a
  hallucinated quote mints zero, and the packet's evidence array carries the
  citation. Record ids are 1:1 with the candidate's `evidenceIds` by construction,
  so the packet filter cannot miss them.
- **Refutation's budget shedding cannot shed citation evidence.** It sheds
  `supportSignalCandidates`, then `reviewContext`, then refuses; `evidence` is not
  a rung. The refuter is told what was withheld and that absence means
  `needs-more-evidence`, never evidence against a candidate.
- **Reviewer instructions reach BOTH discovery and refutation** from one field,
  inherited verbatim by every partition and reactive-split half. The historical
  bug where instructions reached one stage only has not returned.
- **Advisory lanes cannot affect the review's exit code.** The gate reads only
  `report.qualityGate`, which is computed from findings and never from
  `run.warnings`.
- **Every config key is read** except the four `z.literal`-locked security
  invariants (see below), and the newest keys — `review.signalFacts`,
  `review.citations`, `reviewConversation` — are each genuinely wired.

## Recorded, NOT fixed — with the reason

**A. DECIDED 2026-08-11 — the `proposedBy` cluster is NOT dead, and it is KEPT.**

I removed all four mechanisms, then reverted. The audit below traced production
write sites and found only `proposedBy: 'review-agent'`, concluding no producer
exists. **That conclusion was wrong, and the way it was wrong is worth keeping.**
It traced the CLI path only. `ReviewWorkflowInput.candidates` is a published API
surface: a library consumer can seed a candidate with any `proposedBy`, and
`review-workflow.test.ts` asserts the resulting behaviour deliberately ("keeps
support-signal seed candidates artifact-only when the model returns none"). The
producer is not missing — it is the caller. Removing the cluster would have
silently deleted a tested capability and forced every seeded candidate through
refutation, changing behaviour for anyone using the engine as a library.

The original analysis is left below, unedited, because "no production write path"
was a true statement about the CLI and a false one about the product.

---

**A (original, superseded). The `proposedBy` cluster is dead code, and it is not small.** Exactly one
production site constructs a `CandidateFinding`, and it hardcodes
`proposedBy: 'review-agent'`. Four separate mechanisms branch on that value being
something else — `supportSignalCandidates` (refutation packet),
`isModelProposedCandidate`, `candidateNeedsRefutation`'s "support-signal
candidates skip refutation" cost optimisation, and the whole
`supportSignalCandidateOutcome` admission branch. All four are unreachable. This
is a designed capability — deterministic signals proposing or corroborating
candidates and skipping the refuter — that was never given a producer.

Not removed here because it is a **design decision, not a cleanup**: either wire a
deterministic-signal candidate producer, or delete four mechanisms and their
specs. Doing that immediately before a measurement would also change the very
stage being measured. It should be decided deliberately, not as a side effect.

**B. Analyzer metadata cannot reach a finding.** `analyzer-ingestion` builds rich
`EvidenceRecord`s carrying `cwe`, `ruleId`, `helpUri`, `securitySeverity`,
`relatedLocations`, `dataFlow` from real analyzer alerts, and they do inform the
model as rendered prose. But `CandidateFinding` has no matching fields, so no
`AdmittedFinding` can carry them — SARIF falls back to `ruleId ?? category` and
emits no CWE tag or security-severity even for a finding that IS the direct report
of that alert. `securitySeverity`'s non-propagation is deliberate and documented
(third-party data must not set severity); the other five look like incomplete
wiring. Needs its own change with its own tests.

**C. Reactive-split diff duplication.** When a single large file overflows the
provider, `splitContentInHalf` produces two halves that keep the SAME path, and
`diffSegmentsForPaths` selects by path only — so both halves render that file's
entire diff, while the ledger recorded it once, under the pre-split task id that
made zero calls. Accounting-only, fires only on the recursive single-file path.

**D. OpenTelemetry is a stub that reads as live.** `configureOpenTelemetry`
dynamic-imports two packages to check they exist, returns a result its only caller
discards, and logs "setup completed" regardless. Nothing anywhere calls
`startSpan`, and neither package is in `package.json` — so enabling it either
fails preflight with a missing-dependency error or succeeds while exporting
nothing. This is the repository's own silent-optimism class inside its own
observability subsystem.

**E. Computed and never surfaced to a human.** PARTIALLY FIXED 2026-08-11: the
discovery diagnostics (`rawFindingCount`, `droppedCount`, the suppression
counters) now render as a "What Discovery Produced" section in `report.md`, which
is what separates "the reviewer proposed little" from "it proposed plenty and the
later stages removed it". The section is omitted, not zeroed, when a run recorded
no discovery. Still open: the fix lane's judgment that an admitted finding is a false positive reaches only
`fix-report.json`, which no production code reads back; a human sees the finding
presented as real while the fix lane privately disagreed. `verification-report.json`
is likewise write-only apart from its warnings.

**F. The change-intent refutation exclusion is a blocklist with no exhaustiveness
guard.** `kind !== 'change-intent'` compiles unchanged however many kinds exist,
and no test enumerates the enum against the filter. Not a live bug — only that one
kind needs excluding today — but the next untrusted-but-fact-shaped kind will
default to INCLUDED in refutation, which is the fail-open direction.
