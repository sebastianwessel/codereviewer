export type EvalCaseStatusInput = {
  readonly providerErrored: boolean
  readonly parseValid: boolean
  readonly unmatchedExpectedIndexes: readonly unknown[]
  readonly falsePositiveFindingIds: readonly unknown[]
  readonly noFindingZoneFalsePositiveIds: readonly unknown[]
}

export type EvalProviderIssueLabelInput = {
  readonly providerIssues: readonly {
    readonly code: string
    readonly recovered: boolean
    readonly message?: string | undefined
    readonly stage?: string | undefined
  }[]
}

export type EvalAgenticStageLabelInput = {
  readonly agenticStages?:
    | readonly {
        readonly count: number
        readonly stage: string
        readonly status: string
      }[]
    | undefined
}

export type EvalContextLedgerLabelInput = {
  readonly contextLedger: readonly {
    readonly consideredForModelContext: boolean
    readonly kind: string
    readonly truncated: boolean
  }[]
}

export type EvalCaseNoteInput = EvalProviderIssueLabelInput & {
  readonly artifactOnlyFalsePositiveFindingIds: readonly unknown[]
  readonly artifactOnlyMatchedFindings: readonly unknown[]
  readonly duplicateFindingIds: readonly unknown[]
  readonly falsePositiveFindingIds: readonly unknown[]
  readonly noFindingZoneFalsePositiveIds: readonly unknown[]
  readonly providerErrored: boolean
  readonly unmatchedExpectedIndexes: readonly unknown[]
  readonly warnings: readonly string[]
}

export const caseStatus = (
  caseResult: EvalCaseStatusInput
): 'PASS' | 'FAIL' | 'ERROR' => {
  if (caseResult.providerErrored || !caseResult.parseValid) {
    return 'ERROR'
  }

  return caseResult.unmatchedExpectedIndexes.length === 0 &&
    caseResult.falsePositiveFindingIds.length === 0 &&
    caseResult.noFindingZoneFalsePositiveIds.length === 0
    ? 'PASS'
    : 'FAIL'
}

export const humanActionableWarnings = (
  warnings: readonly string[]
): readonly string[] =>
  warnings.filter((warning) => warning !== 'config-file-missing')

export const providerIssueLabel = (
  caseResult: EvalProviderIssueLabelInput
): string => {
  if (caseResult.providerIssues.length === 0) {
    return '-'
  }

  return caseResult.providerIssues
    .map((issue) => {
      const stage = issue.stage === undefined ? '' : `@${issue.stage}`
      const message =
        issue.message === undefined || issue.message.trim().length === 0
          ? ''
          : ` - ${issue.message.trim()}`
      return `${issue.recovered ? 'recovered' : 'error'}:${issue.code}${stage}${message}`
    })
    .join(', ')
}

export const agenticStageLabel = (
  caseResult: EvalAgenticStageLabelInput,
  stage: string
): string => {
  const entry = (caseResult.agenticStages ?? []).find(
    (item) => item.stage === stage
  )

  return entry === undefined ? '-' : `${entry.status} ${entry.count}`
}

export const contextLedgerKindLabel = (
  caseResult: EvalContextLedgerLabelInput
): string => {
  const counts = new Map<string, number>()

  for (const entry of caseResult.contextLedger) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1)
  }

  return counts.size === 0
    ? '-'
    : [...counts.entries()]
        .map(([kind, count]) => `${kind}: ${count}`)
        .join(', ')
}

export const contextLedgerConsideredCount = (
  caseResult: EvalContextLedgerLabelInput
): number =>
  caseResult.contextLedger.filter((entry) => entry.consideredForModelContext)
    .length

export const contextLedgerTruncatedCount = (
  caseResult: EvalContextLedgerLabelInput
): number => caseResult.contextLedger.filter((entry) => entry.truncated).length

export const noteForCase = (caseResult: EvalCaseNoteInput): string => {
  const notes: string[] = []
  const warnings = humanActionableWarnings(caseResult.warnings)

  if (caseResult.providerErrored) {
    notes.push('provider error')
  }

  if (!caseResult.providerErrored && caseResult.providerIssues.length > 0) {
    notes.push(`provider recovered ${caseResult.providerIssues.length}`)
  }

  if (caseResult.unmatchedExpectedIndexes.length > 0) {
    notes.push(`missing ${caseResult.unmatchedExpectedIndexes.length}`)
  }

  if (caseResult.falsePositiveFindingIds.length > 0) {
    notes.push(`false positives ${caseResult.falsePositiveFindingIds.length}`)
  }

  if (caseResult.duplicateFindingIds.length > 0) {
    notes.push(`duplicates ${caseResult.duplicateFindingIds.length}`)
  }

  if (caseResult.noFindingZoneFalsePositiveIds.length > 0) {
    notes.push(
      `no-finding-zone hits ${caseResult.noFindingZoneFalsePositiveIds.length}`
    )
  }

  if (caseResult.artifactOnlyMatchedFindings.length > 0) {
    notes.push(`artifact-only matched ${caseResult.artifactOnlyMatchedFindings.length}`)
  }

  if (caseResult.artifactOnlyFalsePositiveFindingIds.length > 0) {
    notes.push(
      `artifact-only noise ${caseResult.artifactOnlyFalsePositiveFindingIds.length}`
    )
  }

  if (warnings.length > 0) {
    notes.push(`warnings ${warnings.length}`)
  }

  return notes.length === 0 ? '-' : notes.join('; ')
}
