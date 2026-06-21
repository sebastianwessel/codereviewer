import { describe, expect, test } from 'vitest'
import {
  createContextLedgerEntry,
  createTextContextLedgerEntry,
  type ContextLedgerDecision,
  type ContextLedgerKind
} from './index.js'

const allKinds: readonly ContextLedgerKind[] = [
  'file',
  'diff',
  'symbol',
  'instruction',
  'skill',
  'analyzer-output',
  'prior-artifact'
]

const allDecisions: readonly ContextLedgerDecision[] = [
  'included',
  'skipped',
  'truncated',
  'summarized'
]

describe('context ledger', () => {
  test('creates stable entries for all context kinds and decisions', () => {
    const entries = allKinds.flatMap((kind) =>
      allDecisions.map((decision) => {
        const entryPath =
          kind === 'analyzer-output' ? undefined : `context/${kind}.txt`

        return createContextLedgerEntry({
          kind,
          decision,
          reason: decision === 'included' ? 'review-input' : 'context-budget',
          bytesConsidered: 12,
          bytesIncluded: decision === 'included' ? 12 : 6,
          ...(entryPath === undefined ? {} : { path: entryPath }),
          content: Buffer.from(`${kind}:${decision}`)
        })
      })
    )

    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length)
    expect(entries).toContainEqual(
      expect.objectContaining({
        kind: 'file',
        decision: 'included',
        path: 'context/file.txt',
        bytesConsidered: 12,
        bytesIncluded: 12,
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    )
  })

  test('does not store raw source, prompt text, or provider output', () => {
    const rawContent = 'const secret = "do-not-store"'
    const entry = createContextLedgerEntry({
      kind: 'file',
      decision: 'included',
      reason: 'review-input',
      path: 'src/app.ts',
      bytesConsidered: rawContent.length,
      bytesIncluded: rawContent.length,
      content: rawContent
    })

    expect(JSON.stringify(entry)).not.toContain(rawContent)
    expect(entry.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('links derived task entries without storing raw content', () => {
    const entry = createContextLedgerEntry({
      kind: 'file',
      decision: 'included',
      reason: 'task-context-source-chunk',
      path: 'src/app.ts',
      taskId: 'task_abc123',
      sourceLedgerEntryId: 'ctx_1234567890abcdef12345678',
      bytesConsidered: 100,
      bytesIncluded: 100
    })

    expect(entry).toEqual(
      expect.objectContaining({
        taskId: 'task_abc123',
        sourceLedgerEntryId: 'ctx_1234567890abcdef12345678'
      })
    )
    expect(entry.contentHash).toBeUndefined()
    expect(entry.id).toMatch(/^ctx_[a-f0-9]{24}$/)
  })

  test('makes instruction and skill truncation explicit', () => {
    const instructionEntry = createTextContextLedgerEntry({
      kind: 'instruction',
      path: '.review/instructions.md',
      reason: 'context-budget',
      text: 'abcdef',
      maxBytes: 4
    })
    const skillEntry = createTextContextLedgerEntry({
      kind: 'skill',
      path: '.review/skills/review.md',
      reason: 'context-budget',
      text: '0123456789',
      maxBytes: 5
    })

    expect(instructionEntry).toEqual(
      expect.objectContaining({
        decision: 'truncated',
        bytesConsidered: 6,
        bytesIncluded: 4
      })
    )
    expect(skillEntry).toEqual(
      expect.objectContaining({
        decision: 'truncated',
        bytesConsidered: 10,
        bytesIncluded: 5
      })
    )
  })

  test('rejects unsafe repository-backed ledger paths', () => {
    expect(() =>
      createContextLedgerEntry({
        kind: 'file',
        decision: 'included',
        reason: 'review-input',
        path: '../outside.ts',
        bytesConsidered: 1,
        bytesIncluded: 1,
        content: 'x'
      })
    ).toThrow(TypeError)
  })
})
