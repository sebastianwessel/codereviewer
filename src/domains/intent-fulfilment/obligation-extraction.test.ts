import { describe, expect, test } from 'vitest'
import {
  normalizeObligationExtraction,
  obligationExtractionInputFor
} from './obligation-extraction.js'
import { toIntentSources } from './intent-sources.js'
import type { ContextFragment } from '../context-ingestion/index.js'

const fragment = (origin: string, body: string): ContextFragment => ({
  origin,
  kind: 'inbox',
  title: 'Reject expired tokens',
  body,
  metadata: {}
})

describe('obligationExtractionInputFor', () => {
  test('numbers every line of the redacted fragment', () => {
    // Handing the model a numbered list is the difference between a citation it
    // can produce and one it has to count out.
    const { sources } = toIntentSources(
      [fragment('inbox:a', 'Reject expired tokens.\nLog the refusal.')],
      4_000
    )

    expect(obligationExtractionInputFor(sources, 5)).toEqual({
      maxObligations: 5,
      sources: [
        {
          origin: 'inbox:a',
          title: 'Reject expired tokens',
          lines: [
            { line: 1, text: 'Reject expired tokens.' },
            { line: 2, text: 'Log the refusal.' }
          ]
        }
      ]
    })
  })
})

describe('normalizeObligationExtraction', () => {
  test('keeps well-formed obligations and trims the statement', () => {
    expect(
      normalizeObligationExtraction({
        obligations: [
          { origin: ' inbox:a ', line: 2, statement: '  Log the refusal.  ' }
        ]
      })
    ).toEqual([{ origin: 'inbox:a', line: 2, statement: 'Log the refusal.' }])
  })

  test('marks a statement it had to cut, because that string is the row headline', () => {
    // `intent-markdown.ts` renders the statement as the bold headline of the row. A
    // bare slice ends it mid-clause and a reader cannot tell that from an obligation
    // stated that way, so they weigh the change against half a requirement.
    const [obligation] =
      normalizeObligationExtraction({
        obligations: [
          {
            origin: 'inbox:a',
            line: 1,
            statement: `${'Reject expired tokens. '.repeat(20)}unless the caller holds an override grant.`
          }
        ]
      })

    expect(obligation?.statement.length).toBeLessThanOrEqual(300)
    expect(obligation?.statement.endsWith('…')).toBe(true)
    expect(obligation?.statement).not.toContain('override grant')
  })

  test('leaves a statement that fits exactly as the model stated it', () => {
    // The mark must be evidence of a cut, so text that was not cut cannot carry it.
    const statement = 'a'.repeat(300)

    expect(
      normalizeObligationExtraction({
        obligations: [{ origin: 'inbox:a', line: 1, statement }]
      })
    ).toEqual([{ origin: 'inbox:a', line: 1, statement }])
  })

  test('coerces a line a model spelled as a string', () => {
    expect(
      normalizeObligationExtraction({
        obligations: [{ origin: 'inbox:a', line: '3', statement: 'Do a thing.' }]
      })
    ).toEqual([{ origin: 'inbox:a', line: 3, statement: 'Do a thing.' }])
  })

  test.each([
    ['an empty statement', { origin: 'inbox:a', line: 1, statement: '   ' }],
    ['an empty origin', { origin: '', line: 1, statement: 'Do a thing.' }],
    ['a line before the start', { origin: 'inbox:a', line: 0, statement: 'x' }]
  ])('drops an obligation with %s', (_name, obligation) => {
    expect(normalizeObligationExtraction({ obligations: [obligation] })).toEqual([])
  })

  test.each([
    ['a malformed answer', 'obligations'],
    ['a null answer', null],
    ['an answer with no obligations field', {}]
  ])('resolves %s to no obligations rather than throwing', (_name, value) => {
    expect(normalizeObligationExtraction(value)).toEqual([])
  })
})
