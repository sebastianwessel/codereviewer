import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import type { AdmittedFinding } from '../../shared/contracts/findings/finding.schema.js'
import type { ReviewReport } from '../../shared/contracts/report/review-report.schema.js'
import { ClaimSchema } from '../../shared/contracts/verification/verification.schema.js'
import { TRUNCATION_MARK } from '../../shared/text/truncate.js'
import { buildBaselineEntries, renderBaselineJson } from '../admission/index.js'
import { fingerprintsForClaim } from './claim-fingerprints.js'
import { createPriorFindingsProvider } from './prior-findings-provider.js'
import { MAX_CLAIMS_PER_PROVIDER } from './contracts.js'

const gatherInput = (repositoryRoot: string) => ({ repositoryRoot })

const hash = '1'.repeat(64)

const admittedFinding = (index: number): AdmittedFinding => ({
  id: `find_${index.toString(16).padStart(8, '0')}`,
  taskId: 'task_abc123',
  category: 'security',
  severity: 'high',
  title: `Prior finding ${index}`,
  description: 'A prior run reported unsanitized input reaching a raw query.',
  location: {
    path: 'src/orders/lookup.ts',
    startLine: 42,
    endLine: 48,
    side: 'new'
  },
  evidenceIds: ['ev_diff1'],
  proposedBy: 'review-agent',
  admissionStatus: 'admitted',
  admittedAt: '2026-06-20T00:00:00.000Z',
  admissionEvidenceIds: ['ev_diff1'],
  reporterEligibility: 'inline',
  provenance: {
    reviewer: 'review-agent',
    instructionHashes: [],
    skillHashes: [],
    signalVersions: {},
    configHash: hash
  },
  baselineStatus: 'new',
  fingerprints: [{ algorithm: 'v1', value: `abc${index}` }]
})

const reportFixture = (admittedFindings: readonly AdmittedFinding[]): ReviewReport => ({
  schemaVersion: '1.0',
  run: {
    runId: 'test-run',
    startedAt: '2026-06-20T00:00:00.000Z',
    completedAt: '2026-06-20T00:00:01.000Z',
    mode: 'ci',
    depth: 'balanced',
    repositoryRootHash: hash,
    configHash: hash,
    durationMs: 1000,
    warnings: []
  },
  coverage: {
    status: 'complete',
    excludedFileCount: 0,
    reviewableFileCount: 0,
    coveredFileCount: 0,
    reviewableBytes: 0,
    coveredBytes: 0,
    incompleteReasons: [],
    files: []
  },
  admittedFindings: [...admittedFindings],
  rejectedFindings: [],
  evidence: [],
  skippedFiles: [],
  refutationResults: [],
  providerIssues: [],
  artifacts: []
})

