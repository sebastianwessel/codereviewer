import { describe, expect, test } from 'vitest'
import {
  REVIEW_COMMENT_BODY_MAX,
  ReviewCommentDraftSchema
} from '../../shared/contracts/index.js'
import {
  admitCandidate,
  type AdmissionPolicy,
  type CandidateFinding
} from '../admission/index.js'
import { createReportFixture } from '../../shared/testing/report-fixture.js'
import { renderReviewComments } from './review-comment-renderers.js'
import { buildReviewCommentDrafts } from './review-comments.js'

describe('neutral review-comment drafts', () => {
  test('builds an inline new-side draft with a structured single-edit suggestion', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const drafts = buildReviewCommentDrafts({
      ...report,
      admittedFindings: [
        {
          ...finding,
          location: {
            path: 'src/app.ts',
            startLine: 12,
            endLine: 13,
            side: 'new'
          },
          fixProposal: {
            summary: 'Guard the nullable order before reading items.',
            evidenceIds: finding.admissionEvidenceIds,
            safety: 'manual-review',
            edits: [
              {
                path: 'src/app.ts',
                startLine: 12,
                endLine: 13,
                replacement:
                  'if (order === null) {\n  return []\n}\nreturn order.items'
              }
            ]
          }
        }
      ]
    })

    expect(drafts).toHaveLength(1)
    const draft = drafts[0]!
    // Every draft round-trips through the neutral contract schema.
    expect(ReviewCommentDraftSchema.parse(draft)).toEqual(draft)
    expect(draft).toEqual({
      path: 'src/app.ts',
      targetRange: { startLine: 12, endLine: 13 },
      body: expect.stringContaining('Guard the nullable order'),
      suggestion: {
        replacement: 'if (order === null) {\n  return []\n}\nreturn order.items'
      },
      findingId: finding.id,
      severity: finding.severity,
      category: finding.category
    })
    // The neutral body never carries a pre-rendered fence; the suggestion is
    // structured and rendered per platform.
    expect(draft.body).not.toContain('```')
  })

  test('drops summary-only, old-side, and multi-edit suggestions', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const drafts = buildReviewCommentDrafts({
      ...report,
      admittedFindings: [
        {
          ...finding,
          id: 'find_summary1',
          reporterEligibility: 'summary-only'
        },
        {
          ...finding,
          id: 'find_old1',
          reporterEligibility: 'inline',
          location: { path: 'src/app.ts', startLine: 10, side: 'old' }
        },
        {
          ...finding,
          id: 'find_multi1',
          reporterEligibility: 'inline',
          fixProposal: {
            summary: 'Two edits need human review.',
            evidenceIds: finding.admissionEvidenceIds,
            safety: 'manual-review',
            edits: [
              {
                path: finding.location.path,
                startLine: finding.location.startLine,
                endLine: finding.location.startLine,
                replacement: 'first'
              },
              {
                path: finding.location.path,
                startLine: finding.location.startLine + 1,
                endLine: finding.location.startLine + 1,
                replacement: 'second'
              }
            ]
          }
        }
      ]
    })

    // Only the multi-edit inline finding is emitted, and without a suggestion.
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.findingId).toBe('find_multi1')
    expect(drafts[0]!.suggestion).toBeUndefined()
  })

  test('drops a suggestion whose edit range does not map to the target range', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const drafts = buildReviewCommentDrafts({
      ...report,
      admittedFindings: [
        {
          ...finding,
          location: { path: 'src/app.ts', startLine: 12, endLine: 13, side: 'new' },
          fixProposal: {
            summary: 'Range mismatch.',
            evidenceIds: finding.admissionEvidenceIds,
            safety: 'manual-review',
            edits: [
              {
                path: 'src/app.ts',
                startLine: 12,
                endLine: 14,
                replacement: 'mismatched'
              }
            ]
          }
        }
      ]
    })

    expect(drafts[0]!.suggestion).toBeUndefined()
    expect(drafts[0]!.body).toContain('Range mismatch.')
  })

  test('drops a suggestion whose replacement contains a code fence', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const drafts = buildReviewCommentDrafts({
      ...report,
      admittedFindings: [
        {
          ...finding,
          location: { path: 'src/app.ts', startLine: 12, endLine: 13, side: 'new' },
          fixProposal: {
            summary: 'Fence in replacement.',
            evidenceIds: finding.admissionEvidenceIds,
            safety: 'manual-review',
            edits: [
              {
                path: 'src/app.ts',
                startLine: 12,
                endLine: 13,
                replacement: 'const x = 1\n```\nbreakout'
              }
            ]
          }
        }
      ]
    })

    expect(drafts[0]!.suggestion).toBeUndefined()
  })

  // The description used to absorb every byte left over, so a long one pushed the
  // body to the cap and the apply-ready block had nowhere to go — dropped for
  // EVERY platform, with the body still reading "Suggested fix: <summary>". The
  // suggestion's room is now reserved before the description is sized.
  test('a long description does not cost the finding its suggestion', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const drafts = buildReviewCommentDrafts({
      ...report,
      admittedFindings: [
        {
          ...finding,
          // At the contract's own 1200-char bound, with a replacement large
          // enough that the two together exceed the body cap. Something has to
          // give, and it must not be the fix.
          description: 'This description is very long. '.repeat(40).slice(0, 1200),
          location: { path: 'src/app.ts', startLine: 12, endLine: 13, side: 'new' },
          fixProposal: {
            summary: 'Guard the null case.',
            evidenceIds: finding.admissionEvidenceIds,
            safety: 'manual-review',
            edits: [
              {
                path: 'src/app.ts',
                startLine: 12,
                endLine: 13,
                replacement: 'const line = 1\n'.repeat(120)
              }
            ]
          }
        }
      ]
    })

    expect(drafts[0]!.suggestion?.replacement).toBe('const line = 1\n'.repeat(120))
    expect(drafts[0]!.body.length).toBeLessThanOrEqual(REVIEW_COMMENT_BODY_MAX)
    // The description is what gave way, and it says so with the truncation mark.
    expect(drafts[0]!.body).toContain('…')
  })

  // A replacement too large to carry even with the reservation. The fix is
  // withheld — and the body says so, and says where the replacement survives. It
  // is NOT `review-comments.json`: when this layer drops the suggestion, the
  // neutral artifact has no `suggestion` field either.
  test('a suggestion too large to carry is disclosed, not silently dropped', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const drafts = buildReviewCommentDrafts({
      ...report,
      admittedFindings: [
        {
          ...finding,
          location: { path: 'src/app.ts', startLine: 12, endLine: 13, side: 'new' },
          fixProposal: {
            summary: 'Replace the whole block.',
            evidenceIds: finding.admissionEvidenceIds,
            safety: 'manual-review',
            edits: [
              {
                path: 'src/app.ts',
                startLine: 12,
                endLine: 13,
                replacement: 'const line = 1\n'.repeat(260)
              }
            ]
          }
        }
      ]
    })

    expect(drafts[0]!.suggestion).toBeUndefined()
    expect(drafts[0]!.body).toContain('was computed for this finding')
    expect(drafts[0]!.body).toContain('fixProposal.edits')
    expect(drafts[0]!.body.length).toBeLessThanOrEqual(REVIEW_COMMENT_BODY_MAX)
  })

  // The counterweight: a finding with no eligible replacement must NOT claim one
  // was computed and withheld. A note that fires when nothing was lost is a note
  // readers learn to skip.
  test('a finding whose fix was never suggestion-eligible says nothing about one', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const drafts = buildReviewCommentDrafts({
      ...report,
      admittedFindings: [
        {
          ...finding,
          location: { path: 'src/app.ts', startLine: 12, endLine: 13, side: 'new' },
          fixProposal: {
            summary: 'Two separate edits.',
            evidenceIds: finding.admissionEvidenceIds,
            safety: 'manual-review',
            edits: [
              { path: 'src/app.ts', startLine: 12, endLine: 13, replacement: 'a' },
              { path: 'src/app.ts', startLine: 20, endLine: 20, replacement: 'b' }
            ]
          }
        }
      ]
    })

    expect(drafts[0]!.suggestion).toBeUndefined()
    expect(drafts[0]!.body).not.toContain('was computed for this finding')
  })

  test('escapes Markdown metacharacters in untrusted body text', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const drafts = buildReviewCommentDrafts({
      ...report,
      admittedFindings: [
        {
          ...finding,
          title: 'Bug ```injected``` [x](javascript:alert(1))',
          description: 'See ```suggestion\nmalicious()\n``` here.',
          location: { path: 'src/app.ts', startLine: 12, endLine: 13, side: 'new' }
        }
      ]
    })

    const body = drafts[0]!.body
    expect(body).not.toContain('```')
    expect(body).not.toContain('](javascript:')
  })

  test('drafts a whole-file finding that admission marked inline', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const drafts = buildReviewCommentDrafts({
      ...report,
      admittedFindings: [
        {
          ...finding,
          // Model-origin findings carry `side: 'file'`; admission decides whether
          // the line sits in a changed hunk, and this layer must honour that
          // decision instead of dropping every non-`new` location.
          location: { path: 'src/app.ts', startLine: 4, side: 'file' }
        }
      ]
    })

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      path: 'src/app.ts',
      targetRange: { startLine: 4, endLine: 4 }
    })
  })
})

