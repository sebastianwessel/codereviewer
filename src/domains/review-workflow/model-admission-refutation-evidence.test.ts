import { describe, expect, test } from 'vitest'
import {
  createRefutationEvidence,
  enrichProvedCandidate,
  provedFixEditsFor,
  refutationEvidenceIdFor
} from './model-admission-refutation-evidence.js'

describe('model admission refutation evidence', () => {
  test('exports refutation evidence and candidate enrichment helpers', () => {
    expect(typeof refutationEvidenceIdFor).toBe('function')
    expect(typeof createRefutationEvidence).toBe('function')
    expect(typeof provedFixEditsFor).toBe('function')
    expect(typeof enrichProvedCandidate).toBe('function')
  })
})
