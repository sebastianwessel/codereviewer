import type { z } from 'zod'
import type {
  AdmittedFinding,
  ReviewReport
} from '../../../shared/contracts/index.js'
import {
  artifactOnlyPlausibilityFailClosedWarnings,
  inconclusiveMatchWarnings,
  plausibilityFailClosedWarnings
} from '../eval-warnings.js'
import {
  resolveExpectedFindingMatchMode,
  type EvalCase
} from '../corpus/eval-fixture.schema.js'
import {
  LINE_TOLERANCE,
  matchEvalFindings,
  rangesOverlap,
  type EvalMatcherResult,
  type EvalSemanticJudge
} from '../judging/eval-matcher.js'
import {
  judgeUnmatchedFindingsPlausibility,
  type EvalCaseFileReader,
  type EvalPlausibilityJudge,
  type EvalPlausibilityResult
} from '../judging/eval-plausibility-judge.js'
import {
  severityWeight,
  type EvalMetricCaseResult
} from '../scoring/metrics.js'
import { securityFindingMechanismCountsForCase } from '../scoring/security-mechanism-attribution.js'
import {
  type EvalCaseReportSchema,
  EvalProviderIssueReportSchema,
  type EvalCaseOutput
} from '../report/eval-report-contracts.js'
import {
  actionableFindingsForEval,
  agenticStagesForProviderError,
  agenticStagesForReport,
  artifactOnlyFindingsForEval,
  caseSpend,
  diffScopeCountsForCase,
  expectedFindingSummaries,
  findingSummaries,
  hasActionableDetail,
  isKnownProviderErrorStage,
  fixLaneCaseTallies,
  judgeProviderIssuesFromMatchResults,
  providerIssuesFromReport,
  refutationResultSummaries,
  rejectionSeverityTallies,
  securityCountsForCase,
  spendReportFields,
  tierCountsForCase
} from './eval-case-tallies.js'

export type EvalCaseComputation = {
  readonly reportCase: z.infer<typeof EvalCaseReportSchema>
  readonly metricCase: EvalMetricCaseResult
}

