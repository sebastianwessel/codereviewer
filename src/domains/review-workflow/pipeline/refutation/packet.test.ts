import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../../admission/index.js'
import { ReviewContextDocumentSchema } from '../agent-contracts.js'
import {
  type ReviewContextDocument,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from '../contracts.js'
import { findingRefutationBatchInput } from './packet.js'
import { isTaskPacketBudgetExceededError } from '../packet-budget.js'

const configHash =
  '1111111111111111111111111111111111111111111111111111111111111111'

const modelCandidate: CandidateFinding = {
  id: 'cand_bug1',
  taskId: 'task_app1',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch returns wrong value',
  description: 'The changed branch can return the wrong value.',
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  evidenceIds: ['ev_diff1'],
  proposedBy: 'review-agent'
}

// A second model candidate raised by the SAME task. Batched refutation adjudicates
// it in the same packet, so the packet must carry the union of the batch's evidence.
const secondModelCandidate: CandidateFinding = {
  ...modelCandidate,
  id: 'cand_bug2',
  title: 'Changed branch skips validation',
  description: 'The changed branch can skip validation.',
  location: {
    path: 'src/app.ts',
    startLine: 40,
    side: 'new'
  },
  evidenceIds: ['ev_other1']
}

const supportCandidate: CandidateFinding = {
  ...modelCandidate,
  id: 'cand_support1',
  proposedBy: 'deterministic-signal'
}

const unrelatedSamePathSupportCandidate: CandidateFinding = {
  ...supportCandidate,
  id: 'cand_support2',
  location: {
    path: 'src/app.ts',
    startLine: 40,
    side: 'new'
  },
  evidenceIds: ['ev_other2']
}

const evidence = (
  id: string,
  path = 'src/app.ts'
): EvidenceRecord => ({
  id,
  kind: 'file',
  summary: `Evidence for ${path}.`,
  location: {
    path,
    startLine: 4,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
})

const reviewContext = (
  content = 'task context'
): ReviewContextDocument => ({
  kind: 'file',
  path: 'src/app.ts',
  content,
  ledgerEntryId: 'ctx_aaaaaaaa'
})

const task = (
  context: readonly ReviewContextDocument[],
  instructions: WorkflowReviewTask['instructions'] = []
): WorkflowReviewTask => ({
  id: 'task_app1',
  round: 1,
  kind: 'file',
  paths: ['src/app.ts'],
  factIds: [],
  evidenceIds: ['ev_diff1'],
  candidateIds: ['cand_bug1'],
  contextEntryIds: context.map((entry) => entry.ledgerEntryId),
  instructions: [...instructions],
  reviewContext: [...context],
  priority: 0
})

// Instruction documents as context assembly resolves them for one task. Declared
// here so a test can hand the same set to the task fixture that the assertions
// name.
const instructionDocuments = (
  ...contents: readonly string[]
): WorkflowReviewTask['instructions'] =>
  contents.map((content, index) => ({
    path: `AGENTS-${index}.md`,
    content,
    allowed: true
  }))

const workflowInput = (
  input: {
    readonly maxTaskInputBytes?: number
  } = {}
): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-refutation-packet',
    reviewedPaths: ['src/app.ts'],
    reviewedDiffRanges: [
      {
        path: 'src/app.ts',
        startLine: 4,
        endLine: 4
      }
    ],
    evidence: [evidence('ev_diff1'), evidence('ev_other1', 'src/other.ts')],
    candidates: [
      modelCandidate,
      supportCandidate,
      unrelatedSamePathSupportCandidate
    ],
    skills: [],
    ...(input.maxTaskInputBytes === undefined
      ? {}
      : { maxTaskInputBytes: input.maxTaskInputBytes }),
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

describe('finding refutation packet', () => {
  test('keeps candidate-scoped evidence, support signals, and task context', () => {
    const context = reviewContext()
    const packet = findingRefutationBatchInput({
      workflowInput: workflowInput(),
      task: task([context]),
      candidates: [modelCandidate],
      allCandidates: [modelCandidate, supportCandidate]
    })

    expect(packet.evidence.map((record) => record.id)).toEqual([
      'ev_diff1'
    ])
    expect(packet.supportSignalCandidates).toEqual([supportCandidate])
    expect(packet.reviewContext).toEqual([context])
    expect(packet.reviewedDiffRanges).toEqual([
      {
        path: 'src/app.ts',
        startLine: 4,
        endLine: 4
      }
    ])
  })

  // The point of the batch packet: every candidate of the task rides along with a
  // SINGLE copy of the task context, and the evidence is the union of the batch.
  test('carries every batched candidate and the union of their evidence once', () => {
    const context = reviewContext()
    const packet = findingRefutationBatchInput({
      workflowInput: workflowInput(),
      task: task([context]),
      candidates: [modelCandidate, secondModelCandidate],
      allCandidates: [modelCandidate, secondModelCandidate, supportCandidate]
    })

    expect(packet.candidates.map((entry) => entry.id)).toEqual([
      'cand_bug1',
      'cand_bug2'
    ])
    expect(packet.evidence.map((record) => record.id)).toEqual([
      'ev_diff1',
      'ev_other1'
    ])
    expect(packet.reviewContext).toEqual([context])
  })

  // Spec 04: refutation adjudicates a candidate against the same rules its
  // discovery call was given, so the packet takes the originating task's own
  // resolved instruction set. Taking a run-wide list instead would show the
  // adjudicator guidance that was scoped away from the task that raised the
  // candidate — and in this stage the mistake is silent, because a candidate
  // refuted against a rule that should not have applied produces no output.
  test('carries the originating task’s own instruction set', () => {
    const scoped = instructionDocuments('Backend-only guidance.')
    const packet = findingRefutationBatchInput({
      workflowInput: workflowInput(),
      task: task([reviewContext()], scoped),
      candidates: [modelCandidate],
      allCandidates: [modelCandidate]
    })

    expect(packet.instructions).toEqual(scoped)

    const unscopedPacket = findingRefutationBatchInput({
      workflowInput: workflowInput(),
      task: task([reviewContext()]),
      candidates: [modelCandidate],
      allCandidates: [modelCandidate]
    })

    expect(unscopedPacket.instructions).toEqual([])
  })

  test('drops unrelated same-file support signals from the refutation packet', () => {
    const packet = findingRefutationBatchInput({
      workflowInput: workflowInput(),
      task: task([]),
      candidates: [modelCandidate],
      allCandidates: [
        modelCandidate,
        supportCandidate,
        unrelatedSamePathSupportCandidate
      ]
    })

    expect(packet.supportSignalCandidates).toEqual([supportCandidate])
  })

  // The packet reaches the provider as `JSON.stringify(input)` with Zod's
  // declaration key order, so the fields ahead of `reviewContext` ARE the prompt
  // prefix two refutation calls of one run share, and a provider caches only a
  // prefix it can match. Pinning the invariant here because it is invisible: a
  // per-task field moved or inserted above `reviewContext` breaks nothing a
  // functional test would notice, it just silently deletes the shared prefix.
  test('serializes every run-invariant field ahead of the first per-task field', () => {
    const input = workflowInput()
    // The unscoped case: both tasks resolved the same repository-wide
    // instruction, so it is still run-invariant and still belongs in the prefix.
    const instructions = instructionDocuments('Repository review instructions.')
    const firstBatch = JSON.stringify(
      findingRefutationBatchInput({
        workflowInput: input,
        task: task([reviewContext('first task context')], instructions),
        candidates: [modelCandidate],
        allCandidates: [modelCandidate]
      })
    )
    const secondBatch = JSON.stringify(
      findingRefutationBatchInput({
        workflowInput: input,
        task: task([reviewContext('second task context')], instructions),
        candidates: [secondModelCandidate],
        allCandidates: [secondModelCandidate]
      })
    )

    let sharedPrefixLength = 0
    while (
      sharedPrefixLength < firstBatch.length &&
      firstBatch[sharedPrefixLength] === secondBatch[sharedPrefixLength]
    ) {
      sharedPrefixLength += 1
    }
    const sharedPrefix = firstBatch.slice(0, sharedPrefixLength)

    // Provenance, instructions, and skills are constant for every refutation call
    // of a run and must all sit inside the shared prefix.
    expect(sharedPrefix).toContain('"provenance":')
    expect(sharedPrefix).toContain('Repository review instructions.')
    expect(sharedPrefix).toContain('"skills":')
    // The prefix reaches the first per-task field and stops inside it.
    expect(sharedPrefix).toContain('"reviewContext":')
    expect(sharedPrefix).not.toContain('first task context')
  })

  test('throws the shared packet budget error when the refutation packet is too large', () => {
    let thrown: unknown

    try {
      findingRefutationBatchInput({
        workflowInput: workflowInput({ maxTaskInputBytes: 10000 }),
        task: task(
          [],
          instructionDocuments('irreducible instruction '.repeat(800))
        ),
        candidates: [modelCandidate],
        allCandidates: [modelCandidate]
      })
    } catch (error: unknown) {
      thrown = error
    }

    expect(isTaskPacketBudgetExceededError(thrown)).toBe(true)
  })

  // A packet that fits carries no notice at all: the field exists to explain a
  // withheld field, and an always-present one would be a second constant of the
  // kind the shared-context digest already turned out to be.
  test('carries no budget notice when the packet fits', () => {
    const packet = findingRefutationBatchInput({
      workflowInput: workflowInput({ maxTaskInputBytes: 100000 }),
      task: task([reviewContext()]),
      candidates: [modelCandidate],
      allCandidates: [modelCandidate, supportCandidate]
    })

    expect(packet.budgetNotice).toBeUndefined()
    expect(packet.supportSignalCandidates).toEqual([supportCandidate])
  })

  test('compacts support-signal context before failing the packet budget', () => {
    const context = reviewContext('decisive context')
    const supportCandidates = Array.from({ length: 40 }, (_, index) => ({
      ...supportCandidate,
      id: `cand_support${index}`
    }))
    const packet = findingRefutationBatchInput({
      workflowInput: workflowInput({
        maxTaskInputBytes: 10000
      }),
      task: task([context]),
      candidates: [modelCandidate],
      allCandidates: [modelCandidate, ...supportCandidates]
    })

    expect(packet.evidence.map((record) => record.id)).toEqual([
      'ev_diff1'
    ])
    expect(packet.reviewContext).toEqual([context])
    expect(packet.supportSignalCandidates).toEqual([])
    // The support signals were shed, so the notice NAMES them. Without it the
    // emptied array read to the refuter as "there is no corroboration" rather than
    // "it was withheld".
    expect(packet.budgetNotice).toContain('WITHHELD')
    expect(packet.budgetNotice).toContain('the deterministic support signals')
    // And what the absence must NOT be read as. A candidate refuted because the
    // budget removed its support produces no output at all, so the mistake is
    // invisible downstream.
    expect(packet.budgetNotice).toContain('needs-more-evidence')
  })

  // THE DEFAULT PATH. `supportSignalCandidates` is filtered on `proposedBy !==
  // 'review-agent'` and the only producer inside this engine stamps
  // `'review-agent'` on every candidate it proposes, so on an ordinary run the
  // array is ALREADY empty when the ladder starts. The first rung ran anyway:
  // it emptied an empty array — shedding nothing — and added ~330 characters of
  // notice, so the response to an over-budget packet was to make it BIGGER, and
  // the notice told the refuter that deterministic support signals had been
  // withheld from it when none had ever existed. That is the same
  // absence-the-engine-created failure the notice exists to prevent, arriving
  // through the notice itself.
  test('a rung with nothing to shed neither runs nor claims a withholding', () => {
    // Large enough that the packet is over budget with the support-signal rung
    // unavailable, so the ladder must reach the review-context rung to fit.
    const context = reviewContext('decisive context '.repeat(1200))
    const packet = findingRefutationBatchInput({
      workflowInput: workflowInput({ maxTaskInputBytes: 10000 }),
      task: task([context]),
      candidates: [modelCandidate],
      // Nothing here was proposed by anything but the review agent — the shape
      // of every default-path run.
      allCandidates: [modelCandidate]
    })

    expect(packet.supportSignalCandidates).toEqual([])
    expect(packet.reviewContext).toEqual([])
    // What WAS withheld is named.
    expect(packet.budgetNotice).toContain('the review context')
    // What was never there is not: a refuter told the support signals were
    // withheld reads their absence as an artefact of the budget rather than as
    // the ordinary state of every run, and both readings are wrong here.
    expect(packet.budgetNotice).not.toContain('support signals')
  })

  test('naming the withheld context is the last thing shed, not the first', () => {
    // Every rung of the ladder carries the notice, including the one that empties
    // the review context — the rung whose silence was most costly, because the
    // refuter's instructions treat review context as evidentiary.
    // Large enough that shedding the signals still does not fit, so the ladder
    // reaches its last rung. 10000 is the schema floor for the cap.
    const context = reviewContext('decisive context '.repeat(1200))
    const packet = findingRefutationBatchInput({
      workflowInput: workflowInput({ maxTaskInputBytes: 10000 }),
      task: task([context]),
      candidates: [modelCandidate],
      allCandidates: [modelCandidate]
    })

    expect(packet.reviewContext).toEqual([])
    expect(packet.budgetNotice).toContain('the review context')
    expect(packet.budgetNotice).toContain('artefact of the budget')
  })
})

// The change-intent exclusion is a BLOCKLIST — `kind !== 'change-intent'` — so
// every other reviewContext kind reaches refutation by default. That is fail-open,
// and TypeScript cannot catch it: the comparison compiles unchanged however many
// kinds the enum gains.
//
// This test is the guard the filter does not have. It fails when a kind is added,
// forcing a deliberate decision about whether refutation may see it — which is the
// point, because the next untrusted-but-fact-shaped kind (a PR description, an
// external ticket body) inherits change-intent's exact risk: refutation treats
// reviewContext as evidentiary, and a suppressed finding leaves no trace.
describe('every reviewContext kind is a decision, not a default', () => {
  const kindsRefutationMaySee = [
    'file',
    'support-signal-output',
    'referenced-definition',
    'analyzer-signal'
  ] as const
  const kindsWithheldFromRefutation = ['change-intent'] as const

  test('the enum holds exactly the kinds this test has ruled on', () => {
    expect([...ReviewContextDocumentSchema.shape.kind.options].sort()).toEqual(
      [...kindsRefutationMaySee, ...kindsWithheldFromRefutation].sort()
    )
  })

  test('a withheld kind never reaches the refuter', () => {
    for (const kind of kindsWithheldFromRefutation) {
      const packet = findingRefutationBatchInput({
        workflowInput: workflowInput(),
        task: task([{ ...reviewContext(), kind }]),
        candidates: [modelCandidate],
        allCandidates: [modelCandidate]
      })

      expect(packet.reviewContext).toEqual([])
    }
  })

  test('an allowed kind does reach the refuter', () => {
    for (const kind of kindsRefutationMaySee) {
      const document = { ...reviewContext(), kind }
      const packet = findingRefutationBatchInput({
        workflowInput: workflowInput(),
        task: task([document]),
        candidates: [modelCandidate],
        allCandidates: [modelCandidate]
      })

      expect(packet.reviewContext).toEqual([document])
    }
  })
})
