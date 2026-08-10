import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../admission/index.js'
import {
  FindingRefutationBatchInputSchema,
  ModelRefutationBatchVerdictSchema,
  normalizeFindingRefutationResult,
  refutationVerdictsByCandidateId
} from '../pipeline/agent-contracts.js'
import { runRefutationProviderCall } from './provider-call-adapters.js'

const configHash =
  '4444444444444444444444444444444444444444444444444444444444444444'

const candidate: CandidateFinding = {
  id: 'cand_provider',
  taskId: 'task_provider',
  category: 'bug',
  severity: 'high',
  title: 'Provider adapter path loses data',
  description: 'The changed provider adapter path can lose data.',
  location: {
    path: 'src/provider.ts',
    startLine: 12,
    side: 'new'
  },
  evidenceIds: ['ev_provider'],
  proposedBy: 'review-agent'
}

const evidence: EvidenceRecord = {
  id: 'ev_provider',
  kind: 'file',
  summary: 'The changed provider path loses data.',
  location: {
    path: 'src/provider.ts',
    startLine: 12,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const provenance = {
  reviewer: 'review-agent' as const,
  signalVersions: {},
  configHash
}

const createLogger = () => {
  const entries: Array<{
    message: string
    metadata?: Readonly<Record<string, unknown>>
  }> = []

  return {
    entries,
    logger: {
      debug: (
        message: string,
        metadata?: Readonly<Record<string, unknown>>
      ) => {
        entries.push({
          message,
          ...(metadata === undefined ? {} : { metadata })
        })
      }
    }
  }
}

describe('model provider call adapters', () => {
  test('logs and normalizes refutation output', async () => {
    const { entries, logger } = createLogger()
    const refutationInput = FindingRefutationBatchInputSchema.parse({
      candidates: [candidate],
      reviewedDiffRanges: [],
      evidence: [evidence],
      supportSignalCandidates: [],
      instructions: [],
      reviewContext: [],
      skills: [],
      provenance
    })

    const result = await runRefutationProviderCall({
      refutationInput,
      refuteFinding: async (input) => ({
        verdicts: input.candidates.map((batched) => ({
          candidateId: batched.id,
          verdict: 'proved',
          rationaleSummary: 'The proof is still valid.'
        }))
      }),
      logger
    })

    // The adapter passes the batch through untouched; binding a verdict back to its
    // candidate is the resolver's job.
    expect(refutationVerdictsByCandidateId(result).get('cand_provider')).toEqual({
      verdict: 'proved',
      rationaleSummary: 'The proof is still valid.'
    })
    expect(entries.map((entry) => entry.message)).toEqual([
      'Refutation check provider call started.',
      'Refutation check provider call completed.'
    ])
  })

  test('accepts common model refutation output variants before normalization', () => {
    // Exercises the LIVE batched path: providers word the verdict differently and
    // over-run the length caps, and a batch entry must still normalize.
    const parsed = ModelRefutationBatchVerdictSchema.parse({
      candidateId: 'cand_0000000000000001',
      decision: 'false_positive',
      summary: 'The finding is contradicted. '.repeat(80),
      fix_summary: 'No code change is needed. '.repeat(80)
    })

    const normalized = normalizeFindingRefutationResult(parsed)

    expect(normalized.verdict).toBe('refuted')
    expect(normalized.rationaleSummary).toHaveLength(1200)
    expect(normalized.fixSummary).toHaveLength(1200)
  })

  test('ignores the retired suggestedFix spelling', () => {
    // `suggestedFix` was removed from the candidate contract end-to-end, so it is
    // not a spelling this engine ever asked a refuter for. Reading it back would
    // resurrect a retired name through the one door still open to free-form model
    // JSON; the surviving `fixSummary`/`fix_summary` pair is producer tolerance,
    // which is a different thing.
    const parsed = ModelRefutationBatchVerdictSchema.parse({
      candidateId: 'cand_0000000000000002',
      verdict: 'proved',
      rationaleSummary: 'The proof holds.',
      suggestedFix: 'Guard the null case.'
    })

    expect(normalizeFindingRefutationResult(parsed).fixSummary).toBeUndefined()
  })
})