const buildMetricCase = (
  input: {
    readonly evalCase: EvalCase
    readonly output: EvalCaseOutput
    readonly matchResult: EvalMatcherResult
    readonly artifactOnlyMatchResult: EvalMatcherResult
    // Plausibility outcomes for the case's raw false-positive findings. Absent on
    // a provider-error case (no findings to judge), where it defaults to empty.
    readonly plausibility?: EvalPlausibilityResult
    // The SEPARATE plausibility outcomes for the artifact-only population. It is
    // a distinct field rather than a merge because nothing below may read the two
    // together: every precision-bearing metric here reads `plausibility` alone,
    // and this one may only ever reach the two artifact-only counts.
    readonly artifactOnlyPlausibility?: EvalPlausibilityResult
    readonly reviewReport?: ReviewReport
  }
): EvalMetricCaseResult => {
  const judgeProviderIssueCount =
    (input.matchResult.judgeProviderIssues?.length ?? 0) +
    (input.artifactOnlyMatchResult.judgeProviderIssues?.length ?? 0)
  const admittedFindings = input.reviewReport?.admittedFindings ?? []
  const actionableFindings = actionableFindingsForEval(admittedFindings)
  const artifactOnlyFindings = artifactOnlyFindingsForEval(admittedFindings)
  const matchedExpectedSeverityWeights = input.matchResult.matches.map((match) =>
    severityWeight(input.evalCase.expectedFindings[match.expectedIndex]!.severity)
  )
  // Only a path-line expectation can ever satisfy the line check: the matcher
  // records lineOverlaps as false for every other match mode by construction.
  // Counting a path-semantic expectation here put it in the denominator while
  // making the numerator unreachable, so a corpus matched semantically reported a
  // guaranteed 0.0% -- a metric that cannot pass, displayed as one that failed.
  // An explicit path-line that declares no lineRange is excluded too: it asserts
  // no line, and lineRulePasses would credit it unconditionally. Both sides of
  // the ratio come from this one set, so they cannot drift apart again.
  const lineCheckedMatches = input.matchResult.matches.filter((match) => {
    const expected = input.evalCase.expectedFindings[match.expectedIndex]

    return (
      expected?.lineRange !== undefined &&
      resolveExpectedFindingMatchMode(expected) === 'path-line'
    )
  })
  // DIAGNOSTIC ONLY (spec 06 item 0.3): every matched expectation that declares
  // a lineRange, regardless of match mode, unlike `lineCheckedMatches` above
  // which stays gated to `path-line` for the strict `lineAccuracy` metric. This
  // is what finally makes line placement measurable on `path-semantic`
  // expectations -- the entire primary real-repository corpus. The deterministic
  // gate in the matcher already required an exact path match before either
  // match mode could reach the judge, so re-checking path here would be inert;
  // only the produced start line is compared against the declared range, with
  // the SAME tolerance `lineAccuracy` uses, imported from the matcher so the
  // two definitions cannot silently drift apart.
  const linePlacementCheckedMatches = input.matchResult.matches.filter(
    (match) =>
      input.evalCase.expectedFindings[match.expectedIndex]?.lineRange !==
      undefined
  )
  const accurateLinePlacementMatches = linePlacementCheckedMatches.filter(
    (match) => {
      const expectedLineRange =
        input.evalCase.expectedFindings[match.expectedIndex]!.lineRange!

      return rangesOverlap(
        expectedLineRange,
        [match.producedStartLine, match.producedStartLine],
        LINE_TOLERANCE
      )
    }
  )
  const falsePositiveFindingIdSet = new Set(
    input.matchResult.falsePositiveFindingIds
  )
  const falsePositiveFindings = admittedFindings.filter((finding) =>
    falsePositiveFindingIdSet.has(finding.id)
  )
  const warnings = input.reviewReport?.run.warnings ?? []
  const providerIssues =
    input.reviewReport === undefined ? [] : providerIssuesFromReport(input.reviewReport)
  const contextLedgerEntries = input.output.contextLedger.filter(
    (entry) => entry.consideredForModelContext
  )
  const refutationResults = input.reviewReport?.refutationResults ?? []
  const rejectedFindings = input.reviewReport?.rejectedFindings ?? []

  return {
    caseId: input.evalCase.id,
    parseValid: input.reviewReport !== undefined,
    providerErrored: input.output.result.status === 'provider-error',
    providerIssueCount:
      input.output.result.status === 'provider-error'
        ? 1
        : providerIssues.length + judgeProviderIssueCount,
    // Recall denominator: declared expectations minus the ones the judge could
    // not decide. An inconclusive expectation must never be scored as missed.
    expectedFindingCount:
      input.evalCase.expectedFindings.length -
      input.matchResult.inconclusiveExpectedIndexes.length,
    inconclusiveMatchCount:
      input.matchResult.inconclusiveMatches.length +
      input.artifactOnlyMatchResult.inconclusiveMatches.length,
    admittedFindingCount: actionableFindings.length,
    matchedFindingCount: input.matchResult.matches.length,
    expectedSeverityWeights: input.evalCase.expectedFindings
      .filter(
        (_expected, expectedIndex) =>
          !input.matchResult.inconclusiveExpectedIndexes.includes(expectedIndex)
      )
      .map((expected) => severityWeight(expected.severity)),
    matchedExpectedSeverityWeights,
    falsePositiveSeverityWeights: falsePositiveFindings.map((finding) =>
      severityWeight(finding.severity)
    ),
    matchedLineCheckCount: lineCheckedMatches.length,
    accurateLineMatchCount: lineCheckedMatches.filter(
      (match) => match.lineOverlaps
    ).length,
    linePlacementCheckCount: linePlacementCheckedMatches.length,
    accurateLinePlacementCount: accurateLinePlacementMatches.length,
    matchedSeverityCheckCount: input.matchResult.matches.length,
    accurateSeverityMatchCount: input.matchResult.matches.filter(
      (match) => match.severityMatches
    ).length,
    actionableFindingCount:
      input.reviewReport === undefined
        ? 0
        : actionableFindings.filter((finding) =>
            hasActionableDetail(finding, input.reviewReport!)
          ).length,
    falsePositiveCount: input.matchResult.falsePositiveFindingIds.length,
    unlistedRealFindingCount:
      input.plausibility?.unlistedRealFindingIds.length ?? 0,
    duplicateFindingCount: input.matchResult.duplicateFindingIds.length,
    artifactOnlyFindingCount: artifactOnlyFindings.length,
    artifactOnlyMatchedFindingCount:
      input.artifactOnlyMatchResult.matches.length,
    artifactOnlyFalsePositiveCount:
      input.artifactOnlyMatchResult.falsePositiveFindingIds.length,
    artifactOnlyUnlistedRealCount:
      input.artifactOnlyPlausibility?.unlistedRealFindingIds.length ?? 0,
    // The complement, so a fail-closed artifact-only verdict is noise by
    // construction -- the same rule the actionable split follows.
    artifactOnlyGenuineFalsePositiveCount:
      input.artifactOnlyMatchResult.falsePositiveFindingIds.length -
      (input.artifactOnlyPlausibility?.unlistedRealFindingIds.length ?? 0),
    provedRefutationCount: refutationResults.filter(
      (refutation) => refutation.verdict === 'proved'
    ).length,
    rejectedFindingCount: rejectedFindings.length,
    // Why candidates were dropped, tallied by reason. Without this an archived run
    // cannot answer whether the admission gate discarded a candidate before anyone
    // could observe it -- a question that came up when the severity floor was
    // suspected of hiding low-severity findings, and which no stored artifact
    // could settle in either direction.
    rejectionReasonCounts: rejectedFindings.reduce<Record<string, number>>(
      (counts, rejected) => ({
        ...counts,
        [rejected.reason]: (counts[rejected.reason] ?? 0) + 1
      }),
      {}
    ),
    ...rejectionSeverityTallies(rejectedFindings),
    ...fixLaneCaseTallies({
      fixOutcomes: input.output.fixOutcomes,
      matchResult: input.matchResult,
      unlistedRealFindingIds: input.plausibility?.unlistedRealFindingIds ?? []
    }),
    tierCounts: tierCountsForCase(input.evalCase, input.matchResult),
    diffScopeCounts: diffScopeCountsForCase(input.evalCase, input.matchResult),
    ...securityCountsForCase(input.evalCase, input.matchResult),
    // Per-mechanism PRECISION counts (spec 15). Unlike the recall counts above,
    // this population is the admitted findings, so it needs the review's own
    // findings and the plausibility verdict that separates a genuine false
    // positive from a real defect the fixture omitted.
    securityFindingMechanismCounts: securityFindingMechanismCountsForCase({
      admittedFindings,
      expectedFindings: input.evalCase.expectedFindings,
      matches: input.matchResult.matches,
      genuineFalsePositiveFindingIds:
        input.matchResult.falsePositiveFindingIds.filter(
          (findingId) =>
            !(input.plausibility?.unlistedRealFindingIds ?? []).includes(
              findingId
            )
        )
    }),
    noFindingZoneFalsePositiveCount:
      input.matchResult.noFindingZoneFalsePositiveIds.length,
    changedLineCount: input.output.changedLineCount,
    diffHunkCount: input.output.diffHunkCount,
    coverageIncomplete: input.reviewReport?.coverage.status === 'incomplete',
    contextLedgerEntryCount: contextLedgerEntries.length,
    mutatedContextLedgerEntryCount: contextLedgerEntries.filter(
      (entry) => entry.truncated
    ).length,
    ...caseSpend(input.reviewReport),
    warnings,
    failingFindingIds: input.matchResult.falsePositiveFindingIds
  }
}

