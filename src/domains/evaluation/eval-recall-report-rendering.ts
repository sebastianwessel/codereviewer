import { EvalReportSchema, type EvalReport } from './eval-report-contracts.js'
import { expectedLocationLabel } from './eval-report-expected-finding-labels.js'
import { escapeMarkdownCell } from './eval-report-markdown-formatting.js'

type LabeledEvalReport = {
  readonly label: string
  readonly report: EvalReport
}

type RecallRunState = {
  readonly matched: boolean | null
}

type RecallEntry = {
  readonly caseId: string
  readonly expected: EvalReport['caseResults'][number]['expectedFindings'][number]
  readonly runs: RecallRunState[]
}

const selectedCaseKey = (report: EvalReport): string =>
  report.selection.selectedCaseIds.join('\u0000')

const caseSetsMatch = (reports: readonly LabeledEvalReport[]): boolean => {
  if (reports.length <= 1) {
    return true
  }

  const firstKey = selectedCaseKey(reports[0]!.report)
  return reports.every(({ report }) => selectedCaseKey(report) === firstKey)
}

const collectRecallEntries = (
  reports: readonly LabeledEvalReport[]
): readonly RecallEntry[] => {
  const entries = new Map<string, RecallEntry>()

  for (let reportIndex = 0; reportIndex < reports.length; reportIndex += 1) {
    const { report } = reports[reportIndex]!
    for (const caseResult of report.caseResults) {
      const matchedExpectedIndexes = new Set(
        caseResult.matchedFindings.map((match) => match.expectedIndex)
      )

      for (const expected of caseResult.expectedFindings) {
        const key = `${caseResult.caseId}:${expected.expectedIndex}`
        const existing =
          entries.get(key) ??
          {
            caseId: caseResult.caseId,
            expected,
            runs: Array.from({ length: reports.length }, () => ({
              matched: null
            }))
          }

        const runs = [...existing.runs]
        runs[reportIndex] = {
          matched: matchedExpectedIndexes.has(expected.expectedIndex)
        }
        entries.set(key, {
          ...existing,
          runs
        })
      }
    }
  }

  return [...entries.values()].sort(
    (left, right) =>
      left.caseId.localeCompare(right.caseId) ||
      left.expected.expectedIndex - right.expected.expectedIndex
  )
}

const recallRate = (entry: RecallEntry): string => {
  const knownRuns = entry.runs.filter((run) => run.matched !== null)
  if (knownRuns.length === 0) {
    return '-'
  }

  return `${knownRuns.filter((run) => run.matched).length}/${knownRuns.length}`
}

const recallRunMarks = (entry: RecallEntry): string =>
  entry.runs
    .map((run) => {
      if (run.matched === null) {
        return '-'
      }

      return run.matched ? 'Y' : 'N'
    })
    .join(' ')

const recallSummary = (
  entries: readonly RecallEntry[]
): {
  readonly alwaysDetected: number
  readonly neverDetected: number
  readonly flaky: number
} => {
  let alwaysDetected = 0
  let neverDetected = 0
  let flaky = 0

  for (const entry of entries) {
    const knownRuns = entry.runs.filter((run) => run.matched !== null)
    if (knownRuns.length === 0) {
      continue
    }

    const matchedCount = knownRuns.filter((run) => run.matched).length
    if (matchedCount === knownRuns.length) {
      alwaysDetected += 1
    } else if (matchedCount === 0) {
      neverDetected += 1
    } else {
      flaky += 1
    }
  }

  return {
    alwaysDetected,
    neverDetected,
    flaky
  }
}

const appendEvalRecallReportHeader = (
  lines: string[],
  input: {
    readonly reports: readonly LabeledEvalReport[]
  }
): void => {
  lines.push('# Evaluation Recall Report')
  lines.push('')
  lines.push(`Reports: ${input.reports.length}`)
  lines.push(`Case set: ${caseSetsMatch(input.reports) ? 'same' : 'different'}`)
  lines.push('')
}

const appendEvalRecallReportRuns = (
  lines: string[],
  reports: readonly LabeledEvalReport[]
): void => {
  lines.push('## Runs')
  lines.push('')
  lines.push('| # | Label | Generated | Fixtures |')
  lines.push('| ---: | --- | --- | ---: |')
  reports.forEach(({ label, report }, index) => {
    lines.push(
      `| ${index + 1} | ${escapeMarkdownCell(label)} | ${report.generatedAt} | ${report.fixtureCount} |`
    )
  })
  lines.push('')
}

const appendEvalRecallReportSummary = (
  lines: string[],
  input: {
    readonly entries: readonly RecallEntry[]
    readonly summary: ReturnType<typeof recallSummary>
  }
): void => {
  lines.push('## Summary')
  lines.push('')
  lines.push('| Expected findings | Always detected | Never detected | Flaky |')
  lines.push('| ---: | ---: | ---: | ---: |')
  lines.push(
    `| ${input.entries.length} | ${input.summary.alwaysDetected} | ${input.summary.neverDetected} | ${input.summary.flaky} |`
  )
  lines.push('')
}

const formatEvalRecallExpectedFindingRow = (entry: RecallEntry): string =>
  `| ${escapeMarkdownCell(entry.caseId)} | ${entry.expected.expectedIndex} | ${entry.expected.severity} | ${escapeMarkdownCell(expectedLocationLabel(entry.expected))} | ${entry.expected.matchMode} | ${escapeMarkdownCell(entry.expected.semanticSummary)} | ${recallRate(entry)} | ${recallRunMarks(entry)} |`

const appendEvalRecallReportExpectedFindings = (
  lines: string[],
  entries: readonly RecallEntry[]
): void => {
  lines.push('## Expected Findings')
  lines.push('')
  lines.push('| Case | # | Sev | Location | Mode | Summary | Rate | Runs |')
  lines.push('| --- | ---: | --- | --- | --- | --- | ---: | --- |')
  for (const entry of entries) {
    lines.push(formatEvalRecallExpectedFindingRow(entry))
  }
  lines.push('')
}

export const renderEvalRecallReport = (
  input: {
    readonly reports: readonly LabeledEvalReport[]
  }
): string => {
  const reports = input.reports.map(({ label, report }) => ({
    label,
    report: EvalReportSchema.parse(report)
  }))
  const entries = collectRecallEntries(reports)
  const summary = recallSummary(entries)
  const lines: string[] = []

  appendEvalRecallReportHeader(lines, { reports })
  appendEvalRecallReportRuns(lines, reports)
  appendEvalRecallReportSummary(lines, { entries, summary })
  appendEvalRecallReportExpectedFindings(lines, entries)

  return lines.join('\n')
}
