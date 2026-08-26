// One task as the workflow receives it: its context documents, the ledger entries
// recording what those documents cost, and the instruction set its packets carry.
//
// Split out of `context.ts` because it is the whole of what assembly does per
// task, and reading the assembly loop should not require reading it. It takes an
// explicit input and RETURNS its ledger entries and redaction count instead of
// appending to the caller's accumulators: the caller appends them in one place, in
// task order, so the ledger's order remains a property of the loop rather than of
// where inside this function a push happens to sit.

import { redactTextWithCount } from '../../../../shared/redaction/redactor.js'
import { utf8ByteLength } from '../../../../shared/text/utf8-bytes.js'
import { diffSegmentsForPaths } from '../../../../shared/diff/git-diff-header.js'
import type { DeterministicSignalExtraction } from '../../../deterministic-signals/index.js'
import {
  createContextLedgerEntry,
  type ContextLedgerEntry,
  type ReviewTask
} from '../../../review-planning/index.js'
import type { ReviewWorkflowInput } from '../../harness/workflow.js'
import {
  selectInstructionsForFiles,
  type InstructionContextDocument,
  type InstructionScope
} from './static-context.js'

export type ReviewContextDocument = NonNullable<
  ReviewWorkflowInput['reviewContext']
>[number]
export type WorkflowReviewTask = NonNullable<
  ReviewWorkflowInput['tasks']
>[number]

export type ContextInput = {
  readonly content: string
  readonly kind: ReviewContextDocument['kind']
  readonly path?: string
  // Absolute origin of a 'file' chunk in its source file. Present only for source
  // chunks; support-signal and referenced-definition context has no place in the
  // reviewed file to point at.
  readonly startLine?: number
  readonly endLine?: number
}

export type CreateWorkflowTaskInput = {
  readonly task: ReviewTask
  readonly taskId: string
  readonly inputContexts: readonly ContextInput[]
  readonly paths: readonly string[]
  // Referenced-definition contexts (R4) are appended to reviewContext but MUST
  // NOT influence task.paths: they are unchanged dependency files included for
  // context only, never review targets. They are passed separately so the
  // caller can derive paths solely from the changed-file/support-signal batch.
  readonly referencedDefinitionContexts: readonly ContextInput[]
  // The reviewed diff, for ACCOUNTING only — the task's own segments of it are
  // ledgered here, and the packet builds its own copy from the same text through
  // the same shared splitter.
  readonly reviewedDiffText: string
  readonly instructions: readonly InstructionContextDocument[]
  readonly instructionScopes: readonly InstructionScope[]
  readonly facts: DeterministicSignalExtraction['facts']
  readonly evidence: DeterministicSignalExtraction['evidence']
  // `review.signalFacts.enabled`. Needed HERE, where the support-signal document is
  // ledgered, because it decides which STAGE those bytes reach — see the reason
  // string below. Threaded from the caller rather than re-read from config: this
  // module takes no configuration, and one flag is not a reason to give it one.
  readonly signalFactsEnabled: boolean
}

export type CreatedWorkflowTask = {
  readonly task: WorkflowReviewTask
  // In creation order, for the caller to append to the run's ledger.
  readonly ledgerEntries: readonly ContextLedgerEntry[]
  // Spans redaction replaced in this task's documents. Summed by the caller, for
  // the reason given at the substitution below.
  readonly redactedSpanCount: number
}

