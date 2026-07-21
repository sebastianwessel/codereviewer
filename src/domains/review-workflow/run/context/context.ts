import { readFile } from 'node:fs/promises'
import { resolveExistingPathInsideRoot } from '../../../../platform/path-service.js'
import type { CodeReviewerConfig } from '../../../../shared/contracts/index.js'
import { createRedactor } from '../../../../shared/redaction/redactor.js'
import { sha256 } from '../../../../shared/hash/hash.js'
import {
  reviewedLineRangeForContent,
  type ReviewedDiffRange,
  type ReviewedLineRange
} from '../../../admission/index.js'
import {
  discoverDeterministicSignalTestMappings,
  type DeterministicSignalExtraction,
  type SupportSignalSourceFile
} from '../../../deterministic-signals/index.js'
import { type ReviewTask } from '../../../review-planning/index.js'
import {
  createContextLedgerEntry,
  type ContextLedgerEntry
} from '../../../review-planning/context-ledger.js'
import type { DiffMap } from '../../../repository-intake/index.js'
import type { SkillsConfig } from '@purista/harness'
import type { ReviewWorkflowInput } from '../../harness/workflow.js'
import { sourceChunkBudgetFor } from '../support/budgets.js'
import {
  provenanceHashesFromContextLedger,
  type ReviewRunnerProvenanceHashes
} from '../support/provenance.js'
import {
  loadStaticReviewContext,
  type InstructionContextDocument,
  type SkillContextDocument
} from './static-context.js'
import { collectReferencedDefinitions } from './referenced-definitions.js'

export type {
  InstructionContextDocument,
  SkillContextDocument
} from './static-context.js'

type ReviewContextDocument = NonNullable<
  ReviewWorkflowInput['reviewContext']
>[number]
export type WorkflowReviewTask = NonNullable<
  ReviewWorkflowInput['tasks']
>[number]
export type ContextAssemblyResult = {
  readonly reviewContext: readonly ReviewContextDocument[]
  readonly tasks: readonly WorkflowReviewTask[]
  readonly instructions: readonly InstructionContextDocument[]
  readonly skills: readonly SkillContextDocument[]
  readonly skillDefinitions: SkillsConfig
  readonly skillIds: readonly string[]
  readonly contextLedger: readonly ContextLedgerEntry[]
}

export type ReviewRunnerContextStateMetrics = {
  readonly ledgerEntryCount: number
  readonly workflowTaskCount: number
  readonly instructionCount: number
  readonly skillCount: number
}

export type ReviewRunnerContextState = ReviewRunnerProvenanceHashes & {
  readonly assembledContext: ContextAssemblyResult
  readonly metrics: ReviewRunnerContextStateMetrics
}

type ContextInput = {
  readonly content: string
  readonly kind: ReviewContextDocument['kind']
  readonly path?: string
}

export const readChangedSourceFiles = async (
  input: {
    readonly repositoryRoot: string
    readonly changedFiles: readonly { readonly path: string }[]
  }
): Promise<readonly SupportSignalSourceFile[]> =>
  Promise.all(
    input.changedFiles.map(async (file) => ({
      path: file.path,
      content: await readFile(
        await resolveExistingPathInsideRoot(input.repositoryRoot, file.path),
        'utf8'
      )
    }))
  )

export const reviewedLineRangesForSourceFiles = (
  sourceFiles: readonly SupportSignalSourceFile[]
): readonly ReviewedLineRange[] =>
  sourceFiles.map((sourceFile) =>
    reviewedLineRangeForContent({
      path: sourceFile.path,
      content: sourceFile.content
    })
  )

export const reviewedDiffRangesForDiffMaps = (
  diffMaps: readonly DiffMap[]
): readonly ReviewedDiffRange[] =>
  diffMaps.flatMap((diffMap) =>
    diffMap.hunks
      .filter((hunk) => hunk.newLineCount > 0)
      .map((hunk) => ({
        path: diffMap.path,
        startLine: hunk.newStartLine,
        endLine: hunk.newStartLine + hunk.newLineCount - 1,
        changeKind: diffMap.changeKind
      }))
  )

