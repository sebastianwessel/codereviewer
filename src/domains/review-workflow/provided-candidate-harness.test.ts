import { describe, expect, test } from 'vitest'
import type {
  JsonValue,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import { runProvidedCandidateReviewWorkflow } from './workflow-session.js'
import { createProvidedCandidateReviewHarness } from './provided-candidate-harness.js'

class UnusedProvider implements ModelProvider {
  readonly id = 'unused'
  readonly genAiSystem = 'scripted'

  async object<T extends JsonValue = JsonValue>(
    _req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    throw new Error('provided-candidate harness should not call the provider')
  }
}

const configHash =
  '8888888888888888888888888888888888888888888888888888888888888888'

describe('provided candidate harness', () => {
  test('passes provided candidates through the shared workflow handler', async () => {
    const harness = createProvidedCandidateReviewHarness({
      modelAlias: {
        provider: new UnusedProvider(),
        model: 'scripted',
        capabilities: ['object', 'tool_use']
      }
    })

    const result = await runProvidedCandidateReviewWorkflow({
      harness,
      sessionId: 'provided-candidate-test',
      input: {
        runId: 'provided-candidate-run',
        reviewedPaths: ['src/provided.ts'],
        reviewedDiffRanges: [
          { path: 'src/provided.ts', startLine: 1, endLine: 20 }
        ],
        evidence: [
          {
            id: 'ev_provided1',
            kind: 'diff',
            summary: 'Changed branch returns stale data.',
            location: {
              path: 'src/provided.ts',
              startLine: 8,
              side: 'new'
            },
            source: 'diff',
            redactionApplied: true
          }
        ],
        candidates: [
          {
            id: 'cand_provided1',
            taskId: 'task_provided1',
            category: 'bug',
            severity: 'high',
            title: 'Changed branch returns stale data',
            description: 'The changed branch can return stale data to callers.',
            location: {
              path: 'src/provided.ts',
              startLine: 8,
              side: 'new'
            },
            evidenceIds: ['ev_provided1'],
            proposedBy: 'review-agent'
          }
        ],
        instructions: [],
        skills: [],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          signalVersions: {},
          configHash
        },
        qualityGate: {
          maxHigh: 1
        }
      }
    })

    expect(result.candidateFindings).toHaveLength(1)
    expect(result.admittedFindings).toHaveLength(1)
    expect(result.admittedFindings[0]).toMatchObject({
      title: 'Changed branch returns stale data',
      baselineStatus: 'new'
    })
    expect(result.qualityGate.passed).toBe(true)

    await harness.shutdown()
  })
})
