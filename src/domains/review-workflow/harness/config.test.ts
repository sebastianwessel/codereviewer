import { describe, expect, test } from 'vitest'
import { MAX_REACTIVE_SPLIT_DEPTH } from '../pipeline/discovery/reactive-split.js'
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
    // Spec 05: `historyWindow: 0` is a DEFAULT, so blindness is what an agent gets
    // unless its invocation asks for history. The provider-boundary assertion that
    // this actually reaches every stage lives in model-backed-harness.test.ts; this
    // only pins that the default is set and survives the other options.
    // `runTimeoutMs: 0` is "no run deadline", and it is no longer configurable: a
    // whole-run timeout is a self-imposed limit that destroys progressing work.
    // Hanging calls are bounded by `provider.timeoutMs` instead.
    expect(harnessDefaults(3)).toEqual({
      runTimeoutMs: 0,
      historyWindow: 0,
      delegation: {
        maxParallelChildAgentCalls: 3
      }
    })
    expect(modelReviewWorkflowDelegation(2)).toEqual({
      // The semantic finding merge (spec 05) is delegated to as its own agent:
      // finding defects, deciding whether two findings are one, and judging
      // whether a finding is true all stay in separate calls.
      agents: ['holistic_review', 'semantic_merge', 'refute_finding'],
      modelAliases: ['reviewer'],
      maxChildAgentCalls: 16,
      maxParallelChildAgentCalls: 2
    })
    expect(modelReviewWorkflowDelegation(2, 97).maxChildAgentCalls).toBe(97)
  })

  test('derives bounded child-agent call budgets from review scale', () => {
    // taskCount holistic calls, each of which a reactive split (spec 26) can turn
    // into 127, + taskCount * 4 (ONE batched refutation call per task plus a small
    // allowance for budget-driven batch splits) + taskCount * 6 for the semantic
    // finding merge (its ceiling: one call per file carrying at least two of a
    // task's at most 12 candidates) + maxConcurrentTasks * 2:
    // 8*127 + 8*4 + 8*6 + 2*2 = 1016 + 32 + 48 + 4 = 1100.
    expect(
      maxChildAgentCallsForReview({
        taskCount: 8,
        maxConcurrentTasks: 2
      })
    ).toBe(1100)

    // Above the cap → clamped to the maximum child-agent call budget.
    expect(
      maxChildAgentCallsForReview({
        taskCount: 5000,
        maxConcurrentTasks: 32
      })
    ).toBe(32_768)
  })

  // A reactive split does not RETRY a discovery call, it spends one and issues two
  // more: the harness charges the budget before dispatch, so the refused call is
  // already paid for, and each half can be refused in turn down to
  // MAX_REACTIVE_SPLIT_DEPTH. The worst case for one discovery call is therefore a
  // full binary tree of that depth — 2^(depth+1) - 1 calls — and it is the shape
  // that arises exactly when a model's context is small enough to refuse every
  // half, which is when the run most needs its own loud, attributable failure
  // rather than a generic "call budget exceeded".
  //
  // Derived from the depth constant here, not restated: a change to the split
  // guard that left this budget behind is precisely the drift that under-reserves.
  test('reserves the calls a reactive split can multiply one discovery call into', () => {
    const splitCallsPerDiscoveryCall = 2 ** (MAX_REACTIVE_SPLIT_DEPTH + 1) - 1

    // One task, one partition, no security pass: the split factor + 4 refutation +
    // 6 merge + 1*2 concurrency buffer.
    expect(
      maxChildAgentCallsForReview({ taskCount: 1, maxConcurrentTasks: 1 })
    ).toBe(splitCallsPerDiscoveryCall + 4 + 6 + 2)
  })

  // The cap is a runaway guard on an absurd taskCount, and it must not quietly
  // become the under-reservation it exists alongside: a review of 100 tasks — 800
  // files at the planner's 8 paths per task — still gets its whole derived worst
  // case, security pass included.
  test('keeps a large review inside the cap rather than clamping it', () => {
    expect(
      maxChildAgentCallsForReview({
        taskCount: 100,
        maxConcurrentTasks: 8,
        securityPassEnabled: true
      })
      // 100 * (2*127 + 4 + 10) + 8*2 = 26800 + 16, unclamped.
    ).toBe(26_816)
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

    // The DISCOVERY switch never reaches another role: enabling cross-file
    // retrieval must not hand the refuter tools it was not configured for.
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

  // Refutation is tool-free, whatever discovery is configured for. The capability
  // that gave the refuter the mediated tools (`review.refutationRetrieval`) was
  // measured and removed on 2026-08-06; there is no switch that can hand this role
  // a repository tool.
  test('never attaches repository tools to refutation', () => {
    for (const crossFileRetrieval of [
      undefined,
      { enabled: false, maxToolCallsPerTask: 4, maxBytesPerRead: 24000 },
      { enabled: true, maxToolCallsPerTask: 4, maxBytesPerRead: 24000 }
    ]) {
      expect(
        reviewAgentOptionsForRole({
          role: 'refute_finding',
          skillIds: [],
          ...(crossFileRetrieval === undefined ? {} : { crossFileRetrieval })
        })
      ).toEqual({ builtinTools: false, maxSteps: 1 })
    }
  })

  test('grows the budget for the dedicated security pass second discovery call', () => {
    // With the security pass enabled each task issues 2 discovery calls. Refutation
    // stays at one batched call per task (plus the split allowance) no matter how
    // many candidates the two passes raise, while the merge ceiling rises with the
    // extra candidates the pass may add (12 + 8 candidates -> at most 10 files with
    // two of them). Both discovery calls carry the reactive-split factor:
    // 8*2*127 + 8*4 + 8*10 + 2*2 = 2032 + 32 + 80 + 4 = 2148.
    expect(
      maxChildAgentCallsForReview({
        taskCount: 8,
        maxConcurrentTasks: 2,
        securityPassEnabled: true
      })
    ).toBe(2148)
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

    // Configured skill tools reach the agent options through the role builder.
    expect(
      reviewAgentOptionsForRole({
        role: 'holistic_review',
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