// Assemble the per-case eval report entry.
const buildReportCase = (
  input: {
    readonly evalCase: EvalCase
    readonly output: EvalCaseOutput
    readonly reviewReport: ReviewReport
    readonly actionableFindings: readonly AdmittedFinding[]
    readonly artifactOnlyFindings: readonly AdmittedFinding[]
    readonly inlineFindingCount: number
    readonly matchResult: EvalMatcherResult
    readonly artifactOnlyMatchResult: EvalMatcherResult
    readonly plausibility: EvalPlausibilityResult
    readonly artifactOnlyPlausibility: EvalPlausibilityResult
    readonly providerIssues: readonly z.infer<
      typeof EvalProviderIssueReportSchema
    >[]
  }
): z.infer<typeof EvalCaseReportSchema> => ({
  caseId: input.evalCase.id,
  parseValid: true,
  providerErrored: false,
  contextLedger: [...input.output.contextLedger],
  agenticStages: [
    ...agenticStagesForReport(input.reviewReport, input.output.fixOutcomes.length)
  ],
  // Spec 27: carried through verbatim so a comparison script can read what
  // DISCOVERY produced next to what survived, per case. Without it a null result on
  // a discovery-targeting change is uninterpretable — "the reviewer did not look at
  // more" and "it did, and refutation or admission removed the difference" produce
  // the same recall.
  ...(input.reviewReport.discovery === undefined
    ? {}
    : { discovery: input.reviewReport.discovery }),
  fixOutcomes: [...input.output.fixOutcomes],
  // Both populations in one array, in one shape: the actionable findings that
  // could be posted and the artifact-only ones that could not. Recording them
  // together is what lets an analysis compare a finding that matched against one
  // that did not without re-running the case.
  producedFindings: [
    ...findingSummaries(input.actionableFindings),
    ...findingSummaries(input.artifactOnlyFindings)
  ],
  expectedFindings: [...expectedFindingSummaries(input.evalCase)],
  matchedFindings: [...input.matchResult.matches],
  unmatchedExpectedIndexes: [...input.matchResult.unmatchedExpectedIndexes],
  inconclusiveExpectedIndexes: [
    ...input.matchResult.inconclusiveExpectedIndexes
  ],
  inconclusiveFindingIds: [
    ...input.matchResult.inconclusiveFindingIds,
    ...input.artifactOnlyMatchResult.inconclusiveFindingIds
  ],
  inconclusiveMatches: [
    ...input.matchResult.inconclusiveMatches,
    ...input.artifactOnlyMatchResult.inconclusiveMatches
  ],
  duplicateFindingIds: [...input.matchResult.duplicateFindingIds],
  falsePositiveFindingIds: [...input.matchResult.falsePositiveFindingIds],
  unlistedRealFindingIds: [...input.plausibility.unlistedRealFindingIds],
  genuineFalsePositiveFindingIds: input.matchResult.falsePositiveFindingIds.filter(
    (findingId) => !input.plausibility.unlistedRealFindingIds.includes(findingId)
  ),
  noFindingZoneFalsePositiveIds: [
    ...input.matchResult.noFindingZoneFalsePositiveIds
  ],
  artifactOnlyFindingIds: input.artifactOnlyFindings.map((finding) => finding.id),
  artifactOnlyMatchedFindings: [...input.artifactOnlyMatchResult.matches],
  artifactOnlyFalsePositiveFindingIds: [
    ...input.artifactOnlyMatchResult.falsePositiveFindingIds
  ],
  artifactOnlyUnlistedRealFindingIds: [
    ...input.artifactOnlyPlausibility.unlistedRealFindingIds
  ],
  artifactOnlyGenuineFalsePositiveFindingIds:
    input.artifactOnlyMatchResult.falsePositiveFindingIds.filter(
      (findingId) =>
        !input.artifactOnlyPlausibility.unlistedRealFindingIds.includes(findingId)
    ),
  refutationResults: [...refutationResultSummaries(input.reviewReport)],
  inlineFindingCount: input.inlineFindingCount,
  providerIssues: [...input.providerIssues],
  warnings: [
    ...input.reviewReport.run.warnings,
    ...inconclusiveMatchWarnings(
      input.matchResult.inconclusiveMatches.length +
        input.artifactOnlyMatchResult.inconclusiveMatches.length
    ),
    ...plausibilityFailClosedWarnings(input.plausibility.failClosedFindingIds.length),
    ...artifactOnlyPlausibilityFailClosedWarnings(
      input.artifactOnlyPlausibility.failClosedFindingIds.length
    )
  ],
  ...spendReportFields(caseSpend(input.reviewReport))
})

