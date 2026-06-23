import { describe, expect, test } from 'vitest'
import { renderSharedDigest } from './model-shared-digest.js'
import { type SharedContextEntry } from '../shared-context/index.js'

const entry = (
  input: Partial<SharedContextEntry> & Pick<SharedContextEntry, 'kind' | 'summary'>
): SharedContextEntry => ({
  id: input.id ?? `shared_${input.kind}_${input.summary.length}`,
  kind: input.kind,
  summary: input.summary,
  source: input.source ?? 'test',
  ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
  evidenceIds: input.evidenceIds ?? [],
  refIds: input.refIds ?? []
})

describe('model shared digest', () => {
  test('renders only model-bound digest entry kinds', () => {
    const digest = renderSharedDigest([
      entry({ kind: 'candidate-finding', summary: 'candidate noise' }),
      entry({ kind: 'support-signal-fact', summary: 'support fact' }),
      entry({ kind: 'admitted-finding', summary: 'admitted fact' })
    ])

    expect(digest).toContain('support fact')
    expect(digest).toContain('admitted fact')
    expect(digest).not.toContain('candidate noise')
  })

  test('caps summary text and total digest bytes while preserving recent entries', () => {
    const digest = renderSharedDigest(
      [
        entry({ kind: 'task-state', summary: 'old task '.repeat(80) }),
        entry({ kind: 'task-state', summary: 'middle task '.repeat(80) }),
        entry({ kind: 'admitted-finding', summary: 'recent admitted '.repeat(80) })
      ],
      {
        maxSummaryChars: 60,
        maxDigestBytes: 180
      }
    )

    expect(Buffer.byteLength(digest)).toBeLessThanOrEqual(180)
    expect(digest).toContain('recent admitted')
    expect(digest).toContain('...')
    expect(digest).not.toContain('old task')
  })
})
