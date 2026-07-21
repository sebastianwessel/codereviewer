import { describe, expect, test } from 'vitest'
import {
  anchorSourceFilesFromChunks,
  createSourceAnchorResolver
} from './source-anchor.js'

describe('source anchor resolver', () => {
  test('resolves the source line a finding points at', () => {
    const resolve = createSourceAnchorResolver([
      { path: 'src/app.ts', content: 'alpha\nbeta\ngamma\n' }
    ])

    expect(
      resolve({ path: 'src/app.ts', startLine: 2, side: 'new' })
    ).toBe('beta')
  })

  test('handles CRLF and bare CR line endings', () => {
    const resolve = createSourceAnchorResolver([
      { path: 'a.ts', content: 'alpha\r\nbeta\rgamma' }
    ])

    expect(resolve({ path: 'a.ts', startLine: 2, side: 'new' })).toBe('beta')
    expect(resolve({ path: 'a.ts', startLine: 3, side: 'new' })).toBe('gamma')
  })

  test('returns undefined for unknown paths and out-of-range lines', () => {
    const resolve = createSourceAnchorResolver([
      { path: 'a.ts', content: 'only\n' }
    ])

    expect(resolve({ path: 'missing.ts', startLine: 1, side: 'new' })).toBeUndefined()
    expect(resolve({ path: 'a.ts', startLine: 99, side: 'new' })).toBeUndefined()
  })

  test('refuses to anchor old-side locations against head content', () => {
    const resolve = createSourceAnchorResolver([
      { path: 'a.ts', content: 'alpha\nbeta\n' }
    ])

    expect(resolve({ path: 'a.ts', startLine: 1, side: 'old' })).toBeUndefined()
  })
})

describe('anchor sources from review-context chunks', () => {
  test('reassembles ordered chunks of the same file', () => {
    expect(
      anchorSourceFilesFromChunks([
        { kind: 'file', path: 'a.ts', content: 'alpha\nbe' },
        { kind: 'file', path: 'a.ts', content: 'ta\ngamma\n' }
      ])
    ).toEqual([{ path: 'a.ts', content: 'alpha\nbeta\ngamma\n' }])
  })

  test('ignores non-file context and pathless entries', () => {
    expect(
      anchorSourceFilesFromChunks([
        { kind: 'referenced-definition', path: 'dep.ts', content: 'ignored' },
        { kind: 'support-signal-output', content: 'ignored' },
        { kind: 'file', content: 'ignored' },
        { kind: 'file', path: 'a.ts', content: 'kept' }
      ])
    ).toEqual([{ path: 'a.ts', content: 'kept' }])
  })
})
