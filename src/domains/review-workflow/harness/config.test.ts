import { describe, expect, test } from 'vitest'
import {
  effectiveMaxConcurrentTasks,
  harnessDefaults,
  maxChildAgentCallsForReview,
  modelReviewWorkflowDelegation,
  reviewAgentOptionsForRole,
  reviewSkillAgentOptions
} from './config.js'

describe('workflow harness config', () => {
  test('derives runtime defaults and delegation limits for review workflows', () => {
    expect(effectiveMaxConcurrentTasks(undefined)).toBe(4)
    expect(effectiveMaxConcurrentTasks(2)).toBe(2)
    expect(harnessDefaults({}, 3)).toEqual({
      runTimeoutMs: 0,
      delegation: {
        maxParallelChildAgentCalls: 3
      }
    })
    expect(harnessDefaults({ runTimeoutMs: 1200 }, 3)).toEqual({
      runTimeoutMs: 1200,
      delegation: {
        maxParallelChildAgentCalls: 3
      }
    })
    expect(modelReviewWorkflowDelegation(2)).toEqual({
      // The scout (spec 18) and the semantic finding merge (spec 05) are each
      // delegated to as their own agent: selecting context, finding defects,
      // deciding whether two findings are one, and judging whether a finding is
      // true all stay in separate calls.
      agents: [
        'holistic_review',
        'context_scout',
        'semantic_merge',
        'refute_finding'
      ],
      modelAliases: ['reviewer'],
      maxChildAgentCalls: 16,
      maxParallelChildAgentCalls: 2
    })
    expect(modelReviewWorkflowDelegation(2, 97).maxChildAgentCalls).toBe(97)
  })

  test('derives bounded child-agent call budgets from review scale', () => {
    // taskCount holistic calls + taskCount * 4 (ONE batched refutation call per task
    // plus a small allowance for budget-driven batch splits) + taskCount * 6 for the
    // semantic finding merge (its ceiling: one call per file carrying at least two
    // of a task's at most 12 candidates) + maxConcurrentTasks * 2:
    // 8 + 8*4 + 8*6 + 2*2 = 92.
    expect(
      maxChildAgentCallsForReview({
        taskCount: 8,
        maxConcurrentTasks: 2
      })
    ).toBe(92)

    // Above the cap → clamped to the maximum child-agent call budget.
    expect(
      maxChildAgentCallsForReview({
        taskCount: 5000,
        maxConcurrentTasks: 32
      })
    ).toBe(2048)
  })

  test('attaches repository tools to discovery only when cross-file retrieval is enabled', () => {
    const disabled = reviewAgentOptionsForRole({
      role: 'holistic_review',
      skillIds: [],
      crossFileRetrieval: {
        enabled: false,
        maxToolCallsPerTask: 4,
        maxBytesPerRead: 24000
      }
    })
    // Disabled: single-shot discovery with no tools, byte-for-byte as before.
    expect(disabled).toEqual({ builtinTools: false, maxSteps: 1 })

    const enabled = reviewAgentOptionsForRole({
      role: 'holistic_review',
      skillIds: [],
      crossFileRetrieval: {
        enabled: true,
        maxToolCallsPerTask: 4,
        maxBytesPerRead: 24000
      }
    })
    // Enabled: the mediated repo tools plus enough steps to spend the budget,
    // recover from a budget-exceeded tool result, and still emit findings.
    expect(enabled).toEqual({
      builtinTools: false,
      maxSteps: 7,
      tools: ['repo_read', 'repo_list', 'repo_grep']
    })

    // A loop-guard-sized budget simply yields a loop-guard-sized step allowance;
    // the model self-limits well below it.
    expect(
      reviewAgentOptionsForRole({
        role: 'holistic_review',
        skillIds: [],
        crossFileRetrieval: {
        enabled: true,
        maxToolCallsPerTask: 100,
        maxBytesPerRead: 24000
      }
      })
    ).toEqual({
      builtinTools: false,
      maxSteps: 103,
      tools: ['repo_read', 'repo_list', 'repo_grep']
    })

    // Other roles never receive the discovery tools.
    expect(
      reviewAgentOptionsForRole({
        role: 'refute_finding',
        skillIds: [],
        crossFileRetrieval: {
        enabled: true,
        maxToolCallsPerTask: 4,
        maxBytesPerRead: 24000
      }
      })
    ).toEqual({ builtinTools: false, maxSteps: 1 })
  })

  test('reserves one extra call per task for the context scout', () => {
    // Scout enabled: 8 tasks * (1 discovery + 1 scout) + 8*4 refutation + 8*6
    // merge ceiling + 2*2 buffer = 16 + 32 + 48 + 4 = 100.
    expect(
      maxChildAgentCallsForReview({
        taskCount: 8,
        maxConcurrentTasks: 2,
        contextScoutEnabled: true
      })
    ).toBe(100)
  })

  test('grows the budget for the dedicated security pass second discovery call', () => {
    // With the security pass enabled each task issues 2 discovery calls. Refutation
    // stays at one batched call per task (plus the split allowance) no matter how
    // many candidates the two passes raise, while the merge ceiling rises with the
    // extra candidates the pass may add (12 + 8 candidates -> at most 10 files with
    // two of them): 8*2 + 8*4 + 8*10 + 2*2 = 16 + 32 + 80 + 4 = 132.
    expect(
      maxChildAgentCallsForReview({
        taskCount: 8,
        maxConcurrentTasks: 2,
        securityPassEnabled: true
      })
    ).toBe(132)
  })

  test('reserves one discovery call per independent sample', () => {
    // Spec 21: three samples per task means three general discovery calls, and the
    // general candidate cap applies per sample, so the merge ceiling rises with it:
    // 8*3 discovery + 8*4 refutation + 8*18 merge + 2*2 buffer
    // = 24 + 32 + 144 + 4 = 204. Under-reserving is fatal — the workflow refuses
    // the call — so this number is derived from the caps rather than guessed.
    expect(
      maxChildAgentCallsForReview({
        taskCount: 8,
        maxConcurrentTasks: 2,
        discoverySampleCount: 3
      })
    ).toBe(204)

    // One sample is the default and reserves exactly what it does today.
    expect(
      maxChildAgentCallsForReview({
        taskCount: 8,
        maxConcurrentTasks: 2,
        discoverySampleCount: 1
      })
    ).toBe(maxChildAgentCallsForReview({ taskCount: 8, maxConcurrentTasks: 2 }))
  })

  test('enables only read/list/grep builtins for skill-backed review agents', () => {
    expect(
      reviewSkillAgentOptions({
        skillIds: []
      })
    ).toEqual({
      builtinTools: false,
      maxSteps: 1
    })
    expect(
      reviewSkillAgentOptions({
        skillIds: ['secure-review']
      })
    ).toEqual({
      builtinTools: ['read', 'list', 'grep'],
      skills: ['secure-review'],
      maxSteps: 4
    })
    expect(
      reviewSkillAgentOptions({
        skillIds: ['secure-review'],
        skillTools: ['read']
      })
    ).toEqual({
      builtinTools: ['read'],
      skills: ['secure-review'],
      maxSteps: 4
    })
  })

  test('keeps review roles compact without skills and skill-tool capable with them', () => {
    expect(
      reviewAgentOptionsForRole({
        role: 'holistic_review',
        skillIds: []
      })
    ).toEqual({
      builtinTools: false,
      maxSteps: 1
    })

    expect(
      reviewAgentOptionsForRole({
        role: 'refute_finding',
        skillIds: ['secure-review']
      })
    ).toEqual({
      builtinTools: ['read', 'list', 'grep'],
      skills: ['secure-review'],
      maxSteps: 4
    })

    expect(
      reviewAgentOptionsForRole({
        role: 'propose_candidates',
        skillIds: ['secure-review'],
        skillTools: ['read']
      })
    ).toEqual({
      builtinTools: ['read'],
      skills: ['secure-review'],
      maxSteps: 4
    })
  })
})
