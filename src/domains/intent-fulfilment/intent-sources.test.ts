// Spec 23's verification-matrix row "Every obligation cites its source in the
// stated intent" is enforced in two places: here, where a citation either resolves
// to a line of a gathered fragment or does not, and in the run, which drops the
// obligations whose citation did not.
//
// The other requirement this file carries is the one that is easiest to satisfy
// wrongly: obligations come from the redacted FRAGMENTS, never from the summarized
// brief. `toIntentSources` takes spec 11's `ContextFragment`s, so there is no code
// path from the brief into an obligation at all.

import { describe, expect, test } from 'vitest'
import type { ContextFragment } from '../context-ingestion/index.js'
import { resolveIntentCitation, toIntentSources } from './intent-sources.js'

const fragment = (origin: string, body: string): ContextFragment => ({
  origin,
  kind: 'inbox',
  body,
  metadata: {}
})

describe('toIntentSources', () => {
  test('addresses each redacted fragment by line, in gather order', () => {
    const { sources, truncated } = toIntentSources(
      [
        fragment('inbox:tracker/A-1', 'Reject expired tokens.\nLog the refusal.'),
        fragment('changed-file:docs/a.md', 'Document the new flag.')
      ],
      4_000
    )

    expect(truncated).toBe(false)
    expect(sources.map((source) => source.origin)).toEqual([
      'inbox:tracker/A-1',
      'changed-file:docs/a.md'
    ])
    expect(sources[0]?.lines).toEqual([
      'Reject expired tokens.',
      'Log the refusal.'
    ])
  })

  test('truncates on a line boundary and says so', () => {
    // A half line is still a citable line number, and an obligation extracted from
    // half a sentence would cite text the author never wrote.
    const { sources, truncated } = toIntentSources(
      [fragment('inbox:a', ['aaaa', 'bbbb', 'cccc'].join('\n'))],
      10
    )

    expect(truncated).toBe(true)
    expect(sources[0]?.lines).toEqual(['aaaa', 'bbbb'])
  })
})

describe('resolveIntentCitation', () => {
  const sources = toIntentSources(
    [fragment('inbox:a', 'first line\n\n  third line  ')],
    4_000
  ).sources

  test('resolves an origin and line to the author’s own text', () => {
    expect(resolveIntentCitation(sources, 'inbox:a', 1)).toEqual({
      origin: 'inbox:a',
      line: 1,
      text: 'first line'
    })
    expect(resolveIntentCitation(sources, 'inbox:a', 3)?.text).toBe('third line')
  })

  test.each([
    ['an unknown origin', 'inbox:other', 1],
    ['a line past the end', 'inbox:a', 4],
    ['a line before the start', 'inbox:a', 0],
    ['a non-integer line', 'inbox:a', 1.5],
    // Resolvable but unreadable: there is nothing at that address for a reviewer
    // to check, which is the same failure as an origin that does not exist.
    ['a blank line', 'inbox:a', 2]
  ])('refuses to resolve %s', (_name, origin, line) => {
    expect(resolveIntentCitation(sources, origin, line)).toBeUndefined()
  })
})
