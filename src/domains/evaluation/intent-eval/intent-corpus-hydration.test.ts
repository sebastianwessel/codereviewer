import { describe, expect, test } from 'vitest'
import { parseFrontmatter } from '../../context-ingestion/index.js'
import {
  assembleIntentBody,
  renderIntentDocument
} from './intent-corpus-hydration.js'

const document = [
  'line 1',
  'line 2',
  'line 3',
  '',
  'line 5',
  'line 6',
  '',
  ''
].join('\n')

describe('assembleIntentBody', () => {
  test('joins slices verbatim, separated by one blank line', () => {
    const assembled = assembleIntentBody({
      documentText: document,
      lineRanges: [
        [1, 2],
        [5, 6]
      ]
    })

    expect(assembled.body).toBe('line 1\nline 2\n\nline 5\nline 6')
  })

  // THE MAP IS THE WHOLE POINT. The two numbering systems differ, because slices
  // are separated by a blank line the source document does not contain: body line
  // 4 here is source line 5. The answer key addresses source lines and a reported
  // obligation cites a body line, so a scorer without this map would join nothing.
  test('maps every body line back to its source line', () => {
    const assembled = assembleIntentBody({
      documentText: document,
      lineRanges: [
        [1, 2],
        [5, 6]
      ]
    })

    expect(assembled.lineMap).toEqual([
      { bodyLine: 1, sourceLine: 1 },
      { bodyLine: 2, sourceLine: 2 },
      { bodyLine: 4, sourceLine: 5 },
      { bodyLine: 5, sourceLine: 6 }
    ])
  })

  // The separator belongs to no source line and gets no entry. Nothing is lost:
  // `resolveIntentCitation` refuses a blank line, so no obligation can cite it.
  test('leaves the slice separator unmapped', () => {
    const assembled = assembleIntentBody({
      documentText: document,
      lineRanges: [
        [1, 1],
        [5, 5]
      ]
    })

    expect(
      assembled.lineMap.some((entry) => entry.bodyLine === 2)
    ).toBe(false)
  })

  // A slice whose lines are all trailing whitespace contributes nothing and must
  // not shift the numbering of the slices after it.
  test('drops a slice that is only trailing whitespace', () => {
    const assembled = assembleIntentBody({
      documentText: document,
      lineRanges: [
        [1, 1],
        [7, 8]
      ]
    })

    expect(assembled.body).toBe('line 1\n')
    expect(assembled.lineMap).toEqual([{ bodyLine: 1, sourceLine: 1 }])
  })
})

// The line map is indexed from the BODY, and the body is what the inbox provider
// hands on after stripping frontmatter and trimming. If those two ever disagreed,
// every anchor in the corpus would be off by the height of the frontmatter block.
describe('renderIntentDocument', () => {
  test('the provider reads back exactly the assembled body', () => {
    const assembled = assembleIntentBody({
      documentText: document,
      lineRanges: [
        [1, 2],
        [5, 6]
      ]
    })
    const rendered = renderIntentDocument({
      sourceLabel: 'spec',
      id: 'abc1234',
      title: 'Spec 20 — measurement',
      body: assembled.body
    })

    expect(parseFrontmatter(rendered).body.trim()).toBe(assembled.body)
    expect(parseFrontmatter(rendered).metadata.title).toBe(
      'Spec 20 — measurement'
    )
  })

  // A multi-line title would break the frontmatter block, and a corpus title is
  // taken from a manifest field or a commit subject, either of which can carry one.
  test('flattens a title that spans lines', () => {
    const rendered = renderIntentDocument({
      sourceLabel: 'git',
      id: 'abc1234',
      title: 'first line\nsecond line',
      body: 'body'
    })

    expect(parseFrontmatter(rendered).metadata.title).toBe(
      'first line second line'
    )
    expect(parseFrontmatter(rendered).body.trim()).toBe('body')
  })
})
