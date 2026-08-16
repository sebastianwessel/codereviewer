// Every kind of context document this engine can assemble must actually reach
// the model.
//
// THE DEFECT CLASS. `buildContextSections` selects what to render by matching
// `entry.kind` against a fixed set of runtime predicates. A context document
// whose kind no predicate matches is silently dropped: it was gathered, it was
// hashed, it was ledgered as `included` — and the reviewer never saw a byte of
// it. Nothing fails. The report looks complete, the ledger says the bytes
// reached the model, and recall quietly drops.
//
// This is not hypothetical here. Reviewer instructions were ledgered AND hashed
// and then dropped before the discovery call, and the ledger's own header records
// a second instance: the reviewed diff reached every packet while being ledgered
// nowhere, so "how much context did this run send" read low for every run ever
// measured. Both were found by reading, not by a failing test.
//
// TYPESCRIPT CANNOT CATCH THIS. The renderer filters with predicates
// (`entry.kind === 'change-intent'`), not a `switch` over a discriminated union,
// so adding an enum member produces no exhaustiveness error. There is nothing to
// narrow and nothing to complain about. The guard has to be behavioural.
//
// WHY IT ASSERTS ON RENDERED TEXT rather than on a field or a count: the claim
// worth defending is "the model saw it". A document can be present on the task,
// carry a valid ledger id, and still contribute zero bytes to the prompt. Only
// the rendered string can tell those apart.
//
// THE ASYMMETRY THIS CLOSES. Refutation already had this guard — see "every
// reviewContext kind is a decision, not a default" in `refutation/packet.test.ts`
// — and its packet filters with a BLOCKLIST (`kind !== 'change-intent'`), so a
// new kind reaches the refuter by default and the test only forces someone to
// rule on it. Discovery filters with ALLOWLISTS (`kind === 'referenced-definition'`,
// and one per section), so a new kind reaches the model NEVER, by default, and
// nothing said so. The safer default sat on the stage that already had a guard,
// and the stage that fails silent had none. Both stages are now covered, and the
// two tests should be changed together.

import { describe, expect, test } from 'vitest'
import {
  ReviewContextDocumentSchema,
  TaskReviewInputSchema
} from '../agent-contracts.js'
import { buildContextSections } from './review-packet.js'

const reviewedPath = 'src/reviewed.ts'

// One sentinel per kind, unlikely to collide with framing text the packet always
// emits. If a kind's content reaches the prompt, its sentinel is in the output.
const sentinelFor = (kind: string): string =>
  `CONTEXT_KIND_SENTINEL_${kind.toUpperCase().replaceAll('-', '_')}`

const packetTextFor = (kind: string): string => {
  const sentinel = sentinelFor(kind)
  // A 'file' document is the reviewed file itself and must be at the reviewed
  // path; every other kind is supporting context and carries its own path.
  const documentPath = kind === 'file' ? reviewedPath : 'src/context.ts'
  const taskInput = TaskReviewInputSchema.parse({
    task: {
      id: 'task_kind_coverage',
      kind: 'file',
      round: 1,
      paths: [reviewedPath],
      factIds: [],
      evidenceIds: [],
      candidateIds: [],
      contextEntryIds: [],
      priority: 1,
      instructions: [],
      reviewContext: [
        // The reviewed file is always present: a packet with no review target is
        // not a packet this engine would ever build, and its absence would change
        // what the other sections render around.
        {
          kind: 'file',
          path: reviewedPath,
          content: 'export const reviewed = 1\n',
          ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
        },
        {
          kind,
          path: documentPath,
          content: `${sentinel}\n`,
          ledgerEntryId: 'ctx_bbbbbbbbbbbbbbbbbbbbbbbb'
        }
      ]
    },
    reviewedDiffRanges: [],
    evidence: [],
    candidates: [],
    skills: [],
    provenance: {
      reviewer: 'review-agent',
      modelProvider: 'openai',
      modelName: 'context-kind-coverage',
      signalVersions: {},
      configHash: 'a'.repeat(64)
    }
  })

  // Both optional sections enabled, so a kind that only renders under a flag is
  // still covered. A kind reachable ONLY when a capability is off would be a
  // different defect and is not what this guards.
  return buildContextSections(taskInput, '', true, true).join('\n\n')
}

describe('context kind coverage', () => {
  const kinds = ReviewContextDocumentSchema.shape.kind.options

  test('there are kinds to check', () => {
    // ANTI-VACUITY: an empty options array would make the loop below assert
    // nothing while reporting success, which is the shape of failure this whole
    // file exists to catch.
    expect(kinds.length).toBeGreaterThan(4)
  })

  test.each([...kinds])(
    'a %s document reaches the rendered packet',
    (kind) => {
      expect(packetTextFor(kind)).toContain(sentinelFor(kind))
    }
  )
})
