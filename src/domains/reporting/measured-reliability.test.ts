import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
// The pull-request comment is the SECOND renderer of these rates. This test
// reaches across into `scripts/github/` on purpose: the defect it guards against
// is precisely a figure updated in one renderer and missed in the other, so a
// guard that could only see one of them would be the same defect wearing a test's
// clothes.
import { reviewReportFixture } from '../../../scripts/github/fixtures.js'
import { digestReviewReport } from '../../../scripts/github/report-digest.js'
import {
  renderSummaryComment,
  type SummaryCommentInput
} from '../../../scripts/github/summary-comment.js'
import {
  adjustedPrecisionInTwenty,
  NOTHING_PROVED,
  inDiffRecallInTen,
  measuredReliability,
  MEASURED_ON_MODEL,
  MEASURED_ON_PROVIDER
} from './measured-reliability.js'
import { renderMarkdownReport } from './markdown-reporter.js'
import { createReportFixture } from '../../shared/testing/report-fixture.js'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
)

const summaryComment = (
  overrides: Partial<SummaryCommentInput> = {}
): string =>
  renderSummaryComment({
    markerKey: 'default',
    outcomes: [],
    headSha: 'abc123',
    notes: [],
    ...overrides
  })

const emptyReviewDigest = (): NonNullable<SummaryCommentInput['review']> => {
  const digest = digestReviewReport(
    JSON.stringify({ ...reviewReportFixture, admittedFindings: [] })
  )

  // An undigestible fixture would otherwise render a comment with no findings
  // SECTION at all, and the assertions below would fail with a confusing message
  // instead of naming the real cause.
  expect(digest, 'the review fixture no longer digests').toBeDefined()

  return digest as NonNullable<typeof digest>
}

const readLedgerEntry = async (): Promise<string> => {
  const ledger = await readFile(
    path.join(repositoryRoot, 'reports', 'eval-results-ledger.md'),
    'utf8'
  )
  const heading = `## ${measuredReliability.ledgerEntryDate} —`
  const start = ledger.indexOf(heading)

  // A missing entry must fail loudly. Returning "" would let every `toContain`
  // below fail with an unreadable diff, and an `includes` style check would let it
  // pass vacuously — the exact shape of defect this file exists to prevent.
  expect(start, `No ledger entry headed "${heading}"`).toBeGreaterThanOrEqual(0)

  const rest = ledger.slice(start + heading.length)
  const end = rest.indexOf('\n## ')

  return end === -1 ? rest : rest.slice(0, end)
}

const tableCells = (row: string): readonly string[] =>
  row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())

/** The cells of the row whose first column is `label`, in the entry's table. */
const rowFor = (entry: string, label: string): readonly string[] => {
  const row = entry
    .split('\n')
    .find((line) => tableCells(line)[0] === label)

  expect(row, `No table row labelled "${label}" in the ledger entry`).toBeDefined()

  return tableCells(row as string)
}

/**
 * The index of the column holding the run this repository quotes.
 *
 * Read from the header rather than hard-coded, because the ledger's table is a
 * comparison: the quoted run is one column of it, and which column it is moves.
 */
const quotedColumn = (entry: string): number => {
  const header = rowFor(entry, 'metric')
  const index = header.findIndex((cell) =>
    cell.includes(measuredReliability.engine)
  )

  expect(
    index,
    `No column for engine ${measuredReliability.engine} in the ledger entry`
  ).toBeGreaterThan(0)

  return index
}

const cellNumbers = (cell: string, pattern: RegExp): readonly number[] => {
  const match = pattern.exec(cell)

  expect(match, `"${cell}" does not match ${String(pattern)}`).not.toBeNull()

  return (match as RegExpExecArray).slice(1).map(Number)
}

