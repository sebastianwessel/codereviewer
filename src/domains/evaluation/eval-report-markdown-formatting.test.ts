import { describe, expect, test } from 'vitest'
import {
  appendMarkdownBulletSection,
  appendMarkdownTable,
  escapeMarkdownCell,
  formatCostMetric,
  formatDuration,
  formatDurationMetric,
  formatCurrency,
  formatInteger,
  formatListValue,
  formatNumberDelta,
  formatPercent,
  formatPercentagePointDelta,
  UNKNOWN_VALUE
} from './eval-report-markdown-formatting.js'

describe('eval report markdown formatting', () => {
  test('formats shared scalar values for eval Markdown reports', () => {
    expect(formatPercent(0.125)).toBe('12.5%')
    expect(formatDuration(999)).toBe('999ms')
    expect(formatDuration(1250)).toBe('1.3s')
    expect(formatInteger(1234567)).toBe('1,234,567')
  })

  // Zero is the one cost that has a shorter spelling, and every cost cell must
  // agree on it: two conventions in one table read as two different figures.
  test('formats currency with one convention for zero', () => {
    expect(formatCurrency(0)).toBe('$0.00')
    expect(formatCurrency(0.12567)).toBe('$0.1257')
  })

  test('formats run-to-run deltas with an explicit sign', () => {
    expect(formatPercentagePointDelta(0.6, 0.683)).toBe('+8.3pp')
    expect(formatPercentagePointDelta(0.683, 0.6)).toBe('-8.3pp')
    expect(formatPercentagePointDelta(0.5, 0.5)).toBe('0.0pp')
    expect(formatNumberDelta(3, 7)).toBe('+4')
    expect(formatNumberDelta(7, 3)).toBe('-4')
    expect(formatNumberDelta(3, 3)).toBe('0')
  })

  test('spells an unrecorded value one way for every renderer', () => {
    expect(UNKNOWN_VALUE).toBe('unknown (not recorded)')
  })

  test('formats cost metrics with unavailable-case context', () => {
    expect(
      formatCostMetric({
        costUnavailableCount: 0,
        costUsd: 0
      })
    ).toBe('$0.00')
    expect(
      formatCostMetric({
        costUnavailableCount: 2,
        costUsd: 0.12567
      })
    ).toBe('$0.1257 known; unavailable for 2 case(s)')
  })

  test('formats summed duration with unavailable-case context', () => {
    expect(
      formatDurationMetric({
        durationUnavailableCount: 0,
        durationMs: 1250
      })
    ).toBe('1.3s')
    // A case that never produced a review report contributed no duration, so
    // the sum is a floor and must not read as the run's measured total.
    expect(
      formatDurationMetric({
        durationUnavailableCount: 1,
        durationMs: 1250
      })
    ).toBe('1.3s known; unavailable for 1 case(s)')
  })

  test('escapes Markdown cells and skips empty optional tables consistently', () => {
    expect(escapeMarkdownCell('left|right\nnext')).toBe('left\\|right next')

    const lines: string[] = ['before']
    appendMarkdownTable(lines, {
      heading: '## Rows',
      header: '| Name | Count |',
      alignment: '| --- | ---: |',
      rows: ['| one | 1 |']
    })
    appendMarkdownTable(lines, {
      heading: '## Empty',
      header: '| Name | Count |',
      alignment: '| --- | ---: |',
      rows: []
    })

    expect(lines).toEqual([
      'before',
      '## Rows',
      '',
      '| Name | Count |',
      '| --- | ---: |',
      '| one | 1 |',
      ''
    ])
  })

  test('appends optional bullet sections with one skip-empty policy', () => {
    const lines: string[] = ['before']
    appendMarkdownBulletSection(lines, {
      heading: '## Bullets',
      rows: ['- one', '- two']
    })
    appendMarkdownBulletSection(lines, {
      heading: '## Empty',
      rows: []
    })

    expect(lines).toEqual(['before', '## Bullets', '', '- one', '- two', ''])
  })

  test('formats Markdown list cells with escaped comma joining', () => {
    expect(formatListValue([])).toBe('-')
    expect(formatListValue(['alpha|beta', 'next\nline'])).toBe(
      'alpha\\|beta, next line'
    )
  })
})
