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
      agents: ['holistic_review', 'refute_finding'],
      modelAliases: ['reviewer'],
      maxChildAgentCalls: 16,
      maxParallelChildAgentCalls: 2
    })
    expect(modelReviewWorkflowDelegation(2, 97).maxChildAgentCalls).toBe(97)
  })

  test('derives bounded child-agent call budgets from review scale', () => {
    // taskCount holistic calls + taskCount * 12 (one refutation per emitted
    // candidate, up to HOLISTIC_MAX_CANDIDATES) + maxConcurrentTasks * 2:
    // 8 + 8*12 + 2*2 = 108.
    expect(
      maxChildAgentCallsForReview({
        taskCount: 8,
        maxConcurrentTasks: 2
      })
    ).toBe(108)

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
      crossFileRetrieval: { enabled: false, maxToolCallsPerTask: 4 }
    })
    // Disabled: single-shot discovery with no tools, byte-for-byte as before.
    expect(disabled).toEqual({ builtinTools: false, maxSteps: 1 })

    const enabled = reviewAgentOptionsForRole({
      role: 'holistic_review',
      skillIds: [],
      crossFileRetrieval: { enabled: true, maxToolCallsPerTask: 4 }
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
        crossFileRetrieval: { enabled: true, maxToolCallsPerTask: 100 }
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
        crossFileRetrieval: { enabled: true, maxToolCallsPerTask: 4 }
      })
    ).toEqual({ builtinTools: false, maxSteps: 1 })
  })

  test('grows the budget for the dedicated security pass second call and candidates', () => {
    // With the security pass enabled each task issues 2 discovery calls and can
    // emit up to HOLISTIC_MAX_CANDIDATES + SECURITY_MAX_CANDIDATES (12 + 8 = 20)
    // candidates: 8*2 + 8*20 + 2*2 = 16 + 160 + 4 = 180.
    expect(
      maxChildAgentCallsForReview({
        taskCount: 8,
        maxConcurrentTasks: 2,
        securityPassEnabled: true
      })
    ).toBe(180)
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
