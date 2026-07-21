import { describe, expect, test } from 'vitest'
import { buildBaselineEntries, renderBaselineJson } from './baseline-writer.js'

const fingerprint = {
  algorithm: 'v2-category-path-title-anchor',
  value: 'abc123'
}

describe('baseline writer', () => {
  test('copies fingerprints verbatim and discloses nothing else', () => {
    const entries = buildBaselineEntries([
      {
        fingerprints: [fingerprint],
        // Fields a baseline must never carry are present on the source finding.
        ...{ title: 'Sensitive title', path: 'src/secret.ts', severity: 'high' }
      } as never
    ])

    expect(entries).toEqual([{ fingerprints: [fingerprint] }])
    expect(renderBaselineJson(entries)).not.toContain('Sensitive title')
    expect(renderBaselineJson(entries)).not.toContain('src/secret.ts')
  })

  test('skips findings that carry no fingerprint', () => {
    expect(buildBaselineEntries([{ fingerprints: [] }])).toEqual([])
  })

  test('rejects malformed fingerprints instead of writing them', () => {
    expect(() =>
      buildBaselineEntries([{ fingerprints: [{ algorithm: '', value: 'x' }] }])
    ).toThrow()
  })

  test('round-trips through the rendered file', () => {
    const entries = buildBaselineEntries([{ fingerprints: [fingerprint] }])

    expect(JSON.parse(renderBaselineJson(entries))).toEqual(entries)
  })
})
