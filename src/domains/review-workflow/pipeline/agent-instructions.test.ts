import { describe, expect, test } from 'vitest'
import {
  modelFindingRefuterInstructions,
  modelHolisticReviewerInstructions
} from './agent-instructions.js'

describe('model agent instructions', () => {
  test('holistic reviewer drives a recall-first whole-change review method', () => {
    expect(modelHolisticReviewerInstructions).toContain(
      'STEP 1 - Understand the intent.'
    )
    expect(modelHolisticReviewerInstructions).toContain(
      'STEP 3 - Verify correctness against the intent, technically AND logically.'
    )
    expect(modelHolisticReviewerInstructions).toContain(
      'Precision: report ONLY real defects.'
    )
  })

  test('refuter judges every batched candidate from provided context only', () => {
    expect(modelFindingRefuterInstructions).toContain(
      'Adjudicate EVERY candidate in that list, and report nothing else.'
    )
    // Batching shares one context across candidates, so the prompt must forbid the
    // model from letting neighbouring candidates colour a verdict.
    expect(modelFindingRefuterInstructions).toContain(
      'Judge each candidate strictly on its own merits'
    )
    // The candidateId is the only thing binding a verdict back to its candidate.
    expect(modelFindingRefuterInstructions).toContain(
      'EXACTLY ONE entry per candidate you were given'
    )
    expect(modelFindingRefuterInstructions).toContain(
      'never invent a candidateId that was not in the input'
    )
    expect(modelFindingRefuterInstructions).toContain(
      'Return verdict "proved" only when the provided context proves the finding and its impact.'
    )
    expect(modelFindingRefuterInstructions).toContain(
      'Return verdict "refuted" when the candidate is contradicted by the provided context.'
    )
  })
})