// One case-computation path. The semantic judge is optional only because a case
// without expected findings needs no judge; a case with expected findings and no
// judge fails loudly inside the matcher.
export const computeCaseResult = async (
  input: {
    readonly evalCase: EvalCase
    readonly output: EvalCaseOutput
    readonly judge: EvalSemanticJudge | undefined
    // Independent plausibility judge and source reader. Both optional: an offline
    // run has neither, and every unmatched finding then stays a genuine false
    // positive (adjustedPrecision equals precision).
    readonly plausibilityJudge: EvalPlausibilityJudge | undefined
    readonly readFindingSource: EvalCaseFileReader | undefined
  }
): Promise<EvalCaseComputation> => {
  const { evalCase, output, judge } = input

  if (output.result.status === 'provider-error') {
    const matchResult: EvalMatcherResult = {
      matches: [],
      unmatchedExpectedIndexes: evalCase.expectedFindings.map(
        (_finding, index) => index
      ),
      inconclusiveExpectedIndexes: [],
      inconclusiveFindingIds: [],
      inconclusiveMatches: [],
      duplicateFindingIds: [],
      falsePositiveFindingIds: [],
      noFindingZoneFalsePositiveIds: []
    }

    return {
      reportCase: {
        caseId: evalCase.id,
        parseValid: false,
        providerErrored: true,
        providerIssues: [
          {
            code: output.result.code,
            ...(isKnownProviderErrorStage(output.result.stage)
              ? { stage: output.result.stage }
              : {}),
            recovered: false,
            message: output.result.message
          }
        ],
        agenticStages: [
          ...agenticStagesForProviderError(output.result.stage)
        ],
        fixOutcomes: [],
        contextLedger: [...output.contextLedger],
        producedFindings: [],
        expectedFindings: [...expectedFindingSummaries(evalCase)],
        matchedFindings: [],
        unmatchedExpectedIndexes: [...matchResult.unmatchedExpectedIndexes],
        inconclusiveExpectedIndexes: [],
        inconclusiveFindingIds: [],
        inconclusiveMatches: [],
        duplicateFindingIds: [],
        falsePositiveFindingIds: [],
        unlistedRealFindingIds: [],
        genuineFalsePositiveFindingIds: [],
        noFindingZoneFalsePositiveIds: [],
        artifactOnlyFindingIds: [],
        artifactOnlyMatchedFindings: [],
        artifactOnlyFalsePositiveFindingIds: [],
        artifactOnlyUnlistedRealFindingIds: [],
        artifactOnlyGenuineFalsePositiveFindingIds: [],
        refutationResults: [],
        inlineFindingCount: 0,
        warnings: [],
        // No review report exists, so cost, token usage and duration were never
        // measured. They are omitted, not zeroed, and the case is counted as
        // cost- and usage-unavailable in the run's totals.
        ...spendReportFields(caseSpend(undefined))
      },
      metricCase: buildMetricCase({
        evalCase,
        output,
        matchResult,
        artifactOnlyMatchResult: matchResult
      })
    }
  }

  const reviewReport = output.result.reviewReport
  const actionableFindings = actionableFindingsForEval(
    reviewReport.admittedFindings
  )
  const artifactOnlyFindings = artifactOnlyFindingsForEval(
    reviewReport.admittedFindings
  )
  const inlineFindingCount = reviewReport.admittedFindings.filter(
    (finding) => finding.reporterEligibility === 'inline'
  ).length
  const matchResult = await matchEvalFindings({
    evalCase,
    admittedFindings: actionableFindings,
    ...(judge === undefined ? {} : { judge })
  })
  const artifactOnlyMatchResult = await matchEvalFindings({
    evalCase,
    admittedFindings: artifactOnlyFindings,
    ...(judge === undefined ? {} : { judge })
  })

  // Reclassify the raw false positives (unmatched actionable findings only) with
  // the independent plausibility judge. This never touches recall or what the
  // reviewer reported; it only splits the raw false positives into genuine false
  // positives and real-but-unlisted defects for adjustedPrecision.
  const falsePositiveFindingIdSet = new Set(matchResult.falsePositiveFindingIds)
  const matchedFindingIdSet = new Set(
    matchResult.matches.map((match) => match.findingId)
  )
  // The findings already matched to an expected finding in this case, passed so
  // the plausibility judge can recognise when an unmatched finding merely
  // restates one of them at a different line instead of confirming a further,
  // distinct defect. See judgeUnmatchedFindingsPlausibility's module comment.
  const matchedFindingsForPlausibility = actionableFindings.filter((finding) =>
    matchedFindingIdSet.has(finding.id)
  )
  const plausibility = await judgeUnmatchedFindingsPlausibility({
    evalCase,
    unmatchedFindings: actionableFindings.filter((finding) =>
      falsePositiveFindingIdSet.has(finding.id)
    ),
    matchedFindings: matchedFindingsForPlausibility,
    judge: input.plausibilityJudge,
    readFileContent: input.readFindingSource
  })

  // The SAME split over the artifact-only population, in its own pass and its own
  // bucket. Before this, an artifact-only finding that matched nothing carried no
  // real/noise label at all -- and because the eval never stored what would be
  // needed to decide one later, the only way to ask was to re-run the corpus.
  //
  // It is a second pass rather than a wider first one because the two populations
  // must not be pooled: the already-counted pool seeds from the artifact-only
  // MATCHES, so a restatement is judged against the population it belongs to, and
  // the verdicts reach only the artifact-only fields. Nothing here may move
  // `adjustedPrecision`, which excludes artifact-only findings by construction --
  // promoting them into it is a precision decision nobody has made.
  const artifactOnlyFalsePositiveFindingIdSet = new Set(
    artifactOnlyMatchResult.falsePositiveFindingIds
  )
  const artifactOnlyMatchedFindingIdSet = new Set(
    artifactOnlyMatchResult.matches.map((match) => match.findingId)
  )
  const artifactOnlyPlausibility = await judgeUnmatchedFindingsPlausibility({
    evalCase,
    unmatchedFindings: artifactOnlyFindings.filter((finding) =>
      artifactOnlyFalsePositiveFindingIdSet.has(finding.id)
    ),
    matchedFindings: artifactOnlyFindings.filter((finding) =>
      artifactOnlyMatchedFindingIdSet.has(finding.id)
    ),
    judge: input.plausibilityJudge,
    readFileContent: input.readFindingSource
  })

  return {
    reportCase: buildReportCase({
      evalCase,
      output,
      reviewReport,
      actionableFindings,
      artifactOnlyFindings,
      inlineFindingCount,
      matchResult,
      artifactOnlyMatchResult,
      plausibility,
      artifactOnlyPlausibility,
      providerIssues: [
        ...providerIssuesFromReport(reviewReport),
        ...judgeProviderIssuesFromMatchResults([
          matchResult,
          artifactOnlyMatchResult
        ]),
        ...[
          ...plausibility.providerIssues,
          ...artifactOnlyPlausibility.providerIssues
        ].map((issue) =>
          EvalProviderIssueReportSchema.parse({
            code: issue.code,
            stage: issue.stage,
            recovered: issue.recovered,
            ...(issue.message === undefined ? {} : { message: issue.message })
          })
        )
      ]
    }),
    metricCase: buildMetricCase({
      evalCase,
      output,
      matchResult,
      artifactOnlyMatchResult,
      plausibility,
      artifactOnlyPlausibility,
      reviewReport
    })
  }
}
