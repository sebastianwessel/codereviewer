import { readFile } from 'node:fs/promises'
import { resolveExistingPathInsideRoot } from '../../../../platform/path-service.js'
import type { CodeReviewerConfig } from '../../../../shared/contracts/index.js'
import { sha256 } from '../../../../shared/hash/hash.js'
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
  type SupportSignalSourceFile
} from '../../../deterministic-signals/index.js'
import type {
  ContextLedgerEntry,
  ReviewTask
} from '../../../review-planning/index.js'
import type { DiffMap } from '../../../repository-intake/index.js'
import type { SkillsConfig } from '@purista/harness'
import {
  provenanceHashesFromContextLedger,
  type ReviewRunnerProvenanceHashes
} from '../support/provenance.js'
import {
  loadStaticReviewContext,
  type InstructionContextDocument,
  type SkillContextDocument
} from './static-context.js'
import {
  collectReferencedDefinitions,
  createReferencedDefinitionCache
} from './referenced-definitions.js'
import { supportSignalContextsForPaths } from './support-signal-context.js'
import {
  createWorkflowTask,
  type ContextInput,
  type ReviewContextDocument,
  type WorkflowReviewTask
} from './workflow-task.js'

export type {
  InstructionContextDocument,
  SkillContextDocument
} from './static-context.js'

export type { WorkflowReviewTask } from './workflow-task.js'

export type ContextAssemblyResult = {
  readonly reviewContext: readonly ReviewContextDocument[]
  readonly tasks: readonly WorkflowReviewTask[]
  readonly instructions: readonly InstructionContextDocument[]
  readonly skills: readonly SkillContextDocument[]
  readonly skillDefinitions: SkillsConfig
  readonly skillIds: readonly string[]
  readonly contextLedger: readonly ContextLedgerEntry[]
  readonly referencedDefinitionsDroppedCount: number
  readonly referencedDefinitionsUnreadableCount: number
  // Spans redaction replaced in the documents this assembly hands to the model.
  // See the note at the substitution itself for why this is counted and the
  // redactions in logs and report artifacts are not.
  readonly redactedContextSpanCount: number
}

export type ReviewRunnerContextStateMetrics = {
  readonly ledgerEntryCount: number
  readonly workflowTaskCount: number
  readonly instructionCount: number
  readonly skillCount: number
  // Dependency digests the referenced-definition caps kept out, summed over
  // every task. Zero is the expected case and the one worth noticing when it
  // stops being true: a run whose dependency context was cut reviewed something
  // different from one whose was not, and before this the difference was
  // invisible — the counts were computed and discarded at the call site.
  readonly referencedDefinitionsDroppedCount: number
  // Dependencies that resolved and then failed to read, summed over every task.
  // Separate from the dropped count because the two ask for different actions:
  // a cap that bound is answered by raising a bound, an unreadable dependency is
  // answered by looking at the repository. Summing them would put a filesystem
  // failure behind a message that says the caps were too tight.
  readonly referencedDefinitionsUnreadableCount: number
  // Spans redaction replaced across this run's context documents. Same argument
  // as the dropped count above and a sharper version of it: a capped dependency
  // is context the model never saw, a redacted span is context the model saw
  // WRONG — it reads `[REDACTED]` where the file has source, and reasons from it.
  readonly redactedContextSpanCount: number
}

