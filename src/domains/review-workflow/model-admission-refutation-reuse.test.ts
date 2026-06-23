import { describe, expect, test } from 'vitest'
import {
  proofLoopRefutationFor,
  proofPacketForCandidate,
  refutationResultFromProofLoop
} from './model-admission-refutation-reuse.js'

describe('model admission refutation reuse', () => {
  test('exports proof-loop refutation reuse helpers', () => {
    expect(typeof proofPacketForCandidate).toBe('function')
    expect(typeof proofLoopRefutationFor).toBe('function')
    expect(typeof refutationResultFromProofLoop).toBe('function')
  })
})
