import { describe, expect, test } from 'vitest'
import {
  AdmittedFindingSchema,
  type AdmittedFinding
} from '../../shared/contracts/findings/finding.schema.js'
import { ClaimSchema } from '../../shared/contracts/verification/verification.schema.js'
import {
  createCurrentFindingsProvider,
  currentFindingClaimId
} from './current-findings-provider.js'

const provenance = {
  reviewer: 'review-agent',
  instructionHashes: [],
  skillHashes: [],
  signalVersions: {},
  configHash: 'a'.repeat(64)
}

const finding = (over: Partial<AdmittedFinding>): AdmittedFinding =>
  AdmittedFindingSchema.parse({
    id: 'find_current1',
    taskId: 'task_current1',
    category: 'bug',
    severity: 'high',
    title: 'Off-by-one in loop bound',
    description: 'The loop reads one element past the end of the array.',
    location: { path: 'src/app.ts', startLine: 3, side: 'new' },
    evidenceIds: ['ev_current1'],
    proposedBy: 'review-agent',
    admissionStatus: 'admitted',
    admittedAt: '2026-07-23T00:00:00.000Z',
    admissionEvidenceIds: ['ev_current1'],
    reporterEligibility: 'inline',
    provenance,
    baselineStatus: 'new',
    fingerprints: [{ algorithm: 'v2', value: 'abc123' }],
    ...over
  })

describe('createCurrentFindingsProvider', () => {
  test('turns an admitted finding into a current-finding claim', async () => {
    const provider = createCurrentFindingsProvider({
      findings: [finding({})],
      minSeverity: 'medium'
    })

    const { claims } = await provider.gather({ repositoryRoot: '/repo' })
    expect(claims).toHaveLength(1)
    const claim = ClaimSchema.parse(claims[0])
    expect(claim.kind).toBe('current-finding')
    expect(claim.source).toBe('current-finding')
    expect(claim.id).toBe(currentFindingClaimId('find_current1'))
    expect(claim.location).toEqual({
      path: 'src/app.ts',
      startLine: 3,
      side: 'new'
    })
    // The finding's fingerprints are carried so a verdict maps back to it.
    expect(claim.evidenceRefs).toContainEqual({
      key: 'fingerprint:v2',
      value: 'abc123'
    })
    expect(claim.question).toContain('real defect')
  })

  test('gates findings below the configured minSeverity', async () => {
    const provider = createCurrentFindingsProvider({
      findings: [
        finding({ id: 'find_high', severity: 'high' }),
        finding({ id: 'find_low', severity: 'low' }),
        finding({ id: 'find_medium', severity: 'medium' })
      ],
      minSeverity: 'high'
    })

    const { claims } = await provider.gather({ repositoryRoot: '/repo' })
    expect(claims.map((claim) => claim.id)).toEqual([
      currentFindingClaimId('find_high')
    ])
  })

  test('includes every finding when minSeverity is info', async () => {
    const provider = createCurrentFindingsProvider({
      findings: [
        finding({ id: 'find_info', severity: 'info' }),
        finding({ id: 'find_critical', severity: 'critical' })
      ],
      minSeverity: 'info'
    })

    const { claims } = await provider.gather({ repositoryRoot: '/repo' })
    expect(claims).toHaveLength(2)
  })

  test('currentFindingClaimId is deterministic and finding-scoped', () => {
    expect(currentFindingClaimId('find_x')).toBe(currentFindingClaimId('find_x'))
    expect(currentFindingClaimId('find_x')).not.toBe(
      currentFindingClaimId('find_y')
    )
    expect(currentFindingClaimId('find_x')).toMatch(/^claim_[a-f0-9]{24}$/u)
  })
})