export type ReviewRunnerContextState = ReviewRunnerProvenanceHashes & {
  readonly assembledContext: ContextAssemblyResult
  readonly metrics: ReviewRunnerContextStateMetrics
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

/**
 * The head-side span every hunk occupies, per changed file: the reviewed change
 * footprint admission scopes candidates by and the discovery packet shows the
 * model as change metadata.
 *
 * A PURE-DELETION hunk reports `newLineCount === 0` and occupies no head-side
 * line. This used to drop those hunks, which is not a smaller range but the FILE
 * disappearing from the list — and `candidateWithinReviewedScope` admits by PATH,
 * treating a non-empty list as authoritative. So a change whose file A only
 * deletes lines while file B adds some produced a list with no entry for A, and
 * every model candidate in A was rejected as out-of-diff scope. That is not an
 * exotic shape: intake fetches the diff with `--unified=0`, so any hunk that only
 * removes lines reports zero, and deleting a function is precisely how a change
 * breaks its callers.
 *
 * A deletion hunk is therefore anchored at `newStartLine` — the head-side line the
 * removal sits after — which is the answer `changedSymbols`' `hunkRange`,
 * `eval-diff-scope` and `git-diff-header`'s `hunksWithinRange` already derive for
 * this shape. Four derivations of one coordinate, one of them disagreeing, is what
 * produced the bug.
 *
 * `deletionAnchor` marks it, and the mark is load-bearing. The anchor line is NOT
 * a changed head-side line: under `--unified=0` it is not in the diff at all, so
 * no inline comment can be placed on it. Inline-comment eligibility is a separate
 * decision (`locationDiffRangeIsInlineEligible`) but it reads THIS array, so the
 * two only stay separable if a range says which kind it is.
 *
 * A whole-file deletion reports `newStartLine === 0`: no head-side position exists
 * and no head-side content exists for a candidate to point at, so it contributes
 * nothing. Such a range would also fail `ReviewedDiffRangeSchema`, whose
 * `startLine` is 1-based.
 */
export const reviewedDiffRangesForDiffMaps = (
  diffMaps: readonly DiffMap[]
): readonly ReviewedDiffRange[] =>
  diffMaps.flatMap((diffMap) =>
    diffMap.hunks.flatMap((hunk) => {
      if (hunk.newLineCount > 0) {
        return [
          {
            path: diffMap.path,
            startLine: hunk.newStartLine,
            endLine: hunk.newStartLine + hunk.newLineCount - 1,
            changeKind: diffMap.changeKind
          }
        ]
      }

      return hunk.newStartLine < 1
        ? []
        : [
            {
              path: diffMap.path,
              startLine: hunk.newStartLine,
              endLine: hunk.newStartLine,
              changeKind: diffMap.changeKind,
              deletionAnchor: true
            }
          ]
    })
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
    // The reviewed diff, for ACCOUNTING only. Every discovery packet carries the
    // task's own segments of it, and the ledger recorded none of them — so "how
    // much context did this run send" answered low by the size of the diff, which
    // on a large change is the biggest single input there is. The packet still
    // builds its own copy from this same text through the same shared splitter;
    // this does not put the diff into the task documents.
    readonly reviewedDiffText: string
  }
): Promise<ContextAssemblyResult> => {
  const staticContext = await loadStaticReviewContext({
    repositoryRoot: input.repositoryRoot,
    config: input.config
  })
  const contextLedger: ContextLedgerEntry[] = [...staticContext.contextLedger]
  // Accumulated across every task, next to the ledger and for the same reason:
  // it records what the model was actually given.
  let redactedContextSpans = 0

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
  let referencedDefinitionsDropped = 0
  let referencedDefinitionsUnreadable = 0
  // Shared by every task in this assembly. Tasks legitimately import the same
  // dependencies, and without this each one re-probed the same import candidates
  // and re-ran the extractor over the same dependency files.
  const referencedDefinitionCache = createReferencedDefinitionCache()
  const testMappings = discoverDeterministicSignalTestMappings(input.sourceFiles)
  // Every changed/source file path: referenced-definition resolution must never
  // surface one of these (they are reviewed directly, not injected as context).
  const allSourcePaths = new Set(
    input.sourceFiles.map((sourceFile) => sourceFile.path)
  )

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
      ...supportSignalContextsForPaths({
        factIds: task.factIds,
        pathSet:
          sourceContexts.length === 0
            ? taskPathSet
            : new Set(workflowTaskPaths(sourceContexts, task.paths)),
        deterministicSignalMode: input.config.aiReview.deterministicSignalMode,
        facts: input.analysis.facts,
        testMappings
      })
    ]

    // R4: collect bounded referenced-definition digests for unchanged files the
    // task's changed files import (relative imports only). Context only — these
    // never enter task.paths and are not review targets. `allSourcePaths` covers
    // every changed file so a dependency that happens to be changed is excluded.
    // The collector counts what its caps kept out, with the comment "count them
    // so the omission is reportable" — and this call site used to read `.digests`
    // and throw both counts away, so nothing was reported anywhere. A task whose
    // dependency view was cut looked exactly like one with no dependencies.
    const referenced =
      input.config.aiReview.deterministicSignalMode === 'disabled'
        ? {
            digests: [],
            droppedByFileCap: 0,
            droppedByBudget: 0,
            droppedByReadFailure: 0
          }
        : await collectReferencedDefinitions({
            repositoryRoot: input.repositoryRoot,
            taskPaths: task.paths,
            facts: input.analysis.facts,
            knownPaths: allSourcePaths,
            cache: referencedDefinitionCache
          })

    // The two caps sum into one "dropped" count because they say the same thing
    // to a reader — the section was too small for this task's dependencies. A read
    // failure does not, so it is carried on its own.
    referencedDefinitionsDropped +=
      referenced.droppedByFileCap + referenced.droppedByBudget
    referencedDefinitionsUnreadable += referenced.droppedByReadFailure

    const referencedDefinitionContexts: ContextInput[] = referenced.digests.map(
      (digest) => ({
        kind: 'referenced-definition' as const,
        path: digest.path,
        content: digest.content
      })
    )

    // A task with nothing to show the reviewer produces no workflow task at all.
    if (taskContexts.length > 0) {
      const created = createWorkflowTask({
        task,
        taskId: workflowTaskId(task, taskContexts),
        inputContexts: taskContexts,
        paths: workflowTaskPaths(taskContexts, task.paths),
        referencedDefinitionContexts,
        reviewedDiffText: input.reviewedDiffText,
        instructions: staticContext.instructions,
        instructionScopes: staticContext.instructionScopes,
        facts: input.analysis.facts,
        evidence: input.analysis.evidence,
        // Decides which stage the support-signal document's ledger entry claims to
        // have reached. Read from config here, where config already is, rather than
        // handing the whole config to a module that needs one boolean.
        signalFactsEnabled: input.config.review.signalFacts.enabled
      })

      // Appended here, in task order, rather than inside the creation above: the
      // ledger's order is the loop's, and it stays a property a reader can check
      // by reading this loop.
      contextLedger.push(...created.ledgerEntries)
      redactedContextSpans += created.redactedSpanCount
      tasks.push(created.task)
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
    contextLedger,
    referencedDefinitionsDroppedCount: referencedDefinitionsDropped,
    referencedDefinitionsUnreadableCount: referencedDefinitionsUnreadable,
    redactedContextSpanCount: redactedContextSpans
  }
}

