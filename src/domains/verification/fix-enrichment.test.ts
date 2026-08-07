import { describe, expect, test } from 'vitest'
import {
  AdmittedFindingSchema,
  type AdmittedFinding,
  type FixEdit
} from '../../shared/contracts/findings/finding.schema.js'
import {
  VerdictSchema,
  type Verdict
} from '../../shared/contracts/verification/verification.schema.js'
import { currentFindingClaimId } from './current-findings-provider.js'
import { enrichFindingsWithFixes, type CurrentFileReader } from './fix-enrichment.js'
import type { ClaimObservation } from './verification-report.js'

const provenance = {
  reviewer: 'review-agent',
  instructionHashes: [],
  skillHashes: [],
  signalVersions: {},
  configHash: 'a'.repeat(64)
}

const finding = (over: Partial<AdmittedFinding>): AdmittedFinding =>
  AdmittedFindingSchema.parse({
    id: 'find_fix1',
    taskId: 'task_fix1',
    category: 'bug',
    severity: 'high',
    title: 'Off-by-one in loop bound',
    description: 'The loop reads one element past the end of the array.',
    location: { path: 'src/app.ts', startLine: 2, side: 'new' },
    evidenceIds: ['ev_fix1'],
    proposedBy: 'review-agent',
    admissionStatus: 'admitted',
    admittedAt: '2026-07-23T00:00:00.000Z',
    admissionEvidenceIds: ['ev_fix1'],
    reporterEligibility: 'inline',
    provenance,
    baselineStatus: 'new',
    fingerprints: [{ algorithm: 'v2', value: 'abc123' }],
    ...over
  })

const verdict = (input: {
  findingId: string
  findingJudgment?: 'real' | 'false-positive'
  fixEdits?: FixEdit[]
}): Verdict =>
  VerdictSchema.parse({
    claimId: currentFindingClaimId(input.findingId),
    status: 'uncertain',
    ...(input.findingJudgment === undefined
      ? {}
      : { findingJudgment: input.findingJudgment }),
    ...(input.fixEdits === undefined ? {} : { fixEdits: input.fixEdits }),
    rationale: 'The loop bound uses <= where it should use <; fix to <.',
    citedEvidenceIds: ['ev_tool_read1'],
    fingerprints: [{ algorithm: 'v2', value: 'abc123' }]
  })

const observation = (findingId: string, judgment?: 'real' | 'false-positive'): ClaimObservation => ({
  claimId: currentFindingClaimId(findingId),
  claimKind: 'current-finding',
  source: 'current-finding',
  status: 'uncertain',
  ...(judgment === undefined ? {} : { findingJudgment: judgment }),
  toolCalls: 1,
  bytesRead: 40,
  durationMs: 1
})

const fileBytes = ['const a = 1', 'for (i <= n)', 'const c = 3'].join('\n')
const reader: CurrentFileReader = async (p) =>
  p === 'src/app.ts' ? fileBytes : undefined

