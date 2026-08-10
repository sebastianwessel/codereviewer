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
  reviewedLineRangesForSourceFiles
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

// A source file whose lines carry multi-byte UTF-8 characters, so byte counts and
// line numbers cannot be conflated: a span derived by counting bytes drifts here
// while looking correct on pure ASCII.
const multiByteSource = (lineCount: number): string =>
  `${Array.from(
    { length: lineCount },
    (_unused, index) =>
      `const größe${index + 1} = 'Grüße 🙂 ${'ü'.repeat(30)}' // Zeile ${index + 1}`
  ).join('\n')}\n`

describe('review runner context assembly', () => {
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

  // Redaction can LENGTHEN text: a matched secret becomes `prefix + '[REDACTED]'`.
  // The budget used to be measured on the raw file and then applied to the
  // redacted string, so the tail of an instruction could be cut while the ledger
  // recorded `included` and equal byte counts — a record asserting no loss while
  // losing. Both now measure the text the model actually receives.
  test('an instruction that redaction lengthens is not silently cut', async () => {
    const root = await createTempDir()

    try {
      const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz012345'
      await writeFile(
        join(root, 'AGENTS.md'),
        `Never leak ${secret}. Keep this trailing sentence intact.`
      )
      const config = CodeReviewerConfigSchema.parse({
        instructions: { files: [{ path: 'AGENTS.md' }] }
      })

      const result = await prepareReviewRunnerContextState({
        repositoryRoot: root,
        config,
        sourceFiles: [{ path: 'src/a.ts', content: 'export const a = 1\n' }],
        analysis: { facts: [], evidence: [] },
        reviewedDiffText: '',
        tasks: [taskFor('src/a.ts')]
      })
      const instruction = result.assembledContext.instructions[0]

      expect(instruction?.content).not.toContain(secret)
      // The sentence AFTER the redaction survives: the budget grew with the text.
      expect(instruction?.content).toContain('Keep this trailing sentence intact.')

      const entry = result.assembledContext.contextLedger.find(
        (ledgerEntry) => ledgerEntry.kind === 'instruction'
      )

      expect(entry?.decision).toBe('included')
      expect(entry?.bytesIncluded).toBe(entry?.bytesConsidered)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('assembles instructions, source chunks, support-signal context, and ledger entries', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'AGENTS.md'), 'Do not leak secrets.')
      const sourceContent = 'export const alpha = 1\n'
      const evidence = EvidenceRecordSchema.parse({
        id: 'ev_alpha',
        kind: 'diagnostic',
        summary: 'alpha declaration detected',
        location: { path: 'src/a.ts', startLine: 1, side: 'file' },
        source: 'deterministic-support-signal',
        redactionApplied: true
      })
      const config = CodeReviewerConfigSchema.parse({
        review: { contextMaxBytes: 10000 },
        instructions: {
          files: [{ path: 'AGENTS.md' }],
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
              endLine: 1,
              summary: 'alpha declaration',
              contentHash: sha256(sourceContent)
            }
          ],
          evidence: [evidence]
        },
        reviewedDiffText: '',
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

      // The serialized support-signal document carries only what a model can use.
      // Fact ids and the file content hash are internal bookkeeping — no prompt
      // refers to either, and the hash is repeated verbatim on every fact for the
      // file — so they must not reach a model packet. They stay on the fact
      // records themselves, which clustering and evidence still need.
      const supportSignalDocument = result.tasks[0]?.reviewContext.find(
        (context) => context.kind === 'support-signal-output'
      )
      const serializedFacts = JSON.parse(supportSignalDocument?.content ?? '{}')

      expect(serializedFacts.facts).toEqual([
        {
          language: 'typescript',
          kind: 'declaration',
          path: 'src/a.ts',
          name: 'alpha',
          line: 1,
          summary: 'alpha declaration'
        }
      ])
      expect(supportSignalDocument?.content).not.toContain('fact_alpha')
      expect(supportSignalDocument?.content).not.toContain(sha256(sourceContent))
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
              endLine: 1,
              summary: 'alpha declaration',
              contentHash: sha256(sourceContent)
            }
          ],
          evidence: []
        },
        reviewedDiffText: '',
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
        kind: 'diagnostic',
        summary: 'alpha declaration detected',
        location: { path: 'src/a.ts', startLine: 1, side: 'file' },
        source: 'deterministic-support-signal',
        redactionApplied: true
      })
      const config = CodeReviewerConfigSchema.parse({
        review: { contextMaxBytes: 10000 },
        instructions: {
          files: [{ path: 'AGENTS.md' }]
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
              endLine: 1,
              summary: 'alpha declaration',
              contentHash: sha256(sourceContent)
            }
          ],
          evidence: [evidence]
        },
        reviewedDiffText: '',
        tasks: [taskFor('src/a.ts')]
      })

      expect(result.metrics).toEqual({
        ledgerEntryCount: result.assembledContext.contextLedger.length,
        workflowTaskCount: result.assembledContext.tasks.length,
        instructionCount: result.assembledContext.instructions.length,
        skillCount: result.assembledContext.skills.length,
        // Nothing was dropped here, and the metric says so rather than being
        // absent. The collector counted its own omissions all along; the call
        // site discarded them, so a run whose dependency context was cut looked
        // identical to one with no dependencies to add.
        referencedDefinitionsDroppedCount: 0
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

  test('assembles a large file WHOLE, however small the configured context is', async () => {
    // Spec 26: assembly does not split on a byte budget. `contextMaxBytes` is set
    // well below the file here, and it must make no difference — before this, the
    // same input produced two partial tasks in place of one whole-file review.
    const config = CodeReviewerConfigSchema.parse({
      review: { contextMaxBytes: 10000 }
    })
    const largeSource = 'x'.repeat(5000)

    const result = await assembleContext({
      repositoryRoot: '/unused',
      config,
      sourceFiles: [{ path: 'src/large.ts', content: largeSource }],
      analysis: { facts: [], evidence: [] },
      reviewedDiffText: '',
      tasks: [taskFor('src/large.ts')]
    })

    const fileContexts = result.tasks.flatMap((task) =>
      task.reviewContext.filter((context) => context.kind === 'file')
    )

    expect(result.tasks).toHaveLength(1)
    expect(fileContexts).toHaveLength(1)
    expect(fileContexts[0]?.content).toBe(largeSource)
    expect(
      result.contextLedger.filter((entry) => entry.kind === 'file')
    ).toHaveLength(1)
    expect(
      result.contextLedger
        .filter((entry) => entry.kind === 'file')
        .reduce((total, entry) => total + entry.bytesIncluded, 0)
    ).toBe(5000)
  })

  test('gives a whole-file document the file’s full line span, with multi-byte content', async () => {
    // The span still matters after spec 26: a task the PROVIDER refuses is halved
    // reactively, and the halves offset their line numbers from this origin. A span
    // derived by counting bytes (or assuming one byte per character) lands on the
    // wrong line for multi-byte content, which is why the fixture is multi-byte.
    const config = CodeReviewerConfigSchema.parse({
      review: { contextMaxBytes: 10000 }
    })
    const sourceContent = multiByteSource(200)

    const result = await assembleContext({
      repositoryRoot: '/unused',
      config,
      sourceFiles: [{ path: 'src/large.ts', content: sourceContent }],
      analysis: { facts: [], evidence: [] },
      reviewedDiffText: '',
      tasks: [taskFor('src/large.ts')]
    })

    const fileContexts = result.tasks.flatMap((task) =>
      task.reviewContext.filter((context) => context.kind === 'file')
    )

    expect(fileContexts).toHaveLength(1)
    expect(fileContexts[0]?.content).toBe(sourceContent)
    expect(fileContexts[0]?.startLine).toBe(1)
    expect(fileContexts[0]?.endLine).toBe(sourceContent.split('\n').length)
  })
})
