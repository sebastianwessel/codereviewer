import { describe, expect, test } from 'vitest'
import type { ModelFindingCitation } from '../agent-contracts.js'
import { citationEvidenceFor, verifyCitation } from './citation-evidence.js'

// Numbered exactly the way `review-packet.ts` numbers a task's changed files
// (`${lineNumber}: ${text}`), since that is the only shape this module ever
// actually receives.
const numbered = (lines: readonly string[]): string =>
  lines.map((line, index) => `${index + 1}: ${line}`).join('\n')

const citationOf = (
  overrides: Partial<ModelFindingCitation> & { readonly startLine: number }
): ModelFindingCitation => ({
  quote: 'unused',
  ...overrides
})

describe('verifyCitation', () => {
  const content = numbered([
    'export const getRate = (id: string) => {',
    '  const record = cache.get(id)',
    '  return record.rate',
    '}'
  ])

  test('a quote that matches at the cited line verifies', () => {
    const verified = verifyCitation(
      citationOf({ startLine: 3, quote: 'return record.rate' }),
      content
    )

    expect(verified).toEqual({
      citation: expect.objectContaining({ startLine: 3 }),
      matchedLine: 3
    })
  })

  test('whitespace differences still verify: collapsed runs and outer padding', () => {
    const verified = verifyCitation(
      citationOf({ startLine: 3, quote: '  return   record.rate  ' }),
      content
    )

    expect(verified?.matchedLine).toBe(3)
  })

  test('matching is case-sensitive', () => {
    const verified = verifyCitation(
      citationOf({ startLine: 3, quote: 'RETURN RECORD.RATE' }),
      content
    )

    expect(verified).toBeUndefined()
  })

  test('a quote that does not appear anywhere near the cited line does not verify', () => {
    const verified = verifyCitation(
      citationOf({ startLine: 3, quote: 'this text is nowhere in the file' }),
      content
    )

    expect(verified).toBeUndefined()
  })

  test('an off-by-a-line citation still verifies, within the window, at the line it actually matched', () => {
    // Cited at line 4 (the closing brace); the quote is really on line 3, two
    // lines inside the +/-2 window.
    const verifiedOneOff = verifyCitation(
      citationOf({ startLine: 4, quote: 'return record.rate' }),
      content
    )
    expect(verifiedOneOff?.matchedLine).toBe(3)

    // Cited two lines early, at the far edge of the window.
    const verifiedTwoOff = verifyCitation(
      citationOf({ startLine: 1, quote: 'return record.rate' }),
      content
    )
    expect(verifiedTwoOff?.matchedLine).toBe(3)
  })

  test('a quote that appears elsewhere in the file but OUTSIDE the window does not verify', () => {
    // "export const getRate" is on line 1; cited three lines away, past the
    // +/-2 window, so the search must not find it. A whole-file search would
    // wrongly "verify" this — the window exists specifically to prevent that.
    const verified = verifyCitation(
      citationOf({ startLine: 4, quote: 'export const getRate' }),
      content
    )

    expect(verified).toBeUndefined()
  })

  test('a quote spanning two lines is checked against the cited line joined with what follows it', () => {
    const verified = verifyCitation(
      citationOf({
        startLine: 2,
        quote: 'cache.get(id) return record.rate'
      }),
      content
    )

    // Anchored (and reported) at the line the quote STARTS on.
    expect(verified?.matchedLine).toBe(2)
  })

  test('an empty or whitespace-only quote never verifies', () => {
    expect(verifyCitation(citationOf({ startLine: 3, quote: '' }), content)).toBeUndefined()
    expect(
      verifyCitation(citationOf({ startLine: 3, quote: '   ' }), content)
    ).toBeUndefined()
  })

  test('a citation naming a line the content does not have does not verify', () => {
    const verified = verifyCitation(
      citationOf({ startLine: 500, quote: 'return record.rate' }),
      content
    )

    expect(verified).toBeUndefined()
  })
})

