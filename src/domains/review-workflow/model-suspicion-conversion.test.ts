import { describe, expect, test } from 'vitest'
import { candidatesFromModelSuspicions } from './model-suspicion-conversion.js'
import { TaskReviewInputSchema } from './model-agent-contracts.js'

describe('model suspicion conversion', () => {
  const trustedCandidateInput = () =>
    TaskReviewInputSchema.parse({
      runId: 'run-conversion',
      task: {
        id: 'task_conversion',
        kind: 'dependency-cluster',
        round: 1,
        paths: ['pkg/storage/unified/search/bleve.go'],
        factIds: [],
        evidenceIds: ['evidence_cachelock'],
        candidateIds: ['cand_trustedcache'],
        contextEntryIds: [],
        priority: 1
      },
      reviewIntents: [],
      reviewedDiffRanges: [
        {
          path: 'pkg/storage/unified/search/bleve.go',
          startLine: 1,
          endLine: 40
        }
      ],
      evidence: [
        {
          id: 'evidence_cachelock',
          kind: 'rule',
          summary:
            'BuildIndex performs expensive index construction before taking the cache lock.',
          location: {
            path: 'pkg/storage/unified/search/bleve.go',
            startLine: 24,
            side: 'file'
          },
          source: 'go-support-signal',
          ruleId: 'go-build-index-cache-lock-after-build',
          redactionApplied: true
        }
      ],
      candidates: [
        {
          id: 'cand_trustedcache',
          taskId: 'task_conversion',
          category: 'performance',
          severity: 'high',
          title: 'Cache index build happens outside the cache lock',
          description:
            'BuildIndex performs expensive index construction before taking the cache lock.',
          location: {
            path: 'pkg/storage/unified/search/bleve.go',
            startLine: 24,
            side: 'new'
          },
          evidenceIds: ['evidence_cachelock'],
          proposedBy: 'deterministic-trusted-rule',
          fixProposal: {
            summary: 'Move the expensive cache build under the cache lock.',
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
          title: 'BuildIndex reads and populates cache non-atomically',
          description:
            'The model reports the same cache-lock issue at the function start.',
          path: 'pkg/storage/unified/search/bleve.go',
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
          title: 'Unsynchronized map access in BuildIndex can race with writers',
          description:
            'BuildIndex checks and populates the shared cache around expensive index construction without holding the cache lock.',
          path: 'pkg/storage/unified/search/bleve.go',
          startLine: 17,
          fixSummary: 'Protect the cache read/build/write path with locking.'
        }
      ]
    })

    expect(result.candidates).toEqual([])
    expect(result.droppedSuspicionReasons['duplicate-input-candidate']).toBe(1)
  })
})
