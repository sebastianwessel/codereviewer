import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  ClaimSchema,
  type Claim
} from '../../shared/contracts/verification/verification.schema.js'
import type { ClaimProvider } from './contracts.js'
import { isClaimToolCallBudgetExceededError } from './claim-tools.js'
import {
  runVerificationFlow,
  type ClaimAgentRunner
} from './verification-flow.js'

const makeClaim = (overrides: Partial<Claim> = {}): Claim =>
  ClaimSchema.parse({
    id: 'claim_a1b2c3',
    kind: 'fix',
    title: 'Sample claim',
    detail: 'A sample assertion about the fixture repository.',
    source: 'test',
    question: 'Does the fixture still contain the marker?',
    ...overrides
  })

const staticProvider = (claims: readonly Claim[], id = 'static'): ClaimProvider => ({
  id,
  gather: async () => claims
})

const failingProvider = (id = 'failing'): ClaimProvider => ({
  id,
  gather: async () => {
    throw new Error('provider blew up')
  }
})

const baseFlowInput = (repositoryRoot: string) => ({
  repositoryRoot,
  maxToolCallsPerClaim: 5,
  maxBytesPerRead: 20_000,
  maxMatches: 20
})

describe('runVerificationFlow', () => {
  let repositoryRoot: string

  beforeEach(async () => {
    repositoryRoot = await mkdtemp(path.join(tmpdir(), 'verify-flow-'))
    await writeFile(
      path.join(repositoryRoot, 'app.ts'),
      'export const marker = 1\nexport const other = 2\n',
      'utf8'
    )
    await writeFile(
      path.join(repositoryRoot, 'big.ts'),
      `${'x'.repeat(100_000)}\n`,
      'utf8'
    )
    await writeFile(path.join(repositoryRoot, '.env'), 'SECRET=shhh\n', 'utf8')
  })

  afterEach(async () => {
    await rm(repositoryRoot, { recursive: true, force: true })
  })

  test('assembles a confirmed verdict bound to its own claim', async () => {
    const claim = makeClaim({
      evidenceRefs: [
        {
          key: 'fingerprint:v2-category-path-title-anchor',
          value: 'deadbeefcafe'
        }
      ]
    })
    const verify: ClaimAgentRunner = async ({ tools }) => {
      const read = await tools.read({ path: 'app.ts' })

      return {
        verdict: {
          status: 'confirmed',
          rationale: 'app.ts line 1 defines marker.',
          citedEvidenceIds: [read.evidence.id]
        }
      }
    }

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [staticProvider([claim])],
      verifyClaim: verify
    })

    expect(report.claimCount).toBe(1)
    expect(report.verdicts).toHaveLength(1)
    const [verdict] = report.verdicts
    expect(verdict?.status).toBe('confirmed')
    expect(verdict?.claimId).toBe(claim.id)
    // The verdict reuses the claim's carried finding fingerprint so it lines up
    // with the general-review finding it came from.
    expect(verdict?.fingerprints).toContainEqual({
      algorithm: 'v2-category-path-title-anchor',
      value: 'deadbeefcafe'
    })
    expect(verdict?.citedEvidenceIds.length).toBeGreaterThan(0)
    const [observation] = report.observations
    expect(observation?.toolCalls).toBe(1)
    expect(observation?.bytesRead).toBeGreaterThan(0)
    expect(observation?.boundReason).toBeUndefined()
  })

  test('synthesizes a fingerprint when the claim carries none', async () => {
    const claim = makeClaim()
    const verify: ClaimAgentRunner = async () => ({
      verdict: { status: 'refuted', rationale: 'not present', citedEvidenceIds: [] }
    })

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [staticProvider([claim])],
      verifyClaim: verify
    })

    expect(report.verdicts[0]?.status).toBe('refuted')
    expect(report.verdicts[0]?.fingerprints).toHaveLength(1)
    expect(report.verdicts[0]?.fingerprints[0]?.algorithm).toBe('v1-claim-id')
  })

  test('ends uncertain when the tool-call budget is exceeded (error propagated)', async () => {
    let budgetErrors = 0
    const verify: ClaimAgentRunner = async ({ tools }) => {
      // Three reads against a budget of two: the third throws and the fake lets
      // it propagate, as a model that never concludes would.
      await tools.read({ path: 'app.ts' })
      await tools.read({ path: 'app.ts' })
      try {
        await tools.read({ path: 'app.ts' })
      } catch (error) {
        if (isClaimToolCallBudgetExceededError(error)) {
          budgetErrors += 1
        }
        throw error
      }

      return {
        verdict: { status: 'confirmed', rationale: 'x', citedEvidenceIds: [] }
      }
    }

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      maxToolCallsPerClaim: 2,
      providers: [staticProvider([makeClaim()])],
      verifyClaim: verify
    })

    expect(budgetErrors).toBe(1)
    expect(report.verdicts[0]?.status).toBe('uncertain')
    expect(report.observations[0]?.boundReason).toBe('tool-call-budget-exceeded')
    expect(report.observations[0]?.toolCalls).toBe(2)
  })

  test('code overrides a conclusive verdict to uncertain once the budget is exhausted', async () => {
    const verify: ClaimAgentRunner = async ({ tools }) => {
      await tools.read({ path: 'app.ts' })
      try {
        // Over budget: the model receives the recoverable error but still tries
        // to conclude "confirmed". CODE must override that to uncertain.
        await tools.read({ path: 'app.ts' })
      } catch {
        // swallow, as a model would after seeing the tool error message
      }

      return {
        verdict: {
          status: 'confirmed',
          rationale: 'concluded anyway',
          citedEvidenceIds: []
        }
      }
    }

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      maxToolCallsPerClaim: 1,
      providers: [staticProvider([makeClaim()])],
      verifyClaim: verify
    })

    expect(report.verdicts[0]?.status).toBe('uncertain')
    expect(report.observations[0]?.boundReason).toBe('tool-call-budget-exceeded')
  })

  test('code caps bytes read per tool call regardless of the model', async () => {
    let observedContentBytes = -1
    const verify: ClaimAgentRunner = async ({ tools }) => {
      const read = await tools.read({ path: 'big.ts' })
      observedContentBytes = Buffer.byteLength(read.content)

      return {
        verdict: { status: 'refuted', rationale: 'too big', citedEvidenceIds: [] }
      }
    }

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      maxBytesPerRead: 100,
      providers: [staticProvider([makeClaim()])],
      verifyClaim: verify
    })

    expect(observedContentBytes).toBeLessThanOrEqual(100)
    expect(report.observations[0]?.bytesRead).toBeLessThanOrEqual(100)
  })

  test('a claim provider failure is non-fatal and surfaces as a warning', async () => {
    const verify: ClaimAgentRunner = async () => ({
      verdict: { status: 'confirmed', rationale: 'ok', citedEvidenceIds: [] }
    })

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [failingProvider('bad'), staticProvider([makeClaim()], 'good')],
      verifyClaim: verify
    })

    expect(report.warnings).toContain('claim-provider-failed:bad')
    expect(report.verdicts).toHaveLength(1)
    expect(report.claimCount).toBe(1)
  })

  test('no providers yields an empty report and never runs the agent', async () => {
    let called = false
    const verify: ClaimAgentRunner = async () => {
      called = true

      return {
        verdict: { status: 'confirmed', rationale: 'x', citedEvidenceIds: [] }
      }
    }

    const { report, usage } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [],
      verifyClaim: verify
    })

    expect(called).toBe(false)
    expect(report.verdicts).toEqual([])
    expect(report.claimCount).toBe(0)
    expect(report.warnings).toEqual([])
    expect(usage).toBeUndefined()
  })

  test('a pre-aborted run ends every claim uncertain without invoking the agent', async () => {
    let called = false
    const verify: ClaimAgentRunner = async () => {
      called = true

      return {
        verdict: { status: 'confirmed', rationale: 'x', citedEvidenceIds: [] }
      }
    }

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [staticProvider([makeClaim()])],
      verifyClaim: verify,
      signal: AbortSignal.abort()
    })

    expect(called).toBe(false)
    expect(report.verdicts[0]?.status).toBe('uncertain')
    expect(report.observations[0]?.boundReason).toBe('aborted')
    expect(report.observations[0]?.toolCalls).toBe(0)
  })

  test('accumulates token usage across claims', async () => {
    const verify: ClaimAgentRunner = async () => ({
      verdict: { status: 'confirmed', rationale: 'ok', citedEvidenceIds: [] },
      usage: { inputTokens: 1, outputTokens: 2 }
    })

    const { usage } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [
        staticProvider([
          makeClaim({ id: 'claim_one' }),
          makeClaim({ id: 'claim_two' })
        ])
      ],
      verifyClaim: verify
    })

    expect(usage?.inputTokens).toBe(2)
    expect(usage?.outputTokens).toBe(4)
  })

  test('an unexpected agent error ends the claim uncertain without throwing', async () => {
    const verify: ClaimAgentRunner = async () => {
      throw new Error('provider exploded')
    }

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [staticProvider([makeClaim()])],
      verifyClaim: verify
    })

    expect(report.verdicts[0]?.status).toBe('uncertain')
    expect(report.observations[0]?.boundReason).toBe('agent-error')
  })

  test('the bounded tools reject an ineligible secret file', async () => {
    let rejectedReason = ''
    const verify: ClaimAgentRunner = async ({ tools }) => {
      try {
        await tools.read({ path: '.env' })
      } catch (error) {
        rejectedReason = error instanceof Error ? error.message : 'unknown'
      }

      return {
        verdict: { status: 'uncertain', rationale: 'blocked', citedEvidenceIds: [] }
      }
    }

    await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [staticProvider([makeClaim()])],
      verifyClaim: verify
    })

    expect(rejectedReason).toMatch(/not eligible/iu)
  })
})