describe('citationEvidenceFor', () => {
  const content = numbered([
    'export const getRate = (id: string) => {',
    '  const record = cache.get(id)',
    '  return record.rate',
    '}'
  ])
  const lookupFor = (
    byPath: Readonly<Record<string, string>>
  ): { readonly lookup: (path: string) => string | undefined; callCount: () => number } => {
    let calls = 0
    return {
      lookup: (path) => {
        calls += 1
        return byPath[path]
      },
      callCount: () => calls
    }
  }

  test('a verified citation produces exactly one EvidenceRecord, referencing the matched line', () => {
    const { lookup } = lookupFor({ 'src/app.ts': content })
    const records = citationEvidenceFor({
      candidateId: 'cand_aaaaaaaaaaaaaaaa',
      path: 'src/app.ts',
      citations: [{ startLine: 3, quote: 'return record.rate' }],
      lookup
    })

    expect(records).toHaveLength(1)
    const [record] = records
    expect(record?.kind).toBe('citation')
    expect(record?.source).toBe('discovery-citation')
    expect(record?.redactionApplied).toBe(true)
    expect(record?.location).toEqual({
      path: 'src/app.ts',
      startLine: 3,
      side: 'file'
    })
    expect(record?.summary).toContain('record.rate')
    expect(record?.id).toMatch(/^ev_[0-9a-f]{24}$/u)
  })

  test('an unverified citation produces no record at all', () => {
    const { lookup } = lookupFor({ 'src/app.ts': content })
    const records = citationEvidenceFor({
      candidateId: 'cand_aaaaaaaaaaaaaaaa',
      path: 'src/app.ts',
      citations: [{ startLine: 3, quote: 'nothing like this is here' }],
      lookup
    })

    expect(records).toEqual([])
  })

  test('a citation naming a different path is skipped, not chased into a second lookup', () => {
    const { lookup, callCount } = lookupFor({ 'src/app.ts': content })
    const records = citationEvidenceFor({
      candidateId: 'cand_aaaaaaaaaaaaaaaa',
      path: 'src/app.ts',
      citations: [
        { path: 'src/other.ts', startLine: 3, quote: 'return record.rate' }
      ],
      lookup
    })

    expect(records).toEqual([])
    // Only the finding's own path is ever looked up.
    expect(callCount()).toBe(1)
  })

  test('an empty citations array never calls the lookup at all', () => {
    const { lookup, callCount } = lookupFor({ 'src/app.ts': content })
    const records = citationEvidenceFor({
      candidateId: 'cand_aaaaaaaaaaaaaaaa',
      path: 'src/app.ts',
      citations: [],
      lookup
    })

    expect(records).toEqual([])
    expect(callCount()).toBe(0)
  })

  test('a path the lookup has no content for produces no record', () => {
    const { lookup } = lookupFor({})
    const records = citationEvidenceFor({
      candidateId: 'cand_aaaaaaaaaaaaaaaa',
      path: 'src/missing.ts',
      citations: [{ startLine: 1, quote: 'anything' }],
      lookup
    })

    expect(records).toEqual([])
  })

  test('sensitive text in a verified quote is redacted in the evidence summary', () => {
    const secretContent = numbered([
      "const token = 'sk-aaaaaaaaaaaaaaaaaaaaaaaa'",
      'callApi(token)'
    ])
    const { lookup } = lookupFor({ 'src/secret.ts': secretContent })
    const records = citationEvidenceFor({
      candidateId: 'cand_aaaaaaaaaaaaaaaa',
      path: 'src/secret.ts',
      citations: [
        { startLine: 1, quote: "const token = 'sk-aaaaaaaaaaaaaaaaaaaaaaaa'" }
      ],
      lookup
    })

    expect(records).toHaveLength(1)
    expect(records[0]?.summary).not.toContain('sk-aaaaaaaaaaaaaaaaaaaaaaaa')
    expect(records[0]?.summary).toContain('[REDACTED]')
  })

  test('two citations that verify to the same line and quote collapse to one record', () => {
    const { lookup } = lookupFor({ 'src/app.ts': content })
    const records = citationEvidenceFor({
      candidateId: 'cand_aaaaaaaaaaaaaaaa',
      path: 'src/app.ts',
      citations: [
        { startLine: 3, quote: 'return record.rate' },
        { startLine: 3, quote: 'return record.rate' }
      ],
      lookup
    })

    expect(records).toHaveLength(1)
  })
})