// An inline comment is the surface most reviewers read instead of the report, and
// it used to carry nothing a reader could check: severity, category, title,
// description, finding id, fix summary — every one of them the engine's own claim
// about itself. These tests hold the proof on it.
describe('the proof an inline comment carries', () => {
  const refutation = {
    id: 'refute_join1',
    candidateId: 'cand_join1',
    verdict: 'proved',
    summary: 'Looked for a caller-side guard; none exists.',
    evidenceIds: ['ev_diff1'],
    checks: [
      {
        kind: 'proof-review',
        result: 'passed',
        summary: 'The claim follows from the cited line.',
        evidenceIds: ['ev_diff1']
      }
    ]
  }

  const bodyFor = (report: unknown): string => {
    const drafts = buildReviewCommentDrafts(report)

    expect(drafts).toHaveLength(1)

    return drafts[0]!.body
  }

  test('states the verdict it survived and the address it rests on', () => {
    const report = createReportFixture()
    const body = bodyFor({
      ...report,
      refutationResults: [refutation],
      admittedFindings: [
        { ...report.admittedFindings[0]!, refutationId: 'refute_join1' }
      ]
    })

    expect(body).toContain(
      '- **Survived refutation** (proved): Looked for a caller-side guard; none exists.'
    )
    // The evidence ADDRESS, not the bare id the body never resolved.
    expect(body).toContain('- **Rests on:** file at `src/app.ts:4`')
  })

  // The failure this surface is being fixed for: with no verdict line at all, a
  // finding that survived refutation and one that was never adjudicated rendered
  // as the same comment.
  test('says a missing verdict is missing instead of omitting the line', () => {
    const report = createReportFixture()
    const withRefutation = bodyFor({
      ...report,
      refutationResults: [refutation],
      admittedFindings: [
        { ...report.admittedFindings[0]!, refutationId: 'refute_join1' }
      ]
    })
    const withoutRefutation = bodyFor(report)

    expect(withoutRefutation).toContain(
      '- **Survived refutation:** no verdict was recorded against this finding, so what it survived cannot be shown here.'
    )
    expect(withoutRefutation).not.toBe(withRefutation)
  })

  test('names an evidence id whose record is missing rather than dropping it', () => {
    const body = bodyFor({ ...createReportFixture(), evidence: [] })

    expect(body).toContain(
      '`ev_diff1` (no evidence record for this id is in the report)'
    )
  })

  test('cites at most three addresses and points at the report for the rest', () => {
    const report = createReportFixture()
    const evidenceRecord = report.evidence[0]!
    const evidenceIds = ['ev_diff1', 'ev_diff2', 'ev_diff3', 'ev_diff4', 'ev_diff5']
    const body = bodyFor({
      ...report,
      evidence: evidenceIds.map((id, index) => ({
        ...evidenceRecord,
        id,
        location: { ...evidenceRecord.location, startLine: index + 1 }
      })),
      admittedFindings: [{ ...report.admittedFindings[0]!, evidenceIds }]
    })

    expect(body).toContain(
      '- **Rests on:** file at `src/app.ts:1`; file at `src/app.ts:2`; file at `src/app.ts:3`; and 2 more in the run report'
    )
    expect(body).not.toContain('src/app.ts:4')
  })

  // The body has a hard cap, and the proof sits after the description. A blind
  // tail truncation would therefore take the proof off exactly the findings with
  // the most to say, so the description is what gives way instead.
  test('a description that fills the cap loses its own tail, never the proof', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    // Worst case for the cap: every character escapes to five (`&` -> `&amp;`),
    // at the contract's maximum description length.
    const body = bodyFor({
      ...report,
      refutationResults: [refutation],
      admittedFindings: [
        {
          ...finding,
          description: '&'.repeat(1200),
          refutationId: 'refute_join1'
        }
      ]
    })

    expect(body.length).toBeLessThanOrEqual(3000)
    expect(body).toContain('- **Survived refutation** (proved):')
    expect(body).toContain('- **Rests on:** file at `src/app.ts:4`')
    expect(body).toContain(`Finding: ${finding.id}`)
    // Cut short, and cut where a reader can see it — never mid-entity, which
    // would render as a literal `&amp`.
    expect(body).toContain('…')
    expect(body).not.toMatch(/&[A-Za-z#][A-Za-z0-9]*…/u)
  })

  test('bounds a refutation summary that would crowd out the finding', () => {
    const report = createReportFixture()
    const body = bodyFor({
      ...report,
      refutationResults: [
        { ...refutation, summary: `${'r'.repeat(999)}!` }
      ],
      admittedFindings: [
        { ...report.admittedFindings[0]!, refutationId: 'refute_join1' }
      ]
    })

    expect(body).toContain(`${'r'.repeat(399)}…`)
    expect(body).not.toContain('!')
  })
})

// This is the assertion that would have caught the review-comment surface
// shipping at zero: every model-origin finding was stamped `side: 'file'`, which
// no admitted finding could turn into an inline draft, so the whole feature
// produced nothing on real runs while every layer's own unit tests passed on
// hand-written `side: 'new'` fixtures.
describe('model-origin finding to platform review comment', () => {
  const modelCandidate: CandidateFinding = {
    id: 'cand_model1',
    taskId: 'task_model1',
    category: 'bug',
    severity: 'high',
    title: 'Incorrect return branch',
    description: 'The changed branch can return an incorrect value.',
    // Exactly what `mapCandidate` in holistic discovery produces: a whole-file
    // location, because the model read line-numbered file content.
    location: { path: 'src/app.ts', startLine: 4, side: 'file' },
    evidenceIds: ['ev_diff1'],
    proposedBy: 'review-agent',
    fixProposal: {
      summary: 'Return the computed value from the changed branch.',
      evidenceIds: ['ev_diff1'],
      safety: 'manual-review',
      edits: [
        {
          path: 'src/app.ts',
          startLine: 4,
          endLine: 4,
          replacement: 'return computedValue'
        }
      ]
    }
  }

  const policy: AdmissionPolicy = {
    reviewedPaths: ['src/app.ts'],
    reviewedLineRanges: [{ path: 'src/app.ts', startLine: 1, endLine: 20 }],
    reviewedDiffRanges: [{ path: 'src/app.ts', startLine: 3, endLine: 6 }],
    minimumSeverity: 'low',
    inlineSeverityThreshold: 'high',
    provenance: {
      reviewer: 'review-agent',
      modelProvider: 'openai',
      modelName: 'gpt-5-mini',
      instructionHashes: [],
      skillHashes: [],
      signalVersions: { typescript: '6.0.3' },
      configHash: '1'.repeat(64)
    },
    admittedAt: '2026-06-20T00:00:00.000Z'
  }

  const draftsForRun = (): ReturnType<typeof buildReviewCommentDrafts> => {
    const report = createReportFixture()
    const admission = admitCandidate({
      candidate: modelCandidate,
      evidence: report.evidence,
      existingAdmittedFindings: [],
      policy
    })

    expect(admission.status).toBe('admitted')

    return buildReviewCommentDrafts({
      ...report,
      admittedFindings: [admission.admittedFinding!],
      qualityGate: {
        ...report.qualityGate,
        failingFindingIds: []
      }
    })
  }

  test('produces one neutral draft with a structured suggestion', () => {
    const drafts = draftsForRun()

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      path: 'src/app.ts',
      targetRange: { startLine: 4, endLine: 4 },
      suggestion: { replacement: 'return computedValue' }
    })
  })

  test('renders on every comment platform with its own suggestion syntax', () => {
    const drafts = draftsForRun()

    const [github] = renderReviewComments(drafts, 'github')
    expect(github).toMatchObject({ line: 4, side: 'RIGHT' })
    expect(github?.body).toContain('```suggestion\nreturn computedValue\n```')

    const [gitlab] = renderReviewComments(drafts, 'gitlab')
    expect(gitlab).toMatchObject({ line: 4 })
    expect(gitlab?.body).toContain(
      '```suggestion:-0+0\nreturn computedValue\n```'
    )

    // Bitbucket has no one-click apply, so the replacement degrades to a plain
    // fenced block.
    const [bitbucket] = renderReviewComments(drafts, 'bitbucket')
    expect(bitbucket).toMatchObject({ line: 4 })
    expect(bitbucket?.body).toContain('```\nreturn computedValue\n```')
    expect(bitbucket?.body).not.toContain('```suggestion')
  })
})
