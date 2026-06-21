import { randomUUID } from 'node:crypto'
import { sha256 } from '../../shared/hash/hash.js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { OperationTimeoutError } from '@purista/harness'
import type {
  JsonValue,
  Logger,
  ModelAlias,
  ModelProvider,
  ObjectRequest,
  ObjectResponse,
  SkillsConfig
} from '@purista/harness'
import { z } from 'zod'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
import {
  EvidenceRecordSchema,
  ReviewReportSchema,
  type CodeReviewerConfig,
  type EvidenceRecord,
  type ReviewReport,
  type CoverageSummary
} from '../../shared/contracts/index.js'
import {
  normalizeError,
  type StructuredError
} from '../../shared/errors/error-normalizer.js'
import { createRedactor } from '../../shared/redaction/redactor.js'
import {
  admitCandidate,
  CandidateFindingSchema,
  evaluateQualityGate,
  matchBaselineFindings,
  resolveBaselineFingerprints,
  type BaselineFingerprintRecord,
  type CandidateFinding,
  type QualityGateThresholds
} from '../admission/index.js'
import {
  createReviewTaskQueue,
  planReviewTasks,
  createSkillIndex,
  type ReviewTask,
  type ReviewTaskQueueRecord
} from '../review-planning/index.js'
import {
  createContextLedgerEntry,
  createTextContextLedgerEntry,
  type ContextLedgerEntry
} from '../review-planning/context-ledger.js'
import {
  summarizeRunCost,
  type RunCostSummary,
  type RunTokenUsage
} from '../costs/index.js'
import { runDriftCheck } from '../drift/index.js'
import {
  configureOpenTelemetry,
  createNoContentEventRecorder,
  createNoopReviewLogger,
  type NoContentEventRecorder,
  type NoContentObservabilitySnapshot
} from '../observability/index.js'
import {
  analyzeFirstClassLanguageFiles,
  assertAnalyzerEvidenceOwnsPath,
  assertAnalyzerFactOwnsPath,
  languageAnalyzerVersions,
  discoverFirstClassLanguageTests,
  type LanguageSourceFile
} from '../language-analyzers/index.js'
import {
  resolveProviderModelAlias,
  type ProviderImport
} from '../provider-resolution/index.js'
import { collectRepositoryIntake } from '../repository-intake/index.js'
import {
  createModelBackedReviewHarness,
  isReviewTaskExecutionError,
  runModelBackedReviewWorkflow,
  type ScriptedReviewWorkflowInput,
  type ScriptedReviewWorkflowOutput
} from './harness-workflow.js'
import {
  createReviewSharedContext,
  type ReviewSharedContextSnapshot
} from '../shared-context/index.js'

const emptySha256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const reviewWorkflowSessionId = 'review'

const BaselineFileSchema = z.array(
  z.strictObject({
    fingerprints: z.array(
      z.strictObject({
        algorithm: z.string().min(1),
        value: z.string().regex(/^[a-z0-9]+$/)
      })
    )
  })
)

export type RunReviewOptions = {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly configWarnings?: readonly string[]
  readonly baselineExplicitlyConfigured?: boolean
  readonly explicitFiles?: readonly string[]
  readonly baseRef?: string
  readonly headRef?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly providerImport?: ProviderImport
  readonly runId?: string
  readonly now?: () => Date
  readonly signal?: AbortSignal
  readonly observability?: NoContentEventRecorder
  readonly logger?: Logger
}

export type ReviewRunnerResult = {
  readonly report: ReviewReport
  readonly contextLedger: readonly ContextLedgerEntry[]
  readonly sharedContext: ReviewSharedContextSnapshot
  readonly observability: NoContentObservabilitySnapshot
}

export type PartialReviewRunState = {
  readonly artifactRoot: string
  readonly runSummary: ReviewReport['run']
  readonly contextLedger: readonly ContextLedgerEntry[]
  readonly sharedContext: ReviewSharedContextSnapshot
  readonly observability: NoContentObservabilitySnapshot
  readonly error: StructuredError
}

export class ReviewRunFailedError extends Error {
  readonly partialState: PartialReviewRunState
  readonly structuredError: StructuredError

  constructor(input: {
    readonly partialState: PartialReviewRunState
    readonly structuredError: StructuredError
  }) {
    super(input.structuredError.message)
    this.name = 'ReviewRunFailedError'
    this.partialState = input.partialState
    this.structuredError = input.structuredError
  }
}

export const isReviewRunFailedError = (
  error: unknown
): error is ReviewRunFailedError => error instanceof ReviewRunFailedError

const stableJson = (value: unknown): string => JSON.stringify(value)

const createRunId = (): string => `run-${randomUUID()}`

const createReviewRunTimeoutError = (timeoutMs: number): StructuredError => ({
  code: 'review_run_timeout',
  message: `Review run timed out after ${timeoutMs}ms.`,
  category: 'provider',
  recoverable: true,
  exitCode: 4,
  details: {
    timeoutMs
  }
})

const createCostBudgetExceededError = (
  input: {
    readonly maxCostUsd: number
    readonly costUsd: number
  }
): StructuredError => ({
  code: 'cost_budget_exceeded',
  message: `Review cost ${input.costUsd} USD exceeds configured maxCostUsd ${input.maxCostUsd} USD.`,
  category: 'quality-gate',
  recoverable: true,
  exitCode: 1,
  details: {
    maxCostUsd: input.maxCostUsd,
    costUsd: input.costUsd
  }
})

const isHarnessRunTimeoutError = (error: unknown): error is OperationTimeoutError =>
  error instanceof OperationTimeoutError &&
  error.meta?.scope === 'run'

const createCoverageIncompleteError = (
  coverage: CoverageSummary
): StructuredError => ({
  code: 'coverage_incomplete',
  message:
    'Review coverage is incomplete. The run did not claim review success because required source was not fully assigned to review tasks.',
  category: 'quality-gate',
  recoverable: true,
  exitCode: 1,
  details: {
    reviewableFileCount: coverage.reviewableFileCount,
    coveredFileCount: coverage.coveredFileCount,
    reviewableBytes: coverage.reviewableBytes,
    coveredBytes: coverage.coveredBytes
  }
})

type ProviderUsageRecorder = {
  readonly modelAlias: ModelAlias
  readonly usage: () => RunTokenUsage
}

const createProviderUsageRecorder = (
  modelAlias: ModelAlias
): ProviderUsageRecorder => {
  let inputTokens = 0
  let outputTokens = 0
  const provider = modelAlias.provider
  const wrappedProvider: ModelProvider = {
    ...provider,
    id: provider.id,
    genAiSystem: provider.genAiSystem,
    ...(provider.info === undefined ? {} : { info: provider.info }),
    ...(provider.text === undefined
      ? {}
      : {
          text: async (request) => {
            const response = await provider.text!(request)

            inputTokens += response.usage.inputTokens
            outputTokens += response.usage.outputTokens

            return response
          }
        }),
    ...(provider.object === undefined
      ? {}
      : {
          object: async <T extends JsonValue = JsonValue>(
            request: ObjectRequest<T>
          ): Promise<ObjectResponse<T>> => {
            const response = await provider.object!(request)

            inputTokens += response.usage.inputTokens
            outputTokens += response.usage.outputTokens

            return response
          }
        }),
    ...(provider.textStream === undefined
      ? {}
      : { textStream: provider.textStream.bind(provider) }),
    ...(provider.objectStream === undefined
      ? {}
      : { objectStream: provider.objectStream.bind(provider) }),
    ...(provider.embed === undefined ? {} : { embed: provider.embed.bind(provider) }),
    ...(provider.rerank === undefined
      ? {}
      : { rerank: provider.rerank.bind(provider) }),
    ...(provider.close === undefined ? {} : { close: provider.close.bind(provider) })
  }

  return {
    modelAlias: {
      ...modelAlias,
      provider: wrappedProvider
    },
    usage: () => ({
      inputTokens,
      outputTokens
    })
  }
}

