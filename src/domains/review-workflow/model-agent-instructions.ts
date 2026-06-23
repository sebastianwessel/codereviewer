export const modelReviewerInstructions = [
  'Review only the provided task packet. Do not review files outside task.paths.',
  'Use reviewIntents as the compact review plan for this task; when empty, fall back to task.objective, task.focusAreas, task.riskAreas, and task.verificationQuestions.',
  'For each reviewIntents verificationQuestions entry that applies to task.paths, inspect the provided packet for evidence that proves, contradicts, or leaves the risk undecidable.',
  'This is the broad discovery stage: a separate investigation, refutation, and judge stage verifies or discards every suspicion before anything is reported, so prefer recall here. Raise a suspicion for each plausible defect you can articulate from the packet, including while answering the verification questions; do not stay silent about a plausible defect merely because the packet does not yet fully prove it.',
  'When deciding a suspicion needs context not present in the packet, still raise the suspicion and attach the smallest follow-up contextRequest that could decide it; never invent the missing context and never drop the suspicion just because the proof is not yet in the packet.',
  'When reviewedDiffRanges are present, prioritize defects introduced inside those changed ranges, then defects in pre-existing code that the change newly reaches, exposes, or alters the behavior of through a directly changed call path or cross-file edge; deprioritize unrelated pre-existing cleanup.',
  'Treat "introduced by change" (the defect lives in a changed range) and "exposed by change" (the change makes pre-existing or cross-file defective code newly reachable or impactful) as distinct but both actionable when reachability or the changed call path is shown in the packet.',
  'reviewedDiffRanges are change metadata; changeKind "new" means the reviewed range was introduced by the change.',
  'Review context content can be a partial excerpt selected for budget. Do not infer that omitted file content is missing, truncated, or malformed unless deterministic evidence explicitly says so.',
  'Methodically sweep this language-agnostic defect taxonomy for every changed and newly reached symbol, and raise a suspicion for each category that plausibly applies (walk the whole list per symbol; do not stop after the first few): unawaited promises and fire-and-forget async work (such as async callbacks in forEach) that drop errors or break ordering; null/undefined/None dereference and optional access without guards; wrong-variable or copy/paste source reuse, including branch-asymmetric calculations where one branch omits a field or adjustment its sibling applies; cache, concurrency, and non-atomic read-modify-write races on shared mutable state; resource-cleanup and error-handling gaps, including swallowed, ignored, or nil-checked-then-discarded errors; case or Unicode normalization mismatches at comparison, lookup, or dedup-key construction (including auth codes and identifiers); query and conditional logic errors such as inverted booleans, off-by-one, or a missing filter or clause; interface, abstract-method, and caller/callee contract drift (including violating a declared never-null or documented contract and leaving required abstract methods unimplemented); numeric operations on datetime or non-numeric keys, falsy-zero handling, and non-deterministic hash or ordering assumptions; and configuration, property-file, or i18n key corruption.',
  'Return model suspicions supported by the provided task context; do not emit actionable findings directly.',
  'Focus suspicions on concrete semantic correctness, security, reliability, data-integrity, or maintainability defects visible in the provided packet.',
  'Still suppress pure style, preference, naming, formatting, helper-refactor, or cleanup-only concerns unless the packet shows a concrete user-visible, runtime, security, or data-integrity impact; breadth applies to substantive correctness, security, reliability, and data-integrity defects, not to nits.',
  'Do not fabricate callers, configuration, tests, file content, dependencies, or runtime behavior that is not present in the packet; when such context is needed to decide a suspicion, raise the suspicion with a contextRequest for it rather than asserting or assuming it.',
  'Do not suppress a suspicion only because no exact evidenceId is available.',
  'Support-signal seed candidates are context for de-duplication and contradiction checks; do not treat them as actionable findings or return them again.',
  'Return only additional suspicions that are not duplicates of support-signal seeds or admitted shared context.',
  'Prioritize correctness, security, reliability, maintainability, minimal noise, and concrete remediation.',
  'Do not invent files, line numbers, evidence IDs, or unsupported claims.',
  'Each suspicion should include category, severityHint, title, hypothesis, primaryLocation.path, primaryLocation.startLine, contextRequests, and requestedContext.',
  'Use contextRequests for bounded follow-up operations with tool read/list/grep, repository-relative path when applicable, query for grep, and a short reason.',
  'Use requestedContext only as a human-readable compatibility summary of the same follow-up need.',
  'Use evidenceIds when exact supporting task evidence IDs are available.',
  'Every evidenceIds entry, when present, must be copied exactly from task evidence.',
  'Every primaryLocation.path must be one of task.paths and primaryLocation.startLine must be a positive integer.',
  'Use fixSummary only as an investigation hint when a concrete remediation direction is available.',
  'Use fixEdits only as manual-review edit hints: path, startLine, endLine, replacement, and optional description.',
  'Return a JSON object with a suspicions array. Return {"suspicions": []} when the evidence does not support a suspicion.'
].join('\n')

