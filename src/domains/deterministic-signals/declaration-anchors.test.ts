import { afterEach, describe, expect, test, vi } from 'vitest'
import { declarationAnchorLines } from './declaration-anchors.js'

const typescriptSource = [
  'import { helper } from "./helper.js"',
  '',
  'export const first = (): number => {',
  '  return helper(1)',
  '}',
  '',
  'export const second = (): number => {',
  '  return 2',
  '}',
  ''
].join('\n')

describe('declarationAnchorLines', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('./deterministic-signal-registry.js')
  })

  test('reports each declaration start once, ascending', () => {
    // The extractors emit `declaration` and `public-symbol` at the IDENTICAL line
    // for a public symbol, so a caller that split on the raw fact list would get
    // two anchors for one declaration and a zero-width group between them.
    expect(declarationAnchorLines('src/sample.ts', typescriptSource)).toEqual([
      3,
      7
    ])
  })

  test('an unsupported language yields no anchors rather than an error', () => {
    // The fallback both callers depend on: no anchors means whole content, never a
    // byte slice.
    expect(declarationAnchorLines('notes/readme.txt', 'alpha\nbeta\n')).toEqual(
      []
    )
  })

  test('a line outside the content is discarded', () => {
    // An anchor past the end of the content cannot be a split point or a digest
    // window, and trusting one would produce an empty slice presented as source.
    expect(declarationAnchorLines('src/sample.ts', 'export const a = 1\n')).toEqual(
      [1]
    )
  })

  test('an extractor failure yields no anchors rather than propagating', async () => {
    vi.resetModules()
    vi.doMock('./deterministic-signal-registry.js', () => ({
      extractDeterministicSignals: () => {
        throw new Error('extractor failed')
      }
    }))

    const { declarationAnchorLines: withFailingExtractor } = await import(
      './declaration-anchors.js'
    )

    expect(withFailingExtractor('src/sample.ts', typescriptSource)).toEqual([])
  })
})
