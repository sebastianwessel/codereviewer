import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import {
  CodeReviewerConfigSchema,
  EvidenceRecordSchema
} from '../../../../shared/contracts/index.js'
import { sha256 } from '../../../../shared/hash/hash.js'
import type { ReviewTask } from '../../../review-planning/index.js'
import {
  assembleContext,
  prepareReviewRunnerContextState,
  readChangedSourceFiles,
  reviewedDiffRangesForDiffMaps,
  reviewedLineRangesForSourceFiles,
  splitSourceIntoLineChunks,
  splitTextByUtf8Bytes
} from './context.js'

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

// A source file whose lines carry multi-byte UTF-8 characters, so byte budgets
// and line numbers cannot be conflated. 200 such lines are far past the 4500-byte
// source chunk budget that `contextMaxBytes: 10000` produces.
const multiByteSource = (lineCount: number): string =>
  `${Array.from(
    { length: lineCount },
    (_unused, index) =>
      `const größe${index + 1} = 'Grüße 🙂 ${'ü'.repeat(30)}' // Zeile ${index + 1}`
  ).join('\n')}\n`

describe('review runner context assembly', () => {
  test('splits text on UTF-8 character boundaries', () => {
    expect(splitTextByUtf8Bytes('a🙂b', 2)).toEqual(['a', '🙂', 'b'])
    expect(splitTextByUtf8Bytes('', 10)).toEqual([''])
    expect(() => splitTextByUtf8Bytes('abc', 0)).toThrow(
      'maxBytes must be greater than 0'
    )
  })

  test('splits source on line boundaries and records each chunk’s absolute origin', () => {
    // Multi-byte lines: the budget counts UTF-8 bytes, the origin counts lines.
    // The file's trailing empty line rides along in the last chunk, which is why
    // it ends at line 4.
    expect(splitSourceIntoLineChunks('äa\nbä\ncä\n', 4)).toEqual([
      { content: 'äa\n', startLine: 1, endLine: 1 },
      { content: 'bä\n', startLine: 2, endLine: 2 },
      { content: 'cä\n', startLine: 3, endLine: 4 }
    ])
    // A CRLF pair is one line break, so the second chunk starts at line 2 and not
    // at line 3.
    expect(splitSourceIntoLineChunks('aa\r\nbb\r\n', 4)).toEqual([
      { content: 'aa\r\n', startLine: 1, endLine: 1 },
      { content: 'bb\r\n', startLine: 2, endLine: 3 }
    ])
    // A single line longer than the budget is the one case that cannot be cut on a
    // boundary. Its pieces keep that line's number, so the continuation chunk
    // starts at line 1 again and the line after it is still numbered 2.
    expect(splitSourceIntoLineChunks('aaaaa\nb\n', 4)).toEqual([
      { content: 'aaaa', startLine: 1, endLine: 1 },
      { content: 'a\nb\n', startLine: 1, endLine: 3 }
    ])
    // Content that fits stays a single chunk spanning the whole file, so the file's
    // trailing empty line is counted exactly as `sourceLineCount` counts it.
    expect(splitSourceIntoLineChunks('one\ntwo\n', 1000)).toEqual([
      { content: 'one\ntwo\n', startLine: 1, endLine: 3 }
    ])
    expect(splitSourceIntoLineChunks('', 1000)).toEqual([
      { content: '', startLine: 1, endLine: 1 }
    ])
    expect(() => splitSourceIntoLineChunks('abc', 0)).toThrow(
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

  test('deterministicSignalMode "disabled" keeps clustering but omits support-signal context', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      const sourceContent = 'export const alpha = 1\n'
      const config = CodeReviewerConfigSchema.parse({
        review: { contextMaxBytes: 10000 },
        aiReview: { deterministicSignalMode: 'disabled' }
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
          evidence: []
        },
        tasks: [taskFor('src/a.ts')]
      })

      // Source is still reviewed and clustering facts are still attached to the
      // task, but the serialized support-signal facts are NOT injected as model
      // context.
      expect(result.tasks[0]?.reviewContext.map((context) => context.kind)).toEqual([
        'file'
      ])
      expect(result.tasks[0]?.factIds).toEqual(['fact_alpha'])
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

  test('gives every source chunk its absolute line origin, with multi-byte content', async () => {
    const config = CodeReviewerConfigSchema.parse({
      review: { contextMaxBytes: 10000 }
    })
    // The splitter budgets in UTF-8 BYTES while line numbers count LINES, so the
    // fixture is deliberately multi-byte: a chunk origin derived by counting
    // bytes (or by assuming one byte per character) lands on the wrong line here
    // but would look correct on pure ASCII.
    const sourceContent = multiByteSource(200)

    const result = await assembleContext({
      repositoryRoot: '/unused',
      config,
      sourceFiles: [{ path: 'src/large.ts', content: sourceContent }],
      analysis: { facts: [], evidence: [] },
      tasks: [taskFor('src/large.ts')]
    })

    const fileContexts = result.tasks.flatMap((task) =>
      task.reviewContext.filter((context) => context.kind === 'file')
    )

    expect(fileContexts.length).toBeGreaterThan(1)
    // Chunking must remain lossless: concatenating the chunks in order restores
    // the file byte for byte (the fingerprint anchor resolver relies on this).
    expect(fileContexts.map((context) => context.content).join('')).toBe(
      sourceContent
    )

    const expectedLines = sourceContent.split('\n')
    let expectedStartLine = 1

    for (const context of fileContexts) {
      expect(context.startLine).toBe(expectedStartLine)
      // The chunk's first line must be the file's real line at that absolute
      // number - this is the line the reviewer is shown under that number.
      expect(context.content.split('\n')[0]).toBe(
        expectedLines[expectedStartLine - 1]
      )
      expect(context.endLine).toBeGreaterThanOrEqual(context.startLine!)
      // Chunks are contiguous: the next one resumes on the following line.
      expectedStartLine = context.endLine! + 1
    }

    // The chunks together cover the file exactly, ending on its last line.
    expect(fileContexts.at(-1)?.endLine).toBe(expectedLines.length)
  })
})