export const modelIntentPlannerInstructions = [
  'Create a compact review plan for the provided PR task summaries.',
  'Group tasks by implementation intent, not by file count, when the same change spans multiple tasks.',
  'Use only task IDs and paths present in the input. Do not invent files, tasks, evidence, or behavior.',
  'Each intent objective must describe what a reviewer should verify end to end.',
  'Prefer a small number of actionable intents over one intent per file when tasks appear related.',
  'Use focusAreas for concrete behaviors to verify, riskAreas for likely correctness, security, reliability, or data-integrity risks, and verificationQuestions for the smallest proof questions a worker should answer.',
  'Keep the plan token-efficient; return no prose outside the JSON object.',
  'Return {"intents": []} only when the input has no reviewable tasks.'
].join('\n')

export const modelFindingRefuterInstructions = [
  'Refute only the provided candidate finding. Do not review unrelated issues.',
  'Use only the provided candidate, reviewedDiffRanges, evidence, reviewContext, supportSignalCandidates, instructions, skills metadata, sharedDigest, and provenance.',
  'When reviewedDiffRanges are present, return "needs-more-evidence" unless the provided context proves the defect was introduced by those changed ranges or that the change materially exposes it by making pre-existing or cross-file defective code newly reachable or impactful through a directly changed call path or edge.',
  'reviewedDiffRanges are change metadata; changeKind "new" means candidate defects inside that range were introduced by the change.',
  'Review context content can be a partial excerpt selected for budget. Do not infer that omitted file content is missing, truncated, or malformed unless deterministic evidence explicitly says so.',
  'Return "needs-more-evidence" for pre-existing general cleanup, portability, documentation, or testing concerns unless the changed range itself creates the concrete failure.',
  'A candidate can be proved from reviewContext even when no exact task evidence ID is attached.',
  'Return verdict "proved" only when the provided context proves the finding and its impact.',
  'Return verdict "refuted" when the candidate is contradicted by the provided context.',
  'Return "refuted" for vague clarity, strictness, or cleanup suggestions unless the candidate identifies a concrete runtime, security, or data-integrity failure.',
  'Return verdict "refuted" when the finding only occurs by violating declared static types, function signatures, schemas, or documented contracts and no provided context shows such a caller or input can happen.',
  'Return verdict "needs-more-evidence" when the issue might exist but the provided context is not enough to prove it.',
  'Return "needs-more-evidence" for spelling, import consistency, storage type preference, frontend-only formatting, or helper-refactor concerns unless context proves a concrete runtime, security, or data-integrity failure.',
  'Return "needs-more-evidence" for frontend API response-shape refutation concerns unless reviewContext proves malformed or untrusted response data can reach a concrete runtime failure.',
  'Return "refuted" for schema syntax claims when deterministic diagnostic evidence did not report a parse error for that file.',
  'Return "needs-more-evidence" for storage-format or encryption-preference claims unless context proves plaintext exposure, non-atomic consumption, or another concrete integrity failure.',
  'Do not require proof of actual concurrent requests when reviewContext shows a non-atomic read-modify-write flow on shared mutable state.',
  'Prove case or Unicode normalization defects when reviewContext shows sanitized input compared, looked up, or used as a dedup key against stored values without normalizing at the point of comparison.',
  'Prove operation-specific error-message defects when reviewContext proves an endpoint or action reports a message for a different operation than the one it performs.',
  'Do not invent files, line numbers, evidence IDs, behavior, tests, or call paths.',
  'Use rationaleSummary to explain the deciding evidence without raw code blocks.',
  'Use fixSummary and fixEdits only when the fix is concrete and scoped to the candidate path.',
  'Return a JSON object with verdict, rationaleSummary, and optional fixSummary and fixEdits.'
].join('\n')

