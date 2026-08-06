import { describe, expect, test } from 'vitest'
import { findPromptGenericityViolations } from '../../shared/testing/prompt-genericity-guard.js'
import { ToolCallBudgetExceededError } from './bounded-tools.js'
import { disclosedRetrievalCondition, withDisclosedRetrievalCondition } from './condition-disclosure.js'
import {
  contextRetrievalConditions,
  pathNotEligibleCondition,
  pathNotFoundCondition,
  queryBlankCondition,
  readBudgetExhaustedCondition,
  searchBudgetExhaustedCondition,
  type ContextRetrievalCondition
} from './expected-conditions.js'

const conditionErrors: Record<ContextRetrievalCondition, Error> = {
  'path-not-eligible': pathNotEligibleCondition(
    'secrets/token.txt',
    'path matches a configured paths.exclude pattern'
  ),
  'path-not-found': pathNotFoundCondition('src/missing.ts'),
  'read-budget-exhausted': readBudgetExhaustedCondition(),
  'search-budget-exhausted': searchBudgetExhaustedCondition(),
  'query-blank': queryBlankCondition()
}

// The words a model must be able to find in the content to know WHICH refusal it
// hit. Naming the reason is the whole point: "Tool execution failed." is what the
// harness would otherwise hand it, and from that it cannot tell a spent budget
// apart from a file that is not there.
const reasonMarkers: Record<ContextRetrievalCondition, string> = {
  'path-not-eligible': 'PATH NOT ELIGIBLE',
  'path-not-found': 'PATH NOT FOUND',
  'read-budget-exhausted': 'READ BUDGET EXHAUSTED',
  'search-budget-exhausted': 'SEARCH BUDGET EXHAUSTED',
  'query-blank': 'EMPTY SEARCH QUERY'
}

const disclose = (error: unknown) =>
  disclosedRetrievalCondition({ toolId: 'repo_read', error })

describe('expected-condition disclosure', () => {
  test('names the specific reason for every expected condition', () => {
    for (const condition of contextRetrievalConditions) {
      const output = disclose(conditionErrors[condition])

      expect(output, `no disclosure for ${condition}`).toBeDefined()
      expect(output?.content).toContain(reasonMarkers[condition])
      // The tool that was refused is named too, so a model running several
      // lookups knows which one produced no content.
      expect(output?.content).toContain('repo_read')
      expect(output?.summary).toContain('repo_read was refused')
    }
  })

  test('the two path conditions name the path that was refused', () => {
    expect(disclose(conditionErrors['path-not-eligible'])?.content).toContain(
      'secrets/token.txt'
    )
    expect(disclose(conditionErrors['path-not-found'])?.content).toContain(
      'src/missing.ts'
    )
  })

  test('every disclosure says the refusal is not evidence about the code', () => {
    // The defect this whole surface exists to prevent: a lookup that did not
    // happen read as an observation that the code is fine.
    for (const error of [
      ...Object.values(conditionErrors),
      new ToolCallBudgetExceededError(4)
    ]) {
      const output = disclose(error)

      expect(output?.content).toContain('did NOT run and returned no repository content')
      expect(output?.content).toContain(
        'not evidence that anything is absent, correct, or safe'
      )
    }
  })

  test('the scope tool-call bound keeps its shape and joins the same vocabulary', () => {
    const output = disclosedRetrievalCondition({
      toolId: 'repo_list',
      error: new ToolCallBudgetExceededError(4)
    })

    expect(output?.content).toContain('TOOL-CALL BUDGET EXHAUSTED')
    expect(output?.summary).toBe(
      "repo_list was refused: this call's repository tool-call budget is exhausted."
    )
  })

  test('a fault is never disclosed, so it stays a fault', () => {
    // Path containment above all: an escape from the repository root is a
    // security invariant breach, and softening it into a tool result the model
    // shrugs off would be worse than the unexplained failure it replaces.
    const faults = [
      new TypeError('Path target must resolve inside the root.'),
      new TypeError('Path value must resolve inside the root.'),
      new TypeError('No active mediated repository tools are registered for this call.'),
      new Error('EACCES: permission denied'),
      'not even an error'
    ]

    for (const fault of faults) {
      expect(disclose(fault)).toBeUndefined()
    }
  })

  test('the wrapper returns successes untouched and rethrows faults', async () => {
    const success = { summary: 's', content: 'c' }

    expect(
      await withDisclosedRetrievalCondition('repo_read', async () => success)
    ).toBe(success)

    await expect(
      withDisclosedRetrievalCondition('repo_read', async () => {
        throw new TypeError('Path target must resolve inside the root.')
      })
    ).rejects.toThrow(/resolve inside the root/u)

    expect(
      (
        await withDisclosedRetrievalCondition('repo_read', async () => {
          throw pathNotFoundCondition('src/missing.ts')
        })
      ).content
    ).toContain('PATH NOT FOUND')
  })

  // The disclosures are model-facing text, so spec 15's genericity bar applies to
  // them exactly as it applies to an instruction segment.
  test('the disclosed text stays generic and language-neutral', () => {
    for (const error of [
      ...Object.values(conditionErrors),
      new ToolCallBudgetExceededError(4)
    ]) {
      const output = disclose(error)

      expect(
        findPromptGenericityViolations({
          promptName: 'retrieval condition disclosure',
          prompt: `${output?.summary ?? ''}\n${output?.content ?? ''}`
        })
      ).toEqual([])
    }
  })
})