const bytesOf = (value: string): number => Buffer.byteLength(value)

const sliceUtf8 = (value: string, maxBytes: number): string =>
  Buffer.from(value).subarray(0, Math.max(0, maxBytes)).toString('utf8')

const redacted = (value: string): string => createRedactor().redact(value)

export const splitTextByUtf8Bytes = (
  content: string,
  maxBytes: number
): readonly string[] => {
  if (maxBytes < 1) {
    throw new TypeError('maxBytes must be greater than 0.')
  }

  if (content.length === 0) {
    return ['']
  }

  const chunks: string[] = []
  let current = ''
  let currentBytes = 0

  for (const character of content) {
    const characterBytes = bytesOf(character)

    if (currentBytes > 0 && currentBytes + characterBytes > maxBytes) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }

    current += character
    currentBytes += characterBytes
  }

  if (current.length > 0 || chunks.length === 0) {
    chunks.push(current)
  }

  return chunks
}

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right))

const contextBytes = (contexts: readonly ContextInput[]): number =>
  contexts.reduce((total, context) => total + bytesOf(context.content), 0)

const workflowTaskPaths = (
  task: ReviewTask,
  contexts: readonly ContextInput[],
  fallbackPaths: readonly string[]
): readonly string[] => {
  const contextPaths = contexts
    .map((context) => context.path)
    .filter((path): path is string => path !== undefined)

  return contextPaths.length > 0 ? uniqueSorted(contextPaths) : fallbackPaths
}

