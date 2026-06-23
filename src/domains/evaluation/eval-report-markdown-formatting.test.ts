import { describe, expect, test } from 'vitest'
import {
  appendMarkdownBulletSection,
  appendMarkdownTable,
  escapeMarkdownCell,
  formatCostMetric,
  formatDuration,
  formatInteger,
  formatListValue,
  formatPercent
} from './eval-report-markdown-formatting.js'

describe('eval report markdown formatting', () => {
  test('formats shared scalar values for eval Markdown reports', () => {
    expect(formatPercent(0.125)).toBe('12.5%')
    expect(formatDuration(999)).toBe('999ms')
    expect(formatDuration(1250)).toBe('1.3s')
    expect(formatInteger(1234567)).toBe('1,234,567')
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
