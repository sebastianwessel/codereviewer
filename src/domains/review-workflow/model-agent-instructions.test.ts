import { describe, expect, test } from 'vitest'
import { modelReviewerInstructions } from './model-agent-instructions.js'

describe('model agent instructions', () => {
  test('constrains task review to concrete packet-backed semantic defects', () => {
    expect(modelReviewerInstructions).toContain(
      'Focus suspicions on concrete semantic correctness, security, reliability, data-integrity, or maintainability defects visible in the provided packet.'
    )
    expect(modelReviewerInstructions).toContain(
      'Return no suspicion for style, preference, naming, formatting, helper-refactor, or cleanup-only concerns unless the provided packet proves a concrete user-visible, runtime, security, or data-integrity impact.'
    )
    expect(modelReviewerInstructions).toContain(
      'Do not guess about callers, configuration, tests, file content, dependencies, or runtime behavior that is not present in the packet.'
    )
  })

  test('requires intent-question driven discovery', () => {
    expect(modelReviewerInstructions).toContain(
      'For each reviewIntents verificationQuestions entry that applies to task.paths, inspect the provided packet for evidence that proves, contradicts, or leaves the risk undecidable.'
    )
    expect(modelReviewerInstructions).toContain(
      'Return a suspicion for each concrete packet-backed defect discovered while answering the verification questions; when a question is undecidable, request the smallest follow-up context instead of guessing.'
    )
  })

  test('keeps benchmark-derived semantic discovery checks in the task prompt', () => {
    expect(modelReviewerInstructions).toContain(
      'Use a semantic bug checklist before returning no suspicions: falsy zero handling, wrong variable or copy/paste source reuse, nullable or optional access without guards, non-deterministic hash/order assumptions, numeric operations on datetime or non-numeric keys, and unsynchronized shared mutable state.'
    )
    expect(modelReviewerInstructions).toContain(
      'Check branch-asymmetric business-rule calculations where one branch omits a field or adjustment used by a sibling branch.'
    )
  })
})
