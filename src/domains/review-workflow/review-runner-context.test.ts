import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import {
  CodeReviewerConfigSchema,
  EvidenceRecordSchema
} from '../../shared/contracts/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import type { ReviewTask } from '../review-planning/index.js'
import {
  assembleContext,
  prepareReviewRunnerContextState,
  readChangedSourceFiles,
  reviewedDiffRangesForDiffMaps,
  reviewedLineRangesForSourceFiles,
  splitTextByUtf8Bytes
} from './review-runner-context.js'

const createTempDir = async (): Promise<string> => {
  const directory = join(tmpdir(), `codereviewer-context-${crypto.randomUUID()}`)
  await mkdir(directory, { recursive: true })
  return directory
}

const taskFor = (path: string): ReviewTask => ({
  id: 'task_alpha',
  round: 1,
  kind: 'file',
  paths: [path],
  factIds: ['fact_alpha'],
  evidenceIds: ['ev_alpha'],
  candidateIds: [],
  contextEntryIds: [],
  priority: 0
})

describe('review runner context assembly', () => {
  test('splits text on UTF-8 character boundaries', () => {
    expect(splitTextByUtf8Bytes('a🙂b', 2)).toEqual(['a', '🙂', 'b'])
    expect(splitTextByUtf8Bytes('', 10)).toEqual([''])
    expect(() => splitTextByUtf8Bytes('abc', 0)).toThrow(
      'maxBytes must be greater than 0'
    )
  })

  test('reads changed source files and derives reviewed ranges', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'a.ts'), 'one\ntwo\n')

      const sourceFiles = await readChangedSourceFiles({
        repositoryRoot: root,
        changedFiles: [{ path: 'src/a.ts' }]
      })

      expect(sourceFiles).toEqual([{ path: 'src/a.ts', content: 'one\ntwo\n' }])
      expect(reviewedLineRangesForSourceFiles(sourceFiles)).toEqual([
        { path: 'src/a.ts', startLine: 1, endLine: 3 }
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('converts diff maps to new-side reviewed ranges and skips deleted hunks', () => {
    expect(
      reviewedDiffRangesForDiffMaps([
        {
          path: 'src/a.ts',
          changeKind: 'modified',
          hunks: [
            {
              oldStartLine: 4,
              oldLineCount: 2,
              newStartLine: 8,
              newLineCount: 3
            },
            {
              oldStartLine: 20,
              oldLineCount: 2,
              newStartLine: 0,
              newLineCount: 0
            }
          ]
        }
      ])
    ).toEqual([
      {
        path: 'src/a.ts',
        startLine: 8,
        endLine: 10,
        changeKind: 'modified'
      }
    ])
  })

  test('assembles instructions, source chunks, support-signal context, and ledger entries', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'AGENTS.md'), 'Do not leak secrets.')
      const sourceContent = 'export const alpha = 1\n'
      const evidence = EvidenceRecordSchema.parse({
        id: 'ev_alpha',
        kind: 'deterministic-signal',
        summary: 'alpha declaration detected',
        location: { path: 'src/a.ts', startLine: 1, side: 'file' },
        source: 'deterministic-support-signal',
        redactionApplied: true
      })
      const config = CodeReviewerConfigSchema.parse({
        review: { contextMaxBytes: 10000 },
        instructions: {
          files: ['AGENTS.md'],
          inline: 'Inline guidance'
        }
      })

      const result = await assembleContext({
        repositoryRoot: root,
        config,
        sourceFiles: [{ path: 'src/a.ts', content: sourceContent }],
        analysis: {
          facts: [
            {
              id: 'fact_alpha',
              language: 'typescript',
              kind: 'declaration',
              path: 'src/a.ts',
              name: 'alpha',
              line: 1,
              summary: 'alpha declaration',
              contentHash: sha256(sourceContent)
            }
          ],
          evidence: [evidence]
        },
        tasks: [taskFor('src/a.ts')]
      })

      expect(result.instructions.map((instruction) => instruction.path)).toEqual([
        'AGENTS.md',
        '.codereviewer/inline-instructions'
      ])
      expect(result.tasks).toHaveLength(1)
      expect(result.tasks[0]?.reviewContext.map((context) => context.kind)).toEqual([
        'file',
        'support-signal-output'
      ])
      expect(result.tasks[0]?.factIds).toEqual(['fact_alpha'])
      expect(result.tasks[0]?.evidenceIds).toEqual(['ev_alpha'])
      expect(result.contextLedger.map((entry) => entry.kind)).toEqual([
        'instruction',
        'instruction',
        'file',
        'support-signal-output'
      ])
      expect(result.reviewContext).toHaveLength(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('prepares context state with safe metrics and provenance hashes', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'AGENTS.md'), 'Do not leak secrets.')
      const sourceContent = 'export const alpha = 1\n'
      const evidence = EvidenceRecordSchema.parse({
        id: 'ev_alpha',
        kind: 'deterministic-signal',
        summary: 'alpha declaration detected',
        location: { path: 'src/a.ts', startLine: 1, side: 'file' },
        source: 'deterministic-support-signal',
        redactionApplied: true
      })
      const config = CodeReviewerConfigSchema.parse({
        review: { contextMaxBytes: 10000 },
        instructions: {
          files: ['AGENTS.md']
        }
      })

      const result = await prepareReviewRunnerContextState({
        repositoryRoot: root,
        config,
        sourceFiles: [{ path: 'src/a.ts', content: sourceContent }],
        analysis: {
          facts: [
            {
              id: 'fact_alpha',
              language: 'typescript',
              kind: 'declaration',
              path: 'src/a.ts',
              name: 'alpha',
              line: 1,
              summary: 'alpha declaration',
              contentHash: sha256(sourceContent)
            }
          ],
          evidence: [evidence]
        },
        tasks: [taskFor('src/a.ts')]
      })

      expect(result.metrics).toEqual({
        ledgerEntryCount: result.assembledContext.contextLedger.length,
        workflowTaskCount: result.assembledContext.tasks.length,
        instructionCount: result.assembledContext.instructions.length,
        skillCount: result.assembledContext.skills.length
      })
      const instructionHash = result.assembledContext.contextLedger.find(
        (entry) => entry.kind === 'instruction'
      )?.contentHash

      expect(instructionHash).toBeDefined()
      expect(result.instructionHashes).toEqual([instructionHash])
      expect(result.skillHashes).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('splits large source into multiple workflow tasks without truncating content', async () => {
    const config = CodeReviewerConfigSchema.parse({
      review: { contextMaxBytes: 10000 }
    })
    const largeSource = 'x'.repeat(5000)

    const result = await assembleContext({
      repositoryRoot: '/unused',
      config,
      sourceFiles: [{ path: 'src/large.ts', content: largeSource }],
      analysis: { facts: [], evidence: [] },
      tasks: [taskFor('src/large.ts')]
    })

    const fileContexts = result.tasks.flatMap((task) =>
      task.reviewContext.filter((context) => context.kind === 'file')
    )

    expect(fileContexts).toHaveLength(2)
    expect(fileContexts.map((context) => context.content).join('')).toBe(
      largeSource
    )
    expect(result.contextLedger.filter((entry) => entry.kind === 'file')).toHaveLength(2)
    expect(
      result.contextLedger
        .filter((entry) => entry.kind === 'file')
        .reduce((total, entry) => total + entry.bytesIncluded, 0)
    ).toBe(5000)
  })
})
