import { describe, expect, test } from 'vitest'
import { modelReviewerInstructions } from './model-agent-instructions.js'

describe('model agent instructions', () => {
  test('suppresses nits while staying broad on substantive defects', () => {
    expect(modelReviewerInstructions).toContain(
      'Focus suspicions on concrete semantic correctness, security, reliability, data-integrity, or maintainability defects visible in the provided packet.'
    )
    expect(modelReviewerInstructions).toContain(
      'Still suppress pure style, preference, naming, formatting, helper-refactor, or cleanup-only concerns unless the packet shows a concrete user-visible, runtime, security, or data-integrity impact; breadth applies to substantive correctness, security, reliability, and data-integrity defects, not to nits.'
    )
    expect(modelReviewerInstructions).toContain(
      'Do not fabricate callers, configuration, tests, file content, dependencies, or runtime behavior that is not present in the packet; when such context is needed to decide a suspicion, raise the suspicion with a contextRequest for it rather than asserting or assuming it.'
    )
  })

  test('frames discovery as broad recall-first hypothesis generation', () => {
    expect(modelReviewerInstructions).toContain(
      'For each reviewIntents verificationQuestions entry that applies to task.paths, inspect the provided packet for evidence that proves, contradicts, or leaves the risk undecidable.'
    )
    expect(modelReviewerInstructions).toContain(
      'This is the broad discovery stage: a separate investigation, refutation, and judge stage verifies or discards every suspicion before anything is reported, so prefer recall here.'
    )
  })

  test('requires a methodical defect-taxonomy sweep per changed symbol', () => {
    expect(modelReviewerInstructions).toContain(
      'Methodically sweep this language-agnostic defect taxonomy for every changed and newly reached symbol, and raise a suspicion for each category that plausibly applies'
    )
    expect(modelReviewerInstructions).toContain(
      'interface, abstract-method, and caller/callee contract drift'
    )
  })
})