describe('enrichFindingsWithFixes', () => {
  test('enriches a real finding with an apply-checked fix', async () => {
    const target = finding({})
    const result = await enrichFindingsWithFixes({
      findings: [target],
      verdicts: [
        verdict({
          findingId: 'find_fix1',
          findingJudgment: 'real',
          fixEdits: [
            {
              path: 'src/app.ts',
              startLine: 2,
              endLine: 2,
              replacement: 'for (i < n)',
              description: 'Use a strict less-than bound.'
            }
          ]
        })
      ],
      observations: [observation('find_fix1', 'real')],
      readFile: reader
    })

    const enriched = result.findings[0]!
    expect(enriched.fixProposal?.safety).toBe('manual-review')
    expect(enriched.fixProposal?.edits).toHaveLength(1)
    expect(enriched.fixProposal?.edits?.[0]?.replacement).toBe('for (i < n)')
    // Advisory only: category, severity, admission and fingerprints are untouched.
    expect(enriched.severity).toBe('high')
    expect(enriched.category).toBe('bug')
    expect(enriched.admissionStatus).toBe('admitted')
    expect(enriched.fingerprints).toEqual(target.fingerprints)

    expect(result.fixOutcomes).toEqual([
      {
        findingId: 'find_fix1',
        findingJudgment: 'real',
        fixProduced: true,
        applyCheck: 'passed'
      }
    ])
    // The observation is augmented with the fix outcome.
    expect(result.observations[0]?.fixProduced).toBe(true)
    expect(result.observations[0]?.applyCheck).toBe('passed')
  })

  test('drops a fix whose edit does not apply to the current file', async () => {
    const target = finding({})
    const result = await enrichFindingsWithFixes({
      findings: [target],
      verdicts: [
        verdict({
          findingId: 'find_fix1',
          findingJudgment: 'real',
          fixEdits: [
            {
              path: 'src/app.ts',
              startLine: 99,
              endLine: 99,
              replacement: 'for (i < n)'
            }
          ]
        })
      ],
      observations: [observation('find_fix1', 'real')],
      readFile: reader
    })

    // The finding is left exactly as admitted; the fix was not produced.
    expect(result.findings[0]).toEqual(target)
    expect(result.fixOutcomes[0]).toEqual({
      findingId: 'find_fix1',
      findingJudgment: 'real',
      fixProduced: false,
      applyCheck: 'failed'
    })
  })

  test('a false-positive judgment is a signal only and never removes the finding', async () => {
    const target = finding({})
    const result = await enrichFindingsWithFixes({
      findings: [target],
      verdicts: [verdict({ findingId: 'find_fix1', findingJudgment: 'false-positive' })],
      observations: [observation('find_fix1', 'false-positive')],
      readFile: reader
    })

    // The finding is still present and unchanged.
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toEqual(target)
    expect(result.fixOutcomes[0]).toEqual({
      findingId: 'find_fix1',
      findingJudgment: 'false-positive',
      fixProduced: false,
      applyCheck: 'not-attempted'
    })
  })

  test('a finding the agent could not judge is left exactly as admitted', async () => {
    const target = finding({})
    const result = await enrichFindingsWithFixes({
      findings: [target],
      // A verdict with no findingJudgment carries no signal.
      verdicts: [verdict({ findingId: 'find_fix1' })],
      observations: [observation('find_fix1')],
      readFile: reader
    })

    expect(result.findings[0]).toEqual(target)
    expect(result.fixOutcomes).toHaveLength(0)
  })

  // The refusal is deliberate: the apply-check is defined against the finding's own
  // file, the enriched proposal may cite only that finding's evidence, and the
  // inline comment it flows into is anchored there. What was wrong is that it was
  // SILENT — recorded as `not-attempted`, the same record a finding with no proposed
  // fix produces.
  test('a fix touching another file is declined, and the record says why', async () => {
    const target = finding({})
    const result = await enrichFindingsWithFixes({
      findings: [target],
      verdicts: [
        verdict({
          findingId: 'find_fix1',
          findingJudgment: 'real',
          fixEdits: [
            // One edit in the finding's own file and one outside it: the set is
            // refused whole, never half-applied.
            { path: 'src/app.ts', startLine: 2, endLine: 2, replacement: 'for (i < n)' },
            { path: 'src/other.ts', startLine: 1, endLine: 1, replacement: 'x' }
          ]
        })
      ],
      observations: [observation('find_fix1', 'real')],
      readFile: reader
    })

    expect(result.findings[0]).toEqual(target)
    expect(result.fixOutcomes[0]).toEqual({
      findingId: 'find_fix1',
      findingJudgment: 'real',
      fixProduced: false,
      applyCheck: 'not-attempted',
      fixDeclinedReason: 'edits-outside-finding-file'
    })
    expect(result.observations[0]).toMatchObject({
      fixProduced: false,
      applyCheck: 'not-attempted',
      fixDeclinedReason: 'edits-outside-finding-file'
    })
  })

  test('a declined multi-file fix is distinguishable from no fix at all', async () => {
    const target = finding({})
    const noFix = await enrichFindingsWithFixes({
      findings: [target],
      // Judged real, and the agent proposed nothing.
      verdicts: [verdict({ findingId: 'find_fix1', findingJudgment: 'real' })],
      observations: [observation('find_fix1', 'real')],
      readFile: reader
    })
    const declined = await enrichFindingsWithFixes({
      findings: [target],
      verdicts: [
        verdict({
          findingId: 'find_fix1',
          findingJudgment: 'real',
          fixEdits: [
            { path: 'src/other.ts', startLine: 1, endLine: 1, replacement: 'x' }
          ]
        })
      ],
      observations: [observation('find_fix1', 'real')],
      readFile: reader
    })

    // Both report the same apply-check — the check ran in neither case — and only
    // the declined one carries a reason. That field is the whole distinction.
    expect(noFix.fixOutcomes[0]?.applyCheck).toBe('not-attempted')
    expect(noFix.fixOutcomes[0]?.fixDeclinedReason).toBeUndefined()
    expect(declined.fixOutcomes[0]?.fixDeclinedReason).toBe(
      'edits-outside-finding-file'
    )
  })

  test('an outcome for one finding never changes an unrelated finding', async () => {
    const target = finding({ id: 'find_fix1' })
    const unrelated = finding({
      id: 'find_other',
      title: 'Unrelated finding',
      fingerprints: [{ algorithm: 'v2', value: 'other1' }]
    })

    const result = await enrichFindingsWithFixes({
      findings: [target, unrelated],
      verdicts: [
        verdict({
          findingId: 'find_fix1',
          findingJudgment: 'real',
          fixEdits: [
            { path: 'src/app.ts', startLine: 2, endLine: 2, replacement: 'for (i < n)' }
          ]
        })
      ],
      observations: [observation('find_fix1', 'real')],
      readFile: reader
    })

    // Only the target is enriched; the unrelated finding is byte-for-byte the same.
    expect(result.findings[1]).toEqual(unrelated)
    expect(result.fixOutcomes.map((outcome) => outcome.findingId)).toEqual([
      'find_fix1'
    ])
  })

  // The per-finding reads and apply-checks are issued together, so the order of
  // `fixOutcomes` — which is report output — comes from the fold rather than from
  // whichever read happened to finish first. The reader below finishes them in
  // reverse to make the difference observable.
  test('reports outcomes in finding order however the reads complete', async () => {
    const findings = ['find_a', 'find_b', 'find_c'].map((id, index) =>
      finding({
        id,
        fingerprints: [{ algorithm: 'v2', value: `fp${index}` }]
      })
    )
    let pending = findings.length
    const reversingReader: CurrentFileReader = async () => {
      // Later findings resolve first: each waits one fewer turn than the one
      // before it.
      const turns = (pending -= 1)

      for (let turn = 0; turn < turns; turn += 1) {
        await Promise.resolve()
      }

      return 'const first = 1\nfor (i <= n)\n'
    }

    const result = await enrichFindingsWithFixes({
      findings,
      verdicts: findings.map((entry) =>
        verdict({
          findingId: entry.id,
          findingJudgment: 'real',
          fixEdits: [
            {
              path: 'src/app.ts',
              startLine: 2,
              endLine: 2,
              replacement: 'for (i < n)'
            }
          ]
        })
      ),
      observations: findings.map((entry) => observation(entry.id, 'real')),
      readFile: reversingReader
    })

    expect(result.fixOutcomes.map((outcome) => outcome.findingId)).toEqual([
      'find_a',
      'find_b',
      'find_c'
    ])
    expect(result.findings.map((entry) => entry.id)).toEqual([
      'find_a',
      'find_b',
      'find_c'
    ])
  })
})