const createReviewRunSignal = (
  parentSignal: AbortSignal | undefined,
  timeoutMs: number | undefined
): {
  readonly signal?: AbortSignal
  readonly timedOut: () => boolean
  readonly cleanup: () => void
} => {
  if (parentSignal === undefined && timeoutMs === undefined) {
    return {
      timedOut: () => false,
      cleanup: () => {}
    }
  }

  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = (): void => {
    controller.abort(parentSignal?.reason)
  }
  const timeout =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true
          controller.abort(createReviewRunTimeoutError(timeoutMs))
        }, timeoutMs)

  if (parentSignal?.aborted) {
    abortFromParent()
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      if (timeout !== undefined) {
        clearTimeout(timeout)
      }
      parentSignal?.removeEventListener('abort', abortFromParent)
    }
  }
}

type ReviewContextDocument = NonNullable<
  ScriptedReviewWorkflowInput['reviewContext']
>[number]
type WorkflowReviewTask = NonNullable<
  ScriptedReviewWorkflowInput['tasks']
>[number]
type InstructionContextDocument = ScriptedReviewWorkflowInput['instructions'][number]
type SkillContextDocument = ScriptedReviewWorkflowInput['skills'][number]

type ContextAssemblyResult = {
  readonly reviewContext: readonly ReviewContextDocument[]
  readonly tasks: readonly WorkflowReviewTask[]
  readonly instructions: readonly InstructionContextDocument[]
  readonly skills: readonly SkillContextDocument[]
  readonly skillDefinitions: SkillsConfig
  readonly skillIds: readonly string[]
  readonly contextLedger: readonly ContextLedgerEntry[]
}

type SkillContextAssemblyResult = {
  readonly skills: readonly SkillContextDocument[]
  readonly skillDefinitions: SkillsConfig
  readonly skillIds: readonly string[]
}

const readChangedSourceFiles = async (
  input: {
    readonly repositoryRoot: string
    readonly changedFiles: readonly { readonly path: string }[]
  }
): Promise<readonly LanguageSourceFile[]> =>
  Promise.all(
    input.changedFiles.map(async (file) => ({
      path: file.path,
      content: await readFile(
        await resolveExistingPathInsideRoot(input.repositoryRoot, file.path),
        'utf8'
      )
    }))
  )

const candidateHash = (value: string): string => sha256(value).slice(0, 16)

const taskIdFor = (pathValue: string): string =>
  `task_${candidateHash(pathValue)}`

const candidateFromDiagnostic = (
  evidence: EvidenceRecord
): CandidateFinding | undefined => {
  if (evidence.kind !== 'diagnostic' || evidence.location === undefined) {
    return undefined
  }

  const idSegment = candidateHash(
    `${evidence.id}:${evidence.location.path}:${evidence.location.startLine}`
  )

  return {
    id: `cand_${idSegment}`,
    taskId: taskIdFor(evidence.location.path),
    category: 'bug',
    severity: 'high',
    title: 'Parse diagnostic blocks reliable review',
    description: `Syntax parse diagnostic reported by ${evidence.source}: ${evidence.summary}`,
    location: evidence.location,
    evidenceIds: [evidence.id],
    proposedBy: evidence.source,
    confidence: 0.95,
    fixProposal: {
      summary:
        'Fix the syntax issue reported by the language analyzer, then rerun review.',
      evidenceIds: [evidence.id],
      safety: 'manual-review'
    }
  }
}

const createAnalyzerCandidates = (
  evidence: readonly EvidenceRecord[]
): readonly CandidateFinding[] =>
  evidence
    .map(candidateFromDiagnostic)
    .filter((candidate): candidate is CandidateFinding => candidate !== undefined)

const bytesOf = (value: string): number => Buffer.byteLength(value)

const sliceUtf8 = (value: string, maxBytes: number): string =>
  Buffer.from(value).subarray(0, Math.max(0, maxBytes)).toString('utf8')

const redacted = (value: string): string => createRedactor().redact(value)

