import { describe, expect, test } from 'vitest'
import {
  effectiveMaxConcurrentTasks,
  harnessDefaults,
  maxChildAgentCallsForReview,
  modelReviewWorkflowDelegation,
  reviewAgentOptionsForRole,
  reviewSkillAgentOptions,
  reviewWorkflowDelegation
} from './workflow-harness-config.js'

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
    expect(reviewWorkflowDelegation(2)).toEqual({
      agents: ['review_task'],
      modelAliases: ['reviewer'],
      maxChildAgentCalls: 16,
      maxParallelChildAgentCalls: 2
    })
    expect(modelReviewWorkflowDelegation(2)).toEqual({
      agents: [
        'plan_review_intents',
        'review_task',
        'investigate_suspicion',
        'aggregate_findings',
        'sweep_sibling_suspicions',
        'refute_finding',
        'judge_finding'
      ],
      modelAliases: ['reviewer'],
      maxChildAgentCalls: 16,
      maxParallelChildAgentCalls: 2
    })
    expect(modelReviewWorkflowDelegation(2, 97).maxChildAgentCalls).toBe(97)
  })

  test('derives bounded child-agent call budgets from review scale', () => {
    expect(
      maxChildAgentCallsForReview({
        taskCount: 8,
        maxConcurrentTasks: 2,
        maxInvestigationsPerRun: 12,
        maxInvestigationRounds: 3,
        judgeFindings: true,
        intentPlanning: 'model'
      })
    ).toBe(82)

    expect(
      maxChildAgentCallsForReview({
        taskCount: 5000,
        maxConcurrentTasks: 32,
        maxInvestigationsPerRun: 200,
        maxInvestigationRounds: 5,
        judgeFindings: true,
        intentPlanning: 'model'
      })
    ).toBe(2048)
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

  test('keeps planning compact while allowing bounded context-heavy critic roles to use skill tools', () => {
    expect(
      reviewAgentOptionsForRole({
        role: 'plan_review_intents',
        skillIds: ['secure-review']
      })
    ).toEqual({
      builtinTools: false,
      maxSteps: 1
    })

    expect(
      reviewAgentOptionsForRole({
        role: 'investigate_suspicion',
        skillIds: ['secure-review']
      })
    ).toEqual({
      builtinTools: ['read', 'list', 'grep'],
      skills: ['secure-review'],
      maxSteps: 4
    })

    expect(
      reviewAgentOptionsForRole({
        role: 'judge_finding',
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
