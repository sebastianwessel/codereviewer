import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  ClaimSchema,
  type Claim
} from '../../shared/contracts/verification/verification.schema.js'
import type { ClaimProvider } from './contracts.js'
import {
  runWarningsForVerificationReport,
  VerificationReportSchema,
  type ModelVerdict
} from './verification-report.js'
import { isToolCallBudgetExceededError } from '../context-retrieval/index.js'
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
  gather: async () => ({ claims, withheldByCap: 0 })
})

// A provider that hit `MAX_CLAIMS_PER_PROVIDER` and says how many claims it left
// behind.
const cappedProvider = (
  claims: readonly Claim[],
  withheldByCap: number,
  id = 'capped'
): ClaimProvider => ({
  id,
  gather: async () => ({ claims, withheldByCap })
})

const failingProvider = (id = 'failing'): ClaimProvider => ({
  id,
  gather: async () => {
    throw new Error('provider blew up')
  }
})

// `maxBytesPerRead` is deliberately absent: production leaves it unset, so the
// default path under test is the one without a proactive per-read cut. Cases
// that need an explicit cap pass one.
const baseFlowInput = (repositoryRoot: string) => ({
  repositoryRoot,
  maxToolCallsPerClaim: 5,
  maxMatches: 20
})

// A provider refusing the request as too large, in the shape the harness raises
// and `isContextLengthExceeded` reads.
const contextOverflowError = (): Error =>
  Object.assign(new Error('provider refused the request'), {
    reason: 'context_length_exceeded'
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
      investigateClaim: verify
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

  test('carries findingJudgment and fixEdits for a current-finding claim', async () => {
    const claim = makeClaim({ id: 'claim_cf1', kind: 'current-finding' })
    const verify: ClaimAgentRunner = async () => ({
      verdict: {
        status: 'uncertain',
        findingJudgment: 'real',
        fixEdits: [
          { path: 'app.ts', startLine: 1, endLine: 1, replacement: 'export const marker = 2' }
        ],
        rationale: 'the marker is a genuine defect',
        citedEvidenceIds: []
      }
    })

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [staticProvider([claim])],
      investigateClaim: verify
    })

    const [verdict] = report.verdicts
    expect(verdict?.findingJudgment).toBe('real')
    expect(verdict?.fixEdits).toHaveLength(1)
    expect(report.observations[0]?.findingJudgment).toBe('real')
  })

  test('ignores findingJudgment and fixEdits for a non current-finding claim', async () => {
    // The same model output on a verification (prior-finding) claim must never
    // carry the fix-lane fields: they are gated on claim kind in CODE.
    const claim = makeClaim({ id: 'claim_pf1', kind: 'prior-finding' })
    const verify: ClaimAgentRunner = async () => ({
      verdict: {
        status: 'confirmed',
        findingJudgment: 'real',
        fixEdits: [
          { path: 'app.ts', startLine: 1, endLine: 1, replacement: 'export const marker = 2' }
        ],
        rationale: 'the marker is present',
        citedEvidenceIds: []
      }
    })

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [staticProvider([claim])],
      investigateClaim: verify
    })

    const [verdict] = report.verdicts
    expect(verdict?.status).toBe('confirmed')
    expect(verdict?.findingJudgment).toBeUndefined()
    expect(verdict?.fixEdits).toBeUndefined()
    expect(report.observations[0]?.findingJudgment).toBeUndefined()
  })

  test('synthesizes a fingerprint when the claim carries none', async () => {
    const claim = makeClaim()
    const verify: ClaimAgentRunner = async () => ({
      verdict: { status: 'refuted', rationale: 'not present', citedEvidenceIds: [] }
    })

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [staticProvider([claim])],
      investigateClaim: verify
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
        if (isToolCallBudgetExceededError(error)) {
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
      investigateClaim: verify
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
      investigateClaim: verify
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
      investigateClaim: verify
    })

    expect(observedContentBytes).toBeLessThanOrEqual(100)
    expect(report.observations[0]?.bytesRead).toBeLessThanOrEqual(100)
  })

  // The limit is not pre-empted by a byte cap chosen in advance; it is recovered
  // from when the provider actually says so.
  test('a provider that refuses the context is retried against narrowed reads', async () => {
    let attempts = 0
    const verify: ClaimAgentRunner = async ({ tools }) => {
      attempts += 1
      await tools.read({ path: 'app.ts' })

      if (attempts === 1) {
        throw contextOverflowError()
      }

      return {
        verdict: { status: 'confirmed', rationale: 'fits now', citedEvidenceIds: [] }
      }
    }

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [staticProvider([makeClaim()])],
      investigateClaim: verify
    })

    expect(attempts).toBe(2)
    expect(report.verdicts[0]?.status).toBe('confirmed')
    // A recovered claim is not a bounded one.
    expect(report.observations[0]?.boundReason).toBeUndefined()
  })

  test('a context refusal that narrowing cannot fix is named, not called an agent error', async () => {
    const verify: ClaimAgentRunner = async () => {
      throw contextOverflowError()
    }

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [staticProvider([makeClaim()])],
      investigateClaim: verify
    })

    // `agent-error` would send a reader looking for a broken agent. This is a
    // context that will not fit, and the rationale says what to do about it.
    expect(report.observations[0]?.boundReason).toBe('context-length-exceeded')
    expect(report.verdicts[0]?.status).toBe('uncertain')
    expect(report.verdicts[0]?.rationale).toContain('context length')
    expect(report.verdicts[0]?.rationale).toContain('Nothing was truncated')
  })

  test('a claim provider failure is non-fatal and surfaces as a warning', async () => {
    const verify: ClaimAgentRunner = async () => ({
      verdict: { status: 'confirmed', rationale: 'ok', citedEvidenceIds: [] }
    })

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [failingProvider('bad'), staticProvider([makeClaim()], 'good')],
      investigateClaim: verify
    })

    expect(report.warnings).toContain('claim-provider-failed:bad')
    expect(report.verdicts).toHaveLength(1)
    expect(report.claimCount).toBe(1)
  })

  // `claimCount` counts what was investigated, so a capped provider and a
  // provider that had exactly that many claims report the same number. Without
  // this warning a reader concludes every eligible finding was judged.
  test('a provider that hit its claim cap says how many claims went uninvestigated', async () => {
    const verify: ClaimAgentRunner = async () => ({
      verdict: { status: 'confirmed', rationale: 'ok', citedEvidenceIds: [] }
    })

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [cappedProvider([makeClaim()], 7, 'claims-file:.codereviewer/claims.json')],
      investigateClaim: verify
    })

    expect(report.warnings).toContain(
      'claim-provider-capped:7:claims-file:.codereviewer/claims.json'
    )
    expect(report.claimCount).toBe(1)
    expect(runWarningsForVerificationReport(report)).toEqual([
      'Verification claim provider "claims-file:.codereviewer/claims.json" reached the per-provider cap of 200 claims; 7 further claim(s) were not investigated.'
    ])
  })

  test('a provider that stayed under its claim cap warns about nothing', async () => {
    const verify: ClaimAgentRunner = async () => ({
      verdict: { status: 'confirmed', rationale: 'ok', citedEvidenceIds: [] }
    })

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [cappedProvider([makeClaim()], 0)],
      investigateClaim: verify
    })

    expect(report.warnings).toEqual([])
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
      investigateClaim: verify
    })

    expect(called).toBe(false)
    expect(report.verdicts).toEqual([])
    expect(report.claimCount).toBe(0)
    expect(report.warnings).toEqual([])
    expect(usage).toBeUndefined()
  })

  test('records a durable context-ledger entry in the report for every mediated tool call', async () => {
    const verify: ClaimAgentRunner = async ({ claim, tools }) => {
      await tools.read({ path: 'app.ts' })

      return {
        verdict: {
          status: 'confirmed',
          rationale: `read app.ts for ${claim.id}`,
          citedEvidenceIds: []
        }
      }
    }

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [
        staticProvider([
          makeClaim({ id: 'claim_led1' }),
          makeClaim({ id: 'claim_led2' })
        ])
      ],
      investigateClaim: verify
    })

    // One entry per read, across every claim: each claim gets its own retriever,
    // so a per-claim sink would leave the report holding nothing.
    expect(report.contextLedger).toHaveLength(2)
    const [entry] = report.contextLedger
    expect(entry?.kind).toBe('tool-result')
    expect(entry?.path).toBe('app.ts')
    expect(entry?.reason).toBe('context-retrieval-read')
    expect(entry?.decision).toBe('included')
    expect(entry?.bytesIncluded).toBeGreaterThan(0)
    // No source content is disclosed: the entry carries a hash, not the file.
    expect(entry?.contentHash).toMatch(/^[a-f0-9]{64}$/u)

    // The entries survive serialization into the run artifact this lane writes
    // (`verification-report.json`), which is what makes the read auditable.
    const roundTripped = VerificationReportSchema.parse(
      JSON.parse(JSON.stringify(report))
    )
    expect(roundTripped.contextLedger).toEqual(report.contextLedger)
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
      investigateClaim: verify,
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
      investigateClaim: verify
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
      investigateClaim: verify
    })

    expect(report.verdicts[0]?.status).toBe('uncertain')
    expect(report.observations[0]?.boundReason).toBe('agent-error')
  })

  test('a verdict that violates the contract ends the claim uncertain', async () => {
    // Providers differ; some models return a status outside the enum. CODE is
    // authoritative: an unparseable verdict becomes an `invalid-verdict` bound.
    const verify: ClaimAgentRunner = async () => ({
      verdict: {
        status: 'definitely',
        rationale: 'the agent invented a status',
        citedEvidenceIds: []
      } as unknown as ModelVerdict
    })

    const { report } = await runVerificationFlow({
      ...baseFlowInput(repositoryRoot),
      providers: [staticProvider([makeClaim()])],
      investigateClaim: verify
    })

    expect(report.verdicts[0]?.status).toBe('uncertain')
    expect(report.observations[0]?.boundReason).toBe('invalid-verdict')
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
      investigateClaim: verify
    })

    expect(rejectedReason).toMatch(/not eligible/iu)
  })
})
