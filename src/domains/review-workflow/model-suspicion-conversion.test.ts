import { describe, expect, test } from 'vitest'
import { candidatesFromModelSuspicions } from './model-suspicion-conversion.js'
import { TaskReviewInputSchema } from './model-agent-contracts.js'

describe('model suspicion conversion', () => {
  // This fixture exercises the GENERIC deduplication mechanism: model
  // suspicions that restate an existing trusted deterministic-rule candidate
  // (matched by proposedBy, location, and evidence) are dropped. The specific
  // rule that produced the trusted candidate is irrelevant to this behavior, so
  // the fixture uses a neutral rule id rather than a removed benchmark rule.
  const trustedCandidateInput = () =>
    TaskReviewInputSchema.parse({
      runId: 'run-conversion',
      task: {
        id: 'task_conversion',
        kind: 'dependency-cluster',
        round: 1,
        paths: ['src/cache.ts'],
        factIds: [],
        evidenceIds: ['evidence_cachelock'],
        candidateIds: ['cand_trustedcache'],
        contextEntryIds: [],
        priority: 1
      },
      reviewIntents: [],
      reviewedDiffRanges: [
        {
          path: 'src/cache.ts',
          startLine: 1,
          endLine: 40
        }
      ],
      evidence: [
        {
          id: 'evidence_cachelock',
          kind: 'rule',
          summary:
            'The cache value is populated outside the lock that protects it.',
          location: {
            path: 'src/cache.ts',
            startLine: 24,
            side: 'file'
          },
          source: 'typescript-support-signal',
          ruleId: 'trusted-rule-fixture',
          redactionApplied: true
        }
      ],
      candidates: [
        {
          id: 'cand_trustedcache',
          taskId: 'task_conversion',
          category: 'performance',
          severity: 'high',
          title: 'Cache value is populated outside the lock',
          description:
            'The cache value is populated outside the lock that protects it.',
          location: {
            path: 'src/cache.ts',
            startLine: 24,
            side: 'new'
          },
          evidenceIds: ['evidence_cachelock'],
          proposedBy: 'deterministic-trusted-rule',
          fixProposal: {
            summary: 'Populate the cache value under the protecting lock.',
            evidenceIds: ['evidence_cachelock'],
            safety: 'manual-review'
          }
        }
      ],
      instructions: [],
      skills: [],
      sharedDigest: '(empty)',
      provenance: {
        reviewer: 'review-agent',
        signalVersions: {},
        configHash:
          '8989898989898989898989898989898989898989898989898989898989898989'
      }
    })

  test('drops model suggestions that cite the same trusted deterministic evidence', () => {
    const input = trustedCandidateInput()

    const result = candidatesFromModelSuspicions(input, {
      suspicions: [
        {
          category: 'bug',
          severity: 'high',
          title: 'Cache is read and populated non-atomically',
          description:
            'The model reports the same cache-lock issue at the function start.',
          path: 'src/cache.ts',
          startLine: 16,
          evidenceIds: ['evidence_cachelock'],
          fixSummary: 'Protect the cache read/build/write path with locking.'
        }
      ]
    })

    expect(result.candidates).toEqual([])
    expect(result.droppedSuspicionReasons['duplicate-input-candidate']).toBe(1)
  })

  test('drops nearby model restatements of trusted deterministic candidates without evidence ids', () => {
    const input = trustedCandidateInput()

    const result = candidatesFromModelSuspicions(input, {
      suspicions: [
        {
          category: 'bug',
          severity: 'high',
          title: 'Unsynchronized map access can race with writers',
          description:
            'The cache is checked and populated around work without holding the cache lock.',
          path: 'src/cache.ts',
          startLine: 17,
          fixSummary: 'Protect the cache read/build/write path with locking.'
        }
      ]
    })

    expect(result.candidates).toEqual([])
    expect(result.droppedSuspicionReasons['duplicate-input-candidate']).toBe(1)
  })
})