const splitTextByUtf8Bytes = (
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

const defaultContextBudgetsByDepth = {
  fast: {
    maxFiles: 50,
    maxBytes: 100000
  },
  balanced: {
    maxFiles: 200,
    maxBytes: 200000
  },
  thorough: {
    maxFiles: 500,
    maxBytes: 500000
  }
} as const
const defaultProviderTaskContextMaxBytes = 60000
const defaultProviderTaskInputMaxBytes = 90000

// Build deterministic quality-gate thresholds from configuration. `failOnNewOnly`
// falls back to the baseline setting per spec 06; `maxMedium` stays omitted
// ("no fail") unless configured.
const qualityGateThresholdsFor = (
  config: CodeReviewerConfig
): QualityGateThresholds => ({
  maxCritical: config.qualityGate.maxCritical,
  maxHigh: config.qualityGate.maxHigh,
  ...(config.qualityGate.maxMedium === undefined
    ? {}
    : { maxMedium: config.qualityGate.maxMedium }),
  minEvidenceLevel: config.qualityGate.minEvidenceLevel,
  failOnProviderError: config.qualityGate.failOnProviderError,
  failOnNewOnly:
    config.qualityGate.failOnNewOnly ?? config.baseline.failOnNewOnly
})

const contextBudgetFor = (config: CodeReviewerConfig): number =>
  config.review.contextMaxBytes ??
  (config.provider === undefined
    ? defaultContextBudgetsByDepth[config.review.depth].maxBytes
    : Math.min(
        defaultContextBudgetsByDepth[config.review.depth].maxBytes,
        defaultProviderTaskContextMaxBytes
      ))

const taskInputBudgetFor = (config: CodeReviewerConfig): number | undefined =>
  config.provider === undefined
    ? undefined
    : Math.min(
        config.review.contextMaxBytes ?? defaultProviderTaskInputMaxBytes,
        defaultProviderTaskInputMaxBytes
      )

const sourceChunkBudgetFor = (config: CodeReviewerConfig): number => {
  const contextBudget = contextBudgetFor(config)
  const providerBudget = taskInputBudgetFor(config)
  const packetBudget = providerBudget ?? contextBudget

  return Math.max(1024, Math.floor(Math.min(contextBudget, packetBudget) * 0.45))
}

const maxDocumentBytesFor = (
  content: string
): number => bytesOf(content)

const loadInstructionContexts = async (
  input: {
    readonly repositoryRoot: string
    readonly config: CodeReviewerConfig
    readonly ledger: ContextLedgerEntry[]
  }
): Promise<readonly InstructionContextDocument[]> => {
  const instructions: InstructionContextDocument[] = []

  for (const instructionPath of input.config.instructions.files) {
    const content = await readFile(
      await resolveExistingPathInsideRoot(input.repositoryRoot, instructionPath),
      'utf8'
    )
    const ledgerEntry = createTextContextLedgerEntry({
      kind: 'instruction',
      path: instructionPath,
      reason: 'instruction-context',
      text: content,
      maxBytes: maxDocumentBytesFor(content)
    })

    input.ledger.push(ledgerEntry)
    instructions.push({
      path: instructionPath,
      content: sliceUtf8(redacted(content), ledgerEntry.bytesIncluded),
      allowed: true,
      ledgerEntryId: ledgerEntry.id
    })
  }

  if (input.config.instructions.inline.trim().length > 0) {
    const inlineContent = input.config.instructions.inline
    const ledgerEntry = createTextContextLedgerEntry({
      kind: 'instruction',
      path: '.review/inline-instructions',
      reason: 'instruction-context',
      text: inlineContent,
      maxBytes: maxDocumentBytesFor(inlineContent)
    })

    input.ledger.push(ledgerEntry)
    instructions.push({
      path: '.review/inline-instructions',
      content: sliceUtf8(redacted(inlineContent), ledgerEntry.bytesIncluded),
      allowed: true,
      ledgerEntryId: ledgerEntry.id
    })
  }

  return instructions
}

const loadSkillContexts = async (
  input: {
    readonly repositoryRoot: string
    readonly config: CodeReviewerConfig
    readonly ledger: ContextLedgerEntry[]
  }
): Promise<SkillContextAssemblyResult> => {
  if (!input.config.skills.enabled) {
    return {
      skills: [],
      skillDefinitions: {},
      skillIds: []
    }
  }

  const skillIndex = await createSkillIndex({
    repositoryRoot: input.repositoryRoot,
    directories: input.config.skills.directories
  })
  const skills: SkillContextDocument[] = []
  const skillDefinitions: SkillsConfig = {}

  for (const skill of skillIndex.skills) {
    const content = await readFile(
      await resolveExistingPathInsideRoot(input.repositoryRoot, skill.path),
      'utf8'
    )
    const ledgerEntry = createTextContextLedgerEntry({
      kind: 'skill',
      path: skill.path,
      reason: 'skill-context',
      text: content,
      maxBytes: maxDocumentBytesFor(content)
    })

    input.ledger.push(ledgerEntry)
    skills.push({
      name: skill.id,
      path: skill.path,
      directory: skill.directory,
      contentHash: skill.contentHash,
      allowed: true
    })
    skillDefinitions[skill.id] = {
      directory: skill.absoluteDirectory,
      validationMode: 'strict',
      trust: 'project',
      source: 'repository'
    }
  }

  return {
    skills,
    skillDefinitions,
    skillIds: skillIndex.skills.map((skill) => skill.id)
  }
}

const assembleContext = async (
  input: {
    readonly repositoryRoot: string
    readonly config: CodeReviewerConfig
    readonly sourceFiles: readonly LanguageSourceFile[]
    readonly analysis: ReturnType<typeof analyzeFirstClassLanguageFiles>
    readonly tasks: readonly ReviewTask[]
  }
): Promise<ContextAssemblyResult> => {
  const contextLedger: ContextLedgerEntry[] = []
  const instructions = await loadInstructionContexts({
    repositoryRoot: input.repositoryRoot,
    config: input.config,
    ledger: contextLedger
  })
  const skillContext = await loadSkillContexts({
    repositoryRoot: input.repositoryRoot,
    config: input.config,
    ledger: contextLedger
  })

  type ContextInput = {
    readonly content: string
    readonly kind: ReviewContextDocument['kind']
    readonly path?: string
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

  const createWorkflowTask = (
    task: ReviewTask,
    taskId: string,
    inputContexts: readonly ContextInput[],
    paths: readonly string[]
  ): WorkflowReviewTask => {
    const reviewContext: ReviewContextDocument[] = []
    const contextEntryIds: string[] = []
    const pathSet = new Set(paths)

    for (const inputContext of inputContexts) {
      const contentBytes = bytesOf(inputContext.content)
      const ledgerEntry = createContextLedgerEntry({
        kind:
          inputContext.kind === 'test-mapping'
            ? 'analyzer-output'
            : inputContext.kind,
        ...(inputContext.path === undefined ? {} : { path: inputContext.path }),
        taskId,
        reason:
          inputContext.kind === 'file'
            ? 'task-context-source-chunk'
            : 'task-context-analyzer-chunk',
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
      evidenceIds: [],
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
  const testMappings = discoverFirstClassLanguageTests(input.sourceFiles)

  const analyzerContextsForPaths = (
    task: ReviewTask,
    pathSet: ReadonlySet<string>
  ): readonly ContextInput[] => {
    const analyzerFacts = input.analysis.facts.filter(
      (fact) => task.factIds.includes(fact.id) && pathSet.has(fact.path)
    )
    const analyzerTestMappings = testMappings.filter(
      (mapping) =>
        pathSet.has(mapping.sourcePath) || pathSet.has(mapping.testPath)
    )
    const analyzerContext =
      analyzerFacts.length === 0 && analyzerTestMappings.length === 0
        ? ''
        : JSON.stringify({
            facts: analyzerFacts,
            testMappings: analyzerTestMappings
          })

    return bytesOf(analyzerContext) === 0
      ? []
      : splitTextByUtf8Bytes(analyzerContext, chunkBudget).map((chunk) => ({
          kind: 'analyzer-output' as const,
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
    const taskSourceFiles =
      task.kind === 'policy'
        ? []
        : input.sourceFiles.filter((sourceFile) =>
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
    const analyzerAttachedPaths = new Set<string>()

    for (const batch of packContexts(sourceContexts)) {
      const batchPaths = workflowTaskPaths(task, batch, task.paths)
      const newAnalyzerPaths = batchPaths.filter(
        (pathValue) => !analyzerAttachedPaths.has(pathValue)
      )
      const analyzerContexts = analyzerContextsForPaths(
        task,
        new Set(newAnalyzerPaths)
      )
      const packedBatch = [...batch]
      const standaloneAnalyzerContexts: ContextInput[] = []
      let packedBytes = contextBytes(packedBatch)

      for (const analyzerContext of analyzerContexts) {
        const analyzerBytes = bytesOf(analyzerContext.content)

        if (packedBytes + analyzerBytes <= chunkBudget) {
          packedBatch.push(analyzerContext)
          packedBytes += analyzerBytes
        } else {
          standaloneAnalyzerContexts.push(analyzerContext)
        }
      }

      batches.push(packedBatch)
      batches.push(
        ...packContexts(standaloneAnalyzerContexts).map((contextBatch) => [
          ...contextBatch
        ])
      )

      for (const pathValue of newAnalyzerPaths) {
        analyzerAttachedPaths.add(pathValue)
      }
    }

    if (sourceContexts.length === 0) {
      batches.push(
        ...packContexts(analyzerContextsForPaths(task, taskPathSet)).map(
          (contextBatch) => [...contextBatch]
        )
      )
    }

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
          paths
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
    instructions,
    skills: skillContext.skills,
    skillDefinitions: skillContext.skillDefinitions,
    skillIds: skillContext.skillIds,
    contextLedger
  }
}

const loadBaselineFingerprints = async (
  repositoryRoot: string,
  config: CodeReviewerConfig
): Promise<readonly BaselineFingerprintRecord[] | undefined> => {
  if (!config.baseline.enabled) {
    return []
  }

  try {
    const baselineText = await readFile(
      await resolveExistingPathInsideRoot(repositoryRoot, config.baseline.path),
      'utf8'
    )

    return BaselineFileSchema.parse(JSON.parse(baselineText))
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined
    }

    throw error
  }
}

const runAdmissionOnly = (
  input: {
    readonly reviewedPaths: readonly string[]
    readonly candidates: readonly CandidateFinding[]
    readonly evidence: readonly EvidenceRecord[]
    readonly config: CodeReviewerConfig
    readonly admittedAt: string
    readonly configHash: string
    readonly instructionHashes: readonly string[]
    readonly skillHashes: readonly string[]
    readonly baselineConfigured: boolean
    readonly baselineFingerprints?: readonly BaselineFingerprintRecord[]
    readonly taskEvents: ReviewSharedContextSnapshot['taskEvents']
  }
): Pick<ReviewReport, 'admittedFindings' | 'rejectedFindings' | 'qualityGate'> & {
  readonly candidateFindings: readonly CandidateFinding[]
  readonly admissionDecisions: ReviewSharedContextSnapshot['admissionDecisions']
  readonly taskEvents: ReviewSharedContextSnapshot['taskEvents']
  readonly warnings: readonly string[]
} => {
  const admittedFindings = []
  const rejectedFindings = []
  const admissionDecisions: ReviewSharedContextSnapshot['admissionDecisions'] = []

  for (const record of input.evidence) {
    assertAnalyzerEvidenceOwnsPath(record)
  }

  for (const candidate of input.candidates) {
    const result = admitCandidate({
      candidate,
      evidence: input.evidence,
      existingAdmittedFindings: admittedFindings,
      policy: {
        reviewedPaths: input.reviewedPaths,
        minimumSeverity: 'info',
        inlineSeverityThreshold: input.config.review.inlineSeverityThreshold,
        provenance: {
          reviewer: 'deterministic-analyzer',
          instructionHashes: [...input.instructionHashes],
          skillHashes: [...input.skillHashes],
          analyzerVersions: languageAnalyzerVersions,
          configHash: input.configHash
        },
        admittedAt: input.admittedAt
      }
    })

    if (result.status === 'admitted') {
      admittedFindings.push(result.admittedFinding)
      admissionDecisions.push({
        candidateId: candidate.id,
        status: 'admitted',
        findingId: result.admittedFinding.id
      })
    } else {
      rejectedFindings.push(result.rejectedFinding)
      admissionDecisions.push({
        candidateId: candidate.id,
        status: result.status,
        rejectedReason: result.rejectedFinding.reason
      })
    }
  }

  const baseline = matchBaselineFindings({
    admittedFindings,
    ...(input.baselineFingerprints === undefined
      ? {}
      : { baselineFingerprints: input.baselineFingerprints }),
    baselineConfigured: input.baselineConfigured
  })
  const qualityGate = evaluateQualityGate({
    admittedFindings: baseline.admittedFindings,
    thresholds: qualityGateThresholdsFor(input.config)
  })

  return {
    admittedFindings: [...baseline.admittedFindings],
    rejectedFindings: [...rejectedFindings],
    qualityGate,
    candidateFindings: [...input.candidates],
    admissionDecisions,
    taskEvents: input.taskEvents,
    warnings: [...baseline.warnings]
  }
}

const createWorkflowInput = (
  input: {
    readonly runId: string
    readonly reviewedPaths: readonly string[]
    readonly evidence: readonly EvidenceRecord[]
    readonly candidates: readonly CandidateFinding[]
    readonly config: CodeReviewerConfig
    readonly configHash: string
    readonly providerId: string
    readonly modelName: string
    readonly admittedAt: string
    readonly baselineConfigured: boolean
    readonly baselineFingerprints?: readonly BaselineFingerprintRecord[]
    readonly instructions: readonly InstructionContextDocument[]
    readonly skills: readonly SkillContextDocument[]
    readonly tasks: readonly WorkflowReviewTask[]
  }
): ScriptedReviewWorkflowInput => ({
  runId: input.runId,
  reviewedPaths: [...input.reviewedPaths],
  evidence: input.evidence.map((record) => ({ ...record })),
  candidates: input.candidates.map((candidate) => ({ ...candidate })),
  instructions: input.instructions.map((instruction) => ({ ...instruction })),
  skills: input.skills.map((skill) => ({ ...skill })),
  tasks: input.tasks.map((task) => ({
    ...task,
    reviewContext: task.reviewContext.map((context) => ({ ...context }))
  })),
  maxConcurrentTasks: input.config.review.maxConcurrentTasks,
  ...(taskInputBudgetFor(input.config) === undefined
    ? {}
    : { maxTaskInputBytes: taskInputBudgetFor(input.config) }),
  provenance: {
    reviewer: 'review-agent',
    modelProvider: input.providerId,
    modelName: input.modelName,
    analyzerVersions: languageAnalyzerVersions,
    configHash: input.configHash
  },
  admissionPolicy: {
    inlineSeverityThreshold: input.config.review.inlineSeverityThreshold,
    admittedAt: input.admittedAt
  },
  ...(input.baselineFingerprints === undefined
    ? {}
    : {
        baselineFingerprints: input.baselineFingerprints.map((entry) => ({
          fingerprints: entry.fingerprints.map((fingerprint) => ({
            ...fingerprint
          }))
        }))
      }),
  baselineConfigured: input.baselineConfigured,
  qualityGate: qualityGateThresholdsFor(input.config)
})

const runProviderWorkflow = async (
  input: {
    readonly workflowInput: ScriptedReviewWorkflowInput
    readonly config: CodeReviewerConfig
    readonly environment: Readonly<Record<string, string | undefined>>
    readonly providerImport?: ProviderImport
    readonly skillDefinitions: SkillsConfig
    readonly skillIds: readonly string[]
    readonly logger?: Logger
    readonly signal?: AbortSignal
    readonly onTaskEvent?: (
      event: ScriptedReviewWorkflowOutput['taskEvents'][number]
    ) => void
  }
): Promise<
  | {
      readonly output: Awaited<ReturnType<typeof runModelBackedReviewWorkflow>>
      readonly usage: RunTokenUsage
    }
  | undefined
> => {
  if (input.config.provider === undefined) {
    return undefined
  }

  input.logger?.debug('Resolving model provider.', {
    provider_id: input.config.provider.id,
    model: input.config.provider.model
  })
  const provider = await resolveProviderModelAlias({
    provider: input.config.provider,
    environment: input.environment,
    ...(input.logger === undefined ? {} : { logger: input.logger }),
    ...(input.providerImport === undefined
      ? {}
      : { importProvider: input.providerImport })
  })
  input.logger?.debug('Model provider resolved.', {
    provider_id: provider.providerId,
    adapter_package: provider.providerPackage,
    model: input.config.provider.model
  })
  const usageRecorder = createProviderUsageRecorder(provider.modelAlias)
  input.logger?.debug('Review harness creation started.', {
    task_count: input.workflowInput.tasks?.length ?? 0,
    max_concurrent_tasks: input.config.review.maxConcurrentTasks,
    run_timeout_configured: input.config.review.runTimeoutMs !== undefined
  })
  const harness = createModelBackedReviewHarness({
    modelAlias: usageRecorder.modelAlias,
    skills: input.skillDefinitions,
    skillIds: input.skillIds,
    skillTools: input.config.skills.allowTools,
    maxConcurrentTasks: input.config.review.maxConcurrentTasks,
    ...(input.config.review.runTimeoutMs === undefined
      ? {}
      : { runTimeoutMs: input.config.review.runTimeoutMs }),
    ...(input.logger === undefined ? {} : { logger: input.logger }),
    ...(input.onTaskEvent === undefined
      ? {}
      : { onTaskEvent: input.onTaskEvent })
  })
  input.logger?.debug('Review harness creation completed.', {
    task_count: input.workflowInput.tasks?.length ?? 0
  })

  try {
    input.logger?.debug('Model-backed review workflow invocation started.', {
      session_id: reviewWorkflowSessionId,
      task_count: input.workflowInput.tasks?.length ?? 0,
      reviewed_path_count: input.workflowInput.reviewedPaths.length
    })
    const output = await runModelBackedReviewWorkflow({
      harness,
      sessionId: reviewWorkflowSessionId,
      input: input.workflowInput,
      ...(input.signal === undefined ? {} : { signal: input.signal })
    })
    const usage = usageRecorder.usage()

    input.logger?.debug('Model-backed review workflow completed.', {
      task_count: input.workflowInput.tasks?.length ?? 0,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens
    })

    return {
      output,
      usage
    }
  } finally {
    input.logger?.debug('Review harness shutdown started.')
    await harness.shutdown()
    input.logger?.debug('Review harness shutdown completed.')
  }
}

const sharedTaskEventFromWorkflow = (
  event: {
    readonly id: string
    readonly kind: ReviewSharedContextSnapshot['taskEvents'][number]['kind']
    readonly round: number
    readonly paths: readonly string[]
    readonly state: ReviewSharedContextSnapshot['taskEvents'][number]['state']
    readonly workerId?: string | undefined
    readonly message?: string | undefined
  }
): ReviewSharedContextSnapshot['taskEvents'][number] => ({
  id: event.id,
  kind: event.kind,
  round: event.round,
  paths: event.paths,
  state: event.state,
  ...(event.workerId === undefined ? {} : { workerId: event.workerId }),
  ...(event.message === undefined ? {} : { message: event.message })
})

const sharedAdmissionDecisionFromWorkflow = (
  decision: {
    readonly candidateId: string
    readonly status: ReviewSharedContextSnapshot['admissionDecisions'][number]['status']
    readonly findingId?: string | undefined
    readonly rejectedReason?: ReviewSharedContextSnapshot['admissionDecisions'][number]['rejectedReason'] | undefined
    readonly supersedes?: string | undefined
  }
): ReviewSharedContextSnapshot['admissionDecisions'][number] => ({
  candidateId: decision.candidateId,
  status: decision.status,
  ...(decision.findingId === undefined ? {} : { findingId: decision.findingId }),
  ...(decision.rejectedReason === undefined
    ? {}
    : { rejectedReason: decision.rejectedReason }),
  ...(decision.supersedes === undefined ? {} : { supersedes: decision.supersedes })
})

const candidateFindingsFromTaskResults = (
  results: readonly unknown[]
): readonly CandidateFinding[] =>
  results.flatMap((result) => {
    if (
      typeof result !== 'object' ||
      result === null ||
      !('candidates' in result) ||
      !Array.isArray(result.candidates)
    ) {
      return []
    }

    return result.candidates
      .map((candidate) => CandidateFindingSchema.safeParse(candidate))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data)
  })

const deterministicTaskEventFromQueueRecord = (
  record: ReviewTaskQueueRecord<WorkflowReviewTask>
): ReviewSharedContextSnapshot['taskEvents'][number] =>
  sharedTaskEventFromWorkflow({
    id: record.id,
    kind: record.kind,
    round: record.round,
    paths: record.paths,
    state: record.state,
    ...(record.workerId === undefined ? {} : { workerId: record.workerId }),
    ...(record.message === undefined ? {} : { message: record.message })
  })

const runDeterministicReviewTaskQueue = (
  input: {
    readonly tasks: readonly WorkflowReviewTask[]
    readonly maxConcurrentTasks: number
  }
): ReviewSharedContextSnapshot['taskEvents'] => {
  const queue = createReviewTaskQueue(input.tasks)
  let workerRound = 0

  while (true) {
    const batch = queue.claimBatch({
      limit: input.maxConcurrentTasks,
      workerId: `deterministic-worker-${workerRound + 1}`
    })

    if (batch.length === 0) {
      break
    }

    workerRound += 1
    for (const task of batch) {
      queue.complete(task.id, 'deterministic analyzer task completed')
    }
  }

  return queue.snapshot().map(deterministicTaskEventFromQueueRecord)
}

const timedOutTaskEventsFor = (
  tasks: readonly WorkflowReviewTask[]
): ReviewSharedContextSnapshot['taskEvents'] =>
  tasks.flatMap((task) => [
    sharedTaskEventFromWorkflow({
      id: task.id,
      kind: task.kind,
      round: task.round,
      paths: task.paths,
      state: 'planned'
    }),
    sharedTaskEventFromWorkflow({
      id: task.id,
      kind: task.kind,
      round: task.round,
      paths: task.paths,
      state: 'failed',
      workerId: 'review-timeout',
      message: 'review run timed out'
    })
  ])

const recordObservedTaskEvents = (
  recorder: NoContentEventRecorder,
  taskEvents: ReviewSharedContextSnapshot['taskEvents']
): void => {
  for (const event of taskEvents) {
    recorder.recordTaskEvent({
      taskId: event.id,
      kind: event.kind,
      round: event.round,
      state: event.state,
      pathCount: event.paths.length,
      ...(event.workerId === undefined ? {} : { workerId: event.workerId })
    })
  }
}

const recordObservedError = (
  recorder: NoContentEventRecorder,
  error: StructuredError
): void => {
  recorder.recordError({
    code: error.code,
    category: error.category,
    recoverable: error.recoverable
  })
}

const createPartialRunSummary = (input: {
  readonly options: RunReviewOptions
  readonly runId: string
  readonly startedAt: Date
  readonly completedAt: Date
  readonly configHash: string
  readonly warnings: readonly string[]
  readonly runCost?: RunCostSummary
}): ReviewReport['run'] => ({
  runId: input.runId,
  startedAt: input.startedAt.toISOString(),
  completedAt: input.completedAt.toISOString(),
  mode: input.options.config.review.mode,
  depth: input.options.config.review.depth,
  repositoryRootHash: sha256(input.options.repositoryRoot),
  baseRef: input.options.baseRef ?? input.options.config.review.baseRef,
  headRef: input.options.headRef ?? input.options.config.review.headRef,
  configHash: input.configHash,
  ...(input.options.config.provider === undefined
    ? {}
    : {
        provider: input.options.config.provider.id,
        model: input.options.config.provider.model
      }),
  durationMs: Math.max(
    0,
    input.completedAt.getTime() - input.startedAt.getTime()
  ),
  ...(input.runCost?.costUsd === undefined
    ? {}
    : { costUsd: input.runCost.costUsd }),
  ...(input.runCost?.inputTokens === undefined
    ? {}
    : { inputTokens: input.runCost.inputTokens }),
  ...(input.runCost?.outputTokens === undefined
    ? {}
    : { outputTokens: input.runCost.outputTokens }),
  warnings: [...input.warnings]
})

const createCoverageSummary = (
  input: {
    readonly sourceFiles: readonly LanguageSourceFile[]
    readonly contextLedger: readonly ContextLedgerEntry[]
  }
): CoverageSummary => {
  const files = input.sourceFiles.map((file) => {
    const sourceBytes = bytesOf(file.content)
    const fileEntries = input.contextLedger.filter(
      (entry) =>
        entry.kind === 'file' &&
        entry.path === file.path &&
        entry.reason === 'task-context-source-chunk'
    )
    const coveredBytes = fileEntries.reduce(
      (total, entry) => total + entry.bytesIncluded,
      0
    )
    const incompleteReason =
      coveredBytes >= sourceBytes
        ? undefined
        : `Only ${coveredBytes} of ${sourceBytes} bytes were assigned to review tasks.`

    return {
      path: file.path,
      contentHash: sha256(file.content),
      status:
        incompleteReason === undefined
          ? ('complete' as const)
          : ('incomplete' as const),
      bytes: sourceBytes,
      coveredBytes,
      taskIds: [...new Set(fileEntries.flatMap((entry) => entry.taskId ?? []))],
      ...(incompleteReason === undefined ? {} : { incompleteReason })
    }
  })
  const incompleteReasons = files
    .filter((file) => file.status === 'incomplete')
    .map((file) => `${file.path}: ${file.incompleteReason}`)
  const reviewableBytes = files.reduce((total, file) => total + file.bytes, 0)
  const coveredBytes = files.reduce((total, file) => total + file.coveredBytes, 0)

  return {
    status: incompleteReasons.length === 0 ? 'complete' : 'incomplete',
    reviewableFileCount: files.length,
    coveredFileCount: files.filter((file) => file.status === 'complete').length,
    reviewableBytes,
    coveredBytes,
    incompleteReasons,
    files
  }
}

const createSharedContextSnapshot = (input: {
  readonly analysis: ReturnType<typeof analyzeFirstClassLanguageFiles>
  readonly taskEvents: ReviewSharedContextSnapshot['taskEvents']
  readonly contextLedger: readonly ContextLedgerEntry[]
  readonly evidence: readonly EvidenceRecord[]
  readonly candidates: readonly CandidateFinding[]
  readonly admissionDecisions: ReviewSharedContextSnapshot['admissionDecisions']
  readonly admittedFindings: ReviewReport['admittedFindings']
  readonly rejectedFindings: ReviewReport['rejectedFindings']
}): ReviewSharedContextSnapshot => {
  const context = createReviewSharedContext()

  for (const fact of input.analysis.facts) {
    context.appendRepositoryFact(fact)
  }

  for (const taskEvent of input.taskEvents) {
    context.appendTask(taskEvent)
  }

  for (const entry of input.contextLedger) {
    context.appendContextLedgerEntry(entry)
  }

  for (const evidence of input.evidence) {
    context.appendEvidenceRecord(evidence)
  }

  for (const candidate of input.candidates) {
    context.appendCandidateFinding(candidate)
  }

  for (const finding of input.admittedFindings) {
    context.appendAdmittedFinding(finding)
  }

  for (const finding of input.rejectedFindings) {
    context.appendRejectedFinding(finding)
  }

  for (const decision of input.admissionDecisions) {
    context.appendAdmissionDecision(decision)
  }

  return context.snapshot()
}

export const runReview = async (
  options: RunReviewOptions
): Promise<ReviewRunnerResult> => {
  const now = options.now ?? (() => new Date())
  const startedAt = now()
  const runId = options.runId ?? createRunId()
  const configHash = sha256(stableJson(options.config))
  const runSignal = createReviewRunSignal(
    options.signal,
    options.config.review.runTimeoutMs
  )
  const observability =
    options.observability ?? createNoContentEventRecorder()
  const logger = (options.logger ?? createNoopReviewLogger()).child({
    run_id: runId
  })

  observability.startRun({
    runId,
    mode: options.config.review.mode,
    depth: options.config.review.depth,
    configHash,
    ...(options.config.provider === undefined
      ? {}
      : {
          providerId: options.config.provider.id,
          modelName: options.config.provider.model
      })
  })
  logger.info('Review run started.', {
    mode: options.config.review.mode,
    depth: options.config.review.depth,
    provider_configured: options.config.provider !== undefined
  })

  try {
    const driftStep = observability.startStep('drift_check')
    logger.debug('Drift check started.')
    const drift = await runDriftCheck({
      repositoryRoot: options.repositoryRoot,
      config: options.config
    })
    driftStep.end({
      passed: drift.passed,
      errorCount: drift.errorCount,
      warningCount: drift.warningCount
    })
    logger.debug('Drift check completed.', {
      passed: drift.passed,
      error_count: drift.errorCount,
      warning_count: drift.warningCount
    })

    if (!drift.passed) {
      // Hard drift is a configured gate failure, not an internal crash: surface
      // it with exit code 1 so CI treats it as a quality signal.
      const driftGateError: StructuredError = {
        code: 'drift_gate_failed',
        message:
          'Review stopped because hard drift findings block the run.',
        category: 'quality-gate',
        recoverable: true,
        exitCode: 1,
        details: {
          errorCount: drift.errorCount,
          warningCount: drift.warningCount
        }
      }

      throw driftGateError
    }

    // Configure no-content telemetry when enabled (run step). Disabled by
    // default; validates exporter dependencies only when an endpoint is set.
    if (options.config.observability.openTelemetry.enabled) {
      const telemetryStep = observability.startStep('opentelemetry_setup')
      logger.debug('OpenTelemetry setup started.')
      await configureOpenTelemetry({
        config: options.config.observability.openTelemetry
      })
      telemetryStep.end({ enabled: true })
      logger.debug('OpenTelemetry setup completed.', { enabled: true })
    }

    const intakeStep = observability.startStep('repository_intake')
    logger.debug('Repository intake started.', {
      explicit_file_count: options.explicitFiles?.length ?? 0,
      max_files: options.config.review.maxFiles,
      max_file_bytes: options.config.review.maxFileBytes
    })
    const intake = await collectRepositoryIntake({
      repositoryRoot: options.repositoryRoot,
      baseRef: options.baseRef ?? options.config.review.baseRef,
      headRef: options.headRef ?? options.config.review.headRef,
      excludePatterns: options.config.paths.exclude,
      maxFiles: options.config.review.maxFiles,
      maxFileBytes: options.config.review.maxFileBytes,
      ...(options.explicitFiles === undefined
        ? {}
        : { explicitFiles: options.explicitFiles }),
      ...(runSignal.signal === undefined ? {} : { signal: runSignal.signal })
    })
    intakeStep.end({
      changedFileCount: intake.changedFiles.length,
      skippedFileCount: intake.skippedFiles.length
    })
    logger.debug('Repository intake completed.', {
      changed_file_count: intake.changedFiles.length,
      skipped_file_count: intake.skippedFiles.length
    })
    const sourceReadStep = observability.startStep('source_read', {
      fileCount: intake.changedFiles.length
    })
    logger.debug('Source read started.', {
      file_count: intake.changedFiles.length
    })
    const sourceFiles = await readChangedSourceFiles({
      repositoryRoot: options.repositoryRoot,
      changedFiles: intake.changedFiles
    })
    sourceReadStep.end({ fileCount: sourceFiles.length })
    logger.debug('Source read completed.', { file_count: sourceFiles.length })
    const analysisStep = observability.startStep('language_analysis')
    logger.debug('Language analysis started.', { file_count: sourceFiles.length })
    const analysis = analyzeFirstClassLanguageFiles(sourceFiles)
    for (const fact of analysis.facts) {
      assertAnalyzerFactOwnsPath(fact)
    }
    const evidence = analysis.evidence.map((record) =>
      EvidenceRecordSchema.parse(record)
    )
    for (const record of evidence) {
      assertAnalyzerEvidenceOwnsPath(record)
    }
    analysisStep.end({
      factCount: analysis.facts.length,
      evidenceCount: evidence.length
    })
    logger.debug('Language analysis completed.', {
      fact_count: analysis.facts.length,
      evidence_count: evidence.length
    })
    const analyzerCandidates = createAnalyzerCandidates(evidence)
    const planningStep = observability.startStep('task_planning')
    logger.debug('Task planning started.')
    const reviewTasks = planReviewTasks({
      depth: options.config.review.depth,
      files: intake.changedFiles,
      facts: analysis.facts,
      evidence,
      candidates: analyzerCandidates
    })
    planningStep.end({ taskCount: reviewTasks.length })
    logger.debug('Task planning completed.', {
      task_count: reviewTasks.length,
      analyzer_candidate_count: analyzerCandidates.length
    })
    const contextAssemblyStep = observability.startStep('context_assembly')
    logger.debug('Context assembly started.')
    const assembledContext = await assembleContext({
      repositoryRoot: options.repositoryRoot,
      config: options.config,
      sourceFiles,
      analysis,
      tasks: reviewTasks
    })
    contextAssemblyStep.end({
      ledgerEntryCount: assembledContext.contextLedger.length
    })
    logger.debug('Context assembly completed.', {
      ledger_entry_count: assembledContext.contextLedger.length,
      workflow_task_count: assembledContext.tasks.length,
      instruction_count: assembledContext.instructions.length,
      skill_count: assembledContext.skills.length
    })
    // Provenance must record which instruction and skill sources shaped a
    // finding. The context ledger already hashes each loaded source; surface
    // those hashes so the deterministic path keeps a complete audit trail.
    const contextHashesByKind = (
      kind: ContextLedgerEntry['kind']
    ): readonly string[] =>
      assembledContext.contextLedger
        .filter((entry) => entry.kind === kind && entry.contentHash !== undefined)
        .map((entry) => entry.contentHash as string)
    const instructionHashes = contextHashesByKind('instruction')
    const skillHashes = contextHashesByKind('skill')
    const baselineStep = observability.startStep('baseline_load')
    logger.debug('Baseline load started.')
    const baselineFingerprints = await loadBaselineFingerprints(
      options.repositoryRoot,
      options.config
    )
    baselineStep.end({
      baselineEntryCount: baselineFingerprints?.length ?? 0
    })
    logger.debug('Baseline load completed.', {
      baseline_entry_count: baselineFingerprints?.length ?? 0
    })
    // A missing baseline is only reported (and findings marked `unknown`) when
    // the user explicitly opted into a baseline; an enabled-by-default baseline
    // with no file stays silent.
    const baselineConfigured =
      options.config.baseline.enabled &&
      (options.baselineExplicitlyConfigured ?? false)
    const workflowInput = createWorkflowInput({
        runId,
        reviewedPaths: intake.changedFiles.map((file) => file.path),
        evidence,
        candidates: analyzerCandidates,
        config: options.config,
        configHash,
        providerId: options.config.provider?.id ?? '',
        modelName: options.config.provider?.model ?? '',
        admittedAt: startedAt.toISOString(),
        instructions: assembledContext.instructions,
        skills: assembledContext.skills,
        tasks: assembledContext.tasks,
        baselineConfigured,
        ...(baselineFingerprints === undefined ? {} : { baselineFingerprints })
      })
    let providerWorkflow: Awaited<ReturnType<typeof runProviderWorkflow>>
    let providerTaskEventsObservedLive = false
    const recordLiveProviderTaskEvent = (
      event: ScriptedReviewWorkflowOutput['taskEvents'][number]
    ): void => {
      providerTaskEventsObservedLive = true
      recordObservedTaskEvents(observability, [
        sharedTaskEventFromWorkflow(event)
      ])
    }

    try {
      const providerStep =
        options.config.provider === undefined
          ? undefined
          : observability.startStep('provider_workflow', {
              providerId: options.config.provider.id,
              modelName: options.config.provider.model,
              taskCount: assembledContext.tasks.length
            })
      providerWorkflow = await runProviderWorkflow({
        workflowInput,
        config: options.config,
        environment: options.environment ?? {},
        ...(options.providerImport === undefined
          ? {}
          : { providerImport: options.providerImport }),
        skillDefinitions: assembledContext.skillDefinitions,
        skillIds: assembledContext.skillIds,
        logger,
        onTaskEvent: recordLiveProviderTaskEvent,
        ...(runSignal.signal === undefined ? {} : { signal: runSignal.signal })
      })
      providerStep?.end({
        inputTokens: providerWorkflow?.usage.inputTokens ?? 0,
        outputTokens: providerWorkflow?.usage.outputTokens ?? 0
      })
      if (providerStep !== undefined) {
        logger.debug('Provider workflow step completed.', {
          input_tokens: providerWorkflow?.usage.inputTokens ?? 0,
          output_tokens: providerWorkflow?.usage.outputTokens ?? 0
        })
      }
    } catch (error) {
      if (!isReviewTaskExecutionError(error)) {
        if (
          (runSignal.timedOut() || isHarnessRunTimeoutError(error)) &&
          options.config.review.runTimeoutMs !== undefined
        ) {
          const normalized = createReviewRunTimeoutError(
            options.config.review.runTimeoutMs
          )
          const partialWarnings = [
            ...(options.configWarnings ?? []),
            ...drift.findings
              .filter((finding) => finding.gate === 'warning')
              .map((finding) => `drift:${finding.category}`),
            'partial-run'
          ]
          const completedAt = now()
          const sharedContext = createSharedContextSnapshot({
            analysis,
            taskEvents: timedOutTaskEventsFor(assembledContext.tasks),
            contextLedger: assembledContext.contextLedger,
            evidence,
            candidates: analyzerCandidates,
            admissionDecisions: [],
            admittedFindings: [],
            rejectedFindings: []
          })

          throw new ReviewRunFailedError({
            structuredError: normalized,
            partialState: {
              artifactRoot: path.posix.join(
                options.config.paths.artifactDir,
                runId
              ),
              runSummary: createPartialRunSummary({
                options,
                runId,
                startedAt,
                completedAt,
                configHash,
                warnings: partialWarnings
              }),
              contextLedger: assembledContext.contextLedger,
              sharedContext,
              observability: observability.snapshot(),
              error: normalized
            }
          })
        }

        throw error
      }

      const normalized =
        (runSignal.timedOut() || isHarnessRunTimeoutError(error.originalError)) &&
        options.config.review.runTimeoutMs !== undefined
          ? createReviewRunTimeoutError(options.config.review.runTimeoutMs)
          : normalizeError(error.originalError, {
              source: 'provider',
              operation: 'run_review_task'
            })
      const partialCandidates = [
        ...analyzerCandidates,
        ...candidateFindingsFromTaskResults(error.partialResults)
      ]
      const partialContextLedger = [...assembledContext.contextLedger]
      const partialWarnings = [
        ...(options.configWarnings ?? []),
        ...drift.findings
          .filter((finding) => finding.gate === 'warning')
          .map((finding) => `drift:${finding.category}`),
        'partial-run'
      ]
      const completedAt = now()
      const sharedContext = createSharedContextSnapshot({
        analysis,
        taskEvents: error.taskEvents.map(sharedTaskEventFromWorkflow),
        contextLedger: partialContextLedger,
        evidence,
        candidates: partialCandidates,
        admissionDecisions: [],
        admittedFindings: [],
        rejectedFindings: []
      })

      throw new ReviewRunFailedError({
        structuredError: normalized,
        partialState: {
          artifactRoot: path.posix.join(options.config.paths.artifactDir, runId),
          runSummary: createPartialRunSummary({
            options,
            runId,
            startedAt,
            completedAt,
            configHash,
            warnings: partialWarnings
          }),
          contextLedger: partialContextLedger,
          sharedContext,
          observability: observability.snapshot(),
          error: normalized
        }
      })
    }
    const providerWorkflowOutput = providerWorkflow?.output
    const deterministicStep =
      providerWorkflowOutput === undefined
        ? observability.startStep('deterministic_task_queue', {
            taskCount: assembledContext.tasks.length
          })
        : undefined
    const admission =
      providerWorkflowOutput === undefined
        ? runAdmissionOnly({
            reviewedPaths: intake.changedFiles.map((file) => file.path),
            candidates: analyzerCandidates,
            evidence,
            config: options.config,
            admittedAt: startedAt.toISOString(),
            configHash,
            instructionHashes,
            skillHashes,
            baselineConfigured,
            taskEvents: runDeterministicReviewTaskQueue({
              tasks: assembledContext.tasks,
              maxConcurrentTasks: options.config.review.maxConcurrentTasks
            }),
            ...(baselineFingerprints === undefined
              ? {}
              : { baselineFingerprints })
          })
        : {
            admittedFindings: providerWorkflowOutput.admittedFindings,
            rejectedFindings: providerWorkflowOutput.rejectedFindings,
            qualityGate: providerWorkflowOutput.qualityGate,
            candidateFindings: providerWorkflowOutput.candidateFindings,
            admissionDecisions: providerWorkflowOutput.admissionDecisions.map(
              sharedAdmissionDecisionFromWorkflow
            ),
            taskEvents: providerWorkflowOutput.taskEvents.map(
              sharedTaskEventFromWorkflow
            ),
            warnings: providerWorkflowOutput.warnings
          }
    deterministicStep?.end({ taskCount: admission.taskEvents.length })
    if (deterministicStep !== undefined) {
      logger.debug('Deterministic task queue completed.', {
        task_count: admission.taskEvents.length
      })
    }
    if (!providerTaskEventsObservedLive) {
      recordObservedTaskEvents(observability, admission.taskEvents)
    }
    const effectiveContextLedger = [...assembledContext.contextLedger]
    const completedAt = now()
    const coverage = createCoverageSummary({
      sourceFiles,
      contextLedger: effectiveContextLedger
    })
    const resolvedBaselineEntries = options.config.baseline.includeResolvedInReport
      ? resolveBaselineFingerprints(
          baselineFingerprints ?? [],
          admission.admittedFindings
        )
      : []
    const runCost = summarizeRunCost({
      providerConfigured: options.config.provider !== undefined,
      prices: options.config.costs,
      ...(providerWorkflow?.usage === undefined
        ? {}
        : { usage: providerWorkflow.usage })
    })
    const warnings = [
      ...(options.configWarnings ?? []),
      ...drift.findings
        .filter((finding) => finding.gate === 'warning')
        .map((finding) => `drift:${finding.category}`),
      ...admission.warnings,
      ...runCost.warnings
    ]
    if (coverage.status !== 'complete') {
      const structuredError = createCoverageIncompleteError(coverage)
      const sharedContext = createSharedContextSnapshot({
        analysis,
        taskEvents: admission.taskEvents,
        contextLedger: effectiveContextLedger,
        evidence,
        candidates: admission.candidateFindings,
        admissionDecisions: admission.admissionDecisions,
        admittedFindings: admission.admittedFindings,
        rejectedFindings: admission.rejectedFindings
      })

      throw new ReviewRunFailedError({
        structuredError,
        partialState: {
          artifactRoot: path.posix.join(options.config.paths.artifactDir, runId),
          runSummary: createPartialRunSummary({
            options,
            runId,
            startedAt,
            completedAt,
            configHash,
            warnings,
            runCost
          }),
          contextLedger: effectiveContextLedger,
          sharedContext,
          observability: observability.snapshot(),
          error: structuredError
        }
      })
    }
    if (
      options.config.review.maxCostUsd !== undefined &&
      runCost.costUsd !== undefined &&
      runCost.costUsd > options.config.review.maxCostUsd
    ) {
      const completedAtForFailure = now()
      const structuredError = createCostBudgetExceededError({
        maxCostUsd: options.config.review.maxCostUsd,
        costUsd: runCost.costUsd
      })
      const sharedContext = createSharedContextSnapshot({
        analysis,
        taskEvents: admission.taskEvents,
        contextLedger: effectiveContextLedger,
        evidence,
        candidates: admission.candidateFindings,
        admissionDecisions: admission.admissionDecisions,
        admittedFindings: admission.admittedFindings,
        rejectedFindings: admission.rejectedFindings
      })

      throw new ReviewRunFailedError({
        structuredError,
        partialState: {
          artifactRoot: path.posix.join(options.config.paths.artifactDir, runId),
          runSummary: createPartialRunSummary({
            options,
            runId,
            startedAt,
            completedAt: completedAtForFailure,
            configHash,
            warnings,
            runCost
          }),
          contextLedger: effectiveContextLedger,
          sharedContext,
          observability: observability.snapshot(),
          error: structuredError
        }
      })
    }
    const reportStep = observability.startStep('report_assembly')
    const report = ReviewReportSchema.parse({
      schemaVersion: '1.0',
      run: {
        runId,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        mode: options.config.review.mode,
        depth: options.config.review.depth,
        repositoryRootHash: sha256(options.repositoryRoot),
        baseRef: options.baseRef ?? options.config.review.baseRef,
        headRef: options.headRef ?? options.config.review.headRef,
        configHash,
        ...(options.config.provider === undefined
          ? {}
          : {
              provider: options.config.provider.id,
              model: options.config.provider.model
            }),
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        ...(runCost.costUsd === undefined ? {} : { costUsd: runCost.costUsd }),
        ...(runCost.inputTokens === undefined
          ? {}
          : { inputTokens: runCost.inputTokens }),
        ...(runCost.outputTokens === undefined
          ? {}
          : { outputTokens: runCost.outputTokens }),
        warnings
      },
      coverage,
      admittedFindings: admission.admittedFindings,
      rejectedFindings: admission.rejectedFindings,
      evidence,
      skippedFiles: intake.skippedFiles,
      qualityGate: admission.qualityGate,
      ...(options.config.baseline.includeResolvedInReport
        ? { resolvedBaselineEntries }
        : {}),
      artifacts: []
    })
    reportStep.end({
      admittedFindingCount: admission.admittedFindings.length,
      rejectedFindingCount: admission.rejectedFindings.length,
      evidenceCount: evidence.length
    })
    logger.info('Review run completed.', {
      admitted_finding_count: admission.admittedFindings.length,
      rejected_finding_count: admission.rejectedFindings.length,
      evidence_count: evidence.length,
      coverage_status: coverage.status,
      quality_gate_passed: admission.qualityGate?.passed ?? true
    })

    return {
      report,
      contextLedger: effectiveContextLedger,
      sharedContext: createSharedContextSnapshot({
        analysis,
        taskEvents: admission.taskEvents,
        contextLedger: effectiveContextLedger,
        evidence,
        candidates: admission.candidateFindings,
        admissionDecisions: admission.admissionDecisions,
        admittedFindings: admission.admittedFindings,
        rejectedFindings: admission.rejectedFindings
      }),
      observability: observability.snapshot()
    }
  } catch (error) {
    if (isReviewRunFailedError(error)) {
      recordObservedError(observability, error.structuredError)
      logger.error('Review run failed.', {
        code: error.structuredError.code,
        category: error.structuredError.category,
        recoverable: error.structuredError.recoverable
      })
      throw error
    }

    if (
      (runSignal.timedOut() || isHarnessRunTimeoutError(error)) &&
      options.config.review.runTimeoutMs !== undefined
    ) {
      const timeoutError = createReviewRunTimeoutError(
        options.config.review.runTimeoutMs
      )
      recordObservedError(observability, timeoutError)
      logger.error('Review run timed out.', {
        code: timeoutError.code,
        timeout_ms: options.config.review.runTimeoutMs
      })
      throw timeoutError
    }

    const normalized = normalizeError(error, {
      source: 'internal',
      operation: 'run_review'
    })
    recordObservedError(observability, normalized)
    logger.error('Review run crashed.', {
      code: normalized.code,
      category: normalized.category,
      recoverable: normalized.recoverable
    })
    throw normalized
  } finally {
    runSignal.cleanup()
    await observability.shutdown()
  }
}
