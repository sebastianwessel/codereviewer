// Spec 04, path-scoped reviewer instructions, asserted where it is actually
// observable: the MODEL PACKETS.
//
// `selectInstructionsForFiles` being correct proves nothing on its own — the
// defect this suite exists to prevent is a correct selector that no packet
// builder consults, which is exactly the state this feature shipped in first:
// the documentation said a scoped file reached only matching packets while the
// run attached every instruction to every packet.
//
// So each test drives the real path end to end: a repository with a scoped
// instruction file, through `assembleContext`, into `taskReviewInputFor`
// (discovery) and `findingRefutationBatchInput` (refutation). Both stages must
// agree, because an instruction that reaches discovery and not refutation is
// adjudicated against rules the adjudicator was never shown.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../../../shared/contracts/index.js'
import type { CandidateFinding } from '../../../admission/index.js'
import type { ReviewTask } from '../../../review-planning/index.js'
import { taskReviewInputFor } from '../../pipeline/discovery/task-packet.js'
import { findingRefutationBatchInput } from '../../pipeline/refutation/packet.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from '../../pipeline/contracts.js'
import { type WorkflowReviewTask } from '../../pipeline/agent-contracts.js'
import { assembleContext } from './context.js'

const configHash =
  '5555555555555555555555555555555555555555555555555555555555555555'

const BACKEND_INSTRUCTION = 'Backend guidance: every query filters by tenant.'
const REPO_WIDE_INSTRUCTION = 'Repository guidance: never log a secret.'
const INLINE_INSTRUCTION = 'Inline guidance: prefer explicit errors.'

const createTempDir = async (): Promise<string> => {
  const directory = join(
    tmpdir(),
    `codereviewer-instruction-scope-${crypto.randomUUID()}`
  )
  await mkdir(directory, { recursive: true })
  return directory
}

const plannedTask = (id: string, path: string): ReviewTask => ({
  id,
  round: 1,
  kind: 'file',
  paths: [path],
  factIds: [],
  evidenceIds: [],
  candidateIds: [],
  contextEntryIds: [],
  priority: 0
})

// One repository, one scoped instruction, one unscoped instruction, inline text,
// and two single-file tasks: one inside the scope and one outside it.
const assembleScopedRun = async (
  root: string
): Promise<Awaited<ReturnType<typeof assembleContext>>> => {
  await mkdir(join(root, 'backend'), { recursive: true })
  await mkdir(join(root, 'frontend'), { recursive: true })
  await writeFile(join(root, 'backend', 'api.ts'), 'export const api = 1\n')
  await writeFile(join(root, 'frontend', 'app.ts'), 'export const app = 1\n')
  await writeFile(join(root, 'BACKEND.md'), BACKEND_INSTRUCTION)
  await writeFile(join(root, 'AGENTS.md'), REPO_WIDE_INSTRUCTION)

  const config = CodeReviewerConfigSchema.parse({
    aiReview: { deterministicSignalMode: 'disabled' },
    instructions: {
      files: [
        { path: 'BACKEND.md', scope: ['backend/**'] },
        { path: 'AGENTS.md' }
      ],
      inline: INLINE_INSTRUCTION
    }
  })

  return assembleContext({
    repositoryRoot: root,
    config,
    sourceFiles: [
      { path: 'backend/api.ts', content: 'export const api = 1\n' },
      { path: 'frontend/app.ts', content: 'export const app = 1\n' }
    ],
    analysis: { facts: [], evidence: [] },
    tasks: [
      plannedTask('task_backend', 'backend/api.ts'),
      plannedTask('task_frontend', 'frontend/app.ts')
    ]
  })
}

const taskFor = (
  tasks: readonly WorkflowReviewTask[],
  path: string
): WorkflowReviewTask => {
  const task = tasks.find((entry) => entry.paths.includes(path))

  if (task === undefined) {
    throw new Error(`No assembled task covers ${path}.`)
  }

  return task
}

const workflowInputFor = (
  tasks: readonly WorkflowReviewTask[]
): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-instruction-scoping',
    reviewedPaths: ['backend/api.ts', 'frontend/app.ts'],
    reviewedDiffRanges: [
      { path: 'backend/api.ts', startLine: 1, endLine: 1 },
      { path: 'frontend/app.ts', startLine: 1, endLine: 1 }
    ],
    evidence: [],
    candidates: [],
    skills: [],
    tasks,
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

