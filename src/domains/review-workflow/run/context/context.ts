import { readFile } from 'node:fs/promises'
import { resolveExistingPathInsideRoot } from '../../../../platform/path-service.js'
import type { CodeReviewerConfig } from '../../../../shared/contracts/index.js'
import { redactText } from '../../../../shared/redaction/redactor.js'
import { sha256 } from '../../../../shared/hash/hash.js'
import { utf8ByteLength } from '../../../../shared/text/utf8-bytes.js'
import { uniqueSorted } from '../../../../shared/text/unique-sorted.js'
import {
  reviewedLineRangeForContent,
  sourceLineCount,
  type ReviewedDiffRange,
  type ReviewedLineRange
} from '../../../admission/index.js'
import {
  discoverDeterministicSignalTestMappings,
  type DeterministicSignalExtraction,
  type SupportSignalFact,
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
  // Absolute origin of a 'file' chunk in its source file. Present only for source
  // chunks; support-signal and referenced-definition context has no place in the
  // reviewed file to point at.
  readonly startLine?: number
  readonly endLine?: number
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

const workflowTaskPaths = (
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
      const contentBytes = utf8ByteLength(inputContext.content)
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
        // The chunk's origin travels with the document because everything
        // downstream (line-numbered rendering, admission) sees only the document,
        // never the split that produced it.
        ...(inputContext.startLine === undefined ||
        inputContext.endLine === undefined
          ? {}
          : {
              startLine: inputContext.startLine,
              endLine: inputContext.endLine
            }),
        content: redactText(inputContext.content),
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

  // A single-file task carrying only its own source keeps the planner's id, so the
  // common case stays traceable straight back to planning; anything else gets an id
  // derived from what it actually carries.
  //
  // The literal `batch:0` is a fossil of the removed proactive byte-budget split,
  // which numbered several batches per task. It is kept verbatim rather than tidied
  // away because the id is hashed into every candidate and evidence id the task
  // produces, and rewriting the seed would silently renumber all of them.
  const workflowTaskId = (
    task: ReviewTask,
    contexts: readonly ContextInput[]
  ): string =>
    contexts.length === 1 &&
    contexts[0]?.kind === 'file' &&
    task.paths.length === 1
      ? task.id
      : `task_${sha256(
          `${task.id}:batch:0:${contexts
            .map((context) => `${context.kind}:${context.path ?? ''}`)
            .join('|')}`
        ).slice(0, 16)}`

  const tasks: WorkflowReviewTask[] = []
  const testMappings = discoverDeterministicSignalTestMappings(input.sourceFiles)
  // Every changed/source file path: referenced-definition resolution must never
  // surface one of these (they are reviewed directly, not injected as context).
  const allSourcePaths = new Set(
    input.sourceFiles.map((sourceFile) => sourceFile.path)
  )

  // What a MODEL can use out of a deterministic fact, which is not the same thing
  // as what the engine stores in one.
  //
  // `id` and `contentHash` are internal bookkeeping: no prompt refers to a fact id
  // (the refuter cites evidence ids, which are a different namespace), and the
  // content hash is the file's, so every fact for one file repeats the same
  // 64-character hex string. Serializing the raw record put both in front of the
  // model, and measurement over the 37-case corpus priced them: the facts document
  // was 26.0% of ALL model input bytes, and inside it `contentHash` was 25.6% and
  // `id` 8.7% — 3,244 facts carrying just 44 distinct hashes, or 8.9% of every
  // byte this engine sends, in opaque hex that tokenizes at roughly one token per
  // two characters. Projecting here rather than narrowing `SupportSignalFact`
  // keeps the internal record intact for clustering, evidence and change-impact,
  // which all need the id.
  const modelFacingSupportSignalFact = (fact: SupportSignalFact) => ({
    language: fact.language,
    kind: fact.kind,
    path: fact.path,
    name: fact.name,
    ...(fact.moduleSpecifier === undefined
      ? {}
      : { moduleSpecifier: fact.moduleSpecifier }),
    line: fact.line,
    summary: fact.summary
  })

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
            facts: supportSignalFacts.map(modelFacingSupportSignalFact),
            testMappings: supportSignalTestMappings
          })

    return utf8ByteLength(supportSignalContext) === 0
      ? []
      : [
          {
            kind: 'support-signal-output' as const,
            content: supportSignalContext
          }
        ]
  }

  for (const task of input.tasks) {
    const taskPathSet = new Set(task.paths)
    const taskSourceFiles = input.sourceFiles.filter((sourceFile) =>
      taskPathSet.has(sourceFile.path)
    )
    // Spec 26: assembly does NOT split. Each changed file is ONE document spanning
    // the whole file, and the task is ONE batch, however large it comes out. The
    // span is still recorded because a document that the PROVIDER later refuses is
    // split reactively into pieces that must keep the file's real line numbers.
    //
    // What this replaces was a byte budget guessed in advance, and it was wrong in
    // both directions at once: bytes are a poor proxy for tokens, so the guess erred
    // by a content-dependent factor, and the value was small enough to fire on 37%
    // of this repository's last 60 commits against context windows one to two orders
    // of magnitude larger. Every one of those splits substituted several partial
    // reviews for the whole-file holistic review this project MEASURED as better,
    // and charged an extra discovery-plus-refutation pair for the privilege.
    const sourceContexts = taskSourceFiles.map((file) => ({
      kind: 'file' as const,
      path: file.path,
      content: file.content,
      startLine: 1,
      endLine: Math.max(1, sourceLineCount(file.content))
    }))
    // Spec 26 again: the task's whole context is ONE document set, not a series of
    // byte-sized batches.
    const taskContexts: ContextInput[] = [
      ...sourceContexts,
      ...supportSignalContextsForPaths(
        task,
        sourceContexts.length === 0
          ? taskPathSet
          : new Set(workflowTaskPaths(sourceContexts, task.paths))
      )
    ]

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
          ).digests.map((digest) => ({
            kind: 'referenced-definition' as const,
            path: digest.path,
            content: digest.content
          }))

    // A task with nothing to show the reviewer produces no workflow task at all.
    if (taskContexts.length > 0) {
      tasks.push(
        createWorkflowTask(
          task,
          workflowTaskId(task, taskContexts),
          taskContexts,
          workflowTaskPaths(taskContexts, task.paths),
          referencedDefinitionContexts
        )
      )
    }
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