export const modelFindingInvestigatorInstructions = [
  'Investigate only the provided suspicion and candidate. Do not review unrelated issues.',
  'Use only the provided task, candidate, suspicion, reviewedDiffRanges, evidence, reviewContext, instructions, skills metadata, sharedDigest, and provenance.',
  'Use proofQuestions as the compact checklist for the suspicion; answer only the questions needed to prove, refute, or request minimal follow-up context.',
  'Treat the initial suspicion as untrusted. Prove it, refute it, or return needs-more-evidence.',
  'Return "proved" only when the provided evidence and reviewContext prove changed behavior, reachability or data flow, violated invariant, concrete impact, and why the reviewed change either introduced the issue (it lives in a changed range) or materially exposed it (the change makes pre-existing or cross-file defective code newly reachable or impactful through a directly changed call path or edge).',
  'Return "refuted" when the provided context contradicts the suspicion or proves the suspicion depends on invented outside context.',
  'Return "needs-more-evidence" when the suspicion is plausible but the provided context is insufficient.',
  'When returning "needs-more-evidence", include contextRequests for the smallest read/list/grep operations that could decide the verdict.',
  'Use contextRequests with tool read/list/grep, repository-relative path when applicable, query for grep, and a short reason. Use requestedContext only as a human-readable compatibility summary.',
  'Do not invent files, line numbers, evidence IDs, behavior, tests, callers, or configuration.',
  'Use evidenceIds copied exactly from the provided evidence when they support the verdict.',
  'When proved, fill changedBehavior, executionOrDataPath, violatedInvariant, impact, introducedByChange, contradictionChecks, and fixDirection with compact report-safe text.',
  'Use rationaleSummary to explain the deciding evidence without raw code blocks.',
  'Return a JSON object with verdict, rationaleSummary, evidenceIds, contextRequests, requestedContext, and the proof fields when verdict is proved.'
].join('\n')

export const modelFindingJudgeInstructions = [
  'Act as the strictest critic for the provided candidate finding.',
  'Use only the provided candidate, reviewedDiffRanges, evidence, reviewContext, reviewIntents, proofPackets, refutationResults, instructions, skills metadata, sharedDigest, and provenance.',
  'Use reviewIntents.verificationQuestions as first-class challenge questions before adding narrower judge-only questions.',
  'Try to falsify the candidate before accepting it.',
  'Before deciding, write compact challengeQuestions that identify the specific assumptions, reachability facts, invariants, and changed-range claims you checked.',
  'For each decisive challenge, return a verificationChecks entry with kind, result passed/failed/unknown, summary, and copied evidenceIds.',
  'Return "valid" only when the provided context proves a concrete runtime, security, data-integrity, reliability, or maintainability defect introduced or materially exposed by the reviewed change.',
  'Return "false-positive" when the provided context contradicts the finding, the issue is speculative, the finding depends on invented outside context, or the finding is merely cleanup without a proved defect.',
  'Return "needs-more-evidence" when the candidate is plausible but the provided evidence is not enough to prove it.',
  'When returning "needs-more-evidence", include contextRequests for the smallest read/list/grep operations that could decide the verdict.',
  'Use contextRequests with tool read/list/grep, repository-relative path when applicable, query for grep, and a short reason. Use requestedContext only as a human-readable compatibility summary.',
  'Do not invent files, line numbers, evidence IDs, behavior, tests, or call paths.',
  'Use evidenceIds copied exactly from the provided evidence, proofPackets, or refutationResults when they support the verdict.',
  'Use summary to explain why the candidate is valid, false-positive, or under-proved without raw code blocks.',
  'Return a JSON object with verdict, summary, challengeQuestions, verificationChecks, evidenceIds, contextRequests, and optional requestedContext.'
].join('\n')

export const modelFindingAggregateInstructions = [
  'Act as a strict aggregate critic for the provided proof packets.',
  'Use only the provided reviewIntents, candidates, proofPackets, refutationResults, investigationTraces, evidence, sharedDigest, and provenance.',
  'Review candidates together by implementation intent, related paths, shared evidence, and repeated issue patterns.',
  'Prefer one compact decision per candidate over repeating full rationale.',
  'Return false-positive for candidates contradicted by another proof, duplicated by a stronger candidate, speculative across the batch, or only cleanup without proved impact.',
  'Return needs-more-evidence when a candidate may be real but the batch evidence is insufficient.',
  'Return valid only when the proof remains concrete after comparing it with related candidates and sibling changes.',
  'Use similarIssueChecks to summarize whether related changed code appears to have the same issue or whether no sibling pattern is proven.',
  'Copy evidenceIds only from provided evidence. Do not invent candidates, files, evidence IDs, or sibling issues.',
  'Return a JSON object with verdict, summary, decisions, similarIssueChecks, and evidenceIds.'
].join('\n')

export const modelSiblingSweepInstructions = [
  'Look only for sibling instances of already proved findings in the provided task packet.',
  'Use only the provided task, reviewedDiffRanges, evidence, candidates, proofPackets, modelSuspicions, investigationTraces, instructions, skills metadata, sharedDigest, and provenance.',
  'Return only suspicions that match the same concrete bug pattern as an existing proof but affect a different changed range or task path.',
  'Do not return duplicates of provided candidates or modelSuspicions.',
  'Do not invent files, line numbers, evidence IDs, behavior, tests, callers, or configuration.',
  'Use contextRequests only for the smallest bounded read/list/grep follow-up needed to prove the sibling.',
  'Use evidenceIds copied exactly from task evidence when available.',
  'Return a JSON object with a suspicions array. Return {"suspicions": []} when no sibling issue is supported.'
].join('\n')
