import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  FindingRefutationInputSchema,
  ModelFindingRefutationResultSchema,
  normalizeFindingRefutationResult
} from './model-agent-contracts.js'
import { runRefutationProviderCall } from './model-provider-call-adapters.js'

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
  kind: 'diff',
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
    const refutationInput = FindingRefutationInputSchema.parse({
      runId: 'run-provider-adapters',
      candidate,
      reviewedDiffRanges: [],
      evidence: [evidence],
      supportSignalCandidates: [],
      reviewContext: [],
      instructions: [],
      skills: [],
      sharedDigest: '(no admitted shared context yet)',
      provenance
    })

    const result = await runRefutationProviderCall({
      refutationInput,
      refuteFinding: async () => ({
        verdict: 'proved',
        rationaleSummary: 'The proof is still valid.'
      }),
      logger
    })

    expect(result.verdict).toBe('proved')
    expect(entries.map((entry) => entry.message)).toEqual([
      'Refutation check provider call started.',
      'Refutation check provider call completed.'
    ])
  })

  test('accepts common model refutation output variants before normalization', () => {
    const parsed = ModelFindingRefutationResultSchema.parse({
      decision: 'false_positive',
      summary: 'The finding is contradicted. '.repeat(80),
      suggestedFix: 'No code change is needed. '.repeat(80)
    })

    const normalized = normalizeFindingRefutationResult(parsed)

    expect(normalized.verdict).toBe('refuted')
    expect(normalized.rationaleSummary).toHaveLength(1200)
    expect(normalized.fixSummary).toHaveLength(1200)
  })
})