const candidateFor = (task: WorkflowReviewTask): CandidateFinding => ({
  id: `cand_${task.id}`,
  taskId: task.id,
  category: 'bug',
  severity: 'high',
  title: 'A concrete defect',
  description: 'The changed line can produce a wrong result.',
  location: {
    path: task.paths[0] ?? 'backend/api.ts',
    startLine: 1,
    side: 'file'
  },
  evidenceIds: [],
  proposedBy: 'review-agent'
})

const instructionContentsInDiscoveryPacket = (
  workflowInput: ReviewWorkflowInput,
  task: WorkflowReviewTask
): readonly string[] =>
  taskReviewInputFor(workflowInput, task).task.instructions.map(
    (instruction) => instruction.content
  )

const instructionContentsInRefutationPacket = (
  workflowInput: ReviewWorkflowInput,
  task: WorkflowReviewTask
): readonly string[] => {
  const candidate = candidateFor(task)

  return findingRefutationBatchInput({
    workflowInput,
    task,
    candidates: [candidate],
    allCandidates: [candidate]
  }).instructions.map((instruction) => instruction.content)
}

describe('path-scoped reviewer instructions in the model packets', () => {
  test('a scoped instruction is absent from the discovery AND refutation packets of a task whose files do not match', async () => {
    const root = await createTempDir()

    try {
      const assembled = await assembleScopedRun(root)
      const workflowInput = workflowInputFor(assembled.tasks)
      const frontend = taskFor(assembled.tasks, 'frontend/app.ts')

      // Absent from the packet a discovery call is built from...
      expect(
        instructionContentsInDiscoveryPacket(workflowInput, frontend)
      ).toEqual([REPO_WIDE_INSTRUCTION, INLINE_INSTRUCTION])
      // ...and from the packet that adjudicates its candidates. Refutation is
      // where withheld guidance is invisible: a candidate refuted for want of a
      // rule produces no output at all.
      expect(
        instructionContentsInRefutationPacket(workflowInput, frontend)
      ).toEqual([REPO_WIDE_INSTRUCTION, INLINE_INSTRUCTION])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a scoped instruction is present in the discovery AND refutation packets of a task whose files do match', async () => {
    const root = await createTempDir()

    try {
      const assembled = await assembleScopedRun(root)
      const workflowInput = workflowInputFor(assembled.tasks)
      const backend = taskFor(assembled.tasks, 'backend/api.ts')

      expect(
        instructionContentsInDiscoveryPacket(workflowInput, backend)
      ).toEqual([
        BACKEND_INSTRUCTION,
        REPO_WIDE_INSTRUCTION,
        INLINE_INSTRUCTION
      ])
      expect(
        instructionContentsInRefutationPacket(workflowInput, backend)
      ).toEqual([
        BACKEND_INSTRUCTION,
        REPO_WIDE_INSTRUCTION,
        INLINE_INSTRUCTION
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The two stages reading one field is what makes this hold by construction
  // rather than by two call sites happening to agree today.
  test('both stages receive the identical instruction set for one task', async () => {
    const root = await createTempDir()

    try {
      const assembled = await assembleScopedRun(root)
      const workflowInput = workflowInputFor(assembled.tasks)

      for (const path of ['backend/api.ts', 'frontend/app.ts']) {
        const task = taskFor(assembled.tasks, path)

        expect(instructionContentsInRefutationPacket(workflowInput, task)).toEqual(
          instructionContentsInDiscoveryPacket(workflowInput, task)
        )
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('an instruction scoped out of a task is recorded as skipped on the context ledger, not silently dropped', async () => {
    const root = await createTempDir()

    try {
      const assembled = await assembleScopedRun(root)
      const frontend = taskFor(assembled.tasks, 'frontend/app.ts')
      const backend = taskFor(assembled.tasks, 'backend/api.ts')
      const skippedEntries = assembled.contextLedger.filter(
        (entry) => entry.kind === 'instruction' && entry.decision === 'skipped'
      )

      // Exactly one: the backend-scoped file, withheld from the frontend task
      // only. A reader can therefore tell "scoped out of THIS task" from "never
      // loaded at all" — the loaded entry is still there, decided 'included'.
      expect(
        skippedEntries.map((entry) => ({
          path: entry.path,
          taskId: entry.taskId,
          reason: entry.reason,
          bytesIncluded: entry.bytesIncluded
        }))
      ).toEqual([
        {
          path: 'BACKEND.md',
          taskId: frontend.id,
          reason: 'instruction-scope-excluded',
          bytesIncluded: 0
        }
      ])
      // What was withheld is stated in bytes, so the record says how much
      // guidance the packet did not get rather than implying there was none.
      expect(skippedEntries[0]?.bytesConsidered).toBe(
        Buffer.byteLength(BACKEND_INSTRUCTION)
      )
      // And the load itself is still recorded, once, as included.
      expect(
        assembled.contextLedger.filter(
          (entry) =>
            entry.kind === 'instruction' &&
            entry.path === 'BACKEND.md' &&
            entry.decision === 'included'
        )
      ).toHaveLength(1)
      expect(backend.id).not.toBe(frontend.id)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('an unscoped run attaches every instruction to every task, unchanged from before scoping existed', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'backend'), { recursive: true })
      await mkdir(join(root, 'frontend'), { recursive: true })
      await writeFile(join(root, 'AGENTS.md'), REPO_WIDE_INSTRUCTION)
      const config = CodeReviewerConfigSchema.parse({
        aiReview: { deterministicSignalMode: 'disabled' },
        instructions: { files: [{ path: 'AGENTS.md' }] }
      })

      const assembled = await assembleContext({
        repositoryRoot: root,
        config,
        sourceFiles: [
          { path: 'backend/api.ts', content: 'export const api = 1\n' },
          { path: 'frontend/app.ts', content: 'export const app = 1\n' }
        ],
        analysis: { facts: [], evidence: [] },
        tasks: [
          plannedTask('task_backend', 'backend/api.ts'),
          plannedTask('task_frontend', 'frontend/app.ts')
        ]
      })

      expect(
        assembled.tasks.map((task) =>
          task.instructions.map((instruction) => instruction.content)
        )
      ).toEqual([[REPO_WIDE_INSTRUCTION], [REPO_WIDE_INSTRUCTION]])
      // Nothing was withheld, so nothing is disclosed as withheld: a ledger that
      // reported skips on a run with no scopes would be noise that trains a
      // reader to ignore the real ones.
      expect(
        assembled.contextLedger.filter((entry) => entry.decision === 'skipped')
      ).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // A partition (spec 27) or a reactive half (spec 26) reviews a SUBSET of its
  // parent's files and inherits the parent's instruction set. The subset could
  // exclude the file that matched the scope, and re-resolving there would then
  // withhold from the sub-task guidance the parent packet was going to show —
  // the one direction this scoping is not allowed to fail in.
  test('a task carrying one matching file among several keeps the scoped instruction for all of them', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'backend'), { recursive: true })
      await mkdir(join(root, 'frontend'), { recursive: true })
      await writeFile(join(root, 'BACKEND.md'), BACKEND_INSTRUCTION)
      const config = CodeReviewerConfigSchema.parse({
        aiReview: { deterministicSignalMode: 'disabled' },
        instructions: {
          files: [{ path: 'BACKEND.md', scope: ['backend/**'] }]
        }
      })

      const assembled = await assembleContext({
        repositoryRoot: root,
        config,
        sourceFiles: [
          { path: 'backend/api.ts', content: 'export const api = 1\n' },
          { path: 'frontend/app.ts', content: 'export const app = 1\n' }
        ],
        analysis: { facts: [], evidence: [] },
        tasks: [
          {
            ...plannedTask('task_mixed', 'backend/api.ts'),
            kind: 'dependency-cluster',
            paths: ['backend/api.ts', 'frontend/app.ts']
          }
        ]
      })

      expect(assembled.tasks).toHaveLength(1)
      expect(
        assembled.tasks[0]?.instructions.map((instruction) => instruction.content)
      ).toEqual([BACKEND_INSTRUCTION])
      expect(
        assembled.contextLedger.filter((entry) => entry.decision === 'skipped')
      ).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