describe('prior-findings provider', () => {
  test('turns each admitted finding into a prior-finding claim', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-prior-'))

    try {
      await mkdir(path.join(root, '.codereviewer', 'runs'), { recursive: true })
      await writeFile(
        path.join(root, '.codereviewer', 'runs', 'report.json'),
        JSON.stringify(reportFixture([admittedFinding(1)]))
      )

      const provider = createPriorFindingsProvider({
        type: 'prior-findings',
        report: '.codereviewer/runs/report.json'
      })

      const { claims } = await provider.gather(gatherInput(root))
      expect(claims).toHaveLength(1)
      const claim = claims[0]
      expect(claim?.kind).toBe('prior-finding')
      expect(claim?.source).toBe('prior-finding')
      expect(claim?.location).toEqual({
        path: 'src/orders/lookup.ts',
        startLine: 42,
        endLine: 48,
        side: 'new'
      })
      expect(claim?.question).toContain('Prior finding 1')
      expect(claim?.evidenceRefs).toEqual([{ key: 'fingerprint:v1', value: 'abc1' }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('turns each baseline entry into a prior-finding claim carrying its fingerprints', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-prior-'))

    try {
      // Exactly what the baseline writer emits: fingerprints and nothing else.
      const baseline = buildBaselineEntries([
        { fingerprints: [{ algorithm: 'v1', value: 'abc1' }] },
        { fingerprints: [{ algorithm: 'v1', value: 'abc2' }] }
      ])
      await mkdir(path.join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        path.join(root, '.codereviewer', 'baseline.json'),
        renderBaselineJson(baseline)
      )

      const provider = createPriorFindingsProvider({
        type: 'prior-findings',
        report: '.codereviewer/baseline.json'
      })

      const { claims } = await provider.gather(gatherInput(root))
      expect(claims).toHaveLength(2)
      const claim = claims[0]
      expect(claim?.kind).toBe('prior-finding')
      expect(claim?.source).toBe('prior-finding')
      // A baseline discloses no location, and the claim must not invent one.
      expect(claim?.location).toBeUndefined()
      expect(claim?.question).toContain('v1:abc1')
      // The carried fingerprints are what let the verdict be matched back to the
      // baselined finding.
      expect(claim?.evidenceRefs).toEqual([{ key: 'fingerprint:v1', value: 'abc1' }])
      expect(fingerprintsForClaim(ClaimSchema.parse(claim))).toEqual([
        { algorithm: 'v1', value: 'abc1' }
      ])
      // Distinct entries yield distinct claim ids.
      expect(claims[1]?.id).not.toBe(claim?.id)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The reader of these fields is a MODEL. A baseline entry with many
  // fingerprints overruns the claim's title and question caps, and an unmarked
  // cut lands mid-hash: the agent is then shown a fingerprint list that looks
  // complete and whose last entry is a hash that was never recorded.
  test('marks a baseline claim whose fingerprint list overruns the title and question caps', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-prior-'))

    try {
      const baseline = buildBaselineEntries([
        {
          fingerprints: Array.from({ length: 20 }, (_, index) => ({
            algorithm: 'v1',
            value: `${index}`.padStart(40, 'f')
          }))
        }
      ])
      await mkdir(path.join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        path.join(root, '.codereviewer', 'baseline.json'),
        renderBaselineJson(baseline)
      )

      const provider = createPriorFindingsProvider({
        type: 'prior-findings',
        report: '.codereviewer/baseline.json'
      })

      const { claims } = await provider.gather(gatherInput(root))

      expect(claims[0]?.title.endsWith(TRUNCATION_MARK)).toBe(true)
      expect(claims[0]?.question.endsWith(TRUNCATION_MARK)).toBe(true)
      // The mark is reserved inside the cap, never added on top of it.
      expect(claims[0]?.title.length).toBeLessThanOrEqual(200)
      expect(claims[0]?.question.length).toBeLessThanOrEqual(500)
      // Still a valid `Claim`: the contract bounds are what the mark makes room
      // for.
      expect(() => ClaimSchema.parse(claims[0])).not.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('yields no claims when the prior report is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-prior-'))

    try {
      const provider = createPriorFindingsProvider({
        type: 'prior-findings',
        report: '.codereviewer/runs/report.json'
      })

      expect(await provider.gather(gatherInput(root))).toEqual({
        claims: [],
        withheldByCap: 0
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a report that fails schema validation is a genuine failure and throws', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-prior-'))

    try {
      await writeFile(path.join(root, 'report.json'), JSON.stringify({ not: 'a report' }))

      const provider = createPriorFindingsProvider({
        type: 'prior-findings',
        report: 'report.json'
      })

      await expect(provider.gather(gatherInput(root))).rejects.toThrow(
        /neither a review report nor a baseline file/u
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a file matching neither shape fails loudly and names the shape it is not', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-prior-'))

    try {
      // A JSON array, so it is read as a baseline candidate — and rejected as one
      // rather than being silently misread as a report.
      await writeFile(path.join(root, 'unknown.json'), JSON.stringify([{ nope: true }]))

      const provider = createPriorFindingsProvider({
        type: 'prior-findings',
        report: 'unknown.json'
      })

      await expect(provider.gather(gatherInput(root))).rejects.toThrow(
        /"unknown\.json" is a JSON array but is not a valid baseline file/u
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('bounds the number of claims derived from a single report and reports how many it withheld', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-prior-'))

    try {
      const findings = Array.from({ length: MAX_CLAIMS_PER_PROVIDER + 10 }, (_, index) =>
        admittedFinding(index)
      )
      await writeFile(path.join(root, 'report.json'), JSON.stringify(reportFixture(findings)))

      const provider = createPriorFindingsProvider({
        type: 'prior-findings',
        report: 'report.json'
      })

      const result = await provider.gather(gatherInput(root))
      expect(result.claims).toHaveLength(MAX_CLAIMS_PER_PROVIDER)
      expect(result.withheldByCap).toBe(10)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