export const assembleContext = async (
  input: {
    readonly repositoryRoot: string
    readonly config: CodeReviewerConfig
    readonly sourceFiles: readonly SupportSignalSourceFile[]
    readonly analysis: DeterministicSignalExtraction
    readonly tasks: readonly ReviewTask[]
  }
): Promise<ContextAssemblyResult> => {
  const staticContext = await loadStaticReviewContext({
    repositoryRoot: input.repositoryRoot,
    config: input.config
  })
  const contextLedger: ContextLedgerEntry[] = [...staticContext.contextLedger]

  const createWorkflowTask = (
    task: ReviewTask,
    taskId: string,
    inputContexts: readonly ContextInput[],
    paths: readonly string[],
    // Referenced-definition contexts (R4) are appended to reviewContext but MUST
    // NOT influence task.paths: they are unchanged dependency files included for
    // context only, never review targets. They are passed separately so the
    // caller can derive paths solely from the changed-file/support-signal batch.
    referencedDefinitionContexts: readonly ContextInput[] = []
  ): WorkflowReviewTask => {
    const reviewContext: ReviewContextDocument[] = []
    const contextEntryIds: string[] = []
    const pathSet = new Set(paths)

    for (const inputContext of [
      ...inputContexts,
      ...referencedDefinitionContexts
    ]) {
      const contentBytes = bytesOf(inputContext.content)
      const ledgerEntry = createContextLedgerEntry({
        // The context ledger has no dedicated kinds for 'test-mapping',
        // 'referenced-definition', or 'change-intent'; all are recorded as
        // support-signal-output (derived context, not a reviewed changed file).
        // 'change-intent' is injected by a separate stage and never reaches this
        // assembly loop, but the mapping keeps the kind union exhaustive.
        kind:
          inputContext.kind === 'test-mapping' ||
          inputContext.kind === 'referenced-definition' ||
          inputContext.kind === 'change-intent'
            ? 'support-signal-output'
            : inputContext.kind,
        ...(inputContext.path === undefined ? {} : { path: inputContext.path }),
        taskId,
        reason:
          inputContext.kind === 'file'
            ? 'task-context-source-chunk'
            : inputContext.kind === 'referenced-definition'
              ? 'task-context-referenced-definition'
              : 'task-context-support-signal-chunk',
        decision: 'included',
        bytesConsidered: contentBytes,
        bytesIncluded: contentBytes,
        content: inputContext.content
      })
      const contextDocument: ReviewContextDocument = {
        kind: inputContext.kind,
        ...(inputContext.path === undefined ? {} : { path: inputContext.path }),
        content: redacted(inputContext.content),
        ledgerEntryId: ledgerEntry.id
      }

      contextLedger.push(ledgerEntry)
      reviewContext.push(contextDocument)
      contextEntryIds.push(ledgerEntry.id)
    }

    return {
      ...task,
      id: taskId,
      paths: [...paths],
      factIds: input.analysis.facts
        .filter((fact) => pathSet.has(fact.path))
        .map((fact) => fact.id),
      evidenceIds: input.analysis.evidence
        .filter(
          (record) =>
            task.evidenceIds.includes(record.id) &&
            pathSet.has(record.location?.path ?? '')
        )
        .map((record) => record.id),
      candidateIds: [],
      reviewContext,
      contextEntryIds
    }
  }

  const workflowTaskId = (
    task: ReviewTask,
    input: {
      readonly contexts: readonly ContextInput[]
      readonly batchIndex: number
      readonly batchCount: number
    }
  ): string =>
    input.batchCount === 1 &&
    input.contexts.length === 1 &&
    input.contexts[0]?.kind === 'file' &&
    task.paths.length === 1
      ? task.id
      : `task_${sha256(
          `${task.id}:batch:${input.batchIndex}:${input.contexts
            .map((context) => `${context.kind}:${context.path ?? ''}`)
            .join('|')}`
        ).slice(0, 16)}`

  const tasks: WorkflowReviewTask[] = []
  const chunkBudget = sourceChunkBudgetFor(input.config)
  const testMappings = discoverDeterministicSignalTestMappings(input.sourceFiles)
  // Every changed/source file path: referenced-definition resolution must never
  // surface one of these (they are reviewed directly, not injected as context).
  const allSourcePaths = new Set(
    input.sourceFiles.map((sourceFile) => sourceFile.path)
  )

  const supportSignalContextsForPaths = (
    task: ReviewTask,
    pathSet: ReadonlySet<string>
  ): readonly ContextInput[] => {
    // `deterministicSignalMode: 'disabled'` keeps deterministic facts for free
    // task clustering (already applied by the planner) but does not inject the
    // serialized support-signal facts into the model packet, since that structural
    // summary is largely redundant with the source the model already reads.
    if (input.config.aiReview.deterministicSignalMode === 'disabled') {
      return []
    }

    const supportSignalFacts = input.analysis.facts.filter(
      (fact) => task.factIds.includes(fact.id) && pathSet.has(fact.path)
    )
    const supportSignalTestMappings = testMappings.filter(
      (mapping) =>
        pathSet.has(mapping.sourcePath) || pathSet.has(mapping.testPath)
    )
    const supportSignalContext =
      supportSignalFacts.length === 0 && supportSignalTestMappings.length === 0
        ? ''
        : JSON.stringify({
            facts: supportSignalFacts,
            testMappings: supportSignalTestMappings
          })

    return bytesOf(supportSignalContext) === 0
      ? []
      : splitTextByUtf8Bytes(supportSignalContext, chunkBudget).map((chunk) => ({
          kind: 'support-signal-output' as const,
          content: chunk
        }))
  }

  const packContexts = (
    contexts: readonly ContextInput[]
  ): readonly (readonly ContextInput[])[] => {
    const batches: ContextInput[][] = []
    let pending: ContextInput[] = []
    let pendingBytes = 0

    const flush = (): void => {
      if (pending.length > 0) {
        batches.push(pending)
        pending = []
        pendingBytes = 0
      }
    }

    for (const context of contexts) {
      const currentBytes = bytesOf(context.content)

      if (pending.length > 0 && pendingBytes + currentBytes > chunkBudget) {
        flush()
      }

      pending.push(context)
      pendingBytes += currentBytes
    }

    flush()

    return batches
  }

  for (const task of input.tasks) {
    const taskPathSet = new Set(task.paths)
    const taskSourceFiles = input.sourceFiles.filter((sourceFile) =>
      taskPathSet.has(sourceFile.path)
    )
    const sourceContexts = taskSourceFiles.flatMap((file) =>
      splitTextByUtf8Bytes(file.content, chunkBudget).map((chunk) => ({
        kind: 'file' as const,
        path: file.path,
        content: chunk
      }))
    )
    const batches: ContextInput[][] = []
    const supportSignalAttachedPaths = new Set<string>()

    for (const batch of packContexts(sourceContexts)) {
      const batchPaths = workflowTaskPaths(task, batch, task.paths)
      const newSupportSignalPaths = batchPaths.filter(
        (pathValue) => !supportSignalAttachedPaths.has(pathValue)
      )
      const supportSignalContexts = supportSignalContextsForPaths(
        task,
        new Set(newSupportSignalPaths)
      )
      const packedBatch = [...batch]
      const standaloneSupportSignalContexts: ContextInput[] = []
      let packedBytes = contextBytes(packedBatch)

      for (const supportSignalContext of supportSignalContexts) {
        const supportSignalBytes = bytesOf(supportSignalContext.content)

        if (packedBytes + supportSignalBytes <= chunkBudget) {
          packedBatch.push(supportSignalContext)
          packedBytes += supportSignalBytes
        } else {
          standaloneSupportSignalContexts.push(supportSignalContext)
        }
      }

      batches.push(packedBatch)
      batches.push(
        ...packContexts(standaloneSupportSignalContexts).map((contextBatch) => [
          ...contextBatch
        ])
      )

      for (const pathValue of newSupportSignalPaths) {
        supportSignalAttachedPaths.add(pathValue)
      }
    }

    if (sourceContexts.length === 0) {
      batches.push(
        ...packContexts(supportSignalContextsForPaths(task, taskPathSet)).map(
          (contextBatch) => [...contextBatch]
        )
      )
    }

    // R4: collect bounded referenced-definition digests for unchanged files the
    // task's changed files import (relative imports only). Context only — these
    // never enter task.paths and are not review targets. `allSourcePaths` covers
    // every changed file so a dependency that happens to be changed is excluded.
    const referencedDefinitionContexts: ContextInput[] =
      input.config.aiReview.deterministicSignalMode === 'disabled'
        ? []
        : (
            await collectReferencedDefinitions({
              repositoryRoot: input.repositoryRoot,
              taskPaths: task.paths,
              facts: input.analysis.facts,
              knownPaths: allSourcePaths
            })
          ).map((digest) => ({
            kind: 'referenced-definition' as const,
            path: digest.path,
            content: digest.content
          }))

    batches.forEach((batch, index) => {
      const paths = workflowTaskPaths(task, batch, task.paths)

      tasks.push(
        createWorkflowTask(
          task,
          workflowTaskId(task, {
            contexts: batch,
            batchIndex: index,
            batchCount: batches.length
          }),
          batch,
          paths,
          referencedDefinitionContexts
        )
      )
    })
  }
  const reviewContextById = new Map<string, ReviewContextDocument>()

  for (const task of tasks) {
    for (const context of task.reviewContext) {
      reviewContextById.set(context.ledgerEntryId, context)
    }
  }

  return {
    reviewContext: [...reviewContextById.values()],
    tasks,
    instructions: staticContext.instructions,
    skills: staticContext.skills,
    skillDefinitions: staticContext.skillDefinitions,
    skillIds: staticContext.skillIds,
    contextLedger
  }
}

export const prepareReviewRunnerContextState = async (
  input: Parameters<typeof assembleContext>[0]
): Promise<ReviewRunnerContextState> => {
  const assembledContext = await assembleContext(input)

  return {
    assembledContext,
    ...provenanceHashesFromContextLedger(assembledContext.contextLedger),
    metrics: {
      ledgerEntryCount: assembledContext.contextLedger.length,
      workflowTaskCount: assembledContext.tasks.length,
      instructionCount: assembledContext.instructions.length,
      skillCount: assembledContext.skills.length
    }
  }
}