// THE GUARD THIS FILE EXISTS FOR.
//
// Two surfaces publish these rates — the review report and the pull-request
// comment — and a re-baseline once updated the first and left the second quoting
// a superseded figure, with the second's own test pinning it there. Both surfaces
// are rendered below and checked against the same ledger entry, so a re-baseline
// that touches one and misses the other cannot reach green.
describe('published reliability figures', () => {
  test('every figure is the one the cited ledger entry records', async () => {
    const entry = await readLedgerEntry()
    const column = quotedColumn(entry)
    const [recall, standardDeviation] = cellNumbers(
      rowFor(entry, 'in-diff recall')[column] as string,
      /\*\*([\d.]+)%\*\*, sd ([\d.]+)pp/u
    )
    const [outOfDiffFound, outOfDiffTotal] = cellNumbers(
      rowFor(entry, 'out-of-diff recall')[column] as string,
      /\*\*(\d+) of (\d+)\*\*/u
    )
    const [adjustedPrecision] = cellNumbers(
      rowFor(entry, 'adjusted precision')[column] as string,
      /([\d.]+)%\s*$/u
    )

    expect(measuredReliability.inDiffRecallPercent).toBe(recall)
    expect(measuredReliability.inDiffRecallStandardDeviationPp).toBe(
      standardDeviation
    )
    expect(measuredReliability.outOfDiffRecallFound).toBe(outOfDiffFound)
    expect(measuredReliability.outOfDiffRecallTotal).toBe(outOfDiffTotal)
    expect(measuredReliability.adjustedPrecisionPercent).toBe(adjustedPrecision)
    // The corpus, the run count and the model are part of the claim: a rate
    // without them describes nothing a reader can check.
    expect(entry).toContain(`${measuredReliability.corpusCaseCount}-case`)
    expect(entry.toLowerCase()).toContain(
      `${['zero', 'one', 'two', 'three'][measuredReliability.runCount]} runs`
    )
    expect(entry).toContain(`${MEASURED_ON_PROVIDER}/${MEASURED_ON_MODEL}`)
  })

  test('both renderers publish the rate the ledger records, not one of them', async () => {
    const entry = await readLedgerEntry()
    const column = quotedColumn(entry)
    const [recall] = cellNumbers(
      rowFor(entry, 'in-diff recall')[column] as string,
      /\*\*([\d.]+)%\*\*/u
    )
    const [adjustedPrecision] = cellNumbers(
      rowFor(entry, 'adjusted precision')[column] as string,
      /([\d.]+)%\s*$/u
    )
    // Derived from the LEDGER, not from the module, so the assertion is evidence
    // about the published prose rather than a restatement of the constant.
    const recallInTen = Math.round(((recall as number) / 100) * 10)
    const precisionInTwenty = Math.round(
      ((adjustedPrecision as number) / 100) * 20
    )

    const report = renderMarkdownReport(createReportFixture())
    const comment = summaryComment()

    for (const surface of [report, comment]) {
      expect(surface).toContain(`**${recallInTen} in 10**`)
      expect(surface).toContain(`**${precisionInTwenty} in 20**`)
      expect(surface).toContain(
        `**${measuredReliability.outOfDiffRecallFound} of ${measuredReliability.outOfDiffRecallTotal}**`
      )
    }

    // The rounded fractions the module derives must be the ones both surfaces
    // print — otherwise a renderer is quoting a fraction of its own.
    expect(inDiffRecallInTen).toBe(recallInTen)
    expect(adjustedPrecisionInTwenty).toBe(precisionInTwenty)
  })

  // The complement is the sentence a reader meets when the list is EMPTY, which is
  // the moment the rate matters most. It was the last stale copy: the
  // pull-request comment said "two in five missed" — the complement of the
  // superseded 61% — long after the report had moved to seven in ten found.
  test('what an empty list means is stated from the same figure on both surfaces', () => {
    const report = renderMarkdownReport({
      ...createReportFixture(),
      admittedFindings: []
    })
    const comment = summaryComment({ review: emptyReviewDigest() })

    // Asserted against the exported sentence, not a literal: a test holding its own
    // copy is a third place to update and is how the previous drift survived CI.
    expect(report).toContain(NOTHING_PROVED)
    expect(comment).toContain(NOTHING_PROVED)
  })

  test('no surface still carries a rate from a superseded sweep', () => {
    const report = renderMarkdownReport(createReportFixture())
    const comment = summaryComment({ review: emptyReviewDigest() })

    for (const surface of [report, comment]) {
      // The 2026-08-02 baseline, and the prose forms it was published as.
      expect(surface).not.toContain('3 in 5')
      expect(surface).not.toContain('two in five')
      expect(surface).not.toContain('61.1%')
      expect(surface).not.toContain('99.1%')
    }
  })

  // The numbers were centralised here after a re-baseline moved one renderer and
  // not the other. The SENTENCE around them stayed duplicated and diverged the same
  // way, so it is pinned to one source too.
  test('both empty-findings surfaces render the one shared sentence', async () => {
    const reporter = await readFile(
      'src/domains/reporting/markdown-reporter.ts',
      'utf8'
    )
    const summary = await readFile(
      'scripts/github/summary-comment.ts',
      'utf8'
    )

    for (const [name, source] of [
      ['markdown-reporter.ts', reporter],
      ['summary-comment.ts', summary]
    ] as const) {
      expect(
        source.includes('NOTHING_PROVED'),
        `${name} must import the shared sentence`
      ).toBe(true)
      expect(
        source.includes('This run proved no defect it could act on.'),
        `${name} must not carry its own copy of the sentence`
      ).toBe(false)
    }
  })
})