export const createWorkflowTask = (
  input: CreateWorkflowTaskInput
): CreatedWorkflowTask => {
  const reviewContext: ReviewContextDocument[] = []
  const contextEntryIds: string[] = []
  const ledgerEntries: ContextLedgerEntry[] = []
  const pathSet = new Set(input.paths)
  let redactedSpanCount = 0

  // The task's own diff segments, accounted for before the documents are. They
  // are not a reviewContext document — the packet renders them from the same
  // shared splitter — but they ARE bytes this task sends to the model, and the
  // ledger's one job is to know that. Recorded per task because that is how
  // many times they are sent.
  //
  // Recorded for the task as PLANNED. A reactive split (spec 26) happens later,
  // at discovery, when the provider refuses the packet; the halves it produces
  // are shown the hunks inside their own chunk and nothing else, so the two
  // together send about what is recorded here rather than twice it. A hunk
  // straddling the split point is the one thing counted once and sent twice.
  const taskDiffText = diffSegmentsForPaths(input.reviewedDiffText, input.paths)

  if (taskDiffText.length > 0) {
    const diffBytes = utf8ByteLength(taskDiffText)

    ledgerEntries.push(
      createContextLedgerEntry({
        kind: 'diff',
        taskId: input.taskId,
        reason: 'task-context-diff-segments',
        decision: 'included',
        bytesConsidered: diffBytes,
        bytesIncluded: diffBytes,
        content: taskDiffText
      })
    )
  }

  for (const inputContext of [
    ...input.inputContexts,
    ...input.referencedDefinitionContexts
  ]) {
    const contentBytes = utf8ByteLength(inputContext.content)
    // COUNTED HERE, at the one place a reviewed document's content is altered
    // between the file on disk and the packet.
    //
    // A redaction on a log line or a report artifact hides a secret from a
    // reader and is finished. A redaction HERE is generative: the model reads
    // `[REDACTED]` where the file has source, and every candidate it raises or
    // fails to raise around that span is reasoning about code that does not
    // exist. Nothing else in the run can reveal it — the ledger entry below
    // hashes and measures `inputContext.content`, the text BEFORE redaction, so
    // even a reader comparing hashes is comparing against a string the model
    // never saw. The count is the only place the alteration becomes a fact the
    // run can report.
    const redactedContent = redactTextWithCount(inputContext.content)

    redactedSpanCount += redactedContent.redactionCount

    const ledgerEntry = createContextLedgerEntry({
      // The context ledger has no dedicated kinds for 'referenced-definition',
      // 'change-intent', or 'analyzer-signal'; all are recorded as
      // support-signal-output (derived context, not a reviewed changed file).
      // 'change-intent' and 'analyzer-signal' are injected by separate stages and
      // never reach this assembly loop, but the mapping keeps the kind union
      // exhaustive.
      kind:
        inputContext.kind === 'referenced-definition' ||
        inputContext.kind === 'change-intent' ||
        inputContext.kind === 'analyzer-signal'
          ? 'support-signal-output'
          : inputContext.kind,
      ...(inputContext.path === undefined ? {} : { path: inputContext.path }),
      taskId: input.taskId,
      // The reason NAMES THE CONSUMING STAGE for the support-signal document,
      // because that document does not reach both of them.
      //
      // The ledger's stated job is "which bytes reached the model, and which were
      // held back" (`context-ledger.ts`). The support-signal bytes are ledgered
      // `included`, with `bytesIncluded === bytesConsidered`, on EVERY run — and
      // that is true of refutation, whose packet carries every reviewContext kind
      // but `change-intent`, and false of discovery unless
      // `review.signalFacts.enabled` (default false) renders the section into the
      // packet (`review-packet.ts`). So the entry was not a lie, and could not be
      // read correctly either: a reader checking whether the reviewer was shown the
      // symbol map found an `included` entry that meant a different stage. That is
      // the exact shape that hid the reviewer-instructions defect — ledgered,
      // hashed, and never delivered to discovery.
      //
      // A reason string rather than a per-stage ledger: the entry's bytes, hash and
      // decision are all still true as written, and the one thing missing was WHO
      // read them.
      reason:
        inputContext.kind === 'file'
          ? 'task-context-source-chunk'
          : inputContext.kind === 'referenced-definition'
            ? 'task-context-referenced-definition'
            : input.signalFactsEnabled
              ? 'task-context-support-signal-chunk-discovery-and-refutation'
              : 'task-context-support-signal-chunk-refutation-only',
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
      content: redactedContent.text,
      ledgerEntryId: ledgerEntry.id
    }

    ledgerEntries.push(ledgerEntry)
    reviewContext.push(contextDocument)
    contextEntryIds.push(ledgerEntry.id)
  }

  // Spec 04: which instruction documents this task's packets carry, decided
  // here — once per task, from the task's own reviewed files — so discovery and
  // refutation read one resolution instead of each computing their own.
  //
  // `paths` is derived from assembly's own context documents and the planner's
  // task, never from anything a reviewed file says: repository content selects
  // no instruction. An unscoped instruction is in `included` for every task.
  const instructionSelection = selectInstructionsForFiles(
    input.instructions,
    input.instructionScopes,
    input.paths
  )

  // A scoped-out instruction is DISCLOSED, not merely absent. Without this the
  // ledger for a task showed nothing at all where the instruction would have
  // been, which reads identically to "no such instruction was ever configured"
  // — and an operator whose guidance never reached the reviewer would have had
  // no way to tell the two apart. `bytesConsidered` is the document's full
  // size against `bytesIncluded: 0`, so the entry states what was withheld.
  //
  // Walks the DOCUMENTS and selects with the skipped paths, rather than
  // walking the skipped paths and looking each document up: the byte count
  // then always comes from a document that exists, with no absent-document
  // branch to answer with a fabricated zero.
  const skippedInstructionPaths = new Set(
    instructionSelection.skipped.map((entry) => entry.path)
  )

  for (const instruction of input.instructions) {
    if (!skippedInstructionPaths.has(instruction.path)) {
      continue
    }

    ledgerEntries.push(
      createContextLedgerEntry({
        kind: 'instruction',
        path: instruction.path,
        taskId: input.taskId,
        reason: 'instruction-scope-excluded',
        decision: 'skipped',
        bytesConsidered: utf8ByteLength(instruction.content),
        bytesIncluded: 0
      })
    )
  }

  return {
    task: {
      ...input.task,
      id: input.taskId,
      paths: [...input.paths],
      instructions: [...instructionSelection.included],
      factIds: input.facts
        .filter((fact) => pathSet.has(fact.path))
        .map((fact) => fact.id),
      evidenceIds: input.evidence
        .filter(
          (record) =>
            input.task.evidenceIds.includes(record.id) &&
            pathSet.has(record.location?.path ?? '')
        )
        .map((record) => record.id),
      candidateIds: [],
      reviewContext,
      contextEntryIds
    },
    ledgerEntries,
    redactedSpanCount
  }
}