/**
 * The run's disclosure that redaction altered the material the model reviewed.
 *
 * One warning for both surfaces, because the reader's question is the same for
 * the diff and for a context document — "did the reviewer see this file as it
 * is?" — and the remedy is the same too: search the changed files for
 * `[REDACTED]` and decide whether a real credential is committed there or a
 * pattern matched ordinary code. The two counts are reported separately anyway,
 * because a diff-only redaction and a context-only one point at different halves
 * of the same material.
 *
 * Silent at zero. A warning on every run is one nobody reads, which is the rule
 * the referenced-definition caps already follow, and zero is the expected result:
 * measured over this repository's tracked files and its installed dependencies
 * (5,253 files, 52.3 MB), no production source file matches any pattern.
 */
export const redactedReviewMaterialWarnings = (input: {
  readonly redactedDiffSpanCount: number
  readonly redactedContextSpanCount: number
}): readonly string[] => {
  const total = input.redactedDiffSpanCount + input.redactedContextSpanCount

  if (total === 0) {
    return []
  }

  return [
    `Secret redaction replaced ${total} span(s) of the material this review read (${input.redactedDiffSpanCount} in the reviewed diff, ${input.redactedContextSpanCount} in task context), so the reviewer saw \`[REDACTED]\` where those files have text. Findings that touch those spans were reasoned about altered source. Check whether a credential is committed there; if not, a redaction pattern matched ordinary code.`
  ]
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
      skillCount: assembledContext.skills.length,
      referencedDefinitionsDroppedCount:
        assembledContext.referencedDefinitionsDroppedCount,
      referencedDefinitionsUnreadableCount:
        assembledContext.referencedDefinitionsUnreadableCount,
      redactedContextSpanCount: assembledContext.redactedContextSpanCount
    }
  }
}
